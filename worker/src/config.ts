import type { Env } from './index';

export interface Config { origin: string | null; isLocal: boolean; problems: string[] }

// Validates deployment configuration. Never returns secret values, only human-readable problems.
export function readConfig(env: Partial<Env>, reqUrl: string): Config {
  const problems: string[] = [];
  const host = new URL(reqUrl).hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1'; // request host (not user-controlled in production)
  let origin: string | null = null;
  try {
    const u = new URL(String(env.APP_URL ?? '').trim());
    if (/replace/i.test(u.hostname)) problems.push('APP_URL is still the placeholder in wrangler.toml');
    else if (u.protocol !== 'https:' && !(isLocal && u.protocol === 'http:')) problems.push('APP_URL must start with https:// (use your Vercel URL)');
    if (u.pathname !== '/' || u.search || u.hash) problems.push('APP_URL must be only the site address, e.g. https://my-app.vercel.app');
    origin = u.origin;
  } catch { problems.push('APP_URL is missing or not a valid URL'); }
  if (!env.GITHUB_CLIENT_ID) problems.push('GITHUB_CLIENT_ID secret is not set');
  if (!env.GITHUB_CLIENT_SECRET) problems.push('GITHUB_CLIENT_SECRET secret is not set');
  return { origin, isLocal, problems };
}

export function allowedOrigins(env: Partial<Env>, reqUrl: string): Set<string> {
  const s = new Set<string>();
  const k = readConfig(env, reqUrl);
  if (k.origin) { s.add(k.origin); if (k.isLocal) { s.add('http://localhost:5173'); s.add('http://127.0.0.1:5173'); } }
  for (const o of String(env.ALLOWED_ORIGINS ?? '').split(',')) { try { if (o.trim()) s.add(new URL(o.trim()).origin); } catch { /* ignore */ } }
  return s;
}

// CSRF defence in depth (cookies are already SameSite=Lax): state-changing requests from a browser must come from our own origin.
export const csrf: any = async (c: any, next: () => Promise<void>) => {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const origin = c.req.header('origin');
  const blocked = () => c.json({ ok: false, error: 'Cross-origin request blocked', code: 'csrf' }, 403);
  if (origin) { if (!allowedOrigins(c.env, c.req.url).has(origin)) return blocked(); }
  else if (c.req.header('sec-fetch-site') === 'cross-site') return blocked();
  return next();
};
