import fs from "fs";
import { DEFAULT_SETTINGS } from "../../shared/constants";
import type { Settings } from "../../src/types/browser";

export class SettingsManager {
  private settings: Settings;

  constructor(private settingsPath: string) {
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const data = fs.readFileSync(this.settingsPath, "utf-8");
      const parsed = JSON.parse(data);
      // Theme migration: legacy values → named presets
      if (parsed.theme === "light") parsed.theme = "dia";
      if (parsed.theme === "dark") parsed.theme = "midnight";
      const validThemes: string[] = [
        "system",
        "dia",
        "midnight",
        "ocean",
        "forest",
      ];
      if (parsed.theme && !validThemes.includes(parsed.theme)) {
        parsed.theme = DEFAULT_SETTINGS.theme;
      }
      if (parsed.schemaVersion !== DEFAULT_SETTINGS.schemaVersion) {
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          schemaVersion: DEFAULT_SETTINGS.schemaVersion,
        };
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private save(): void {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.settings[key];
  }

  getAll(): Settings {
    return { ...this.settings };
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    this.save();
  }

  reset<K extends keyof Settings>(key?: K): void {
    if (key) {
      this.settings[key] = DEFAULT_SETTINGS[key] as Settings[K];
    } else {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    this.save();
  }
}
