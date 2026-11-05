import { Hono, type Context } from 'hono';
import type { Env } from '../index';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { DEFAULT_PLATFORM_MODEL, MODEL_RE, ProviderError, ValidationError, resolveBase, testProvider, type ProviderCode, type ProviderName } from '../ai/provider';

type C = Context<{ Bindings: Env; Variables: { userId: number } }>;
const r = new Hono<{ Bindings: Env; Variables: { userId: number } }>();
const NAMES = ['gemini', 'groq', 'custom'] as const;
const LABEL = { gemini: 'Google Gemini', groq: 'Groq', custom: 'OpenAI-compatible' };
const KEY_RE = /^[\x21-\x7E]{8,400}$/;
const MSG: Record<ProviderCode, string> = {
  invalid_key: 'The provider rejected this API key.', model_unsupported: 'The provider does not support this model name.',
  rate_limited: 'The provider rate limit was reached. Try again later.', unreachable: 'Could not reach the provider.',
  bad_response: 'The provider returned an unexpected response.', bad_request: 'The provider rejected the request.',
};
const bad = (error: string, code?: string) => ({ ok: false, error, ...(code ? { code } : {}) });
const isName = (s: unknown): s is ProviderName => NAMES.includes(s as ProviderName);
const pub = (x: any) => ({ provider: x.provider, label: LABEL[x.provider as ProviderName], model: x.model, base_url: x.provider === 'custom' ? x.base_url : null,
  enabled: !!x.enabled, status: x.status, key_hint: x.key_hint ? `••••${x.key_hint}` : null, last_tested_at: x.last_tested_at }); // never the key
const COLS = 'provider, model, base_url, enabled, status, key_hint, last_tested_at';

function fail(c: C, e: unknown) {
  if (e instanceof ValidationError) return c.json(bad(e.message, 'invalid_url'), 400);
  if (e instanceof ProviderError) return c.json(bad(MSG[e.code], e.code), e.code === 'rate_limited' ? 429 : e.code === 'unreachable' ? 502 : 422);
  throw e;
}
const stored = (c: C, name: string) => c.env.DB.prepare(`SELECT ${COLS}, encrypted_api_key FROM ai_providers WHERE user_id = ? AND provider = ?`).bind(c.get('userId'), name).first<any>();
const resetIfActive = (c: C, name: string) => c.env.DB.prepare("UPDATE users SET active_ai_provider = 'default' WHERE id = ? AND active_ai_provider = ?").bind(c.get('userId'), name).run();

// Validates input and resolves {base, apiKey, model}; the apiKey comes from the request or, if omitted, from the user's OWN stored config.
async function prep(c: C, name: ProviderName, b: any, needModel: boolean): Promise<{ base: string; apiKey: string; model?: string; fresh: boolean; existing: any } | Response> {
  let base: string;
  try { base = resolveBase(name, b?.baseUrl); } catch (e) { return fail(c, e); }
  const model = b?.model == null || b.model === '' ? undefined : String(b.model);
  if ((needModel && !model) || (model && !MODEL_RE.test(model))) return c.json(bad('Invalid model name', 'invalid_model'), 400);
  const existing = await stored(c, name);
  if (b?.apiKey != null && b.apiKey !== '') {
    if (typeof b.apiKey !== 'string' || !KEY_RE.test(b.apiKey)) return c.json(bad('API key format is invalid', 'invalid_key'), 400);
    return { base, apiKey: b.apiKey, model, fresh: true, existing };
  }
  if (!existing || !c.env.ENCRYPTION_KEY) return c.json(bad('API key required', 'key_required'), 400);
  return { base, apiKey: await decryptSecret(existing.encrypted_api_key, c.env.ENCRYPTION_KEY), model, fresh: false, existing };
}

r.get('/ai/providers', async (c) => {
  const uid = c.get('userId');
  const [rows, u] = await Promise.all([
    c.env.DB.prepare(`SELECT ${COLS} FROM ai_providers WHERE user_id = ? ORDER BY provider`).bind(uid).all(),
    c.env.DB.prepare('SELECT active_ai_provider AS a FROM users WHERE id = ?').bind(uid).first<{ a: string }>(),
  ]);
  return c.json({ ok: true, data: {
    active: u?.a ?? 'default', byokEnabled: !!c.env.ENCRYPTION_KEY,
    default: { available: !!c.env.AI, label: 'Cloudflare Workers AI', model: c.env.AI_MODEL ?? DEFAULT_PLATFORM_MODEL,
      limits: 'No key needed. Shared free allocation of 10,000 Neurons/day for this deployment (resets 00:00 UTC); 10 questions per minute per user.' },
    providers: rows.results.map(pub),
  } });
});

r.get('/ai/status', async (c) => {
  const uid = c.get('userId');
  const u = await c.env.DB.prepare('SELECT active_ai_provider AS a FROM users WHERE id = ?').bind(uid).first<{ a: string }>();
  const a = u?.a ?? 'default';
  const row = a === 'default' ? null : await stored(c, a);
  const available = a === 'default' ? !!c.env.AI : !!row && !!row.enabled && row.status === 'ok' && !!c.env.ENCRYPTION_KEY;
  return c.json({ ok: true, data: { available, active: a } });
});

r.post('/ai/providers/test', async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!isName(b?.provider)) return c.json(bad('Unknown provider'), 400);
  const p = await prep(c, b.provider, b, false);
  if (p instanceof Response) return p;
  try { return c.json({ ok: true, data: await testProvider(b.provider, { baseUrl: p.base, apiKey: p.apiKey, model: p.model }) }); } catch (e) { return fail(c, e); }
});

r.put('/ai/providers/:provider', async (c) => {
  const name = c.req.param('provider'), uid = c.get('userId');
  if (!isName(name)) return c.json(bad('Unknown provider'), 400);
  const ek = c.env.ENCRYPTION_KEY;
  if (!ek) return c.json(bad('Custom providers are not enabled on this deployment', 'byok_disabled'), 503);
  const b = await c.req.json<any>().catch(() => null);
  const p = await prep(c, name, b, true);
  if (p instanceof Response) return p;
  try { await testProvider(name, { baseUrl: p.base, apiKey: p.apiKey, model: p.model }); } catch (e) { return fail(c, e); } // never save an unverified config
  const enc = p.fresh ? await encryptSecret(p.apiKey, ek) : p.existing.encrypted_api_key;
  const hint = p.fresh ? p.apiKey.slice(-4) : p.existing.key_hint;
  const enabled = b.enabled === undefined ? (p.existing ? p.existing.enabled : 1) : b.enabled ? 1 : 0;
  await c.env.DB.prepare(`INSERT INTO ai_providers (user_id, provider, encrypted_api_key, model, base_url, enabled, status, key_hint, last_tested_at)
    VALUES (?,?,?,?,?,?, 'ok', ?, datetime('now'))
    ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_api_key = excluded.encrypted_api_key, model = excluded.model, base_url = excluded.base_url,
      enabled = excluded.enabled, status = 'ok', key_hint = excluded.key_hint, last_tested_at = excluded.last_tested_at, updated_at = datetime('now')`)
    .bind(uid, name, enc, p.model!, p.base, enabled, hint).run();
  if (!enabled) await resetIfActive(c, name);
  return c.json({ ok: true, data: pub(await stored(c, name)) });
});

r.patch('/ai/providers/:provider', async (c) => {
  const name = c.req.param('provider');
  const b = await c.req.json<any>().catch(() => null);
  if (!isName(name) || typeof b?.enabled !== 'boolean') return c.json(bad('provider and enabled required'), 400);
  const row = await stored(c, name);
  if (!row) return c.json(bad('Provider not configured'), 404);
  if (b.enabled && row.status !== 'ok') return c.json(bad('Re-test and save this provider first', 'needs_retest'), 409);
  await c.env.DB.prepare('UPDATE ai_providers SET enabled = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND provider = ?').bind(b.enabled ? 1 : 0, c.get('userId'), name).run();
  if (!b.enabled) await resetIfActive(c, name);
  return c.json({ ok: true, data: pub(await stored(c, name)) });
});

r.delete('/ai/providers/:provider', async (c) => {
  const name = c.req.param('provider');
  if (!isName(name)) return c.json(bad('Unknown provider'), 400);
  await c.env.DB.prepare('DELETE FROM ai_providers WHERE user_id = ? AND provider = ?').bind(c.get('userId'), name).run();
  await resetIfActive(c, name); // removing the active provider falls back to Default AI
  return c.json({ ok: true });
});

r.put('/ai/active', async (c) => {
  const uid = c.get('userId');
  const b = await c.req.json<any>().catch(() => null);
  const name = b?.provider;
  if (name === 'default') {
    if (!c.env.AI) return c.json(bad('Default AI is not available on this deployment', 'default_unavailable'), 409);
  } else if (isName(name)) {
    const row = await stored(c, name);
    if (!row || !row.enabled || !c.env.ENCRYPTION_KEY) return c.json(bad('Configure and enable this provider first', 'not_configured'), 409);
    try { // validate live before activating
      await testProvider(name, { baseUrl: resolveBase(name, row.base_url), apiKey: await decryptSecret(row.encrypted_api_key, c.env.ENCRYPTION_KEY), model: row.model });
    } catch (e) {
      await c.env.DB.prepare("UPDATE ai_providers SET status = ? WHERE user_id = ? AND provider = ?").bind(e instanceof ProviderError && e.code === 'invalid_key' ? 'invalid_key' : 'error', uid, name).run();
      return fail(c, e);
    }
    await c.env.DB.prepare("UPDATE ai_providers SET status = 'ok', last_tested_at = datetime('now') WHERE user_id = ? AND provider = ?").bind(uid, name).run();
  } else return c.json(bad('Unknown provider'), 400);
  await c.env.DB.prepare('UPDATE users SET active_ai_provider = ? WHERE id = ?').bind(name, uid).run();
  return c.json({ ok: true, data: { active: name } });
});

export default r;
