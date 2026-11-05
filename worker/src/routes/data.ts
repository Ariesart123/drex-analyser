import { Hono } from 'hono';
import type { Env } from '../index';
import { parseRepoUrls } from '../lib/parse';

type Status = 'imported' | 'exists' | 'not_found' | 'rate_limited' | 'failed';
const r = new Hono<{ Bindings: Env; Variables: { userId: number } }>();

r.get('/dashboard', async (c) => {
  const uid = c.get('userId'), db = c.env.DB;
  const [tot, langs, recent] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(is_starred),0) AS starred,
      (SELECT COUNT(*) FROM folders WHERE user_id = ?1) AS folders FROM repositories WHERE user_id = ?1`).bind(uid).first<{ total: number; starred: number; folders: number }>(),
    db.prepare(`SELECT COALESCE(language,'Unknown') AS language, COUNT(*) AS n FROM repositories WHERE user_id = ? GROUP BY 1 ORDER BY n DESC LIMIT 8`).bind(uid).all(),
    db.prepare(`SELECT id, full_name, description, language, stars, forks, pushed_at, url FROM repositories WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 5`).bind(uid).all(),
  ]);
  return c.json({ ok: true, data: { ...tot, languages: langs.results, recent: recent.results } });
});

r.get('/repositories', async (c) => {
  const uid = c.get('userId');
  const q = `%${(c.req.query('q') ?? '').slice(0, 100)}%`;
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const where = `user_id = ?1 AND (full_name LIKE ?2 OR COALESCE(description,'') LIKE ?2)`;
  const [items, total] = await Promise.all([
    c.env.DB.prepare(`SELECT id, full_name, description, language, stars, forks, pushed_at, url FROM repositories WHERE ${where} ORDER BY pushed_at DESC LIMIT 30 OFFSET ?3`).bind(uid, q, (page - 1) * 30).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM repositories WHERE ${where}`).bind(uid, q).first<{ n: number }>(),
  ]);
  return c.json({ ok: true, data: { items: items.results, total: total?.n ?? 0 } });
});

r.get('/repositories/:id{[0-9]+}', async (c) => {
  const row = await c.env.DB.prepare(`SELECT id, owner, name, full_name, url, description, language, stars, forks, visibility, default_branch, license, pushed_at, created_at
    FROM repositories WHERE id = ? AND user_id = ?`).bind(Number(c.req.param('id')), c.get('userId')).first();
  return row ? c.json({ ok: true, data: row }) : c.json({ ok: false, error: 'Repository not found' }, 404);
});

r.get('/repositories/:id{[0-9]+}/readme', async (c) => {
  const repo = await c.env.DB.prepare('SELECT full_name FROM repositories WHERE id = ? AND user_id = ?').bind(Number(c.req.param('id')), c.get('userId')).first<{ full_name: string }>();
  if (!repo) return c.json({ ok: false, error: 'Repository not found' }, 404);
  const headers: Record<string, string> = { 'User-Agent': 'drex-analyser', Accept: 'application/vnd.github+json' };
  if (c.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${c.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo.full_name}/readme`, { headers });
  if (res.status === 404) return c.json({ ok: true, data: null });
  if (res.status === 403 || res.status === 429) return c.json({ ok: false, error: 'GitHub API rate limit reached' }, 429);
  if (!res.ok) return c.json({ ok: false, error: 'Could not fetch README' }, 502);
  const g = (await res.json()) as { path: string; content: string; size: number };
  if (g.size > 400_000) return c.json({ ok: true, data: { path: g.path, content: '_README is too large to preview. Open it on GitHub._' } });
  const bin = atob(g.content.replace(/\n/g, ''));
  return c.json({ ok: true, data: { path: g.path, content: new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))) } });
});

r.post('/repositories/import', async (c) => {
  const uid = c.get('userId');
  const body = await c.req.json<{ urls?: unknown }>().catch(() => ({ urls: undefined }));
  if (!Array.isArray(body.urls) || body.urls.length === 0 || body.urls.length > 20 || !body.urls.every((u) => typeof u === 'string' && u.length < 300))
    return c.json({ ok: false, error: 'urls must be 1-20 strings' }, 400);
  const parsed = parseRepoUrls(body.urls.join('\n'));
  const headers: Record<string, string> = { 'User-Agent': 'drex-analyser', Accept: 'application/vnd.github+json' };
  const token = (c.env as Env & { GITHUB_TOKEN?: string }).GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const results = await Promise.all(parsed.valid.map(async (p) => {
    const mk = (status: Status) => ({ input: p.url, fullName: p.fullName, status });
    try {
      const ex = await c.env.DB.prepare('SELECT 1 FROM repositories WHERE user_id = ? AND lower(full_name) = lower(?)').bind(uid, p.fullName).first();
      if (ex) return mk('exists');
      const res = await fetch(`https://api.github.com/repos/${p.fullName}`, { headers });
      if (res.status === 404) return mk('not_found');
      if (res.status === 403 || res.status === 429) return mk('rate_limited');
      if (!res.ok) return mk('failed');
      const g = (await res.json()) as any;
      await c.env.DB.prepare(`INSERT INTO repositories (user_id, github_repo_id, owner, name, full_name, url, description, language, stars, forks,
        visibility, default_branch, license, pushed_at, last_checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(user_id, full_name) DO NOTHING`)
        .bind(uid, g.id, g.owner.login, g.name, g.full_name, g.html_url, g.description, g.language, g.stargazers_count, g.forks_count,
          g.private ? 'private' : 'public', g.default_branch, g.license?.spdx_id ?? null, g.pushed_at).run();
      return mk('imported');
    } catch { return mk('failed'); }
  }));
  return c.json({ ok: true, data: { results, invalid: parsed.invalid, duplicates: parsed.duplicates } });
});

export default r;
