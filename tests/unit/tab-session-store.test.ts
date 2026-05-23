import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TabSessionStore } from '@electron/services/TabSessionStore';

function useTmpDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const silent = () => ({ warn: vi.fn(), error: vi.fn() });
const makeStore = (sessionPath: string, log = silent()) =>
  new TabSessionStore(sessionPath, setTimeout, clearTimeout, log);

describe('TabSessionStore', () => {
  let tmp: ReturnType<typeof useTmpDir>;
  let sessionPath: string;

  beforeEach(() => {
    tmp = useTmpDir('tab-session-');
    sessionPath = path.join(tmp.dir, 'session.json');
  });

  afterEach(() => tmp.cleanup());

  it('returns [] when the file does not exist (silent, no warn)', () => {
    const log = silent();
    const store = makeStore(sessionPath, log);
    expect(store.load()).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('quarantines a corrupt JSON file and logs an error', () => {
    fs.writeFileSync(sessionPath, '{not json');
    const log = silent();
    expect(makeStore(sessionPath, log).load()).toEqual([]);
    expect(log.error).toHaveBeenCalled();
    // The bad file is moved aside so we don't overwrite recoverable data.
    expect(fs.existsSync(sessionPath)).toBe(false);
    const siblings = fs.readdirSync(tmp.dir).filter((f) => f.startsWith('session.json.corrupt-'));
    expect(siblings.length).toBe(1);
  });

  it('returns [] when the file content is not an array (logged warn)', () => {
    fs.writeFileSync(sessionPath, JSON.stringify({ wat: true }));
    const log = silent();
    expect(makeStore(sessionPath, log).load()).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
  });

  it('round-trips http and horizon://newtab tabs', () => {
    const tabs = [
      { url: 'https://example.com', title: 'Example', isActive: true },
      { url: 'horizon://newtab', isPinned: true },
    ];
    makeStore(sessionPath).save(tabs);
    expect(makeStore(sessionPath).load()).toEqual(tabs);
  });

  it('filters out non-restorable URLs on save', () => {
    makeStore(sessionPath).save([
      { url: 'https://ok.example' },
      { url: 'horizon://error?code=-3' },
      { url: 'about:blank' },
      { url: 'javascript:void(0)' },
    ]);
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([{ url: 'https://ok.example' }]);
  });

  it('filters out non-restorable URLs on load', () => {
    fs.writeFileSync(
      sessionPath,
      JSON.stringify([
        { url: 'https://ok.example' },
        { url: 'horizon://error?code=-3' },
        { url: 'about:blank' },
      ])
    );
    expect(makeStore(sessionPath).load()).toEqual([{ url: 'https://ok.example' }]);
  });

  it('debounces save calls and only writes after the timer fires', () => {
    vi.useFakeTimers();
    const store = makeStore(sessionPath);
    store.scheduleSave([{ url: 'https://a' }]);
    store.scheduleSave([{ url: 'https://b' }]);
    store.scheduleSave([{ url: 'https://c' }]);
    expect(fs.existsSync(sessionPath)).toBe(false);
    vi.advanceTimersByTime(450);
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([{ url: 'https://c' }]);
    vi.useRealTimers();
  });

  it('flush cancels any pending timer and writes synchronously', () => {
    vi.useFakeTimers();
    const store = makeStore(sessionPath);
    store.scheduleSave([{ url: 'https://pending' }]);
    store.flush([{ url: 'https://final' }]);
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([{ url: 'https://final' }]);
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([{ url: 'https://final' }]);
    vi.useRealTimers();
  });

  it('does not wipe an existing session when save([]) is called', () => {
    const store = makeStore(sessionPath);
    store.save([{ url: 'https://a' }]);
    store.save([]);
    // Empty saves are guarded — keeps the previously persisted session intact.
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([{ url: 'https://a' }]);
  });

  it('clear() explicitly wipes the file and cancels pending writes', () => {
    vi.useFakeTimers();
    const store = makeStore(sessionPath);
    store.save([{ url: 'https://a' }]);
    store.scheduleSave([{ url: 'https://b' }]);
    store.clear();
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([]);
    vi.advanceTimersByTime(1000);
    // Pending debounce was cancelled — file stays empty.
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([]);
    vi.useRealTimers();
  });

  it('save() does not throw when the write fails (logged instead)', () => {
    const log = silent();
    const store = new TabSessionStore('/no-such-dir/abc/session.json', setTimeout, clearTimeout, log);
    expect(() => store.save([{ url: 'https://a' }])).not.toThrow();
    expect(log.error).toHaveBeenCalled();
  });
});
