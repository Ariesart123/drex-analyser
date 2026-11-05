const PRIORITY = ['README.md', 'readme.md', 'package.json', 'requirements.txt', 'pyproject.toml', 'setup.py', 'Cargo.toml', 'go.mod',
  'pom.xml', 'build.gradle', 'Dockerfile', 'docker-compose.yml', 'Makefile', '.env.example'];

export function selectFiles(paths: string[], question: string, max = 8): string[] {
  const lower = question.toLowerCase(), set = new Set(paths), out: string[] = [];
  for (const p of paths) {
    const base = p.split('/').pop()!.toLowerCase();
    if (lower.includes(p.toLowerCase()) || (base.length >= 4 && lower.includes(base))) out.push(p);
  }
  for (const p of PRIORITY) if (set.has(p) && !out.includes(p)) out.push(p);
  return out.slice(0, max);
}

const gh = (token?: string): Record<string, string> => ({
  'User-Agent': 'drex-analyser', Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

export async function fetchTree(full: string, branch: string, token?: string): Promise<string[]> {
  const r = await fetch(`https://api.github.com/repos/${full}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: gh(token) });
  if (!r.ok) throw new Error('tree fetch failed');
  const j = (await r.json()) as { tree: { path: string; type: string }[] };
  return j.tree.filter((t) => t.type === 'blob').map((t) => t.path).slice(0, 2000);
}

export async function fetchFile(full: string, path: string, token?: string): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${full}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
    { headers: { ...gh(token), Accept: 'application/vnd.github.raw+json' } });
  if (!r.ok) return '';
  return (await r.text()).slice(0, 12_000);
}
