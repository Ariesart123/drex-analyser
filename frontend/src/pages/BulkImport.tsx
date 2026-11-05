import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, RotateCcw } from 'lucide-react';
import { api, type ImportResp, type ImportRow } from '../api';

const CHUNK = 10;
const tokenize = (s: string) => s.split(/[\s,]+/).filter(Boolean);

export default function BulkImport() {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [dups, setDups] = useState(0);
  const [err, setErr] = useState('');

  async function run(tokens: string[], reset: boolean) {
    setBusy(true); setErr('');
    if (reset) { setRows([]); setInvalid([]); setDups(0); }
    setProgress([0, tokens.length]);
    try {
      for (let i = 0; i < tokens.length; i += CHUNK) {
        const res = await api<ImportResp>('/repositories/import', { method: 'POST', body: JSON.stringify({ urls: tokens.slice(i, i + CHUNK) }) });
        setRows((r) => [...r, ...res.results]);
        setInvalid((v) => [...v, ...res.invalid]);
        setDups((d) => d + res.duplicates.length);
        setProgress([Math.min(i + CHUNK, tokens.length), tokens.length]);
      }
      qc.invalidateQueries();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const count = (s: ImportRow['status']) => rows.filter((r) => r.status === s).length;
  const failed = rows.filter((r) => ['failed', 'rate_limited'].includes(r.status));
  const submitted = tokenize(text).length;
  const stats: [string, number, string][] = [
    ['Submitted', progress[1], ''], ['Imported', count('imported'), 'text-green-400'],
    ['Already existing', count('exists') + dups, 'text-slate-300'], ['Invalid', invalid.length + count('not_found'), 'text-amber-400'],
    ['Failed', failed.length, 'text-red-400'],
  ];

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-bold">Bulk Import</h1><p className="text-slate-400 text-sm">Paste GitHub links — one per line or comma separated.</p></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} disabled={busy}
        placeholder={'https://github.com/user/project-one\nhttps://github.com/user/project-two'}
        className="w-full rounded-2xl bg-card border border-white/5 p-4 text-sm font-mono outline-none focus:border-primary" />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy || !submitted} onClick={() => run(tokenize(text), true)}><Upload size={16} />{busy ? 'Importing…' : `Import ${submitted || ''}`}</button>
        {failed.length > 0 && !busy && <button className="btn btn-ghost" onClick={() => { const t = failed.map((f) => f.input); setRows((r) => r.filter((x) => !t.includes(x.input))); run(t, false); }}><RotateCcw size={16} />Retry {failed.length} failed</button>}
      </div>
      {busy && <div className="h-2 rounded-full bg-sec"><div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${(progress[0] / Math.max(1, progress[1])) * 100}%` }} /></div>}
      {err && <p className="text-red-400 text-sm">{err}</p>}
      {progress[1] > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {stats.map(([l, v, c]) => <div key={l} className="card p-3"><div className={`text-xl font-bold ${c}`}>{v}</div><div className="text-xs text-slate-400">{l}</div></div>)}
          </div>
          <div className="card divide-y divide-white/5">
            {invalid.map((u, i) => <div key={'i' + i} className="p-3 text-sm flex justify-between gap-3"><span className="break-all">{u}</span><span className="text-amber-400 shrink-0">invalid URL</span></div>)}
            {rows.filter((r) => r.status !== 'imported').map((r, i) => <div key={i} className="p-3 text-sm flex justify-between gap-3"><span className="break-all">{r.fullName || r.input}</span><span className="text-slate-400 shrink-0">{r.status.replace('_', ' ')}</span></div>)}
          </div>
        </>
      )}
    </div>
  );
}
