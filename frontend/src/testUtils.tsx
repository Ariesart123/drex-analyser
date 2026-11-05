import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

export type Res = { status?: number; body: unknown };
export function mockFetch(h: (url: string) => Res | Promise<Res>) {
  const fn = vi.fn(async (url: string) => {
    const r = await h(url); const status = r.status ?? 200;
    return { ok: status < 400, status, statusText: 'err', json: async () => r.body } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
export const ok = (data: unknown): Res => ({ body: { ok: true, data } });
export const fail = (status: number, error: string, extra: object = {}): Res => ({ status, body: { ok: false, error, ...extra } });
export const renderQ = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
export const urls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => c[0] as string);
