import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Tag } from 'lucide-react';
import { api, fmtDate, fmtSize, type ReleasePage } from './api';
import Markdown from './Markdown';
import { Empty, ErrorBox, Skeleton } from './StateViews';

export default function Releases({ repo }: { repo: { id: number } }) {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['releases', repo.id, page], queryFn: () => api<ReleasePage>(`/repositories/${repo.id}/releases?page=${page}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  if (d.items.length === 0 && page === 1) return <Empty>This repository has no published releases.</Empty>;
  return (
    <div className="space-y-4">
      {d.items.map((r) => (
        <article key={r.id} className="card p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold break-all">{r.name}</h3>
            <span className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-xs"><Tag size={11} />{r.tag}</span>
            {r.is_latest && <span className="rounded-full bg-green-500/15 text-green-400 px-2 py-0.5 text-xs">Latest</span>}
            {r.prerelease && <span className="rounded-full bg-amber-500/15 text-amber-300 px-2 py-0.5 text-xs">Pre-release</span>}
          </div>
          <p className="text-xs text-slate-400">Published {fmtDate(r.published_at)}{r.author_login ? ` by ${r.author_login}` : ''}</p>
          {r.body ? <details><summary className="cursor-pointer text-sm text-primary">Release notes</summary><div className="mt-2"><Markdown>{r.body}</Markdown></div></details> : <p className="text-xs text-slate-500">No description.</p>}
          {r.assets.length > 0 && (
            <ul className="rounded-xl border border-white/5 divide-y divide-white/5">
              {r.assets.map((a) => (
                <li key={a.name}><a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 min-h-11 text-sm hover:bg-white/5">
                  <Download size={14} className="text-primary shrink-0" /><span className="flex-1 truncate">{a.name}</span><span className="text-xs text-slate-500">{fmtSize(a.size)} · {a.download_count}↓</span></a></li>
              ))}
            </ul>
          )}
          <a href={r.html_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink size={12} />View on GitHub</a>
        </article>
      ))}
      <div className="flex items-center justify-center gap-3">
        <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
        <span className="text-sm text-slate-400">Page {d.page}</span>
        <button className="btn btn-ghost" disabled={!d.hasNext} onClick={() => setPage(page + 1)}>Older</button>
      </div>
    </div>
  );
}
