import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { randomToken, safeEqual, sha256 } from './lib/crypto';
import { csrf, readConfig } from './config';
import data from './routes/data';
import ai from './routes/ai';
import aiSettings from './routes/ai-settings';
import content from './routes/content';

export type Env = {
  DB: D1Database; APP_URL: string;
  GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string;
  ENCRYPTION_KEY?: string; GITHUB_TOKEN?: string; AI?: Ai; AI_MODEL?: string; ALLOWED_ORIGINS?: string;
};
type Vars = { userId: number };
const SESSION_DAYS = 30;
const COOKIE = { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: '/' };
class LoginFail extends Error { constructor(public code: string) { super(code); } }

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// No CORS headers on purpose: the browser only talks to the API through the same origin (Vercel rewrite).
app.use('/api/*', secureHeaders());
app.use('/api/*', async (c, next) => { await next(); if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store'); });
app.use('/api/*', csrf);

app.onError((err, c) => {
  console.error('error', err.message); // never log credentials
  return c.json({ ok: false, error: 'Internal error' }, 500);
});
app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const token = getCookie(c, 'drex_session');
  if (!token) return c.json({ ok: false, error: 'Unauthorized' }, 401);
  const row = await c.env.DB.prepare(
    "SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')"
  ).bind(await sha256(token)).first<{ user_id: number }>();
  if (!row) return c.json({ ok: false, error: 'Unauthorized' }, 401);
  c.set('userId', row.user_id);
  await next();
};

app.get('/api/auth/github', (c) => {
  const k = readConfig(c.env, c.req.url);
  if (k.problems.length) return c.json({ ok: false, error: 'Server is not configured yet', code: 'misconfigured', problems: k.problems }, 500);
  const state = randomToken(16);
  setCookie(c, 'drex_oauth_state', state, { ...COOKIE, maxAge: 600 });
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
  u.searchParams.set('redirect_uri', `${k.origin}/api/auth/callback`); // must equal the OAuth App's callback URL
  u.searchParams.set('scope', 'read:user'); // minimal; no repo scope for public repos
  u.searchParams.set('state', state);
  return c.redirect(u.toString());
});

app.get('/api/auth/callback', async (c) => {
  const k = readConfig(c.env, c.req.url);
  if (k.problems.length) return c.json({ ok: false, error: 'Server is not configured yet', code: 'misconfigured', problems: k.problems }, 500);
  const back = (code: string) => c.redirect(`${k.origin}/?login_error=${code}`); // friendly error page instead of raw JSON
  const code = c.req.query('code'), state = c.req.query('state');
  const saved = getCookie(c, 'drex_oauth_state');
  deleteCookie(c, 'drex_oauth_state', { path: '/', secure: true });
  if (c.req.query('error')) return back('denied');
  if (!code || !state || !saved || !safeEqual(state, saved)) return back('state');
  try {
    const tokRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${k.origin}/api/auth/callback` }),
    }).catch(() => { throw new LoginFail('exchange'); });
    const tok = (await tokRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tok.access_token) throw new LoginFail('exchange');
    const uRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tok.access_token}`, 'User-Agent': 'drex-analyser', Accept: 'application/vnd.github+json' },
    }).catch(() => { throw new LoginFail('profile'); });
    if (!uRes.ok) throw new LoginFail('profile');
    const gh = (await uRes.json()) as { id: number; login: string; avatar_url: string; email: string | null };

    const user = await c.env.DB.prepare(
      `INSERT INTO users (github_id, username, avatar_url, email) VALUES (?,?,?,?)
       ON CONFLICT(github_id) DO UPDATE SET username=excluded.username, avatar_url=excluded.avatar_url, email=excluded.email
       RETURNING id`
    ).bind(gh.id, gh.login, gh.avatar_url, gh.email).first<{ id: number }>();
    if (!user) throw new LoginFail('server');

    const session = randomToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString().replace('T', ' ').slice(0, 19);
    await c.env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run(); // housekeeping
    await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)').bind(await sha256(session), user.id, expires).run();
    setCookie(c, 'drex_session', session, { ...COOKIE, maxAge: SESSION_DAYS * 86400 }); // no Domain attribute: bound to the site the browser sees (Vercel)
    return c.redirect(`${k.origin}/`);
  } catch (e) {
    if (e instanceof LoginFail) return back(e.code);
    console.error('login failed', (e as Error).message);
    return back('server');
  }
});

app.get('/api/auth/me', requireAuth, async (c) => {
  const u = await c.env.DB.prepare('SELECT id, username, avatar_url, email, created_at FROM users WHERE id = ?')
    .bind(c.get('userId')).first();
  return c.json({ ok: true, data: u });
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, 'drex_session');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  deleteCookie(c, 'drex_session', { path: '/', secure: true });
  return c.json({ ok: true });
});

app.use('/api/dashboard', requireAuth);
app.use('/api/repositories/*', requireAuth);
app.route('/api', data);
app.route('/api', content);
app.use('/api/ai/*', requireAuth);
app.route('/api', ai);
app.route('/api', aiSettings);

// Public status page for deployment debugging (booleans and problem descriptions only, never secrets).
app.get('/api/health', async (c) => {
  const k = readConfig(c.env, c.req.url);
  let database = 'error', migrations = false;
  try {
    await c.env.DB.prepare('SELECT 1').first(); database = 'ok';
    await c.env.DB.prepare('SELECT active_ai_provider FROM users LIMIT 1').first();
    await c.env.DB.prepare('SELECT status, enabled, key_hint FROM ai_providers LIMIT 1').first();
    migrations = true;
  } catch { /* reported below */ }
  const problems = [...k.problems];
  if (database !== 'ok') problems.push('Database binding "DB" is missing or database_id in wrangler.toml is wrong');
  else if (!migrations) problems.push('Database migrations are not applied (run docs/schema-all.sql in the D1 console)');
  return c.json({
    ok: true, name: 'Drex Analyser', ready: problems.length === 0,
    checks: { app_url: k.problems.every((p) => !p.startsWith('APP_URL')), github_oauth: !!(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET), database, migrations, workers_ai: !!c.env.AI },
    problems,
  });
});

export default app;
