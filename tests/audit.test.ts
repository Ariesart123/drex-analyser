import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app from '../worker/src/index';
import { DatabaseSync, setup } from './helpers/env';
import { sha256 } from '../worker/src/lib/crypto';
import { PLATFORM_MODELS, DEFAULT_PLATFORM_MODEL, assertSafeBaseUrl, callPlatform } from '../worker/src/ai/provider';

afterEach(() => vi.unstubAllGlobals());
const WORKER = 'https://drex-analyser.me.workers.dev', SITE = 'https://drex.vercel.app';
const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const jj = async (r: Response) => (await r.json()) as any;
const cookies = (res: Response) => res.headers.getSetCookie();
const cookieVal = (res: Response, name: string) => cookies(res).find((c) => c.startsWith(name + '='))!.split(';')[0].split('=')[1];

// Simulates the Vercel rewrite: the browser talks to SITE, Vercel forwards to the Worker host keeping cookies + Origin.
const viaVercel = (t: Awaited<ReturnType<typeof setup>>) => (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  app.request(`${WORKER}${path}`, { ...init, redirect: 'manual', headers: { origin: SITE, ...(init.headers ?? {}) } }, t.env);

describe('1. every data route requires authentication', () => {
  it('returns 401 without a session for all non-public /api routes', async () => {
    const t = await setup();
    const PUBLIC = new Set(['/api/health', '/api/auth/github', '/api/auth/callback', '/api/auth/logout']);
    const sub = (p: string) => p.replace(/:(\w+)(\{[^}]*\})?/g, (_m, n) => (n === 'sha' ? 'abc1234' : n === 'provider' ? 'gemini' : '1'));
    const seen = new Set<string>();
    for (const r of app.routes) {
      if (!r.path.startsWith('/api/') || PUBLIC.has(r.path) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)) continue;
      const key = `${r.method} ${r.path}`; if (seen.has(key)) continue; seen.add(key);
      const res = await app.request(sub(r.path), { method: r.method }, t.env);
      expect([key, res.status]).toEqual([key, 401]);
    }
    expect(seen.size).toBeGreaterThanOrEqual(22);
    for (const k of ['POST /api/ai/chat', 'GET /api/auth/me', 'GET /api/repositories/:id{[0-9]+}/file', 'PUT /api/ai/providers/:provider', 'POST /api/repositories/import']) expect(seen).toContain(k);
  });
});

describe('9. CSRF, CORS and security headers', () => {
  it('blocks cross-origin state changes (even with a valid cookie) and allows the site origin', async () => {
    const t = await setup();
    let r = await t.call(1, 'POST', '/api/ai/chat', { repositoryId: 1, message: 'hi' }, { origin: 'https://evil.example' });
    expect([r.status, (await r.json()).code]).toEqual([403, 'csrf']);
    r = await t.call(1, 'POST', '/api/ai/chat', { repositoryId: 1, message: 'Tell me a joke' }, { origin: 'null' });
    expect(r.status).toBe(403);
    r = await t.call(1, 'POST', '/api/ai/chat', { repositoryId: 1, message: 'hi' }, { 'sec-fetch-site': 'cross-site' });
    expect(r.status).toBe(403);
    r = await t.call(1, 'POST', '/api/ai/chat', { repositoryId: 1, message: 'Tell me a joke' }, { origin: SITE });
    expect(r.status).toBe(200);
  });
  it('emits no CORS headers, answers preflight without allowing origins, sets security headers and no-store', async () => {
    const t = await setup();
    const pre = await app.request('/api/ai/chat', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } }, t.env);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    const res = await app.request('/api/auth/me', { headers: { origin: 'https://evil.example', cookie: 'drex_session=tok1' } }, t.env);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await app.request('/api/nope', {}, t.env)).status).toBe(404);
  });
  it('private GitHub content responses stay private (not shared-cacheable on the Vercel edge)', async () => {
    const t = await setup(); t.setGh(() => J([]));
    expect((await t.call(1, 'GET', '/api/repositories/1/files')).headers.get('cache-control')).toBe('private, max-age=60');
  });
});

describe('3/4/5. GitHub OAuth + session cookies through the Vercel proxy', () => {
  it('full login -> session -> logout flow', async () => {
    const t = await setup(); const px = viaVercel(t);
    // start
    const start = await px('/api/auth/github');
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${SITE}/api/auth/callback`);
    expect(loc.searchParams.get('client_id')).toBe('cid'); expect(loc.searchParams.get('scope')).toBe('read:user');
    const state = loc.searchParams.get('state')!;
    const sc = cookies(start).find((c) => c.startsWith('drex_oauth_state='))!;
    expect(sc).toContain(state); expect(sc).toMatch(/HttpOnly/i); expect(sc).toMatch(/Secure/i); expect(sc).toMatch(/SameSite=Lax/i); expect(sc).not.toMatch(/Domain=/i);
    // bad state -> friendly redirect, no session
    let bad = await px(`/api/auth/callback?code=x&state=WRONG`, { headers: { cookie: `drex_oauth_state=${state}` } });
    expect(bad.headers.get('location')).toBe(`${SITE}/?login_error=state`);
    expect((await px(`/api/auth/callback?error=access_denied`, { headers: { cookie: `drex_oauth_state=${state}` } })).headers.get('location')).toBe(`${SITE}/?login_error=denied`);
    // success
    let exchangeBody: any;
    t.setGh((u, init) => {
      if (u.pathname === '/login/oauth/access_token') { exchangeBody = JSON.parse(init.body); return J({ access_token: 'gho_token' }); }
      if (u.pathname === '/user') return J({ id: 555, login: 'octo', avatar_url: 'https://a/x.png', email: null });
    });
    const ok = await px(`/api/auth/callback?code=abc&state=${state}`, { headers: { cookie: `drex_oauth_state=${state}` } });
    expect(ok.headers.get('location')).toBe(`${SITE}/`);
    expect(exchangeBody).toMatchObject({ client_id: 'cid', client_secret: 'csecret', code: 'abc', redirect_uri: `${SITE}/api/auth/callback` });
    const sess = cookies(ok).find((c) => c.startsWith('drex_session='))!;
    expect(sess).toMatch(/HttpOnly/i); expect(sess).toMatch(/Secure/i); expect(sess).toMatch(/SameSite=Lax/i); expect(sess).toMatch(/Max-Age=2592000/); expect(sess).not.toMatch(/Domain=/i);
    expect(cookies(ok).some((c) => c.startsWith('drex_oauth_state=') && /Max-Age=0|Expires=/i.test(c))).toBe(true); // state cookie cleared
    const token = cookieVal(ok, 'drex_session');
    const row = t.db.prepare('SELECT id FROM sessions ORDER BY rowid DESC').get();
    expect(row.id).toBe(await sha256(token)); expect(row.id).not.toBe(token); // only the hash is stored
    // session works through the proxy
    const me = await px('/api/auth/me', { headers: { cookie: `drex_session=${token}` } });
    expect((await jj(me)).data.username).toBe('octo');
    // logout (with Origin) kills the session
    expect((await px('/api/auth/logout', { method: 'POST', headers: { cookie: `drex_session=${token}` } })).status).toBe(200);
    expect((await px('/api/auth/me', { headers: { cookie: `drex_session=${token}` } })).status).toBe(401);
  });
  it('GitHub rejecting the code or the profile call redirects with a friendly error', async () => {
    const t = await setup(); const px = viaVercel(t);
    const cb = (st: string) => px(`/api/auth/callback?code=c&state=${st}`, { headers: { cookie: `drex_oauth_state=${st}` } });
    t.setGh((u) => (u.pathname === '/login/oauth/access_token' ? J({ error: 'bad_verification_code' }) : undefined));
    expect((await cb('s1')).headers.get('location')).toBe(`${SITE}/?login_error=exchange`);
    t.setGh((u) => (u.pathname === '/login/oauth/access_token' ? J({ access_token: 't' }) : u.pathname === '/user' ? J({}, 401) : undefined));
    expect((await cb('s2')).headers.get('location')).toBe(`${SITE}/?login_error=profile`);
    t.setGh((u) => (u.pathname === '/login/oauth/access_token' ? J({ access_token: 't' }) : u.pathname === '/user' ? J({ id: 1, login: 'x', avatar_url: '', email: null }) : undefined));
    t.db.exec('DROP TABLE sessions');   // simulate un-migrated database
    expect((await cb('s3')).headers.get('location')).toBe(`${SITE}/?login_error=server`);
  });
});

describe('5/6/8. configuration problems are detected, not silent', () => {
  const run = async (patch: object, host = WORKER) => { const t = await setup(); t.env = Object.assign(t.env, patch); return { t, res: await app.request(`${host}/api/auth/github`, { redirect: 'manual' }, t.env) }; };
  it.each([
    ['placeholder APP_URL', { APP_URL: 'https://REPLACE-WITH-YOUR-VERCEL-URL.vercel.app' }, /placeholder/],
    ['http APP_URL on a deployed Worker', { APP_URL: 'http://localhost:8787' }, /https/],
    ['APP_URL with a path', { APP_URL: 'https://drex.vercel.app/app' }, /only the site address/],
    ['missing client id', { GITHUB_CLIENT_ID: undefined }, /GITHUB_CLIENT_ID/],
    ['missing client secret', { GITHUB_CLIENT_SECRET: '' }, /GITHUB_CLIENT_SECRET/],
  ])('%s -> 500 misconfigured with an explanation', async (_n, patch, re) => {
    const { res } = await run(patch); const j = await jj(res);
    expect([res.status, j.code]).toEqual([500, 'misconfigured']); expect(j.problems.join(' ')).toMatch(re);
    expect(JSON.stringify(j)).not.toContain('csecret');
  });
  it('local development over http is still allowed on localhost', async () => {
    const { res } = await run({ APP_URL: 'http://localhost:8787' }, 'http://localhost:8787');
    expect(res.status).toBe(302);
  });
  it('/api/health reports readiness without leaking secrets, and flags missing migrations / DB', async () => {
    const t = await setup();
    const h = await jj(await app.request(`${WORKER}/api/health`, {}, t.env));
    expect(h).toMatchObject({ ok: true, ready: true, problems: [], checks: { app_url: true, github_oauth: true, database: 'ok', migrations: true, workers_ai: true } });
    expect(JSON.stringify(h)).not.toMatch(/csecret|cid/);
    const old = new DatabaseSync(':memory:'); const mig = new URL('../migrations/0001_init.sql', import.meta.url);
    old.exec(readFileSync(mig, 'utf8'));
    const { makeD1 } = await import('./helpers/env');
    const h2 = await jj(await app.request(`${WORKER}/api/health`, {}, { ...t.env, DB: makeD1(old) }));
    expect([h2.ready, h2.checks.migrations]).toEqual([false, false]); expect(h2.problems.join(' ')).toMatch(/migrations/i);
    const h3 = await jj(await app.request(`${WORKER}/api/health`, {}, { ...t.env, DB: undefined, AI: undefined }));
    expect([h3.ready, h3.checks.database, h3.checks.workers_ai]).toEqual([false, 'error', false]);
  });
});

describe('9. SSRF (custom provider URLs)', () => {
  it.each(['https://127.0.0.1.nip.io/v1', 'https://a.sslip.io/v1', 'https://x.localtest.me/v1', 'https://printer.lan/v1', 'https://db.corp/v1', 'https://0x7f.1/v1', 'https://[::ffff:127.0.0.1]/v1', 'https://2130706433/v1'])('blocks %s', (u) => expect(() => assertSafeBaseUrl(u)).toThrow());
});

describe('7. Workers AI default works with no user key and survives model removal', () => {
  const msgs = [{ role: 'user' as const, content: 'hi' }];
  it('default model is an active "-fast" model, and the old removed id falls back', async () => {
    expect(DEFAULT_PLATFORM_MODEL).toBe('@cf/meta/llama-3.1-8b-instruct-fast'); expect(PLATFORM_MODELS).not.toContain('@cf/meta/llama-3.1-8b-instruct');
    const calls: string[] = [];
    const ai = { run: async (m: string) => { calls.push(m); if (m === '@cf/meta/llama-3.1-8b-instruct') throw new Error('5007: No such model'); return { response: 'ok' }; } };
    expect(await callPlatform(ai, '@cf/meta/llama-3.1-8b-instruct', msgs)).toBe('ok');
    expect(calls).toEqual(['@cf/meta/llama-3.1-8b-instruct', DEFAULT_PLATFORM_MODEL]);
  });
  it('falls through the list only for missing models; rate limits and other errors stop immediately; accepts OpenAI-style output', async () => {
    const run = vi.fn(async (_m: string): Promise<unknown> => { throw new Error('4006: daily free allocation exceeded'); });
    await expect(callPlatform({ run }, undefined, msgs)).rejects.toMatchObject({ code: 'rate_limited' }); expect(run).toHaveBeenCalledTimes(1);
    const run2 = vi.fn(async (_m: string): Promise<unknown> => { throw new Error('boom'); });
    await expect(callPlatform({ run: run2 }, undefined, msgs)).rejects.toMatchObject({ status: 502 }); expect(run2).toHaveBeenCalledTimes(1);
    const run3 = vi.fn(async (_m: string): Promise<unknown> => { throw new Error('model not found'); });
    await expect(callPlatform({ run: run3 }, undefined, msgs)).rejects.toMatchObject({ status: 502 }); expect(run3).toHaveBeenCalledTimes(PLATFORM_MODELS.length);
    expect(await callPlatform({ run: async () => ({ choices: [{ message: { content: 'openai-style' } }] }) }, undefined, msgs)).toBe('openai-style');
  });
  it('chat works end to end with Default AI and no provider/key configured', async () => {
    const t = await setup({ encryption: false });
    const j = await (await t.call(1, 'POST', '/api/ai/chat', { repositoryId: 1, message: 'How do I install this project?' })).json();
    expect(j.data).toMatchObject({ provider: 'default', refused: false });
    expect(t.ai.run.mock.calls[0][0]).toBe(DEFAULT_PLATFORM_MODEL);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM ai_providers').get().n).toBe(0);
  });
});

describe('6. database schema', () => {
  const shape = (db: any) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t: any) => [t.name, db.prepare(`PRAGMA table_info(${t.name})`).all().map((c: any) => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}`)]));
  it('docs/schema-all.sql (for the D1 console) equals applying the migrations in order', () => {
    const a = new DatabaseSync(':memory:'), b = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').sort()) a.exec(readFileSync(`migrations/${f}`, 'utf8'));
    b.exec(readFileSync('docs/schema-all.sql', 'utf8'));
    expect(shape(b)).toEqual(shape(a));
    expect(Object.keys(shape(a))).toEqual(expect.arrayContaining(['users', 'sessions', 'repositories', 'ai_providers', 'ai_messages', 'notifications']));
  });
  it('migrations contain no PRAGMA (D1 always enforces foreign keys) and bindings match the code', () => {
    for (const f of readdirSync('migrations')) expect(readFileSync(`migrations/${f}`, 'utf8')).not.toMatch(/PRAGMA/i);
    for (const f of ['wrangler.toml', 'wrangler.full.toml']) {
      const w = readFileSync(f, 'utf8');
      expect(w).toMatch(/binding = "DB"/); expect(w).toMatch(/binding = "AI"/); expect(w).toMatch(/migrations_dir = "migrations"/); expect(w).toMatch(/name = "drex-analyser"/);
    }
    expect(readFileSync('wrangler.toml', 'utf8')).not.toMatch(/\[assets\]/); // API-only: deploy must not need a built dist/
    expect(readFileSync('wrangler.toml', 'utf8')).not.toMatch(/localhost/);
  });
});

describe('1/2/10. vercel.json: build, /api proxy and SPA refresh', () => {
  const check = (cfg: object) => { const d = mkdtempSync(join(tmpdir(), 'vj-')); const f = join(d, 'vercel.json'); writeFileSync(f, JSON.stringify(cfg)); try { execFileSync('node', ['scripts/check-vercel.mjs', f], { stdio: 'pipe' }); return 0; } catch (e: any) { return e.status as number; } };
  const real = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const good = { ...real, rewrites: [{ source: '/api/:path*', destination: `${WORKER}/api/:path*` }, real.rewrites[1]] };
  it('the shipped placeholder fails the build (so a broken proxy is never deployed); a real Worker URL passes', () => {
    expect(check(real)).toBe(1); expect(check(good)).toBe(0);
  });
  it('rejects wrong order, loops to Vercel, missing SPA fallback and wrong output directory', () => {
    expect(check({ ...good, rewrites: [good.rewrites[1], good.rewrites[0]] })).toBe(1);
    expect(check({ ...good, rewrites: [{ source: '/api/:path*', destination: 'https://x.vercel.app/api/:path*' }, good.rewrites[1]] })).toBe(1);
    expect(check({ ...good, rewrites: [good.rewrites[0]] })).toBe(1);
    expect(check({ ...good, outputDirectory: 'build' })).toBe(1);
  });
  it('build output dir matches vite config, and resolution (emulated) proxies /api and falls back to index.html for app routes', () => {
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/outDir: '\.\.\/dist'/); expect(good.outputDirectory).toBe('dist');
    const files = new Set(['/index.html', '/assets/index-abc.js']);
    const resolve = (path: string) => { // Vercel order: filesystem first, then rewrites in order (emulation of documented behaviour)
      if (files.has(path)) return { file: path };
      for (const r of good.rewrites) { const m = new RegExp('^' + r.source.replace(':path*', '(.*)') + '$').exec(path); if (m) return { to: r.destination.replace(':path*', m[1]) }; }
      return null;
    };
    expect(resolve('/api/auth/github')).toEqual({ to: `${WORKER}/api/auth/github` });
    expect(resolve('/api/ai/conversations/12')).toEqual({ to: `${WORKER}/api/ai/conversations/12` });
    for (const p of ['/', '/repositories/12', '/settings/ai', '/import']) expect(resolve(p)).toEqual({ to: '/index.html' });
    expect(resolve('/assets/index-abc.js')).toEqual({ file: '/assets/index-abc.js' });
  });
  it('security headers are configured and the CSP still allows the app (same-origin API, https images)', () => {
    const csp = real.headers[0].headers.find((h: any) => h.key === 'Content-Security-Policy').value as string;
    expect(csp).toMatch(/connect-src 'self'/); expect(csp).toMatch(/img-src 'self' https:/); expect(csp).toMatch(/frame-ancestors 'none'/); expect(csp).not.toMatch(/unsafe-eval/);
  });
});
