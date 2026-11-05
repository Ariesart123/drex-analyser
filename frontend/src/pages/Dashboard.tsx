import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Star, Folder, Library, Upload } from 'lucide-react';
import { api, type Repo } from '../api';

interface Dash { total: number; starred: number; folders: number; languages: { language: string; n: number }[]; recent: Repo[] }

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['dash'], queryFn: () => api<Dash>('/dashboard') });
  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (error || !data) return <p className="text-red-400">Could not load dashboard.</p>;
  const stats = [
    { label: 'Repositories', v: data.total, icon: Library }, { label: 'Starred', v: data.starred, icon: Star },
    { label: 'Folders', v: data.folders, icon: Folder },
  ];
  const max = Math.max(1, ...data.languages.map((l) => l.n));
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Drex Command Center</h1><p className="text-slate-400 text-sm">Understand Every Repository.</p></div>
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <s.icon size={18} className="text-primary mb-2" />
            <div className="text-2xl md:text-3xl font-bold">{s.v}</div>
            <div className="text-xs text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>
      {data.total === 0 ? (
        <div className="card p-8 text-center space-y-3">
          <p className="text-slate-300">No repositories yet.</p>
          <Link to="/import" className="btn"><Upload size={16} /> Bulk import repositories</Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <section className="card p-4 space-y-3">
            <h2 className="font-semibold">Recently Added</h2>
            {data.recent.map((r) => (
              <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="block rounded-xl p-3 bg-sec hover:bg-white/5">
                <div className="font-medium truncate">{r.full_name}</div>
                <div className="text-xs text-slate-400 truncate">{r.description || 'No description'}</div>
              </a>
            ))}
          </section>
          <section className="card p-4 space-y-3">
            <h2 className="font-semibold">Languages</h2>
            {data.languages.map((l) => (
              <div key={l.language}>
                <div className="flex justify-between text-xs mb-1"><span>{l.language}</span><span className="text-slate-400">{l.n}</span></div>
                <div className="h-2 rounded-full bg-sec"><div className="h-2 rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${(l.n / max) * 100}%` }} /></div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
