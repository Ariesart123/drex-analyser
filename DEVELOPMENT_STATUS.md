# Drex Analyser — Development Status

## Completed
- Phase 1: D1 schema, OAuth + sessions, responsive shell, dashboard (real DB stats), static assets.
- Phase 2: bulk import, repo list, repo detail page (GitHub metadata, sanitized README), file explorer (lazy per-folder, breadcrumbs, highlighted code viewer, binary/large-file handling), commit history + commit details (changed files), releases (latest/pre-release, assets).
- Phase 5 (partial): strict repo-only AI (gate + prompt + isolation + citation validation), per-repo chat UI, AI Provider Settings.

## AI providers (migration 0002)
- Default: Cloudflare Workers AI binding, no key. Shared free allocation 10,000 Neurons/day per account.
- Optional BYOK: Google Gemini and Groq (fixed official OpenAI-compatible base URLs, Bearer auth), custom OpenAI-compatible (HTTPS only, SSRF-guarded).
- Models are never hardcoded: listed live from the provider (`GET {base}/models`); a model is accepted only after one real completion succeeds.
- Save = verify first (never stores unverified config). Activate = live re-verify. Keys: AES-GCM, ENCRYPTION_KEY secret, only last 4 chars kept as a hint, never returned.
- Active provider stored per user (`users.active_ai_provider`); deleting/disabling the active one resets to Default. No silent cross-provider fallback: a failing BYOK provider returns 409/502 and the UI links to AI Settings.
- Repo-only restriction runs before any provider is resolved, so it is identical for every provider.

## Tests: 90+ (parser, AI gate, engine, SQLite-backed route tests, frontend chat/markdown/settings)

## Content API (Phase 5 explorer)
- Routes: /files, /file, /commits, /commits/:sha, /releases under /api/repositories/:id (owner-only; 404 for other users, no GitHub call).
- Safety: path/ref/sha validation, 512 KB preview limit, binary detection (extension + NUL bytes), symlink/submodule not previewed, only text returned; frontend shows it as escaped text. Nothing is executed. Drafts never shown; asset links only github.com.
- GitHub errors mapped: rate limit -> 429 (+resetAt), 404, 403, 5xx/network -> 502. Responses cached 60 s (private).
- Uses deployment GITHUB_TOKEN if set (recommended: 60 req/h unauthenticated limit is shared per Worker IP); private repositories are not accessible.

## Remaining
- Not started by request: folders, starring, monitoring/notifications, import/export, light theme, tags, filters/sort, refresh.
- Explorer gaps: no whole-repo tree view or file search (folder-by-folder only); no branch/tag switcher (default branch only); no diff patches in commit details (files + counts + GitHub link); no image preview; no line numbers; commits are for the whole repo (no per-file history in UI).
- AI gaps: citations not persisted in history; AI does not yet use explorer-selected file; chat copy/regenerate.
- Phase 6: security audit, mobile device testing, real GitHub/provider smoke tests with real keys.

## Deployment audit (Vercel + Cloudflare) — fixed
- OAuth now sends redirect_uri (APP_URL + /api/auth/callback); failures redirect to /?login_error=<code> with friendly messages; state compared in constant time; expired sessions purged on login.
- CSRF: Origin/Sec-Fetch-Site check on all state-changing /api requests; no CORS headers; secure headers + Cache-Control no-store (content routes stay `private`).
- Config validation + /api/health (ready flag, checks, problems; no secrets). APP_URL placeholder/http/path detected. wrangler.toml is API-only (no dist needed); wrangler.full.toml = single-Worker mode.
- vercel.json: build:vercel guard script, SPA fallback, security headers/CSP. Frontend detects non-JSON /api responses (broken rewrite).
- Workers AI: default model llama-3.1-8b-instruct is scheduled for removal (Cloudflare changelog 2026-05-08); default is now the active "-fast" variant with automatic fallback.
- SSRF: extra blocked suffixes (nip.io, sslip.io, localtest.me, .lan, .corp ...). Migration 0001 no longer has PRAGMA. docs/schema-all.sql for the D1 console (`npm run schema:all`).
- NOT TESTED live: real Vercel rewrite/cookie pass-through, Cloudflare deploy/D1/Workers AI model availability, GitHub OAuth against github.com, Workers Builds migration permissions.

## Vercel
- App is built for Cloudflare (D1, Workers AI binding). Vercel can host the frontend only (vercel.json proxies /api/* to the Worker). Full Vercel-only hosting would need a rewrite (DB, sessions, default AI). vercel.json is untested on a live Vercel project.

## Deployment config
- Required secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET. D1 id + APP_URL in wrangler.toml. `[ai]` binding present.
- Apply migrations: `npm run db:migrate:remote` (0001, 0002).
- Optional: ENCRYPTION_KEY (`openssl rand -base64 32`, enables BYOK; do not rotate without re-saving user keys), GITHUB_TOKEN, AI_MODEL.

## Next exact step
Folders, starring and tags (Phase 3) — then monitoring.
