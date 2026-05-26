// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DomainSkills } from '@electron/services/DomainSkills';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'domskills-'));
}

describe('DomainSkills', () => {
  let root: string;
  let ds: DomainSkills;

  beforeEach(async () => {
    root = await tmp();
    ds = new DomainSkills(root);
  });

  it('list() returns [] when host has no notes', async () => {
    expect(await ds.list('example.com')).toEqual([]);
  });

  it('save + list + read round-trips a markdown note', async () => {
    await ds.save('amazon.com', 'captcha-trigger.md', '# When captcha shows up\n\nAfter 3 searches.');
    expect(await ds.list('amazon.com')).toEqual(['captcha-trigger.md']);
    const skill = await ds.read('amazon.com', 'captcha-trigger.md');
    expect(skill?.body).toContain('After 3 searches');
    expect(skill?.host).toBe('amazon.com');
    expect(skill?.bytes).toBeGreaterThan(0);
  });

  it('treats www.X and X as the same host', async () => {
    await ds.save('www.github.com', 'pr-merge.md', 'click via shortcut M');
    expect(await ds.list('github.com')).toEqual(['pr-merge.md']);
  });

  it('overwrites by name on save', async () => {
    await ds.save('site.com', 'a.md', 'v1');
    await ds.save('site.com', 'a.md', 'v2');
    const s = await ds.read('site.com', 'a.md');
    expect(s?.body).toBe('v2');
  });

  it('remove() deletes the file', async () => {
    await ds.save('site.com', 'a.md', 'x');
    expect(await ds.remove('site.com', 'a.md')).toBe(true);
    expect(await ds.list('site.com')).toEqual([]);
    // Removing again is a no-op (returns false, doesn't throw).
    expect(await ds.remove('site.com', 'a.md')).toBe(false);
  });

  it('rejects file names without .md extension', async () => {
    await expect(ds.save('s.com', 'no-ext', 'x')).rejects.toThrow(/\.md/);
  });

  it('rejects file names with path separators', async () => {
    await expect(ds.save('s.com', '../escape.md', 'x')).rejects.toThrow(/invalid skill name/);
    await expect(ds.read('s.com', 'foo/bar.md')).rejects.toThrow(/invalid skill name/);
  });

  it('rejects hosts with path separators', async () => {
    expect(() => DomainSkills.normalizeHost('bad/host')).toThrow(/invalid host/);
  });

  it('search() finds matches across all hosts, ranked by line count', async () => {
    await ds.save('a.com', 'login.md', '# Login wall\nUse SSO button at top right.');
    await ds.save('b.com', 'captcha.md', '# Captcha trap\nTrigger: 3 searches.\nFix: slow down past captcha checks.\ncaptcha widget id is #cap.');
    await ds.save('c.com', 'misc.md', '# Misc\nNothing about captchas here.');
    const hits = await ds.search('captcha');
    // b.com matches 3 times, c.com once.
    expect(hits[0].host).toBe('b.com');
    expect(hits[0].score).toBe(3);
    expect(hits.map((h) => h.host)).toEqual(['b.com', 'c.com']);
  });

  it('search() returns [] for empty query', async () => {
    await ds.save('a.com', 'x.md', 'foo');
    expect(await ds.search('')).toEqual([]);
    expect(await ds.search('  ')).toEqual([]);
  });

  it('search() limits each file to 5 matching lines', async () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i} captcha here`).join('\n');
    await ds.save('a.com', 'big.md', body);
    const hits = await ds.search('captcha');
    expect(hits[0].lines).toHaveLength(5);
    expect(hits[0].score).toBe(20);
  });

  it('listHosts returns directories with at least one note', async () => {
    await ds.save('a.com', 'x.md', '1');
    await ds.save('b.com', 'y.md', '2');
    const hosts = await ds.listHosts();
    expect(hosts).toEqual(['a.com', 'b.com']);
  });
});
