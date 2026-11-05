import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup } from './helpers/env';
import app from '../worker/src/index';

afterEach(() => vi.unstubAllGlobals());
const J = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
const b64 = (s: string | Uint8Array) => btoa(String.fromCharCode(...(typeof s === 'string' ? new TextEncoder().encode(s) : s)));
const R = '/repos/acme/fastcli';
const enc = encodeURIComponent;

describe('file explorer API', () => {
  it('lists real directory contents (dirs first), passes path and ref safely', async () => {
    const t = await setup();
    t.setGh((u) => {
      if (u.pathname === `${R}/contents`) return J([{ name: 'README.md', path: 'README.md', type: 'file', size: 10 }, { name: 'src', path: 'src', type: 'dir', size: 0 }, { name: 'Z', path: 'Z', type: 'submodule' }]);
      if (u.pathname === `${R}/contents/src/lib%20x` && u.search === '?ref=dev') return J([{ name: 'a.py', path: 'src/lib x/a.py', type: 'file', size: 5 }]);
    });
    const root = (await (await t.call(1, 'GET', '/api/repositories/1/files')).json()).data;
    expect(root.entries.map((e: any) => [e.name, e.type, e.size])).toEqual([['src', 'dir', null], ['README.md', 'file', 10], ['Z', 'submodule', null]]);
    const sub = (await (await t.call(1, 'GET', `/api/repositories/1/files?path=${enc('src/lib x')}&ref=dev`)).json()).data;
    expect(sub.path).toBe('src/lib x'); expect(sub.entries[0].name).toBe('a.py');
  });
  it('rejects path traversal and malformed paths before contacting GitHub', async () => {
    const t = await setup();
    for (const p of ['../etc', 'a/../b', '/abs', 'a\\b', 'a//b', 'x/./y']) expect((await t.call(1, 'GET', `/api/repositories/1/files?path=${enc(p)}`)).status).toBe(400);
    expect((await t.call(1, 'GET', `/api/repositories/1/file?path=${enc('../x')}`)).status).toBe(400);
    expect((await t.call(1, 'GET', '/api/repositories/1/file')).status).toBe(400);
    expect(t.ghCalls).toEqual([]);
  });
  it('returns decoded UTF-8 text with metadata', async () => {
    const t = await setup();
    t.setGh((u) => u.pathname === `${R}/contents/src/main.py` ? J({ type: 'file', name: 'main.py', path: 'src/main.py', size: 16, encoding: 'base64', content: b64('print("héllo")\n').replace(/(.{10})/g, '$1\n') }) : undefined);
    const j = (await (await t.call(1, 'GET', `/api/repositories/1/file?path=${enc('src/main.py')}`)).json()).data;
    expect(j).toMatchObject({ kind: 'text', content: 'print("héllo")\n', extension: 'py', name: 'main.py', size: 16, html_url: 'https://github.com/acme/fastcli/blob/main/src/main.py' });
  });
  it('never returns content for binary, oversized or unsupported files', async () => {
    const t = await setup();
    t.setGh((u) => {
      const f = (o: object) => J({ type: 'file', encoding: 'base64', ...o });
      if (u.pathname.endsWith('/logo.png')) return f({ name: 'logo.png', path: 'logo.png', size: 3, content: b64('abc') });
      if (u.pathname.endsWith('/data.dat')) return f({ name: 'data.dat', path: 'data.dat', size: 3, content: b64(new Uint8Array([1, 0, 2])) });
      if (u.pathname.endsWith('/big.txt')) return f({ name: 'big.txt', path: 'big.txt', size: 600000, content: b64('x'.repeat(100)) });
      if (u.pathname.endsWith('/huge.txt')) return J({ type: 'file', name: 'huge.txt', path: 'huge.txt', size: 5_000_000, encoding: 'none', content: '' });
      if (u.pathname.endsWith('/link')) return J({ type: 'symlink', name: 'link', path: 'link', size: 4 });
      if (u.pathname.endsWith('/sub')) return J([{ name: 'x', path: 'sub/x', type: 'file', size: 1 }]);
    });
    for (const [path, kind] of [['logo.png', 'binary'], ['data.dat', 'binary'], ['big.txt', 'too_large'], ['huge.txt', 'too_large'], ['link', 'unsupported']]) {
      const j = (await (await t.call(1, 'GET', `/api/repositories/1/file?path=${path}`)).json()).data;
      expect(j.kind).toBe(kind); expect(j.content).toBeUndefined();
    }
    expect((await t.call(1, 'GET', '/api/repositories/1/file?path=sub')).status).toBe(400);   // directory
    expect((await t.call(1, 'GET', '/api/repositories/1/files?path=big.txt')).status).toBe(400); // file
  });
});

describe('commits API', () => {
  const commit = (n: number) => ({ sha: `abcdef${n}0123456789`, html_url: 'x', commit: { message: `Fix bug ${n}\n\nLong body`, author: { name: 'Ada', date: '2026-01-01T00:00:00Z' } }, author: { login: 'ada', avatar_url: 'https://a/b.png' } });
  it('maps history and paginates (page, per_page clamp, hasNext)', async () => {
    const t = await setup(); let seen: URL | undefined;
    t.setGh((u) => { if (u.pathname === `${R}/commits`) { seen = u; return J([commit(1), commit(2)], 200, { link: '<https://api.github.com/x?page=3>; rel="next"' }); } });
    const j = (await (await t.call(1, 'GET', '/api/repositories/1/commits?page=2&per_page=500')).json()).data;
    expect([seen!.searchParams.get('page'), seen!.searchParams.get('per_page')]).toEqual(['2', '50']);
    expect(j.page).toBe(2); expect(j.hasNext).toBe(true);
    expect(j.items[0]).toMatchObject({ short: 'abcdef1', message: 'Fix bug 1', body: 'Long body', author_name: 'Ada', author_login: 'ada', date: '2026-01-01T00:00:00Z', html_url: 'https://github.com/acme/fastcli/commit/abcdef10123456789' });
    await t.call(1, 'GET', '/api/repositories/1/commits?page=0'); expect(seen!.searchParams.get('page')).toBe('1');
  });
  it('last page has no next; empty repository (409) is an empty list', async () => {
    const t = await setup();
    t.setGh(() => J([commit(1)]));
    expect((await (await t.call(1, 'GET', '/api/repositories/1/commits')).json()).data.hasNext).toBe(false);
    t.setGh(() => J({ message: 'Git Repository is empty.' }, 409));
    expect((await (await t.call(1, 'GET', '/api/repositories/1/commits')).json()).data).toMatchObject({ items: [], hasNext: false });
  });
  it('commit detail: changed files (capped), stats; invalid SHA rejected; unknown commit 404', async () => {
    const t = await setup();
    t.setGh((u) => {
      if (u.pathname === `${R}/commits/abc1234`) return J({ ...commit(1), sha: 'abc1234'.padEnd(40, '0'), stats: { additions: 9, deletions: 2, total: 11 }, parents: [{ sha: 'deadbeef00' }],
        files: Array.from({ length: 120 }, (_, i) => ({ filename: `f${i}.ts`, status: 'modified', additions: 1, deletions: 0 })) });
      return J({}, 404);
    });
    const j = (await (await t.call(1, 'GET', '/api/repositories/1/commits/abc1234')).json()).data;
    expect(j).toMatchObject({ files_total: 120, files_truncated: true, stats: { additions: 9, deletions: 2, total: 11 }, parents: ['deadbee'] });
    expect(j.files).toHaveLength(100);
    expect((await t.call(1, 'GET', '/api/repositories/1/commits/nothex')).status).toBe(400);
    expect((await t.call(1, 'GET', '/api/repositories/1/commits/ffff000')).status).toBe(404);
  });
});

describe('releases API', () => {
  it('filters drafts, flags latest, keeps prereleases, only GitHub-hosted assets', async () => {
    const t = await setup();
    t.setGh((u) => {
      if (u.pathname === `${R}/releases/latest`) return J({ id: 2 });
      if (u.pathname === `${R}/releases`) return J([
        { id: 1, tag_name: 'v2.0.0-rc1', name: '', prerelease: true, draft: false, published_at: '2026-02-01', body: 'rc notes', assets: [] },
        { id: 2, tag_name: 'v1.0.0', name: 'One', prerelease: false, draft: false, published_at: '2026-01-01', body: '# notes', assets: [
          { name: 'a.zip', size: 5, download_count: 3, content_type: 'application/zip', browser_download_url: 'https://github.com/acme/fastcli/releases/download/v1.0.0/a.zip' },
          { name: 'evil', size: 1, browser_download_url: 'https://evil.example/x' }] },
        { id: 3, tag_name: 'v3-draft', draft: true },
      ], 200, { link: '<x>; rel="next"' });
    });
    const j = (await (await t.call(1, 'GET', '/api/repositories/1/releases')).json()).data;
    expect(j.items.map((r: any) => [r.id, r.name, r.prerelease, r.is_latest])).toEqual([[1, 'v2.0.0-rc1', true, false], [2, 'One', false, true]]);
    expect(j.items[1].assets).toEqual([{ name: 'a.zip', size: 5, download_count: 3, content_type: 'application/zip', url: 'https://github.com/acme/fastcli/releases/download/v1.0.0/a.zip' }]);
    expect(j.hasNext).toBe(true);
  });
  it('repositories without releases return an empty list; page 2 skips the latest lookup', async () => {
    const t = await setup();
    t.setGh((u) => (u.pathname.endsWith('/releases/latest') ? J({}, 404) : J([])));
    expect((await (await t.call(1, 'GET', '/api/repositories/1/releases')).json()).data).toMatchObject({ items: [], latestId: null, hasNext: false });
    t.ghCalls.length = 0; await t.call(1, 'GET', '/api/repositories/1/releases?page=2');
    expect(t.ghCalls.some((c) => c.includes('/releases/latest'))).toBe(false);
  });
});

describe('GitHub errors and permissions', () => {
  const paths = ['files', 'file?path=a.txt', 'commits', 'commits/abc1234', 'releases'];
  it.each(paths)('%s: rate limit -> 429 with reset time; 404; 5xx; network failure; plain 403', async (p) => {
    const t = await setup();
    t.setGh(() => J({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1893456000' }));
    let r = await t.call(1, 'GET', `/api/repositories/1/${p}`); let j = await r.json();
    expect([r.status, j.code, j.resetAt]).toEqual([429, 'rate_limited', '2030-01-01T00:00:00.000Z']);
    t.setGh(() => J({}, 404)); expect((await t.call(1, 'GET', `/api/repositories/1/${p}`)).status).toBe(404);
    t.setGh(() => J({}, 500)); expect((await t.call(1, 'GET', `/api/repositories/1/${p}`)).status).toBe(502);
    t.setGh(() => J({}, 403)); expect((await t.call(1, 'GET', `/api/repositories/1/${p}`)).status).toBe(403);
    t.setGh(() => { throw new TypeError('down'); });
    r = await t.call(1, 'GET', `/api/repositories/1/${p}`); expect([r.status, (await r.json()).code]).toEqual([502, 'unreachable']);
  });
  it.each(paths)('%s: other users and anonymous requests are denied without contacting GitHub', async (p) => {
    const t = await setup(); t.setGh(() => J([]));
    expect((await t.call(2, 'GET', `/api/repositories/1/${p}`)).status).toBe(404);
    expect((await app.request(`/api/repositories/1/${p}`, {}, t.env)).status).toBe(401);
    expect(t.ghCalls).toEqual([]);
    expect((await t.call(2, 'GET', '/api/repositories/2/files')).status).toBe(200); // own repository works
  });
});
