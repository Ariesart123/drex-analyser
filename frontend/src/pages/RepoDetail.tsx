import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, GitFork, Star } from 'lucide-react';
import { api, type RepoDetailData } from '../api';
import Markdown from '../Markdown';
import RepoChat from '../RepoChat';
import FileExplorer from '../FileExplorer';
import CommitList from '../CommitList';
import Releases from '../Releases';

const TABS = [['readme', 'README'], ['files', 'Files'], ['commits', 'Commits'], ['releases', 'Releases'], ['ai', 'Ask AI']] as const;
type Tab = (typeof TABS)[number][0];

export default function RepoDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>('readme');
  const repo = useQuery({ queryKey: ['repo', id], queryFn: () => api<RepoDetailData>(`/repositories/${id}`) });
  const readme = useQuery({ queryKey: ['readme', id], queryFn: () => api<{ path: string; content: string } | null>(`/repositories/${id}/readme`), enabled: !!repo.data && tab === 'readme' });

  if (repo.isLoading) return <p className="text-slate-400">Loading repository…</p>;
  if (repo.isError || !repo.data) return (
    <div className="card p-6 space-y-3"><p className="text-slate-300">Repository not found.</p><Link to="/repositories" className="btn btn-ghost">Back to repositories</Link></div>
  );
  const r = repo.data, branch = r.default_branch ?? 'HEAD';
  const facts: [string, string | number][] = [['Language', r.language ?? '—'], ['License', r.license ?? '—'], ['Default branch', r.default_branch ?? '—'], ['Last push', r.pushed_at ? new Date(r.pushed_at).toLocaleDateString() : '—']];
  const rateLimited = (readme.error as { status?: number } | null)?.status === 429;
  const content: Exclude<Tab, 'ai'> = tab === 'ai' ? 'readme' : tab; // on desktop the chat is always visible beside the content

  return (
    <div className="space-y-4">
      <Link to="/repositories" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"><ArrowLeft size={14} />Repositories</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold break-all">{r.full_name}</h1>
          <p className="text-sm text-slate-400 mt-1">{r.description || 'No description'}</p>
        </div>
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn w-full sm:w-auto"><ExternalLink size={16} />Open on GitHub</a>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="card p-3"><Star size={14} className="text-primary mb-1" /><div className="font-semibold">{r.stars}</div><div className="text-[11px] text-slate-400">Stars</div></div>
        <div className="card p-3"><GitFork size={14} className="text-primary mb-1" /><div className="font-semibold">{r.forks}</div><div className="text-[11px] text-slate-400">Forks</div></div>
        {facts.map(([k, v]) => <div key={k} className="card p-3"><div className="font-semibold truncate">{v}</div><div className="text-[11px] text-slate-400">{k}</div></div>)}
      </div>

      <div className="grid grid-cols-5 lg:grid-cols-4 gap-1 rounded-xl bg-sec p-1 text-xs sm:text-sm" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-lg py-2 ${t === 'ai' ? 'lg:hidden' : ''} ${tab === t ? 'bg-primary text-white' : 'text-slate-400'}`}>{label}</button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
        <section className={`card p-4 md:p-6 min-w-0 ${tab === 'ai' ? 'hidden lg:block' : ''}`}>
          {content === 'readme' && (
            <>
              <h2 className="font-semibold mb-3">{readme.data?.path ?? 'README'}</h2>
              {readme.isLoading && <div className="space-y-2 animate-pulse"><div className="h-4 bg-sec rounded w-2/3" /><div className="h-4 bg-sec rounded" /><div className="h-4 bg-sec rounded w-5/6" /></div>}
              {rateLimited && <p className="text-amber-300 text-sm">GitHub API rate limit reached. Try again later or open the README on GitHub.</p>}
              {readme.isError && !rateLimited && <p className="text-red-400 text-sm">Could not load the README.</p>}
              {readme.isSuccess && readme.data === null && <p className="text-slate-400 text-sm">This repository has no README.</p>}
              {readme.data && <Markdown base={{ fullName: r.full_name, branch }}>{readme.data.content}</Markdown>}
            </>
          )}
          {content === 'files' && <FileExplorer key={r.id} repo={r} />}
          {content === 'commits' && <CommitList key={r.id} repo={r} />}
          {content === 'releases' && <Releases key={r.id} repo={r} />}
        </section>
        <div className={`${tab === 'ai' ? '' : 'hidden lg:block'} lg:sticky lg:top-4`}>
          <RepoChat repo={{ id: r.id, full_name: r.full_name, default_branch: r.default_branch }} />
        </div>
      </div>
    </div>
  );
}
