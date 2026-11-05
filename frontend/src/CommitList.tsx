import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, GitCommit } from 'lucide-react';
import { api, fmtDate, type CommitDetail, type CommitPage } from './api';
import { Empty, ErrorBox, Skeleton } from './StateViews';

export default function CommitList({ repo }: { repo: { id: number } }) {
  const [page, setPage] = useState(1);
  const [sha, setSha] = useState<string | null>(null);
  if (sha) return <Detail repoId={repo.id} sha={sha} onBack={() => setSha(null)} />;
  return <List repoId={repo.id} page={page} setPage={setPage} onOpen={setSha} />;
}

function List({ repoId, page, setPage, onOpen }: { repoId: number; page: number; setPage: (p: number) => void; onOpen: (s: string) => void }) {
  const q = useQuery({ queryKey: ['commits', repoId, page], queryFn: () => api<CommitPage>(`/repositories/${repoId}/commits?page=${page}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-3">
      {d.items.length === 0 ? <Empty>No commits found.</Empty> : (
        <ul className="rounded-xl border border-white/5 divide-y divide-white/5 overflow-hidden">
          {d.items.map((c) => (
            <li key={c.sha}>
              <button onClick={() => onOpen(c.sha)} className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-white/5">
                <GitCommit size={16} className="mt-0.5 text-primary shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{c.message}</span>
                  <span className="block text-xs text-slate-400 truncate">{c.author_login ?? c.author_name} · {fmtDate(c.date)}</span>
                </span>
                <code className="text-xs text-accent shrink-0">{c.short}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-center gap-3">
        <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
        <span className="text-sm text-slate-400">Page {d.page}</span>
        <button className="btn btn-ghost" disabled={!d.hasNext} onClick={() => setPage(page + 1)}>Older</button>
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { added: 'text-green-400', removed: 'text-red-400', modified: 'text-amber-300', renamed: 'text-sky-300' };
function Detail({ repoId, sha, onBack }: { repoId: number; sha: string; onBack: () => void }) {
  const q = useQuery({ queryKey: ['commit', repoId, sha], queryFn: () => api<CommitDetail>(`/repositories/${repoId}/commits/${sha}`) });
  const d = q.data;
  return (
    <div className="space-y-3">
      <button className="btn btn-ghost !py-1.5" onClick={onBack}><ArrowLeft size={14} />All commits</button>
      {q.isLoading && <Skeleton rows={5} />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <div className="card p-4 space-y-2">
            <h3 className="font-semibold whitespace-pre-wrap break-words">{d.message}</h3>
            <p className="text-xs text-slate-400">{d.author_login ?? d.author_name} · {fmtDate(d.date)} · <code>{d.short}</code>{d.parents.length > 0 && <> · parent <code>{d.parents.join(', ')}</code></>}</p>
            <p className="text-xs"><span className="text-green-400">+{d.stats.additions}</span> <span className="text-red-400">−{d.stats.deletions}</span> in {d.files_total} file{d.files_total === 1 ? '' : 's'}</p>
            <a href={d.html_url} target="_blank" rel="noopener noreferrer" className="btn w-full sm:w-auto"><ExternalLink size={16} />View commit on GitHub</a>
          </div>
          <ul className="rounded-xl border border-white/5 divide-y divide-white/5">
            {d.files.map((f) => (
              <li key={f.filename} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className={`w-16 shrink-0 ${STATUS_COLOR[f.status] ?? 'text-slate-400'}`}>{f.status}</span>
                <span className="flex-1 min-w-0 break-all">{f.filename}</span>
                <span className="shrink-0"><span className="text-green-400">+{f.additions}</span> <span className="text-red-400">−{f.deletions}</span></span>
              </li>
            ))}
            {d.files.length === 0 && <li className="p-3 text-xs text-slate-400">No file changes reported for this commit.</li>}
          </ul>
          {d.files_truncated && <p className="text-xs text-amber-300">Showing the first 100 of {d.files_total} files. See the full diff on GitHub.</p>}
        </>
      )}
    </div>
  );
}
