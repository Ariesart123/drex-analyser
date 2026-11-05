import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Plus, Send, Sparkles } from 'lucide-react';
import { api, type ChatMessage, type ChatResult } from './api';
import Markdown from './Markdown';

export interface ChatRepo { id: number; full_name: string; default_branch: string | null }
type Err = { kind: 'rate' | 'off' | 'provider' | 'generic'; text: string };
const SUGGESTIONS = ['What does this project do?', 'How do I install this project?', 'What dependencies are needed?', 'Does it support Android/Termux?'];

// Context isolation: the whole chat is remounted (state discarded) whenever the open repository changes.
export default function RepoChat({ repo }: { repo: ChatRepo }) {
  return <ChatInner key={repo.id} repo={repo} />;
}

function ChatInner({ repo }: { repo: ChatRepo }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [conv, setConv] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Err | null>(null);
  const [input, setInput] = useState('');
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const st = await api<{ available: boolean }>('/ai/status');
        if (!alive) return;
        setAvailable(st.available);
        const list = await api<{ id: number }[]>(`/ai/conversations?repositoryId=${repo.id}`);
        if (list[0]) {
          const c = await api<{ id: number; messages: ChatMessage[] }>(`/ai/conversations/${list[0].id}`);
          if (alive) { setConv(c.id); setMsgs(c.messages); }
        }
      } catch { if (alive) setErr({ kind: 'generic', text: 'Could not load chat history.' }); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [repo.id]);

  useEffect(() => { end.current?.scrollIntoView?.({ behavior: 'smooth' }); }, [msgs, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setErr(null); setBusy(true); setInput('');
    setMsgs((m) => [...m, { role: 'user', content: message }]);
    try {
      const res = await api<ChatResult>('/ai/chat', { method: 'POST', body: JSON.stringify({ repositoryId: repo.id, conversationId: conv, message }) });
      setConv(res.conversationId);
      setMsgs((m) => [...m, { role: 'assistant', content: res.answer, sources: res.sources, refused: res.refused }]);
    } catch (e) {
      const status = (e as { status?: number }).status, code = (e as { code?: string }).code ?? '';
      setMsgs((m) => m.slice(0, -1)); setInput(message); // let the user retry
      setErr(status === 409 || code === 'provider_auth' || code === 'provider_unavailable' ? { kind: 'provider', text: (e as Error).message }
        : status === 429 ? { kind: 'rate', text: (e as Error).message || 'Rate limit reached. Try again later.' }
        : status === 503 ? { kind: 'off', text: 'AI is not enabled on this deployment.' }
        : { kind: 'generic', text: 'Something went wrong. Your question was not sent — try again.' });
    }
    setBusy(false);
  }

  return (
    <section className="card flex flex-col h-[75vh] lg:h-[calc(100vh-7rem)]" aria-label="Repository AI chat">
      <header className="flex items-center gap-2 p-3 border-b border-white/5">
        <Sparkles size={16} className="text-accent shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Ask AI</div>
          <div className="text-[11px] text-slate-400 truncate" data-testid="chat-context">Context: {repo.full_name}</div>
        </div>
        <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => { setConv(null); setMsgs([]); setErr(null); }}><Plus size={14} />New</button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Loading conversation…</p>}
        {!loading && msgs.length === 0 && (
          <div className="space-y-3 text-center py-6">
            <p className="text-sm text-slate-400">Ask anything about <span className="text-slate-200">{repo.full_name}</span>.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => <button key={s} disabled={!available || busy} onClick={() => send(s)} className="rounded-full bg-sec px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-50">{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div data-refused={m.refused ? 'true' : undefined}
              className={`max-w-[92%] rounded-2xl px-3 py-2 ${m.role === 'user' ? 'bg-primary text-white' : m.refused ? 'bg-sec text-slate-400 italic' : 'bg-sec'}`}>
              {m.role === 'user' ? <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p> : <Markdown>{m.content}</Markdown>}
              {!!m.sources?.length && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-slate-400">Sources:</span>
                  {m.sources.map((p) => (
                    <a key={p} href={`https://github.com/${repo.full_name}/blob/${repo.default_branch ?? 'HEAD'}/${p}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-accent hover:bg-white/10"><FileText size={11} />{p}</a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Thinking…</p>}
        <div ref={end} />
      </div>

      {err && <div role="alert" data-kind={err.kind} className={`mx-3 mb-2 rounded-xl px-3 py-2 text-xs ${err.kind === 'rate' ? 'bg-amber-500/10 text-amber-300' : 'bg-red-500/10 text-red-300'}`}>{err.text}{err.kind === 'provider' && <> <a href="/settings/ai" className="underline">Open AI Settings</a></>}</div>}
      {!available && !loading ? (
        <p className="p-3 text-xs text-slate-400 border-t border-white/5">AI is not enabled on this deployment. Ask the owner to enable Workers AI, or add your own provider in Settings.</p>
      ) : (
        <form className="flex items-end gap-2 p-3 border-t border-white/5" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <textarea aria-label="Ask a question about this repository" value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={2000} disabled={busy}
            placeholder="Ask about this repository…" className="flex-1 resize-none rounded-xl bg-sec border border-white/5 p-2.5 text-sm outline-none focus:border-primary" />
          <button type="submit" className="btn !px-3" disabled={busy || !input.trim()}><Send size={16} />Send</button>
        </form>
      )}
    </section>
  );
}
