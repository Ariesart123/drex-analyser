// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import Markdown from './Markdown';

afterEach(cleanup);
const base = { fullName: 'acme/fastcli', branch: 'main' };

describe('README sanitization', () => {
  it('drops scripts, inline handlers and raw HTML', () => {
    const { container } = render(<Markdown>{'# Hi\n<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n<iframe src="https://evil"></iframe>'}</Markdown>);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror=/i);
  });
  it('neutralizes javascript:, data: and vbscript: URLs in links and images', () => {
    const md = '[a](javascript:alert(1)) [b](data:text/html;base64,AAA) [c](vbscript:x) ![d](javascript:alert(1))';
    const { container } = render(<Markdown>{md}</Markdown>);
    for (const a of container.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/^(javascript|data|vbscript):/i);
    expect(container.querySelector('img')).toBeNull();
  });
  it('keeps safe content and hardens links', () => {
    const { container } = render(<Markdown>{'[ok](https://example.com)\n\n```sh\nnpm i\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![logo](https://example.com/l.png)'}</Markdown>);
    const a = container.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(container.querySelector('pre code')?.textContent).toContain('npm i');
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/l.png');
  });
  it('resolves relative README links/images to the repository on GitHub', () => {
    const { container } = render(<Markdown base={base}>{'[doc](docs/a.md) ![s](./img/s.png)'}</Markdown>);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://github.com/acme/fastcli/blob/main/docs/a.md');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://raw.githubusercontent.com/acme/fastcli/main/img/s.png');
  });
});
