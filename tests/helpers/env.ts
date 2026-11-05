import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { vi } from 'vitest';
import app from '../../worker/src/index';
import { sha256 } from '../../worker/src/lib/crypto';

export const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const mig = new URL('../../migrations/', import.meta.url);

// Minimal D1 adapter over a real SQLite database so routes and migrations run for real.
export function makeD1(db: any): D1Database {
  const stmt = (sql: string, params: unknown[] = []): any => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => { db.prepare(sql).run(...params); return { success: true }; },
  });
  return {
    prepare: (s: string) => stmt(s),
    batch: async (list: any[]) => { db.exec('BEGIN'); try { for (const s of list) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; },
  } as unknown as D1Database;
}

export const KEYS = { gemini: 'GEM-KEY-1234', groq: 'GROQ-KEY-5678', custom: 'CUSTOM-KEY-9999' };
export const HOSTS = () => ({
  'generativelanguage.googleapis.com': { key: KEYS.gemini, models: ['models/gemini-a', 'models/gemini-embed-x'], valid: ['gemini-a'], answer: 'Gemini: run pip install -r requirements.txt, see README.md and docs/fake.md', chatStatus: 0, down: false },
  'api.groq.com': { key: KEYS.groq, models: ['llama-x', 'whisper-large'], valid: ['llama-x'], answer: 'Groq: see README.md', chatStatus: 0, down: false },
  'llm.example.com': { key: KEYS.custom, models: [] as string[], valid: ['my-model'], answer: 'Custom: see README.md', chatStatus: 0, down: false },
});

export async function setup(opts: { encryption?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(mig).sort()) db.exec(readFileSync(new URL(f, mig), 'utf8'));
  for (const id of [1, 2]) {
    db.prepare('INSERT INTO users (id, github_id, username) VALUES (?,?,?)').run(id, 100 + id, `u${id}`);
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)').run(await sha256(`tok${id}`), id, '2999-01-01 00:00:00');
  }
  db.prepare('INSERT INTO repositories (user_id, owner, name, full_name, url, language, default_branch) VALUES (?,?,?,?,?,?,?)').run(1, 'acme', 'fastcli', 'acme/fastcli', 'https://github.com/acme/fastcli', 'Python', 'main');
  db.prepare('INSERT INTO repositories (user_id, owner, name, full_name, url, language, default_branch) VALUES (?,?,?,?,?,?,?)').run(2, 'acme', 'other', 'acme/other', 'https://github.com/acme/other', 'Go', 'main');

  const ai = { run: vi.fn(async (_m: string, _i: unknown) => ({ response: 'Default AI: see README.md' })) };
  const encKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const env: any = { DB: makeD1(db), APP_URL: 'https://drex.vercel.app', GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'csecret', AI: ai, ...(opts.encryption === false ? {} : { ENCRYPTION_KEY: encKey }) };

  const gh: { fn?: (u: URL, init: any) => Response | undefined } = {}; const ghCalls: string[] = []; const hosts = HOSTS(); const seen: { host: string; path: string; auth: string; body?: any }[] = []; const bodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: any, init: any = {}) => {
    const u = new URL(String(input)); const auth = init.headers?.Authorization ?? ''; const body = init.body ? JSON.parse(init.body) : undefined;
    const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s });
    if (u.host === 'api.github.com' || u.host === 'github.com') {
      ghCalls.push(u.pathname + u.search);
      const custom = gh.fn?.(u, init); if (custom) return custom;
      if (u.host === 'github.com') return json(404, {});
      if (u.pathname.includes('/git/trees/')) return json(200, { tree: [{ path: 'README.md', type: 'blob' }, { path: 'requirements.txt', type: 'blob' }] });
      return new Response('# fastcli readme', { status: 200 });
    }
    seen.push({ host: u.host, path: u.pathname, auth, body });
    const h = (hosts as any)[u.host];
    if (!h || h.down) throw new TypeError('network down');
    if (auth !== `Bearer ${h.key}`) return json(401, { error: 'bad key' });
    if (u.pathname.endsWith('/models')) return json(200, { data: h.models.map((id: string) => ({ id })) });
    if (u.pathname.endsWith('/chat/completions')) {
      if (h.chatStatus) return json(h.chatStatus, {});
      if (!h.valid.includes(body.model)) return json(404, {});
      return json(200, { choices: [{ message: { content: h.answer } }] });
    }
    return json(404, {});
  }));

  const call = async (user: 1 | 2, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, { method, headers: { cookie: `drex_session=tok${user}`, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }, env);
    const text = await res.text();
    bodies.push(text);
    return { status: res.status, headers: res.headers, text: async () => text, json: async (): Promise<any> => JSON.parse(text) };
  };
  const chatCalls = (host?: string) => seen.filter((s) => s.path.endsWith('/chat/completions') && (!host || s.host === host));
  const setGh = (fn: (u: URL, init: any) => Response | undefined) => { gh.fn = fn; };
  return { db, env, ai, hosts, seen, bodies, call, chatCalls, setGh, ghCalls };
}
