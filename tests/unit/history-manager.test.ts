import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HistoryManager } from '../../.electron/services/HistoryManager';

let dir: string;
let historyPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'horizon-history-'));
  historyPath = join(dir, 'history.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('HistoryManager', () => {
  it('returns an empty list when no file exists', () => {
    const hm = new HistoryManager(historyPath);
    expect(hm.getRecent()).toEqual([]);
  });

  it('loads an existing history file', () => {
    const seed = [
      { id: 'a', url: 'https://a.example', title: 'A', visitTime: 100, visitCount: 1, typedCount: 0 },
    ];
    writeFileSync(historyPath, JSON.stringify(seed));
    const hm = new HistoryManager(historyPath);
    expect(hm.getRecent()).toEqual(seed);
  });

  it('addEntry() creates a new entry on first visit', () => {
    const hm = new HistoryManager(historyPath);
    hm.addEntry('https://example.com', 'Example');
    const recent = hm.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].url).toBe('https://example.com');
    expect(recent[0].visitCount).toBe(1);
  });

  it('addEntry() increments visitCount and updates title on repeat visits', () => {
    const hm = new HistoryManager(historyPath);
    hm.addEntry('https://example.com', 'Old Title');
    hm.addEntry('https://example.com', 'New Title');
    const recent = hm.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].visitCount).toBe(2);
    expect(recent[0].title).toBe('New Title');
  });

  it('caps history at 5000 entries (FIFO eviction of oldest)', () => {
    const seed = Array.from({ length: 5000 }, (_, i) => ({
      id: `seed-${i}`,
      url: `https://seed-${i}.example`,
      title: `Seed ${i}`,
      visitTime: i,
      visitCount: 1,
      typedCount: 0,
    }));
    writeFileSync(historyPath, JSON.stringify(seed));
    const hm = new HistoryManager(historyPath);
    hm.addEntry('https://new.example', 'New');
    const recent = hm.getRecent(10000);
    expect(recent).toHaveLength(5000);
    expect(recent.some((e) => e.id === 'seed-0')).toBe(false);
    expect(recent.some((e) => e.url === 'https://new.example')).toBe(true);
  });

  it('search() matches against url and title, case-insensitive, newest first', () => {
    const hm = new HistoryManager(historyPath);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1000));
    hm.addEntry('https://nodejs.org', 'Node.js Docs');
    vi.setSystemTime(new Date(2000));
    hm.addEntry('https://python.org', 'Python Site');
    vi.setSystemTime(new Date(3000));
    hm.addEntry('https://other.example', 'PYTHON guide');

    const results = hm.search('python');
    expect(results.map((r) => r.url)).toEqual([
      'https://other.example',
      'https://python.org',
    ]);
  });

  it('search() respects the limit', () => {
    const hm = new HistoryManager(historyPath);
    hm.addEntry('https://a.example', 'A');
    hm.addEntry('https://b.example', 'B');
    hm.addEntry('https://c.example', 'C');
    expect(hm.search('example', 2)).toHaveLength(2);
  });

  it('getRecent() respects the limit', () => {
    const hm = new HistoryManager(historyPath);
    hm.addEntry('https://a.example', 'A');
    hm.addEntry('https://b.example', 'B');
    expect(hm.getRecent(1)).toHaveLength(1);
  });

  it('clear() with no range wipes everything and returns count removed', () => {
    const hm = new HistoryManager(historyPath);
    hm.addEntry('https://a.example', 'A');
    hm.addEntry('https://b.example', 'B');
    expect(hm.clear()).toBe(2);
    expect(hm.getRecent()).toEqual([]);
  });

  it('clear("hour") only removes entries newer than one hour ago', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(new Date(now));
    const hm = new HistoryManager(historyPath);
    // old entry, 2 hours ago
    vi.setSystemTime(new Date(now - 2 * 3600_000));
    hm.addEntry('https://old.example', 'Old');
    // fresh entry, "now"
    vi.setSystemTime(new Date(now));
    hm.addEntry('https://new.example', 'New');

    expect(hm.clear('hour')).toBe(1);
    const remaining = hm.getRecent();
    expect(remaining.map((e) => e.url)).toEqual(['https://old.example']);
  });

  it.each(['day', 'week', 'month'] as const)(
    'clear("%s") computes the correct cutoff',
    (range) => {
      const offsets: Record<typeof range, number> = {
        day: 86400_000,
        week: 604800_000,
        month: 2592000_000,
      };
      vi.useFakeTimers();
      const now = 10_000_000_000_000;
      vi.setSystemTime(new Date(now));
      const hm = new HistoryManager(historyPath);
      vi.setSystemTime(new Date(now - offsets[range] - 1));
      hm.addEntry('https://old.example', 'Old');
      vi.setSystemTime(new Date(now));
      hm.addEntry('https://new.example', 'New');
      expect(hm.clear(range)).toBe(1);
      expect(hm.getRecent()[0].url).toBe('https://old.example');
    }
  );
});
