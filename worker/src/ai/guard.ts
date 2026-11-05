// Backend gate: Drex AI answers ONLY about the currently opened repository.
// Policy: reject unless the question is clearly tied to THIS repo (explicit repo term, an anchor like
// "this/it/the project" plus a repo-intent word, or a closed set of canonical lifecycle questions).
export const REFUSAL = 'I can only answer questions about the currently opened repository.';
export interface GateCtx { name: string; paths: string[]; language?: string | null }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INJECTION = /\b(ignore|disregard|forget|override|bypass)\b.{0,30}\b(instructions?|rules?|prompt|restrictions?|guidelines?)\b|\b(act as|pretend|you are now|roleplay|jailbreak|developer mode|system prompt)\b/i;
const OFF_TOPIC = /\b(weather|forecast|news|headlines?|stocks?|bitcoin|crypto|joke|poem|story|song|lyrics|movie|recipe|restaurant|horoscope|celebrity|politics|election|homework|essay|girlfriend|boyfriend|capital of|translate|riddle|trivia|sports?|cricket|football|score|rain|temperature|president|who (is|was|created|invented|won)|about yourself|your name|are you (chatgpt|an ai))\b/i;
const ANCHOR = /\b(this|it|its|readme|the (repo|repository|project|app|tool|library|code|package|bot))\b/i;
const SIGNAL = /\b(install\w*|uninstall\w*|run|start|build|deploy\w*|config\w*|set ?up|depend\w*|package|docker\w*|compose|env|api key|key|database|db|android|termux|windows|linux|macos|mac|update|upgrade|error|bug|fail\w*|crash\w*|troubleshoot\w*|file|function|class|module|source|code|license|free|self-?host\w*|alternatives?|limitations?|support\w*|architecture|script|command|version|release|commit|purpose|features?|usage|requirements?|prerequisites?)\b/i;
const PURPOSE = /^(what|why|how)\b.*\b(it|this)\b.*\b(do|does|work|works|solve|solves)\b/i;
const TOOLS = /\b(python3?|java|javascript|typescript|node(?:\.?js)?|npm|yarn|pnpm|pip3?|pipx|conda|git|github|docker|kubernetes|k8s|react|vue|angular|django|flask|rust|cargo|golang|ruby|php|dotnet|aws|azure|vscode)\b/gi;
const TAIL = String.raw`(?:\s+(?:it|this|the (?:project|app|repo|repository|tool)|this (?:project|app|repo|repository|tool)))?\s*\??`;
const CANON = new RegExp(String.raw`^(?:how (?:do i|can i|to|should i)|what are the|what's the|list the|show the)\s+(?:install|uninstall|run|build|deploy|configure|update|upgrade|set ?up|start|troubleshoot|dependencies|prerequisites|requirements|license|limitations|alternatives|features|architecture)${TAIL}$`, 'i');
const NEEDS = /^(?:what|which) (?:dependencies|prerequisites|requirements|platforms|os) (?:(?:are|do|does) )?(?:i |it |this )?(?:need|needed|required|supported)\s*\??$/i;

function vocab(ctx: GateCtx): Set<string> {
  const v = new Set<string>(), add = (...w: string[]) => w.forEach((x) => v.add(x));
  const has = (f: string) => ctx.paths.some((p) => p === f || p.endsWith('/' + f));
  if (ctx.language) add(ctx.language.toLowerCase());
  if (has('package.json')) add('node', 'nodejs', 'node.js', 'npm', 'yarn', 'pnpm', 'javascript', 'typescript');
  if (has('requirements.txt') || has('pyproject.toml') || has('setup.py')) add('python', 'python3', 'pip', 'pip3', 'pipx', 'conda');
  if (has('Cargo.toml')) add('rust', 'cargo');
  if (has('go.mod')) add('golang');
  if (has('Dockerfile') || has('docker-compose.yml')) add('docker');
  if (has('pom.xml') || has('build.gradle')) add('java');
  return v;
}

export function isRepoQuestion(question: string, ctx: GateCtx): boolean {
  const q = question.trim();
  if (!q || q.length > 2000) return false;
  let lower = q.toLowerCase();
  if (INJECTION.test(lower)) return false;

  const terms = new Set<string>();
  if (ctx.name.length >= 3) terms.add(ctx.name.toLowerCase());
  for (const p of ctx.paths.slice(0, 300)) {
    terms.add(p.toLowerCase());
    const base = p.split('/').pop()!.toLowerCase();
    if (base.length >= 4) terms.add(base);
  }
  let hit = false;
  for (const t of [...terms].sort((a, b) => b.length - a.length)) {
    const next = lower.replace(new RegExp(`(^|[^a-z0-9])${esc(t)}(?=[^a-z0-9]|$)`, 'g'), '$1 ');
    if (next !== lower) { hit = true; lower = next; }
  }
  if (OFF_TOPIC.test(lower)) return false; // judged on what is left after removing repo names/paths
  if (hit) return true;

  const v = vocab(ctx);
  const foreign = [...lower.matchAll(TOOLS)].some((m) => !v.has(m[1]));
  if (foreign) return false; // generic tool/language questions ("install Python") never qualify
  if (ANCHOR.test(lower)) return PURPOSE.test(lower) || SIGNAL.test(lower);
  return CANON.test(lower) || NEEDS.test(lower);
}
