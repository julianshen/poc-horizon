import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import type { Settings } from '../../src/types/browser';

export class SettingsManager {
  private settingsPath: string;
  private settings: Settings;

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const data = fs.readFileSync(this.settingsPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.schemaVersion !== DEFAULT_SETTINGS.schemaVersion) {
        return { ...DEFAULT_SETTINGS, ...parsed, schemaVersion: DEFAULT_SETTINGS.schemaVersion };
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
  }

  get(key: string): unknown {
    return (this.settings as Record<string, unknown>)[key];
  }

  getAll(): Settings {
    return { ...this.settings };
  }

  set(key: string, value: unknown): void {
    (this.settings as Record<string, unknown>)[key] = value;
    this.save();
  }

  reset(key?: string): void {
    if (key) {
      (this.settings as Record<string, unknown>)[key] = (DEFAULT_SETTINGS as Record<string, unknown>)[key];
    } else {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    this.save();
  }
}
