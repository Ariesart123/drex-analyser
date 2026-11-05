export interface ParsedRepo { owner: string; name: string; fullName: string; url: string }
export interface ParseResult { valid: ParsedRepo[]; invalid: string[]; duplicates: string[] }

const RE = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[\/?#].*)?$/i;

export function parseRepoUrls(input: string): ParseResult {
  const valid: ParsedRepo[] = [], invalid: string[] = [], duplicates: string[] = [];
  const seen = new Set<string>();
  for (const token of input.split(/[\s,]+/).filter(Boolean)) {
    const m = RE.exec(token);
    if (!m || m[2] === '.' || m[2] === '..') { invalid.push(token); continue; }
    const fullName = `${m[1]}/${m[2]}`;
    const key = fullName.toLowerCase();
    if (seen.has(key)) { duplicates.push(token); continue; }
    seen.add(key);
    valid.push({ owner: m[1], name: m[2], fullName, url: `https://github.com/${fullName}` });
  }
  return { valid, invalid, duplicates };
}
