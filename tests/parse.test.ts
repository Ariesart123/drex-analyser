import { describe, it, expect } from 'vitest';
import { parseRepoUrls } from '../worker/src/lib/parse';

describe('parseRepoUrls', () => {
  it('splits newline and comma separated links', () => {
    const r = parseRepoUrls('https://github.com/a/one\nhttps://github.com/b/two, https://github.com/c/three');
    expect(r.valid.map((v) => v.fullName)).toEqual(['a/one', 'b/two', 'c/three']);
  });
  it('flags invalid URLs, never discarding them', () => {
    const r = parseRepoUrls('https://gitlab.com/a/b\nnot-a-url\nhttps://github.com/onlyowner');
    expect(r.valid).toHaveLength(0);
    expect(r.invalid).toHaveLength(3);
  });
  it('detects case-insensitive duplicates and strips .git / paths', () => {
    const r = parseRepoUrls('https://github.com/A/Repo.git https://github.com/a/repo/tree/main');
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].url).toBe('https://github.com/A/Repo');
    expect(r.duplicates).toHaveLength(1);
  });
});
