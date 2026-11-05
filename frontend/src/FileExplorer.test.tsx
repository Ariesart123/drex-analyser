// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import FileExplorer from './FileExplorer';
import { fail, mockFetch, ok, renderQ, urls } from './testUtils';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const repo = { id: 1, full_name: 'acme/fastcli' };
const meta = (o: object) => ({ path: 'src/main.py', name: 'main.py', size: 1229, extension: 'py', html_url: 'https://github.com/acme/fastcli/blob/main/src/main.py', ...o });
const root = { path: '', truncated: false, entries: [{ name: 'src', path: 'src', type: 'dir', size: null }, { name: 'README.md', path: 'README.md', type: 'file', size: 1200 }] };
const src = { path: 'src', truncated: false, entries: [{ name: 'main.py', path: 'src/main.py', type: 'file', size: 1229 }, { name: 'logo.png', path: 'src/logo.png', type: 'file', size: 9 }, { name: 'big.txt', path: 'src/big.txt', type: 'file', size: 900000 }] };
const FILES: Record<string, unknown> = {
  'src/main.py': { kind: 'text', content: 'def hi():\n    return "<b>x</b>"\n', ...meta({}) },
  'src/index.html': { kind: 'text', content: '<script>alert(1)</script><p onclick="x()">hi</p>', ...meta({ path: 'src/index.html', name: 'index.html', extension: 'html' }) },
  'src/logo.png': { kind: 'binary', ...meta({ path: 'src/logo.png', name: 'logo.png', extension: 'png', size: 9 }) },
  'src/big.txt': { kind: 'too_large', ...meta({ path: 'src/big.txt', name: 'big.txt', extension: 'txt', size: 900000 }) },
};
const api = (u: string) => {
  if (u === '/api/repositories/1/files?path=') return ok(root);
  if (u === '/api/repositories/1/files?path=src') return ok(src);
  const m = /file\?path=(.+)$/.exec(u); if (m) return ok(FILES[decodeURIComponent(m[1])]);
  return fail(404, 'nf');
};

describe('FileExplorer', () => {
  it('lists the root, navigates into folders and back via breadcrumbs / up', async () => {
    const fn = mockFetch(api); renderQ(<FileExplorer repo={repo} />);
    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(screen.getByText('1.2 KB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^src$/ }));
    expect(await screen.findByText('main.py')).toBeTruthy();
    expect(urls(fn)).toContain('/api/repositories/1/files?path=src');
    const crumbs = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    expect(crumbs.getByText('src').getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: /up to root/i }));
    expect(await screen.findByText('README.md')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^src$/ })); await screen.findByText('main.py');
    fireEvent.click(crumbs.getByRole('button', { name: 'fastcli' }));
    expect(await screen.findByText('README.md')).toBeTruthy();
  });
  it('opens a text file with path, extension, size and syntax highlighting', async () => {
    mockFetch(api); const { container } = renderQ(<FileExplorer repo={repo} />);
    fireEvent.click(await screen.findByRole('button', { name: /^src$/ })); fireEvent.click(await screen.findByRole('button', { name: /main\.py/ }));
    expect(await screen.findByText('src/main.py')).toBeTruthy();
    expect(screen.getByText('.py')).toBeTruthy(); expect(screen.getByText('1.2 KB')).toBeTruthy();
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('def');
    expect(screen.getByRole('link', { name: /open on github/i }).getAttribute('href')).toBe('https://github.com/acme/fastcli/blob/main/src/main.py');
    fireEvent.click(screen.getByRole('button', { name: /back to folder/i }));
    expect(await screen.findByText('logo.png')).toBeTruthy();
  });
  it('shows repository HTML as inert text (never executes or renders it)', async () => {
    mockFetch((u) => (u.includes('files?path=') ? ok({ path: '', truncated: false, entries: [{ name: 'index.html', path: 'src/index.html', type: 'file', size: 50 }] }) : api(u)));
    const { container } = renderQ(<FileExplorer repo={repo} />);
    fireEvent.click(await screen.findByRole('button', { name: /index\.html/ }));
    await screen.findByTestId('code');
    expect(container.querySelector('script')).toBeNull(); expect(container.querySelector('[onclick]')).toBeNull();
    expect(screen.getByTestId('code').textContent).toContain('<script>alert(1)</script>');
  });
  it('binary and too-large files are not previewed and link to GitHub', async () => {
    mockFetch(api); renderQ(<FileExplorer repo={repo} />);
    fireEvent.click(await screen.findByRole('button', { name: /^src$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /logo\.png/ }));
    expect((await screen.findByRole('status')).textContent).toMatch(/binary file/i);
    expect(screen.queryByTestId('code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /back to folder/i }));
    fireEvent.click(await screen.findByRole('button', { name: /big\.txt/ }));
    expect((await screen.findByRole('status')).textContent).toMatch(/too large/i);
    expect(screen.getByRole('link', { name: /view it on github/i })).toBeTruthy();
  });
  it('empty folder, rate limit and not-found states', async () => {
    mockFetch(() => ok({ path: '', truncated: false, entries: [] })); renderQ(<FileExplorer repo={repo} />);
    expect(await screen.findByText(/folder is empty/i)).toBeTruthy(); cleanup();
    mockFetch(() => fail(429, 'GitHub API rate limit reached', { code: 'rate_limited', resetAt: '2030-01-01T00:00:00.000Z' })); renderQ(<FileExplorer repo={repo} />);
    expect((await screen.findByRole('alert')).getAttribute('data-kind')).toBe('rate'); cleanup();
    mockFetch(() => fail(404, 'Not found on GitHub')); renderQ(<FileExplorer repo={repo} />);
    expect((await screen.findByRole('alert')).getAttribute('data-kind')).toBe('notfound');
  });
});
