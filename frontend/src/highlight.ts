import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript'; import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python'; import json from 'highlight.js/lib/languages/json'; import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml'; import markdown from 'highlight.js/lib/languages/markdown'; import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css'; import go from 'highlight.js/lib/languages/go'; import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java'; import c from 'highlight.js/lib/languages/c'; import cpp from 'highlight.js/lib/languages/cpp';
import sql from 'highlight.js/lib/languages/sql'; import ini from 'highlight.js/lib/languages/ini'; import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile'; import makefile from 'highlight.js/lib/languages/makefile';

Object.entries({ javascript, typescript, python, json, bash, yaml, markdown, xml, css, go, rust, java, c, cpp, sql, ini, diff, dockerfile, makefile }).forEach(([n, l]) => hljs.registerLanguage(n, l));
const EXT: Record<string, string> = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', md: 'markdown', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', css: 'css', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
  sql: 'sql', toml: 'ini', ini: 'ini', cfg: 'ini', diff: 'diff', patch: 'diff' };
const NAMES: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile' };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Output is HTML produced by highlight.js from escaped input (only <span class> tags); never from raw file HTML.
export function highlight(code: string, name: string, ext: string): { html: string; language: string | null } {
  const language = NAMES[name.toLowerCase()] ?? EXT[ext.toLowerCase()] ?? null;
  if (!language || code.length > 200_000) return { html: esc(code), language: null };
  try { return { html: hljs.highlight(code, { language, ignoreIllegals: true }).value, language }; } catch { return { html: esc(code), language: null }; }
}
