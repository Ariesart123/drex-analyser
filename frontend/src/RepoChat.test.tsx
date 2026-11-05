// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RepoChat from './RepoChat';
import { REFUSAL } from './api';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
type Res = { status?: number; body: unknown };
function mockFetch(h: (url: string, init?: RequestInit) => Res | Promise<Res>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = await h(url, init); const status = r.status ?? 200;
    return { ok: status < 400, status, statusText: 'err', json: async () => r.body } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const ok = (data: unknown): Res => ({ body: { ok: true, data } });
const R1 = { id: 1, full_name: 'acme/fastcli', default_branch: 'main' };
const R2 = { id: 2, full_name: 'acme/otherapp', default_branch: 'dev' };
const ask = (text: string) => {
  fireEvent.change(screen.getByLabelText(/ask a question/i), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
};
const chatBody = (fn: ReturnType<typeof vi.fn>) => JSON.parse((fn.mock.calls.find((c) => c[0] === '/api/ai/chat')![1] as RequestInit).body as string);

describe('RepoChat', () => {
  it('uses the open repository id, shows answer and only backend-returned source citations', async () => {
    const fn = mockFetch((u) => u === '/api/ai/status' ? ok({ available: true }) : u.startsWith('/api/ai/conversations') ? ok([])
      : ok({ conversationId: 5, answer: 'Run it as in the README.', refused: false, sources: ['README.md'] }));
    render(<RepoChat repo={R1} />);
    expect(await screen.findByText(/ask anything about/i)).toBeTruthy();
    expect(screen.getByTestId('chat-context').textContent).toContain('acme/fastcli');
    ask('How do I install this project?');
    expect(await screen.findByText('Run it as in the README.')).toBeTruthy();
    expect(chatBody(fn)).toMatchObject({ repositoryId: 1, conversationId: null });
    const link = screen.getByRole('link', { name: 'README.md' });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/fastcli/blob/main/README.md');
    expect(screen.queryByRole('link', { name: /fake/i })).toBeNull();
  });

  it('switching repositories resets context and conversation; late replies from the old repo never appear', async () => {
    let release!: (r: Res) => void;
    const fn = mockFetch((u, init) => {
      if (u === '/api/ai/status') return ok({ available: true });
      if (u === '/api/ai/conversations?repositoryId=1') return ok([{ id: 9 }]);
      if (u === '/api/ai/conversations/9') return ok({ id: 9, messages: [{ role: 'user', content: 'old q1' }, { role: 'assistant', content: 'old a1' }] });
      if (u === '/api/ai/conversations?repositoryId=2') return ok([]);
      if (u === '/api/ai/chat' && JSON.parse(String(init!.body)).repositoryId === 1) return new Promise<Res>((r) => { release = r; });
      return ok({ conversationId: 77, answer: 'answer for repo 2', refused: false, sources: [] });
    });
    const { rerender } = render(<RepoChat repo={R1} />);
    expect(await screen.findByText('old a1')).toBeTruthy();       // repo 1 history restored
    ask('Pending question for repo 1');
    await screen.findByText('Pending question for repo 1');

    rerender(<RepoChat repo={R2} />);                             // switch repository
    expect(await screen.findByText(/ask anything about/i)).toBeTruthy();
    expect(screen.getByTestId('chat-context').textContent).toContain('acme/otherapp');
    expect(screen.queryByText('old a1')).toBeNull();
    expect(screen.queryByText('Pending question for repo 1')).toBeNull();
    expect(fn).toHaveBeenCalledWith('/api/ai/conversations?repositoryId=2', expect.anything());

    release(ok({ conversationId: 9, answer: 'LATE answer from repo 1', refused: false, sources: [] }));
    await Promise.resolve();
    expect(screen.queryByText('LATE answer from repo 1')).toBeNull();

    ask('How do I run this?');
    await screen.findByText('answer for repo 2');
    const last = fn.mock.calls.filter((c) => c[0] === '/api/ai/chat').pop()!;
    expect(JSON.parse((last[1] as RequestInit).body as string)).toMatchObject({ repositoryId: 2, conversationId: null }); // no repo-1 conversation reused
  });

  it('renders backend refusals for irrelevant questions distinctly', async () => {
    mockFetch((u) => u === '/api/ai/status' ? ok({ available: true }) : u.startsWith('/api/ai/conversations') ? ok([]) : ok({ conversationId: 1, answer: REFUSAL, refused: true, sources: [] }));
    const { container } = render(<RepoChat repo={R1} />);
    await screen.findByText(/ask anything about/i);
    ask('How do I install Python?');
    expect(await screen.findByText(REFUSAL)).toBeTruthy();
    expect(container.querySelector('[data-refused="true"]')).not.toBeNull();
  });

  it('shows rate-limit and error states and keeps the question for retry', async () => {
    mockFetch((u) => u === '/api/ai/status' ? ok({ available: true }) : u.startsWith('/api/ai/conversations') ? ok([]) : { status: 429, body: { ok: false, error: 'AI rate limit reached. Please try again later.' } });
    render(<RepoChat repo={R1} />);
    await screen.findByText(/ask anything about/i);
    ask('What does it do?');
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-kind')).toBe('rate');
    expect((screen.getByLabelText(/ask a question/i) as HTMLTextAreaElement).value).toBe('What does it do?');
  });

  it('shows an unavailable state with no input when AI is not enabled', async () => {
    mockFetch((u) => u === '/api/ai/status' ? ok({ available: false }) : ok([]));
    render(<RepoChat repo={R1} />);
    expect(await screen.findByText(/AI is not enabled on this deployment/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText(/ask a question/i)).toBeNull());
  });
});
