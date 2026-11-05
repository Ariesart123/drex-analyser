# Deploy Drex from an Android phone (Vercel site + Cloudflare API)

Architecture: the React site runs on **Vercel**. Vercel forwards every `/api/*` request to a **Cloudflare Worker** (API + D1 database + free Workers AI). Your browser only ever sees the Vercel address, so login cookies work. Users never enter an AI key.

You need free accounts: GitHub, Cloudflare, Vercel (sign in with GitHub). Use Chrome; if a dashboard looks cramped, menu -> "Desktop site".

Pick names first and write them down:
- Vercel project name -> your site will be `https://NAME.vercel.app` (example: `drex-aries`)
- Worker name stays `drex-analyser` -> `https://drex-analyser.YOURSUB.workers.dev` (YOURSUB is shown by Cloudflare)

## 1. Put the code on GitHub (Termux)
Install **Termux from F-Droid** (the Play Store build is outdated). Create an EMPTY repo on github.com (name `drex-analyser`). Create a token: GitHub -> Settings -> Developer settings -> Personal access tokens -> Tokens (classic) -> scope `repo`.
```
pkg update -y && pkg install -y git unzip
termux-setup-storage
cd ~ && unzip ~/storage/downloads/drex-analyser.zip -d drex && cd drex
git init -b main && git add . && git commit -m "Drex"
git remote add origin https://github.com/YOURNAME/drex-analyser.git
git push -u origin main      # username = YOURNAME, password = the token
```
(You can then edit single files with the pencil icon on github.com.)

## 2. Cloudflare: database
dash.cloudflare.com -> Storage & Databases -> D1 SQL database -> Create -> name `drex-db`. Copy the **Database ID**.
On GitHub edit `wrangler.toml`: set `database_id = "..."` and `APP_URL = "https://NAME.vercel.app"`. Commit.

## 3. Cloudflare: Worker
Workers & Pages -> Create -> **Import a repository** -> pick `drex-analyser`.
- Project/Worker name: `drex-analyser` (must equal `name` in wrangler.toml)
- Build command: leave empty
- Deploy command: `npx wrangler d1 migrations apply drex-db --remote && npx wrangler deploy`
Deploy. Note the URL `https://drex-analyser.YOURSUB.workers.dev`.
If the migration step fails (token permissions): D1 -> drex-db -> Console -> paste the contents of `docs/schema-all.sql` -> Execute, and set the deploy command to just `npx wrangler deploy`.

## 4. Vercel: site
On GitHub edit `vercel.json`: replace `REPLACE-WITH-YOUR-WORKER-URL.workers.dev` with `drex-analyser.YOURSUB.workers.dev`. Commit.
vercel.com -> Add New -> Project -> import the repo. Project name = `NAME`. Framework: Vite, Root Directory empty. Deploy.
(The build stops with a clear message if the Worker URL is still the placeholder.)

## 5. GitHub OAuth app
GitHub -> Settings -> Developer settings -> OAuth Apps -> New.
- Homepage URL: `https://NAME.vercel.app`
- Authorization callback URL: `https://NAME.vercel.app/api/auth/callback`  (exact)
Register, then **Generate a new client secret**. Copy Client ID and secret.

## 6. Worker secrets
Cloudflare -> Workers & Pages -> drex-analyser -> Settings -> Variables and Secrets -> Add (type **Secret**): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. Then Deployments -> redeploy (or push any commit).

## 7. Check
Open `https://NAME.vercel.app/api/health`. You must see `"ready":true`. If not, `problems` says exactly what is missing (APP_URL, secrets, database id, migrations).
Then open `https://NAME.vercel.app` -> Continue with GitHub -> authorize -> dashboard. Import a repo, open it, Ask AI (no key needed).
Use the production address (`NAME.vercel.app`), not preview URLs.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Cannot reach the API" screen | `vercel.json` Worker URL wrong, or Worker not deployed |
| Login error "GitHub rejected the login" | Callback URL not exactly `https://NAME.vercel.app/api/auth/callback`, or wrong Client ID/secret |
| Login error "database may not be set up" | Run `docs/schema-all.sql` in the D1 console |
| `/api/health` problem about APP_URL | Fix `APP_URL` in wrangler.toml (https, no path) and redeploy |
| Ask AI says not enabled | Keep the `[ai]` block in wrangler.toml; check `workers_ai: true` in /api/health |
| Ask AI rate limit | Free Workers AI allowance is daily (resets 00:00 UTC); wait or add your own key in AI Settings |
| Worker deploy fails on `dist` | You used wrangler.full.toml; use the default wrangler.toml for this setup |
