# Drex Analyser — Understand Every Repository.
Setup (works from Cloudflare dashboard / Termux):
1. `npm install`
2. `npx wrangler d1 create drex-db` → paste the id into wrangler.toml
3. `npm run db:migrate:remote`
4. Create a GitHub OAuth App; callback: `https://<your-worker>/api/auth/callback`
5. `npx wrangler secret put GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
6. Set `APP_URL` in wrangler.toml, then `npm run deploy`
Local: copy .dev.vars.example to .dev.vars; `npm run build`, `npm run db:migrate:local`, `npm run dev`. UI-only dev: `npm run dev:ui`.

## AI configuration
Zero-key by default: the Worker uses the Cloudflare Workers AI binding (`[ai]` in wrangler.toml), so users never enter keys. Free allocation: 10,000 Neurons/day per account.
Optional: `wrangler secret put ENCRYPTION_KEY` (value from `openssl rand -base64 32`) enables users to add their own provider; `GITHUB_TOKEN` raises GitHub API limits. Secrets never go in source or frontend code.

BYOK providers (Gemini, Groq, custom OpenAI-compatible) are configured by each user in **AI Settings**; they need the optional `ENCRYPTION_KEY` secret. Run `npm run db:migrate:remote` after pulling to apply migration 0002.

## Deploy: Vercel (site) + Cloudflare (API)
Follow **docs/DEPLOY_ANDROID.md** (works entirely from a phone). `vercel.json` proxies `/api/*` to the Worker so cookies work; the build fails early if the Worker URL is still the placeholder. Check `/api/health` after deploying. Single-Worker mode (no Vercel): `npm run deploy:full` with `wrangler.full.toml`.
