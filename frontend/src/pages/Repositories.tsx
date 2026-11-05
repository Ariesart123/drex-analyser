import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Star, GitFork, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type Repo } from '../api';

export default function Repositories() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['repos', q, page],
    queryFn: () => api<{ items: Repo[]; total: number }>(`/repositories?q=${encodeURIComponent(q)}&page=${page}`),
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / 30)) : 1;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">All Repositories</h1>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-3.5 text-slate-500" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, owner, description…"
          className="w-full rounded-xl bg-card border border-white/5 pl-9 pr-3 py-3 text-sm outline-none focus:border-primary" />
      </div>
      {isLoading && <p className="text-slate-400">Loading…</p>}
      {data && data.items.length === 0 && <p className="text-slate-400">No repositories found.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data?.items.map((r) => (
          <div key={r.id} className="card p-4 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <Link to={`/repositories/${r.id}`} className="font-semibold break-all flex-1 hover:text-primary">{r.full_name}</Link>
              <a href={r.url} target="_blank" rel="noreferrer" aria-label="Open on GitHub" className="text-slate-400 hover:text-white"><ExternalLink size={16} /></a>
            </div>
            <p className="text-sm text-slate-400 line-clamp-2">{r.description || 'No description'}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mt-auto pt-1">
              {r.language && <span className="text-accent">{r.language}</span>}
              <span className="inline-flex items-center gap-1"><Star size={12} />{r.stars}</span>
              <span className="inline-flex items-center gap-1"><GitFork size={12} />{r.forks}</span>
              {r.pushed_at && <span>Pushed {new Date(r.pushed_at).toLocaleDateString()}</span>}
            </div>
          </div>
        ))}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="text-sm text-slate-400">{page} / {pages}</span>
          <button className="btn btn-ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
