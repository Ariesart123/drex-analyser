import type { Env } from '../index';
import { decryptSecret } from '../lib/crypto';
import { resolveBase, type ProviderCfg, type ProviderName } from './provider';

export type Resolved = { kind: 'default' } | { kind: 'byok'; provider: ProviderName; cfg: ProviderCfg };
// Picks the user's ACTIVE provider. Never silently falls back to another provider (data would go somewhere the user didn't choose).
export async function resolveProvider(env: Env, uid: number): Promise<Resolved | { error: string; status: 409 | 503 }> {
  const u = await env.DB.prepare('SELECT active_ai_provider AS a FROM users WHERE id = ?').bind(uid).first<{ a: string }>();
  const a = u?.a ?? 'default';
  if (a === 'default') return env.AI ? { kind: 'default' } : { error: 'AI is not enabled on this deployment', status: 503 };
  const unavailable = { error: 'Your selected AI provider is unavailable. Open AI Settings to fix it or switch to Default AI.', status: 409 as const };
  const row = await env.DB.prepare('SELECT provider, encrypted_api_key, model, base_url, enabled, status FROM ai_providers WHERE user_id = ? AND provider = ?').bind(uid, a).first<any>();
  if (!row || !row.enabled || row.status !== 'ok' || !env.ENCRYPTION_KEY) return unavailable;
  try {
    return { kind: 'byok', provider: a as ProviderName, cfg: { baseUrl: resolveBase(a as ProviderName, row.base_url), apiKey: await decryptSecret(row.encrypted_api_key, env.ENCRYPTION_KEY), model: row.model } };
  } catch { return unavailable; }
}
