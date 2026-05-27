import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { SettingsManager } from "@electron/services/SettingsManager";
import { DEFAULT_SETTINGS } from "@shared/constants";
import { useTmpDir } from "../helpers/tmpdir";

const tmp = useTmpDir("horizon-settings");
const settingsPath = () => tmp.path("settings.json");

describe("SettingsManager", () => {
  it("returns defaults when no file exists", () => {
    const sm = new SettingsManager(settingsPath());
    expect(sm.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it("loads an existing settings file and merges over defaults", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        schemaVersion: DEFAULT_SETTINGS.schemaVersion,
        accentColor: "#ff0000",
      }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("accentColor")).toBe("#ff0000");
    expect(sm.get("fontSize")).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it("migrates by overwriting schemaVersion when the persisted version differs", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 0, accentColor: "#00ff00" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("schemaVersion")).toBe(DEFAULT_SETTINGS.schemaVersion);
    expect(sm.get("accentColor")).toBe("#00ff00");
  });

  it("falls back to defaults on corrupted JSON", () => {
    writeFileSync(settingsPath(), "{not valid json");
    const sm = new SettingsManager(settingsPath());
    expect(sm.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it("set() persists the new value to disk", () => {
    const sm = new SettingsManager(settingsPath());
    sm.set("accentColor", "#abcdef");
    expect(existsSync(settingsPath())).toBe(true);
    const persisted = JSON.parse(readFileSync(settingsPath(), "utf-8"));
    expect(persisted.accentColor).toBe("#abcdef");
    const sm2 = new SettingsManager(settingsPath());
    expect(sm2.get("accentColor")).toBe("#abcdef");
  });

  it("getAll() returns a copy, not a live reference", () => {
    const sm = new SettingsManager(settingsPath());
    const snapshot = sm.getAll();
    snapshot.accentColor = "#000000";
    expect(sm.get("accentColor")).toBe(DEFAULT_SETTINGS.accentColor);
  });

  it("reset(key) resets only that key", () => {
    const sm = new SettingsManager(settingsPath());
    sm.set("accentColor", "#abcdef");
    sm.set("fontSize", 99);
    sm.reset("accentColor");
    expect(sm.get("accentColor")).toBe(DEFAULT_SETTINGS.accentColor);
    expect(sm.get("fontSize")).toBe(99);
  });

  it("reset() with no key resets everything", () => {
    const sm = new SettingsManager(settingsPath());
    sm.set("accentColor", "#abcdef");
    sm.set("fontSize", 99);
    sm.reset();
    expect(sm.getAll()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("SettingsManager theme migration", () => {
  it("migrates legacy 'light' to 'dia'", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: "light" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("theme")).toBe("dia");
    expect(sm.get("schemaVersion")).toBe(DEFAULT_SETTINGS.schemaVersion);
  });

  it("migrates legacy 'dark' to 'midnight'", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: "dark" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("theme")).toBe("midnight");
  });

  it("keeps 'system' unchanged", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: "system" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("theme")).toBe("system");
  });

  it("resets invalid theme values to default", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ schemaVersion: 1, theme: "invalid-theme" }),
    );
    const sm = new SettingsManager(settingsPath());
    expect(sm.get("theme")).toBe(DEFAULT_SETTINGS.theme);
  });
});
