export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch('/api' + path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...init });
  const ct = r.headers?.get?.('content-type') ?? 'application/json';
  if (!ct.includes('json')) throw Object.assign(new Error('The API is not reachable. The site is probably misconfigured: check the /api rewrite in vercel.json and that the Cloudflare Worker is deployed.'), { status: 502, code: 'api_unreachable' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, code: j.code as string | undefined, resetAt: j.resetAt as string | null | undefined });
  return j.data as T;
}
export interface Repo { id: number; full_name: string; description: string | null; language: string | null; stars: number; forks: number; pushed_at: string | null; url: string }
export interface ImportRow { input: string; fullName?: string; status: 'imported' | 'exists' | 'not_found' | 'rate_limited' | 'failed' }
export interface ImportResp { results: ImportRow[]; invalid: string[]; duplicates: string[] }
export interface RepoDetailData extends Repo {
  owner: string; name: string; visibility: string; default_branch: string | null; license: string | null; created_at: string;
}
export interface ChatResult { conversationId: number; answer: string; refused: boolean; sources: string[] }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; sources?: string[]; refused?: boolean }
export const REFUSAL = 'I can only answer questions about the currently opened repository.';
export type ProviderName = 'gemini' | 'groq' | 'custom';
export interface ProviderRow { provider: ProviderName; label: string; model: string; base_url: string | null; enabled: boolean; status: 'ok' | 'invalid_key' | 'error' | 'untested'; key_hint: string | null; last_tested_at: string | null }
export interface ProviderSettings { active: 'default' | ProviderName; byokEnabled: boolean; default: { available: boolean; label: string; model: string; limits: string }; providers: ProviderRow[] }

export interface DirEntry { name: string; path: string; type: 'file' | 'dir' | 'symlink' | 'submodule'; size: number | null }
export interface DirData { path: string; entries: DirEntry[]; truncated: boolean }
export interface FileMeta { path: string; name: string; size: number; extension: string; html_url: string }
export type FileData = ({ kind: 'text'; content: string } | { kind: 'binary' | 'too_large' | 'unsupported' }) & FileMeta;
export interface CommitItem { sha: string; short: string; message: string; body: string; author_name: string; author_login: string | null; avatar_url: string | null; date: string | null; html_url: string }
export interface CommitPage { items: CommitItem[]; page: number; hasNext: boolean }
export interface CommitFile { filename: string; status: string; additions: number; deletions: number; previous_filename: string | null }
export interface CommitDetail { sha: string; short: string; message: string; author_name: string; author_login: string | null; date: string | null; stats: { additions: number; deletions: number; total: number }; parents: string[]; files: CommitFile[]; files_total: number; files_truncated: boolean; html_url: string }
export interface ReleaseAsset { name: string; size: number; download_count: number; content_type: string | null; url: string }
export interface ReleaseItem { id: number; name: string; tag: string; prerelease: boolean; is_latest: boolean; published_at: string | null; author_login: string | null; body: string; html_url: string; assets: ReleaseAsset[] }
export interface ReleasePage { items: ReleaseItem[]; page: number; hasNext: boolean; latestId: number | null }
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
