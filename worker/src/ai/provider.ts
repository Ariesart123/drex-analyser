import type { ChatMsg } from './engine';

export class ValidationError extends Error {}
export type ProviderCode = 'invalid_key' | 'rate_limited' | 'unreachable' | 'model_unsupported' | 'bad_response' | 'bad_request';
const codeFor = (s: number): ProviderCode => (s === 401 || s === 403 ? 'invalid_key' : s === 429 ? 'rate_limited' : s === 0 ? 'unreachable' : [400, 404, 422].includes(s) ? 'bad_request' : 'bad_response');
export class ProviderError extends Error {
  constructor(public status: number, m: string, public code: ProviderCode = codeFor(status)) { super(m); }
}

// NOTE: Cloudflare announced removal of @cf/meta/llama-3.1-8b-instruct (changelog 2026-05-08); the "-fast" variants stay active.
// The first entry is the default; later entries are tried only when a model is reported missing/removed.
export const PLATFORM_MODELS = ['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
export const DEFAULT_PLATFORM_MODEL = PLATFORM_MODELS[0];
export type ProviderName = 'gemini' | 'groq' | 'custom';
// Official OpenAI-compatible endpoints (Bearer auth): Gemini docs ai.google.dev/gemini-api/docs/openai, Groq docs console.groq.com/docs/openai.
export const FIXED_BASE = { gemini: 'https://generativelanguage.googleapis.com/v1beta/openai', groq: 'https://api.groq.com/openai/v1' } as const;
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/@-]{0,99}$/;
const NON_CHAT = /(whisper|tts|embed|guard|moderation|dall-e|imagen|veo|audio|transcribe|rerank|aqa)/i;

export function assertSafeBaseUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ValidationError('Invalid URL'); }
  if (u.protocol !== 'https:') throw new ValidationError('HTTPS required');
  if (u.username || u.password) throw new ValidationError('Credentials in URL not allowed');
  if (u.search || u.hash) throw new ValidationError('Query strings are not allowed');
  const h = u.hostname.toLowerCase();
  const blockedSuffix = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.private', '.nip.io', '.sslip.io', '.xip.io', '.localtest.me', '.lvh.me', '.vcap.me'];
  if (h === 'localhost' || blockedSuffix.some((x) => h.endsWith(x)) || h.startsWith('[') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\d+$/.test(h) || !h.includes('.')) throw new ValidationError('Host not allowed');
  if (u.port && u.port !== '443') throw new ValidationError('Port not allowed');
  return u;
}
export function resolveBase(p: ProviderName, baseUrl?: unknown): string {
  if (p !== 'custom') return FIXED_BASE[p];
  return assertSafeBaseUrl(String(baseUrl ?? '')).toString().replace(/\/+$/, '');
}

export interface ProviderCfg { baseUrl: string; apiKey: string; model: string }
const auth = (k: string) => ({ Authorization: `Bearer ${k}` });
async function pf(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ProviderError(0, 'Provider unreachable', 'unreachable'); }
}

export async function listModels(p: ProviderName, baseUrl: string, apiKey: string): Promise<string[]> {
  const r = await pf(`${baseUrl}/models`, { headers: auth(apiKey) });
  if ([400, 401, 403].includes(r.status)) throw new ProviderError(r.status, 'Key rejected', 'invalid_key');
  if (r.status === 429) throw new ProviderError(429, 'Rate limited', 'rate_limited');
  if (r.status === 404 || r.status === 405) { if (p === 'custom') return []; throw new ProviderError(r.status, 'No models endpoint', 'bad_response'); }
  if (!r.ok) throw new ProviderError(r.status, 'Model list failed');
  const j = (await r.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
  if (!Array.isArray(j?.data)) { if (p === 'custom') return []; throw new ProviderError(502, 'Unexpected model list', 'bad_response'); }
  const ids = j!.data.map((m) => String(m.id ?? '').replace(/^models\//, '')).filter((id) => MODEL_RE.test(id) && !NON_CHAT.test(id));
  return [...new Set(ids)].sort().slice(0, 200);
}

async function chatRaw(cfg: ProviderCfg, messages: ChatMsg[], maxTokens: number): Promise<string> {
  const r = await pf(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth(cfg.apiKey) },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new ProviderError(r.status, `Provider returned ${r.status}`);
  const j = (await r.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  if (!j || !Array.isArray(j.choices)) throw new ProviderError(502, 'Unexpected response', 'bad_response');
  return j.choices[0]?.message?.content ?? '';
}

export async function callProvider(cfg: ProviderCfg, messages: ChatMsg[]): Promise<string> {
  const t = await chatRaw(cfg, messages, 1200);
  if (!t) throw new ProviderError(502, 'Empty provider response', 'bad_response');
  return t;
}

// Real connection check: key validity via the live model list, then (if a model is given) one tiny real completion.
export async function testProvider(p: ProviderName, cfg: { baseUrl: string; apiKey: string; model?: string }) {
  const models = await listModels(p, cfg.baseUrl, cfg.apiKey);
  if (!cfg.model) return { models, modelOk: false };
  try { await chatRaw({ ...cfg, model: cfg.model }, [{ role: 'user', content: 'ping' }], 32); }
  catch (e) {
    if (e instanceof ProviderError && e.code === 'bad_request') throw new ProviderError(e.status, 'Model not supported', 'model_unsupported');
    throw e;
  }
  return { models, modelOk: true };
}

// Zero-key path: Cloudflare Workers AI binding. Tries the preferred model, then fallbacks only if the model is gone.
export async function callPlatform(ai: { run: (model: string, input: unknown) => Promise<unknown> }, preferred: string | undefined, messages: ChatMsg[]): Promise<string> {
  const order = [...new Set([preferred, ...PLATFORM_MODELS].filter(Boolean) as string[])];
  for (const model of order) {
    try {
      const out = (await ai.run(model, { messages, max_tokens: 1000, temperature: 0.2 })) as any;
      const text = typeof out?.response === 'string' ? out.response : out?.choices?.[0]?.message?.content;
      if (!text) throw new ProviderError(502, 'Empty AI response', 'bad_response');
      return text;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      const m = (e as Error)?.message ?? '';
      if (/limit|allocation|quota|429|rate/i.test(m)) throw new ProviderError(429, 'Platform AI rate limited');
      if (/no such model|not found|deprecat|unknown model|does not exist|5007|5018/i.test(m)) continue; // try next model
      throw new ProviderError(502, 'Platform AI failed');
    }
  }
  throw new ProviderError(502, 'No Workers AI model is available');
}
