import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SettingsManager } from '../../.electron/services/SettingsManager';
import { DEFAULT_SETTINGS } from '../../shared/constants';

let dir: string;
let settingsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'horizon-settings-'));
  settingsPath = join(dir, 'settings.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsManager', () => {
  it('returns defaults when no file exists', () => {
    const sm = new SettingsManager(settingsPath);
    expect(sm.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it('loads an existing settings file and merges over defaults', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ schemaVersion: DEFAULT_SETTINGS.schemaVersion, accentColor: '#ff0000' })
    );
    const sm = new SettingsManager(settingsPath);
    expect(sm.get('accentColor')).toBe('#ff0000');
    expect(sm.get('fontSize')).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it('migrates by overwriting schemaVersion when the persisted version differs', () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ schemaVersion: 0, accentColor: '#00ff00' })
    );
    const sm = new SettingsManager(settingsPath);
    expect(sm.get('schemaVersion')).toBe(DEFAULT_SETTINGS.schemaVersion);
    expect(sm.get('accentColor')).toBe('#00ff00');
  });

  it('falls back to defaults on corrupted JSON', () => {
    writeFileSync(settingsPath, '{not valid json');
    const sm = new SettingsManager(settingsPath);
    expect(sm.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it('set() persists the new value to disk', () => {
    const sm = new SettingsManager(settingsPath);
    sm.set('accentColor', '#abcdef');
    expect(existsSync(settingsPath)).toBe(true);
    const persisted = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(persisted.accentColor).toBe('#abcdef');
    // Subsequent instance sees the persisted value
    const sm2 = new SettingsManager(settingsPath);
    expect(sm2.get('accentColor')).toBe('#abcdef');
  });

  it('getAll() returns a copy, not a live reference', () => {
    const sm = new SettingsManager(settingsPath);
    const snapshot = sm.getAll();
    snapshot.accentColor = '#000000';
    expect(sm.get('accentColor')).toBe(DEFAULT_SETTINGS.accentColor);
  });

  it('reset(key) resets only that key', () => {
    const sm = new SettingsManager(settingsPath);
    sm.set('accentColor', '#abcdef');
    sm.set('fontSize', 99);
    sm.reset('accentColor');
    expect(sm.get('accentColor')).toBe(DEFAULT_SETTINGS.accentColor);
    expect(sm.get('fontSize')).toBe(99);
  });

  it('reset() with no key resets everything', () => {
    const sm = new SettingsManager(settingsPath);
    sm.set('accentColor', '#abcdef');
    sm.set('fontSize', 99);
    sm.reset();
    expect(sm.getAll()).toEqual(DEFAULT_SETTINGS);
  });
});
