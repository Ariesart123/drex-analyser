export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-2 animate-pulse" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="h-10 rounded-xl bg-sec" />)}</div>;
}
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-slate-400 py-8 text-center">{children}</p>;
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as { status?: number; code?: string; resetAt?: string | null; message?: string };
  if (e.status === 429 || e.code === 'rate_limited')
    return <div role="alert" data-kind="rate" className="rounded-xl bg-amber-500/10 text-amber-300 text-sm p-3">GitHub API rate limit reached.{e.resetAt ? ` Try again after ${new Date(e.resetAt).toLocaleTimeString()}.` : ' Please try again later.'}</div>;
  if (e.status === 404)
    return <div role="alert" data-kind="notfound" className="rounded-xl bg-sec text-slate-300 text-sm p-3">Not found on GitHub. It may have been deleted, renamed or made private.</div>;
  return (
    <div role="alert" data-kind="error" className="rounded-xl bg-red-500/10 text-red-300 text-sm p-3 flex flex-wrap items-center gap-3">
      <span className="flex-1">{e.message || 'Something went wrong.'}</span>{onRetry && <button className="btn btn-ghost !py-1.5" onClick={onRetry}>Retry</button>}
    </div>
  );
}
