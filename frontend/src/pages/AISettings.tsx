import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { api, type ProviderName, type ProviderRow, type ProviderSettings } from '../api';

const META: Record<ProviderName, { label: string; hint: string }> = {
  gemini: { label: 'Google Gemini', hint: 'Your own key from Google AI Studio.' },
  groq: { label: 'Groq', hint: 'Your own key from console.groq.com.' },
  custom: { label: 'OpenAI-compatible endpoint', hint: 'Any HTTPS endpoint that supports /chat/completions.' },
};
const STATUS: Record<string, [string, string]> = {
  ok: ['Connected', 'text-green-400'], invalid_key: ['Key rejected', 'text-red-400'], error: ['Connection failed', 'text-red-400'], untested: ['Not verified', 'text-amber-300'],
};

export default function AISettings() {
  const [data, setData] = useState<ProviderSettings | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setData(await api<ProviderSettings>('/ai/providers')); setErr(''); } catch (e) { setErr((e as Error).message); } }, []);
  useEffect(() => { load(); }, [load]);

  async function activate(p: string) {
    setBusy(true); setErr('');
    try { await api('/ai/active', { method: 'PUT', body: JSON.stringify({ provider: p }) }); await load(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  if (!data) return err ? <p className="text-red-400">{err}</p> : <p className="text-slate-400">Loading AI settings…</p>;
  const activeLabel = data.active === 'default' ? data.default.label : META[data.active].label;

  return (
    <div className="space-y-5 max-w-3xl">
      <div><h1 className="text-2xl font-bold">AI Settings</h1><p className="text-slate-400 text-sm">No API key is required. Adding your own key is optional.</p></div>
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0"><div className="text-xs text-slate-400">Active provider</div><div className="font-semibold" data-testid="active-provider">{activeLabel}</div></div>
        {data.active !== 'default' && <button className="btn btn-ghost" disabled={busy || !data.default.available} onClick={() => activate('default')}>Switch back to Default AI</button>}
      </div>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}

      <section aria-label="Default AI" className="card p-4 space-y-2">
        <div className="flex items-center gap-2"><h2 className="font-semibold flex-1">Default AI (Cloudflare Workers AI)</h2>
          <span className={`text-xs ${data.default.available ? 'text-green-400' : 'text-amber-300'}`}>{data.default.available ? 'Available' : 'Not available on this deployment'}</span></div>
        <p className="text-xs text-slate-400">Model: {data.default.model}</p>
        <p className="text-xs text-slate-400">{data.default.limits}</p>
        {data.active !== 'default' && <button className="btn btn-ghost" disabled={busy || !data.default.available} onClick={() => activate('default')}>Use Default AI</button>}
      </section>

      {!data.byokEnabled && <p className="text-xs text-amber-300">Bringing your own API is not enabled on this deployment (the owner has not set ENCRYPTION_KEY).</p>}
      {(['gemini', 'groq', 'custom'] as ProviderName[]).map((n) => (
        <ProviderCard key={n} name={n} row={data.providers.find((x) => x.provider === n)} active={data.active === n} enabledByo={data.byokEnabled} onChanged={load} onActivate={() => activate(n)} busy={busy} />
      ))}
    </div>
  );
}

function ProviderCard({ name, row, active, enabledByo, onChanged, onActivate, busy }: {
  name: ProviderName; row?: ProviderRow; active: boolean; enabledByo: boolean; onChanged: () => void; onActivate: () => void; busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(row?.base_url ?? '');
  const [model, setModel] = useState(row?.model ?? '');
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [work, setWork] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const body = () => JSON.stringify({ apiKey: key || undefined, baseUrl: name === 'custom' ? baseUrl : undefined, model: model || undefined });
  const run = async (fn: () => Promise<void>) => { setWork(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } setWork(false); };

  const test = () => run(async () => {
    const r = await api<{ models: string[]; modelOk: boolean }>('/ai/providers/test', { method: 'POST', body: JSON.stringify({ provider: name, ...JSON.parse(body()) }) });
    setModels(r.models);
    setMsg({ ok: true, text: `Connected. ${r.models.length} models available.${model ? (r.modelOk ? ' Model works.' : '') : ' Choose a model.'}` });
  });
  const save = () => run(async () => {
    await api(`/ai/providers/${name}`, { method: 'PUT', body: body() });
    setKey(''); setOpen(false); setMsg(null); onChanged();
  });
  const remove = () => run(async () => { await api(`/ai/providers/${name}`, { method: 'DELETE' }); setConfirmDel(false); setOpen(false); setModel(''); onChanged(); });
  const toggle = () => run(async () => { await api(`/ai/providers/${name}`, { method: 'PATCH', body: JSON.stringify({ enabled: !row!.enabled }) }); onChanged(); });
  const [stLabel, stColor] = row ? (STATUS[row.status] ?? STATUS.untested) : ['Not configured', 'text-slate-400'];

  return (
    <section aria-label={META[name].label} className={`card p-4 space-y-3 ${active ? 'ring-1 ring-primary' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold flex-1">{META[name].label}</h2>
        {active && <span className="text-xs rounded-full bg-primary/20 text-primary px-2 py-0.5">Active</span>}
        <span className={`text-xs ${stColor}`}>{row && !row.enabled ? 'Disabled' : stLabel}</span>
      </div>
      <p className="text-xs text-slate-400">{META[name].hint}</p>
      {row && (
        <div className="text-xs text-slate-300 space-y-0.5">
          <div>Model: <span className="text-slate-100">{row.model}</span></div>
          {row.base_url && <div className="break-all">Endpoint: {row.base_url}</div>}
          <div className="flex items-center gap-1"><KeyRound size={12} />API key: {row.key_hint ?? '—'}</div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {row && !active && <button className="btn" disabled={busy || !row.enabled || !enabledByo} onClick={onActivate}>Use this provider</button>}
        {row && <button className="btn btn-ghost" disabled={work} onClick={toggle}>{row.enabled ? 'Disable' : 'Enable'}</button>}
        <button className="btn btn-ghost" disabled={!enabledByo} onClick={() => setOpen(!open)}>{open ? 'Close' : row ? 'Edit' : 'Configure'}</button>
        {row && !confirmDel && <button className="btn btn-ghost text-red-300" onClick={() => setConfirmDel(true)}><Trash2 size={14} />Delete</button>}
        {row && confirmDel && <button className="btn bg-red-600 hover:bg-red-500" disabled={work} onClick={remove}>Confirm delete</button>}
      </div>

      {open && (
        <div className="space-y-3 border-t border-white/5 pt-3">
          {name === 'custom' && <input aria-label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" autoComplete="off" className="w-full rounded-xl bg-sec border border-white/5 p-2.5 text-sm" />}
          <input aria-label="API key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={row ? 'Leave blank to keep the current key' : 'Paste your API key'} className="w-full rounded-xl bg-sec border border-white/5 p-2.5 text-sm" />
          <input aria-label="Model" list={`models-${name}`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model (run Test connection to list models)" autoComplete="off" className="w-full rounded-xl bg-sec border border-white/5 p-2.5 text-sm" />
          <datalist id={`models-${name}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
          {msg && <p role="status" className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.ok && <CheckCircle2 size={12} className="inline mr-1" />}{msg.text}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost" disabled={work || (!key && !row)} onClick={test}>{work ? <Loader2 size={14} className="animate-spin" /> : null}Test connection</button>
            <button className="btn" disabled={work || !model || (!key && !row)} onClick={save}>Save</button>
          </div>
          <p className="text-[11px] text-slate-500">Saving verifies the key and model with the provider first. Your key is sent only to this app's server over HTTPS, stored encrypted, and never shown again.</p>
        </div>
      )}
    </section>
  );
}
