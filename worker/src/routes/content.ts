import { Hono, type Context } from 'hono';
import type { Env } from '../index';

type C = Context<{ Bindings: Env; Variables: { userId: number } }>;
const r = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
const GH = 'https://api.github.com';
const bad = (error: string, code?: string, extra: object = {}) => ({ ok: false, error, ...(code ? { code } : {}), ...extra });
const clamp = (v: string | undefined, min: number, max: number, d: number) => Math.min(max, Math.max(min, parseInt(v ?? '', 10) || d));
const hasNext = (res: Response) => /rel="next"/.test(res.headers.get('link') ?? '');
const BIN_EXT = new Set('png jpg jpeg gif webp bmp ico pdf zip gz tgz tar bz2 xz 7z rar exe dll so dylib bin class jar war o a wasm mp3 mp4 mov avi mkv wav flac ogg woff woff2 ttf otf eot psd ai sketch db sqlite pyc'.split(' '));
const MAX_BYTES = 512 * 1024; // larger files are never fetched into the UI

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
function safePath(p: string | undefined): string | null {
  const v = (p ?? '').replace(/\/+$/, '');
  if (v === '') return '';
  if (v.length > 300 || /[\\\u0000-\u001f]/.test(v) || v.startsWith('/') || v.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return v;
}
const safeRef = (v: string | undefined) => (v && /^[\w./-]{1,100}$/.test(v) && !v.includes('..') ? v : null);

async function repoFor(c: C) {
  return c.env.DB.prepare('SELECT id, full_name, default_branch FROM repositories WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), c.get('userId')).first<{ id: number; full_name: string; default_branch: string | null }>();
}

// Single choke point for GitHub calls: consistent error and rate-limit mapping. Content is only ever returned as data, never executed.
async function gh(c: C, path: string, okStatuses: number[] = []): Promise<{ res: Response } | { err: Response }> {
  const headers: Record<string, string> = { 'User-Agent': 'drex-analyser', Accept: 'application/vnd.github+json' };
  if (c.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${c.env.GITHUB_TOKEN}`;
  let res: Response;
  try { res = await fetch(`${GH}${path}`, { headers }); } catch { return { err: c.json(bad('Could not reach GitHub', 'unreachable'), 502) }; }
  if (res.ok || okStatuses.includes(res.status)) return { res };
  const limited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')));
  if (limited) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    return { err: c.json(bad('GitHub API rate limit reached', 'rate_limited', { resetAt: reset ? new Date(reset * 1000).toISOString() : null }), 429) };
  }
  if (res.status === 404) return { err: c.json(bad('Not found on GitHub', 'not_found'), 404) };
  if (res.status === 403) return { err: c.json(bad('GitHub denied access to this resource', 'forbidden'), 403) };
  return { err: c.json(bad('GitHub request failed', 'github_error'), 502) };
}
const done = (c: C, data: unknown) => { c.header('Cache-Control', 'private, max-age=60'); return c.json({ ok: true, data }); };

r.get('/repositories/:id{[0-9]+}/files', async (c) => {
  const repo = await repoFor(c);
  if (!repo) return c.json(bad('Repository not found'), 404);
  const path = safePath(c.req.query('path'));
  if (path === null) return c.json(bad('Invalid path', 'invalid_path'), 400);
  const ref = safeRef(c.req.query('ref'));
  const out = await gh(c, `/repos/${repo.full_name}/contents${path ? '/' + encPath(path) : ''}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
  if ('err' in out) return out.err;
  const j = (await out.res.json()) as any;
  if (!Array.isArray(j)) return c.json(bad('Path is a file', 'not_a_directory'), 400);
  const rank = (t: string) => (t === 'dir' ? 0 : 1);
  const entries = j.map((e: any) => ({
    name: String(e.name), path: String(e.path), type: ['file', 'dir', 'symlink', 'submodule'].includes(e.type) ? e.type : 'file', size: e.type === 'file' ? Number(e.size) || 0 : null,
  })).sort((a: any, b: any) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name));
  return done(c, { path, entries, truncated: entries.length >= 1000 });
});

r.get('/repositories/:id{[0-9]+}/file', async (c) => {
  const repo = await repoFor(c);
  if (!repo) return c.json(bad('Repository not found'), 404);
  const path = safePath(c.req.query('path'));
  if (!path) return c.json(bad('Invalid path', 'invalid_path'), 400);
  const ref = safeRef(c.req.query('ref'));
  const out = await gh(c, `/repos/${repo.full_name}/contents/${encPath(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
  if ('err' in out) return out.err;
  const j = (await out.res.json()) as any;
  if (Array.isArray(j)) return c.json(bad('Path is a directory', 'not_a_file'), 400);
  const name = String(j.name ?? path.split('/').pop());
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const meta = { path, name, size: Number(j.size) || 0, extension, html_url: `https://github.com/${repo.full_name}/blob/${ref ?? repo.default_branch ?? 'HEAD'}/${encPath(path)}` };
  if (j.type === 'symlink' || j.type === 'submodule') return done(c, { kind: 'unsupported', ...meta });
  if (BIN_EXT.has(extension)) return done(c, { kind: 'binary', ...meta });
  if (meta.size > MAX_BYTES || j.encoding !== 'base64' || typeof j.content !== 'string') return done(c, { kind: 'too_large', ...meta });
  const bin = atob(j.content.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  if (bytes.subarray(0, 8000).includes(0)) return done(c, { kind: 'binary', ...meta });
  return done(c, { kind: 'text', content: new TextDecoder('utf-8').decode(bytes), ...meta });
});

const person = (x: any) => ({ author_name: x.commit?.author?.name ?? 'Unknown', author_login: x.author?.login ?? null, avatar_url: x.author?.avatar_url ?? null, date: x.commit?.author?.date ?? null });

r.get('/repositories/:id{[0-9]+}/commits', async (c) => {
  const repo = await repoFor(c);
  if (!repo) return c.json(bad('Repository not found'), 404);
  const page = clamp(c.req.query('page'), 1, 1000, 1), per = clamp(c.req.query('per_page'), 1, 50, 30);
  const path = safePath(c.req.query('path'));
  if (path === null) return c.json(bad('Invalid path', 'invalid_path'), 400);
  const out = await gh(c, `/repos/${repo.full_name}/commits?per_page=${per}&page=${page}${path ? `&path=${encodeURIComponent(path)}` : ''}`, [409]);
  if ('err' in out) return out.err;
  if (out.res.status === 409) return done(c, { items: [], page, hasNext: false }); // empty repository
  const j = (await out.res.json()) as any[];
  const items = j.map((x) => {
    const [first, ...rest] = String(x.commit?.message ?? '').split('\n');
    return { sha: x.sha, short: String(x.sha).slice(0, 7), message: first.slice(0, 200), body: rest.join('\n').trim().slice(0, 2000), ...person(x), html_url: `https://github.com/${repo.full_name}/commit/${x.sha}` };
  });
  return done(c, { items, page, hasNext: hasNext(out.res) });
});

r.get('/repositories/:id{[0-9]+}/commits/:sha', async (c) => {
  const repo = await repoFor(c);
  if (!repo) return c.json(bad('Repository not found'), 404);
  const sha = c.req.param('sha');
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return c.json(bad('Invalid commit SHA', 'invalid_sha'), 400);
  const out = await gh(c, `/repos/${repo.full_name}/commits/${sha}`);
  if ('err' in out) return out.err;
  const j = (await out.res.json()) as any;
  const all: any[] = Array.isArray(j.files) ? j.files : [];
  return done(c, {
    sha: j.sha, short: String(j.sha).slice(0, 7), message: String(j.commit?.message ?? ''), ...person(j),
    stats: { additions: j.stats?.additions ?? 0, deletions: j.stats?.deletions ?? 0, total: j.stats?.total ?? 0 },
    parents: (j.parents ?? []).map((p: any) => String(p.sha).slice(0, 7)),
    files: all.slice(0, 100).map((f) => ({ filename: String(f.filename), status: String(f.status), additions: f.additions ?? 0, deletions: f.deletions ?? 0, previous_filename: f.previous_filename ?? null })),
    files_total: all.length, files_truncated: all.length > 100,
    html_url: `https://github.com/${repo.full_name}/commit/${j.sha}`,
  });
});

r.get('/repositories/:id{[0-9]+}/releases', async (c) => {
  const repo = await repoFor(c);
  if (!repo) return c.json(bad('Repository not found'), 404);
  const page = clamp(c.req.query('page'), 1, 100, 1);
  const [out, latest] = await Promise.all([
    gh(c, `/repos/${repo.full_name}/releases?per_page=20&page=${page}`),
    page === 1 ? gh(c, `/repos/${repo.full_name}/releases/latest`, [404]) : Promise.resolve(null),
  ]);
  if ('err' in out) return out.err;
  const latestId = latest && 'res' in latest && latest.res.ok ? ((await latest.res.json()) as any).id ?? null : null;
  const j = (await out.res.json()) as any[];
  const items = j.filter((x) => !x.draft).map((x) => { // drafts are never shown: they are only visible to people with push access
    const tag = String(x.tag_name);
    return {
      id: x.id, name: String(x.name || tag), tag, prerelease: !!x.prerelease, is_latest: latestId !== null && x.id === latestId,
      published_at: x.published_at ?? x.created_at ?? null, author_login: x.author?.login ?? null, body: String(x.body ?? '').slice(0, 20000),
      html_url: `https://github.com/${repo.full_name}/releases/tag/${encodeURIComponent(tag)}`,
      assets: (x.assets ?? []).map((a: any) => ({
        name: String(a.name), size: a.size ?? 0, download_count: a.download_count ?? 0, content_type: a.content_type ?? null,
        url: typeof a.browser_download_url === 'string' && a.browser_download_url.startsWith('https://github.com/') ? a.browser_download_url : null,
      })).filter((a: any) => a.url),
    };
  });
  return done(c, { items, page, hasNext: hasNext(out.res), latestId });
});

export default r;
