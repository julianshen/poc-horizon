import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'fs';
import { DownloadStore } from '@electron/services/DownloadStore';
import type { DownloadItem } from '../../src/types/browser';
import { useTmpDir } from '../helpers/tmpdir';

const tmp = useTmpDir('horizon-downloads');
const downloadsPath = () => tmp.path('downloads.json');

const sample = (id: string, state: DownloadItem['state'] = 'progressing'): DownloadItem => ({
  id,
  filename: `${id}.bin`,
  url: `https://example.com/${id}`,
  totalBytes: 1000,
  receivedBytes: 500,
  state,
  startTime: 1,
  savePath: `/tmp/${id}.bin`,
});

describe('DownloadStore', () => {
  it('starts empty when no file exists', () => {
    const ds = new DownloadStore(downloadsPath());
    expect(ds.getAll()).toEqual([]);
  });

  it('loads an existing downloads file', () => {
    writeFileSync(downloadsPath(), JSON.stringify([sample('a', 'completed')]));
    const ds = new DownloadStore(downloadsPath());
    expect(ds.getAll()).toHaveLength(1);
    expect(ds.getAll()[0].id).toBe('a');
  });

  it('get(id) returns the record or undefined', () => {
    const ds = new DownloadStore(downloadsPath());
    ds.upsert(sample('a'));
    expect(ds.get('a')?.id).toBe('a');
    expect(ds.get('missing')).toBeUndefined();
  });

  it('upsert() adds a new item and notifies listeners', () => {
    const ds = new DownloadStore(downloadsPath());
    const listener = vi.fn();
    ds.onUpdate(listener);
    ds.upsert(sample('a'));
    expect(ds.getAll()).toHaveLength(1);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0][0].id).toBe('a');
  });

  it('upsert() replaces an existing item by id', () => {
    const ds = new DownloadStore(downloadsPath());
    ds.upsert(sample('a'));
    ds.upsert({ ...sample('a'), receivedBytes: 900 });
    expect(ds.getAll()).toHaveLength(1);
    expect(ds.getAll()[0].receivedBytes).toBe(900);
  });

  it('finalize() persists the item to disk and notifies', () => {
    const ds = new DownloadStore(downloadsPath());
    ds.upsert(sample('a'));
    const listener = vi.fn();
    ds.onUpdate(listener);
    ds.finalize('a', 'completed', 999);
    const updated = ds.getAll()[0];
    expect(updated.state).toBe('completed');
    expect(updated.endTime).toBe(999);
    // finalize writes to disk; verified by loading fresh instance
    const ds2 = new DownloadStore(downloadsPath());
    expect(ds2.getAll()[0].state).toBe('completed');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('finalize() is a no-op for unknown ids', () => {
    const ds = new DownloadStore(downloadsPath());
    ds.upsert(sample('a'));
    ds.finalize('missing', 'completed', 1);
    expect(ds.getAll()).toHaveLength(1);
    expect(ds.getAll()[0].state).toBe('progressing');
  });

  it('setState() updates state without persisting', () => {
    const ds = new DownloadStore(downloadsPath());
    ds.upsert(sample('a'));
    ds.setState('a', 'interrupted');
    expect(ds.getAll()[0].state).toBe('interrupted');
    // setState does NOT write to disk — a new instance reads the
    // pre-setState state from the file (or empty if no finalize)
    const ds2 = new DownloadStore(downloadsPath());
    expect(ds2.getAll()).toEqual([]);
  });

  it('setState() is a no-op for unknown ids', () => {
    const ds = new DownloadStore(downloadsPath());
    ds.setState('missing', 'completed');
    expect(ds.getAll()).toEqual([]);
  });

  it('clearCompleted() drops completed and cancelled, keeps active', () => {
    const ds = new DownloadStore(downloadsPath());
    ds.upsert(sample('a', 'completed'));
    ds.upsert(sample('b', 'progressing'));
    ds.upsert(sample('c', 'cancelled'));
    ds.upsert(sample('d', 'interrupted'));
    ds.clearCompleted();
    const ids = ds.getAll().map((x) => x.id);
    expect(ids.sort()).toEqual(['b', 'd']);
    // Persisted
    const ds2 = new DownloadStore(downloadsPath());
    expect(ds2.getAll().map((x) => x.id).sort()).toEqual(['b', 'd']);
  });

  it('onUpdate() returns an unsubscribe function', () => {
    const ds = new DownloadStore(downloadsPath());
    const listener = vi.fn();
    const off = ds.onUpdate(listener);
    ds.upsert(sample('a'));
    off();
    ds.upsert(sample('b'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('falls back to empty list on corrupted JSON', () => {
    writeFileSync(downloadsPath(), '{not json');
    const ds = new DownloadStore(downloadsPath());
    expect(ds.getAll()).toEqual([]);
  });
});
