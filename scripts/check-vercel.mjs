// Fails the Vercel build early if the /api proxy to the Cloudflare Worker is not set up correctly.
import { readFileSync } from 'node:fs';
const file = process.argv[2] ?? 'vercel.json';
const fail = (m) => { console.error(`\n✖ vercel.json: ${m}\n`); process.exit(1); };
let cfg;
try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch { fail('file is missing or not valid JSON'); }
const rw = cfg.rewrites ?? [];
const api = rw[0];
if (!api || api.source !== '/api/:path*') fail('the FIRST rewrite must have source "/api/:path*"');
if (/YOUR-|REPLACE/i.test(api.destination)) fail('replace REPLACE-WITH-YOUR-WORKER-URL with your Cloudflare Worker host (e.g. drex-analyser.myname.workers.dev)');
if (!/^https:\/\/[^/\s]+\/api\/:path\*$/.test(api.destination)) fail('destination must look like https://<worker-host>/api/:path*');
if (/vercel\.app/i.test(api.destination)) fail('destination must be the Cloudflare Worker, not Vercel itself (that would loop)');
const last = rw[rw.length - 1];
if (!last || last.source !== '/(.*)' || last.destination !== '/index.html') fail('the LAST rewrite must send every other path to /index.html (so page refresh works)');
if (cfg.outputDirectory !== 'dist') fail('outputDirectory must be "dist"');
console.log(`✔ vercel.json OK — /api/* is proxied to ${new URL(api.destination.replace(':path*', 'x')).host}`);
