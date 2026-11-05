import { NavLink, Route, Routes } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, Library, Upload, LogOut, Github, Settings } from 'lucide-react';
import { api } from './api';
import Logo from './Logo';
import Dashboard from './pages/Dashboard';
import Repositories from './pages/Repositories';
import BulkImport from './pages/BulkImport';
import RepoDetail from './pages/RepoDetail';
import AISettings from './pages/AISettings';

interface User { id: number; username: string; avatar_url: string | null }
const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/repositories', label: 'Repositories', icon: Library },
  { to: '/import', label: 'Bulk Import', icon: Upload },
  { to: '/settings/ai', label: 'AI Settings', icon: Settings },
];

const LOGIN_ERRORS: Record<string, string> = {
  state: 'Your login session expired or was invalid. Please try again.',
  denied: 'GitHub login was cancelled.',
  exchange: 'GitHub rejected the login. The OAuth Client ID/Secret or callback URL is probably wrong.',
  profile: 'Could not read your GitHub profile. Please try again.',
  server: 'Server error while signing in. The database may not be set up yet.',
  misconfigured: 'The server is not configured yet.',
};

function Login() {
  const err = new URLSearchParams(window.location.search).get('login_error');
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <div className="card p-8 w-full max-w-sm text-center space-y-5">
        <div className="flex justify-center"><Logo size={56} /></div>
        <div><h1 className="text-2xl font-bold">Drex Analyser</h1><p className="text-slate-400 text-sm mt-1">Understand Every Repository.</p></div>
        {err && <p role="alert" className="rounded-xl bg-red-500/10 text-red-300 text-sm p-3">{LOGIN_ERRORS[err] ?? 'Login failed. Please try again.'} <a href="/api/health" className="underline">Check server status</a></p>}
        <a href="/api/auth/github" className="btn w-full"><Github size={18} /> Continue with GitHub</a>
      </div>
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/auth/me') });
  const logout = useMutation({ mutationFn: () => api('/auth/logout', { method: 'POST' }), onSuccess: () => qc.clear() });
  if (me.isLoading) return <div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>;
  if ((me.error as { code?: string } | null)?.code === 'api_unreachable')
    return <div className="min-h-screen grid place-items-center p-6"><div role="alert" className="card p-6 max-w-md text-sm space-y-2"><h1 className="font-semibold text-base">Cannot reach the API</h1><p className="text-slate-300">{(me.error as Error).message}</p><a href="/api/health" className="underline text-primary">Open /api/health</a></div></div>;
  if (me.isError || !me.data) return <Login />;
  const u = me.data;
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive ? 'bg-primary/15 text-white' : 'text-slate-400 hover:bg-white/5'}`;
  const out = () => logout.mutate(undefined, { onSettled: () => location.assign('/') });

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden md:flex md:w-64 shrink-0 flex-col gap-1 border-r border-white/5 bg-sec p-4 sticky top-0 h-screen">
        <div className="flex items-center gap-3 px-2 py-3 mb-3"><Logo /><span className="font-bold text-lg">Drex</span></div>
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={link}><n.icon size={18} />{n.label}</NavLink>)}
        <div className="mt-auto flex items-center gap-3 px-2 pt-4 border-t border-white/5">
          {u.avatar_url && <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full" />}
          <span className="text-sm truncate flex-1">{u.username}</span>
          <button onClick={out} aria-label="Logout" className="text-slate-400 hover:text-white"><LogOut size={18} /></button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-2 bg-sec/90 backdrop-blur border-b border-white/5 px-4 py-3">
          <Logo size={26} /><span className="font-bold flex-1">Drex Analyser</span>
          <button onClick={out} aria-label="Logout" className="text-slate-400"><LogOut size={20} /></button>
        </header>
        <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-8 pb-24 md:pb-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/repositories" element={<Repositories />} />
            <Route path="/repositories/:id" element={<RepoDetail />} />
            <Route path="/settings/ai" element={<AISettings />} />
            <Route path="/import" element={<BulkImport />} />
            <Route path="*" element={<p className="text-slate-400">Page not found.</p>} />
          </Routes>
        </main>
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 grid grid-cols-4 bg-sec/95 backdrop-blur border-t border-white/5 safe-b">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[11px] ${isActive ? 'text-primary' : 'text-slate-400'}`}>
              <n.icon size={20} />{n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
