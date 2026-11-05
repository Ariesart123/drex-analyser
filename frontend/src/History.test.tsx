// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import CommitList from './CommitList';
import Releases from './Releases';
import { fail, mockFetch, ok, renderQ, urls } from './testUtils';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const repo = { id: 1 };
const c = (n: number) => ({ sha: `abc${n}`.padEnd(40, '0'), short: `abc${n}000`.slice(0, 7), message: `Commit ${n}`, body: '', author_name: 'Ada', author_login: 'ada', avatar_url: null, date: '2026-01-01T00:00:00Z', html_url: 'x' });

describe('CommitList', () => {
  it('shows commits, paginates and opens details with changed files and GitHub link', async () => {
    const fn = mockFetch((u) => {
      if (u === '/api/repositories/1/commits?page=1') return ok({ items: [c(1), c(2)], page: 1, hasNext: true });
      if (u === '/api/repositories/1/commits?page=2') return ok({ items: [c(3)], page: 2, hasNext: false });
      if (u.includes('/commits/abc1')) return ok({ ...c(1), message: 'Commit 1\n\nbody text', stats: { additions: 5, deletions: 1, total: 6 }, parents: ['deadbee'], files_total: 2, files_truncated: false,
        files: [{ filename: 'a.ts', status: 'added', additions: 5, deletions: 0, previous_filename: null }, { filename: 'b.ts', status: 'modified', additions: 0, deletions: 1, previous_filename: null }], html_url: 'https://github.com/acme/fastcli/commit/abc1' });
      return fail(404, 'nf');
    });
    renderQ(<CommitList repo={repo} />);
    expect(await screen.findByText('Commit 1')).toBeTruthy(); expect(screen.getByText('abc1000')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Newer' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByText('Commit 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Older' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
    fireEvent.click(await screen.findByText('Commit 1'));
    expect(await screen.findByText('a.ts')).toBeTruthy(); expect(screen.getByText('added')).toBeTruthy(); expect(screen.getByText(/in 2 files/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /view commit on github/i }).getAttribute('href')).toBe('https://github.com/acme/fastcli/commit/abc1');
    expect(urls(fn)).toContain('/api/repositories/1/commits/' + c(1).sha);
    fireEvent.click(screen.getByRole('button', { name: /all commits/i }));
    expect(await screen.findByText('Commit 2')).toBeTruthy();
  });
  it('empty, rate-limit and error states', async () => {
    mockFetch(() => ok({ items: [], page: 1, hasNext: false })); renderQ(<CommitList repo={repo} />);
    expect(await screen.findByText(/no commits/i)).toBeTruthy(); cleanup();
    mockFetch(() => fail(429, 'x', { code: 'rate_limited' })); renderQ(<CommitList repo={repo} />);
    expect((await screen.findByRole('alert')).getAttribute('data-kind')).toBe('rate'); cleanup();
    mockFetch(() => fail(502, 'GitHub request failed')); renderQ(<CommitList repo={repo} />);
    expect((await screen.findByRole('alert')).textContent).toContain('GitHub request failed');
  });
});

describe('Releases', () => {
  const rel = (id: number, o: object = {}) => ({ id, name: `Release ${id}`, tag: `v${id}.0.0`, prerelease: false, is_latest: false, published_at: '2026-01-01T00:00:00Z', author_login: 'ada', body: '', html_url: `https://github.com/acme/fastcli/releases/tag/v${id}.0.0`, assets: [], ...o });
  it('marks latest and pre-releases, lists assets with download links, paginates', async () => {
    const fn = mockFetch((u) => u.endsWith('page=2') ? ok({ items: [rel(9)], page: 2, hasNext: false, latestId: null })
      : ok({ items: [rel(2, { prerelease: true }), rel(1, { is_latest: true, body: '# Notes', assets: [{ name: 'app.zip', size: 2048, download_count: 7, content_type: 'application/zip', url: 'https://github.com/acme/fastcli/releases/download/v1.0.0/app.zip' }] })], page: 1, hasNext: true, latestId: 1 }));
    renderQ(<Releases repo={repo} />);
    expect(await screen.findByText('Release 1')).toBeTruthy();
    expect(screen.getByText('Latest')).toBeTruthy(); expect(screen.getByText('Pre-release')).toBeTruthy();
    expect(screen.getByRole('link', { name: /app\.zip/ }).getAttribute('href')).toBe('https://github.com/acme/fastcli/releases/download/v1.0.0/app.zip');
    expect(screen.getByText(/2\.0 KB · 7↓/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByText('Release 9')).toBeTruthy(); expect(urls(fn)).toContain('/api/repositories/1/releases?page=2');
  });
  it('handles repositories without releases, rate limit and errors', async () => {
    mockFetch(() => ok({ items: [], page: 1, hasNext: false, latestId: null })); renderQ(<Releases repo={repo} />);
    expect(await screen.findByText(/no published releases/i)).toBeTruthy(); cleanup();
    mockFetch(() => fail(429, 'x', { code: 'rate_limited', resetAt: null })); renderQ(<Releases repo={repo} />);
    expect((await screen.findByRole('alert')).getAttribute('data-kind')).toBe('rate'); cleanup();
    mockFetch(() => fail(404, 'nf')); renderQ(<Releases repo={repo} />);
    expect((await screen.findByRole('alert')).getAttribute('data-kind')).toBe('notfound');
  });
});
