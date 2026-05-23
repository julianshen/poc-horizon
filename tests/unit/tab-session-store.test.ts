import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TabSessionStore } from '@electron/services/TabSessionStore';

function useTmpDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('TabSessionStore', () => {
  let tmp: ReturnType<typeof useTmpDir>;
  let sessionPath: string;

  beforeEach(() => {
    tmp = useTmpDir('tab-session-');
    sessionPath = path.join(tmp.dir, 'session.json');
  });

  afterEach(() => tmp.cleanup());

  it('returns [] when the file does not exist', () => {
    const store = new TabSessionStore(sessionPath);
    expect(store.load()).toEqual([]);
  });

  it('returns [] when the file contains invalid JSON', () => {
    fs.writeFileSync(sessionPath, '{not json');
    expect(new TabSessionStore(sessionPath).load()).toEqual([]);
  });

  it('returns [] when the file content is not an array', () => {
    fs.writeFileSync(sessionPath, JSON.stringify({ wat: true }));
    expect(new TabSessionStore(sessionPath).load()).toEqual([]);
  });

  it('round-trips http and horizon://newtab tabs', () => {
    const store = new TabSessionStore(sessionPath);
    const tabs = [
      { url: 'https://example.com', title: 'Example', isActive: true },
      { url: 'horizon://newtab', isPinned: true },
    ];
    store.save(tabs);
    expect(new TabSessionStore(sessionPath).load()).toEqual(tabs);
  });

  it('filters out non-restorable URLs on save', () => {
    const store = new TabSessionStore(sessionPath);
    store.save([
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
    expect(new TabSessionStore(sessionPath).load()).toEqual([{ url: 'https://ok.example' }]);
  });

  it('debounces save calls and only writes after the timer fires', () => {
    vi.useFakeTimers();
    const store = new TabSessionStore(sessionPath);
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
    const store = new TabSessionStore(sessionPath);
    store.scheduleSave([{ url: 'https://pending' }]);
    store.flush([{ url: 'https://final' }]);
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([{ url: 'https://final' }]);
    // The pending timer must have been cleared — advancing time should not
    // overwrite our flush.
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual([{ url: 'https://final' }]);
    vi.useRealTimers();
  });
});
