// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
const mount = () => render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider></MemoryRouter>);

describe('App auth / deployment states', () => {
  it('shows a clear setup error when /api returns HTML (broken Vercel rewrite)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new Error('not json'); } })));
    mount();
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot reach the api/i);
    expect(screen.getByRole('link', { name: /api\/health/ }).getAttribute('href')).toBe('/api/health');
  });
  it('unauthenticated: login page goes through /api/auth/github and explains login_error', async () => {
    window.history.replaceState({}, '', '/?login_error=exchange');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, headers: { get: () => 'application/json' }, json: async () => ({ ok: false, error: 'Unauthorized' }) })));
    mount();
    expect((await screen.findByRole('alert')).textContent).toMatch(/OAuth Client ID/);
    expect(screen.getByRole('link', { name: /continue with github/i }).getAttribute('href')).toBe('/api/auth/github');
  });
});
