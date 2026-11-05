import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';
import { highlight } from './highlight';

export default function CodeViewer({ code, name, extension }: { code: string; name: string; extension: string }) {
  const { html, language } = useMemo(() => highlight(code, name, extension), [code, name, extension]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl bg-sec border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-slate-400 border-b border-white/5">
        <span>{language ?? 'plain text'}</span>
        <button className="inline-flex items-center gap-1 hover:text-white" onClick={async () => { try { await navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } }}>
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed"><code className="hljs !bg-transparent !p-0" data-testid="code" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}
