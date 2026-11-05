import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, ExternalLink, File as FileIcon, Folder, FolderGit2 } from 'lucide-react';
import { api, fmtSize, type DirData, type FileData } from './api';
import CodeViewer from './CodeViewer';
import { Empty, ErrorBox, Skeleton } from './StateViews';

type Cur = { path: string; view: 'dir' | 'file' };
// Files are only ever fetched as text and displayed; nothing from a repository is executed or rendered as HTML.
export default function FileExplorer({ repo }: { repo: { id: number; full_name: string } }) {
  const [cur, setCur] = useState<Cur>({ path: '', view: 'dir' });
  const segs = cur.path ? cur.path.split('/') : [];
  const goDir = (path: string) => setCur({ path, view: 'dir' });
  const parent = segs.slice(0, -1).join('/');
  const crumbs = [{ label: repo.full_name.split('/')[1], path: '' }, ...segs.map((s, i) => ({ label: s, path: segs.slice(0, i + 1).join('/') }))];

  return (
    <div className="space-y-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm pb-1">
        <FolderGit2 size={14} className="text-primary shrink-0" />
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={c.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-600">/</span>}
              {last ? <span aria-current="page" className="text-slate-100">{c.label}</span>
                : <button className="text-primary hover:underline py-1" onClick={() => goDir(c.path)}>{c.label}</button>}
            </span>
          );
        })}
      </nav>
      {cur.view === 'dir' ? <Dir repo={repo} path={cur.path} parent={parent} onOpen={setCur} onUp={() => goDir(parent)} />
        : <FileView repo={repo} path={cur.path} onBack={() => goDir(parent)} />}
    </div>
  );
}

function Dir({ repo, path, parent, onOpen, onUp }: { repo: { id: number }; path: string; parent: string; onOpen: (c: Cur) => void; onUp: () => void }) {
  const q = useQuery({ queryKey: ['dir', repo.id, path], queryFn: () => api<DirData>(`/repositories/${repo.id}/files?path=${encodeURIComponent(path)}`) });
  if (q.isLoading) return <Skeleton />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const entries = q.data!.entries;
  return (
    <div className="rounded-xl border border-white/5 divide-y divide-white/5 overflow-hidden">
      {path && <button onClick={onUp} aria-label={`Up to ${parent || 'root'}`} className="flex w-full items-center gap-3 px-3 min-h-12 text-sm text-slate-400 hover:bg-white/5"><ArrowUp size={16} />..</button>}
      {entries.length === 0 && <Empty>This folder is empty.</Empty>}
      {entries.map((e) => (
        <button key={e.path} disabled={e.type === 'symlink' || e.type === 'submodule'} onClick={() => onOpen({ path: e.path, view: e.type === 'dir' ? 'dir' : 'file' })}
          className="flex w-full items-center gap-3 px-3 min-h-12 text-left text-sm hover:bg-white/5 disabled:opacity-50">
          {e.type === 'dir' ? <Folder size={16} className="text-primary shrink-0" /> : <FileIcon size={16} className="text-slate-400 shrink-0" />}
          <span className="flex-1 truncate">{e.name}</span>
          {e.type === 'file' && e.size !== null && <span className="text-xs text-slate-500">{fmtSize(e.size)}</span>}
          {(e.type === 'symlink' || e.type === 'submodule') && <span className="text-xs text-slate-500">{e.type}</span>}
        </button>
      ))}
      {q.data!.truncated && <p className="p-3 text-xs text-amber-300">GitHub lists at most 1000 entries per folder; some are not shown.</p>}
    </div>
  );
}

function FileView({ repo, path, onBack }: { repo: { id: number }; path: string; onBack: () => void }) {
  const q = useQuery({ queryKey: ['file', repo.id, path], queryFn: () => api<FileData>(`/repositories/${repo.id}/file?path=${encodeURIComponent(path)}`) });
  const f = q.data;
  const why: Record<string, string> = {
    binary: "This is a binary file and can't be previewed.", too_large: 'This file is too large to preview here (limit 512 KB).', unsupported: "This entry (symlink or submodule) can't be previewed.",
  };
  return (
    <div className="space-y-3">
      <button className="btn btn-ghost !py-1.5" onClick={onBack}><ArrowUp size={14} />Back to folder</button>
      {q.isLoading && <Skeleton rows={6} />}
      {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {f && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span className="text-slate-100 break-all">{f.path}</span>
            {f.extension && <span className="rounded bg-white/5 px-1.5 py-0.5">.{f.extension}</span>}
            <span>{fmtSize(f.size)}</span>
            <a href={f.html_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink size={12} />Open on GitHub</a>
          </div>
          {f.kind === 'text' ? (f.content === '' ? <Empty>This file is empty.</Empty> : <CodeViewer code={f.content} name={f.name} extension={f.extension} />)
            : <div role="status" className="rounded-xl bg-sec p-4 text-sm text-slate-300">{why[f.kind]} <a href={f.html_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">View it on GitHub</a>.</div>}
        </>
      )}
    </div>
  );
}
