// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AISettings from './AISettings';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });
const SECRET = 'SUPER-SECRET-KEY-1234';
function setupApi(opts: { badKey?: boolean } = {}) {
  const state: any = { active: 'default', byokEnabled: true, default: { available: true, label: 'Cloudflare Workers AI', model: '@cf/x', limits: 'No key needed. Shared free allocation.' }, providers: [] };
  const calls: { url: string; method: string; body?: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const res = (status: number, b: unknown) => ({ ok: status < 400, status, statusText: 'x', json: async () => b }) as Response;
    if (url === '/api/ai/providers' && method === 'GET') return res(200, { ok: true, data: JSON.parse(JSON.stringify(state)) });
    if (url === '/api/ai/providers/test') return opts.badKey ? res(422, { ok: false, error: 'The provider rejected this API key.', code: 'invalid_key' }) : res(200, { ok: true, data: { models: ['gemini-a', 'gemini-b'], modelOk: true } });
    if (url === '/api/ai/providers/gemini' && method === 'PUT') { state.providers = [{ provider: 'gemini', label: 'Google Gemini', model: body.model, base_url: null, enabled: true, status: 'ok', key_hint: '••••1234', last_tested_at: 'now' }]; return res(200, { ok: true, data: state.providers[0] }); }
    if (url === '/api/ai/providers/gemini' && method === 'DELETE') { state.providers = []; state.active = 'default'; return res(200, { ok: true }); }
    if (url === '/api/ai/active') { state.active = body.provider; return res(200, { ok: true, data: { active: body.provider } }); }
    return res(404, { ok: false, error: 'nf' });
  }));
  return { state, calls };
}
const card = (name: string) => within(screen.getByRole('region', { name }));

describe('AISettings', () => {
  it('shows Default AI as active with availability and limits, and needs no key', async () => {
    setupApi(); render(<AISettings />);
    expect((await screen.findByTestId('active-provider')).textContent).toBe('Cloudflare Workers AI');
    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByText(/No key needed/)).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
  });
  it('configure Gemini: test lists live models, save sends the key once, masks it, clears input, stores nothing in the browser', async () => {
    const { calls } = setupApi(); render(<AISettings />);
    await screen.findByTestId('active-provider');
    fireEvent.click(card('Google Gemini').getByRole('button', { name: 'Configure' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    expect((await screen.findByRole('status')).textContent).toContain('2 models available');
    expect(document.querySelectorAll('datalist option')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gemini-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await card('Google Gemini').findByText(/••••1234/)).toBeTruthy();
    expect(calls.filter((c) => c.url === '/api/ai/providers/gemini' && c.method === 'PUT')).toHaveLength(1);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(JSON.stringify({ ...localStorage })).not.toContain(SECRET); expect(JSON.stringify({ ...sessionStorage })).not.toContain(SECRET);
  });
  it('invalid key shows an error and does not save', async () => {
    const { calls } = setupApi({ badKey: true }); render(<AISettings />);
    await screen.findByTestId('active-provider');
    fireEvent.click(card('Groq').getByRole('button', { name: 'Configure' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'bad-key-00000' } });
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));
    expect((await screen.findByRole('status')).textContent).toContain('rejected');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
  it('select provider, then switch back to Default AI', async () => {
    const { calls } = setupApi(); render(<AISettings />);
    await screen.findByTestId('active-provider');
    fireEvent.click(card('Google Gemini').getByRole('button', { name: 'Configure' }));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: SECRET } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gemini-a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await card('Google Gemini').findByRole('button', { name: 'Use this provider' }));
    await waitFor(() => expect(screen.getByTestId('active-provider').textContent).toBe('Google Gemini'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Switch back to Default AI' })[0]);
    await waitFor(() => expect(screen.getByTestId('active-provider').textContent).toBe('Cloudflare Workers AI'));
    expect(calls.filter((c) => c.url === '/api/ai/active').map((c) => c.body.provider)).toEqual(['gemini', 'default']);
  });
});
