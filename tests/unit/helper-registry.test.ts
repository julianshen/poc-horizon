// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { HelperRegistry } from '@electron/services/HelperRegistry';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let dir: string;
let file: string;
let reg: HelperRegistry;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'hr-'));
  file = path.join(dir, 'helpers.json');
  reg = new HelperRegistry(file);
});

describe('HelperRegistry', () => {
  it('list() returns [] when no file', () => {
    expect(reg.list()).toEqual([]);
  });

  it('save() persists; get() reads back', async () => {
    await reg.save({ name: 'dbl', expression: '(x) => x * 2', description: 'double a number' });
    expect(reg.get('dbl')?.expression).toBe('(x) => x * 2');
    expect(reg.list()).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('save() with existing name overwrites in place (not append)', async () => {
    await reg.save({ name: 'x', expression: '() => 1' });
    await reg.save({ name: 'x', expression: '() => 2' });
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('x')?.expression).toBe('() => 2');
    rmSync(dir, { recursive: true, force: true });
  });

  it('remove() drops the matching name', async () => {
    await reg.save({ name: 'a', expression: '() => 1' });
    await reg.save({ name: 'b', expression: '() => 2' });
    await reg.remove('a');
    expect(reg.list().map((h) => h.name)).toEqual(['b']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('inlineInjection() builds a window.__horizon.helpers definition block', async () => {
    await reg.save({ name: 'pi', expression: '() => 3.14' });
    const injection = reg.inlineInjection();
    expect(injection).toContain('window.__horizon');
    expect(injection).toContain('helpers');
    expect(injection).toContain('"pi"');
    expect(injection).toContain('() => 3.14');
    rmSync(dir, { recursive: true, force: true });
  });
});
