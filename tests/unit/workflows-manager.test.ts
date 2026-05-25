// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowsManager } from '@electron/services/WorkflowsManager';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let dir: string;
let file: string;
let mgr: WorkflowsManager;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'wf-'));
  file = path.join(dir, 'workflows.json');
  mgr = new WorkflowsManager(file);
});

describe('WorkflowsManager', () => {
  it('list() returns [] when the file does not exist', () => {
    expect(mgr.list()).toEqual([]);
  });

  it('create() writes a new workflow with an id + createdAt', async () => {
    const w = await mgr.create({ name: 'Daily summary', prompt: 'Summarize.', attach: 'activeTab' });
    expect(w.id).toBeTruthy();
    expect(w.createdAt).toBeGreaterThan(0);
    expect(mgr.list()).toHaveLength(1);
    expect(mgr.list()[0].name).toBe('Daily summary');
    rmSync(dir, { recursive: true, force: true });
  });

  it('delete() removes the matching id', async () => {
    const w1 = await mgr.create({ name: 'a', prompt: 'x', attach: 'none' });
    await mgr.create({ name: 'b', prompt: 'y', attach: 'none' });
    await mgr.delete(w1.id);
    expect(mgr.list().map((w) => w.name)).toEqual(['b']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('get(id) returns the matching workflow or undefined', async () => {
    const w = await mgr.create({ name: 'a', prompt: 'x', attach: 'none' });
    expect(mgr.get(w.id)?.name).toBe('a');
    expect(mgr.get('nonexistent')).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});
