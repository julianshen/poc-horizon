import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { writePiConfig } from "@electron/services/PiConfigWriter";

describe("writePiConfig", () => {
  let dir: string;
  const settingsPath = () => path.join(dir, "settings.json");
  const authPath = () => path.join(dir, "auth.json");
  const readSettings = () =>
    JSON.parse(readFileSync(settingsPath(), "utf-8")) as Record<string, unknown>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pi-cfg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes provider/model defaults and auth.json (0600)", () => {
    writePiConfig(dir, {
      provider: "anthropic",
      model: "claude-x",
      apiKey: "sk-1",
    });
    expect(readSettings()).toMatchObject({
      defaultProvider: "anthropic",
      defaultModel: "claude-x",
    });
    expect(JSON.parse(readFileSync(authPath(), "utf-8"))).toEqual({
      anthropic: { type: "api_key", key: "sk-1" },
    });
  });

  it("drops a previously-set model when the Model field is cleared", () => {
    writePiConfig(dir, { provider: "openai", model: "gpt-x", apiKey: "k" });
    expect(readSettings().defaultModel).toBe("gpt-x");
    // User clears the model to fall back to the provider default.
    writePiConfig(dir, { provider: "openai", model: "", apiKey: "k" });
    expect(readSettings()).not.toHaveProperty("defaultModel");
    expect(readSettings().defaultProvider).toBe("openai");
  });

  it("preserves unmanaged Pi-written settings keys", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ sessionDir: ".pi/sessions", theme: "dark" }),
    );
    writePiConfig(dir, { provider: "openai" });
    const s = readSettings();
    expect(s.sessionDir).toBe(".pi/sessions");
    expect(s.theme).toBe("dark");
    expect(s.defaultProvider).toBe("openai");
  });

  it("removes auth.json when the API key is cleared", () => {
    writePiConfig(dir, { provider: "anthropic", apiKey: "sk-1" });
    expect(existsSync(authPath())).toBe(true);
    writePiConfig(dir, { provider: "anthropic", apiKey: "" });
    expect(existsSync(authPath())).toBe(false);
  });

  it("writes a base-URL override extension and prunes it when cleared", () => {
    writePiConfig(dir, {
      provider: "openai",
      baseUrl: "https://proxy.example.com/v1",
    });
    const overridePath = path.join(dir, "horizon-provider-override.mjs");
    expect(existsSync(overridePath)).toBe(true);
    expect(readSettings().extensions).toEqual([overridePath]);
    // Clearing the base URL removes the extension and the managed key.
    writePiConfig(dir, { provider: "openai", baseUrl: "" });
    expect(existsSync(overridePath)).toBe(false);
    expect(readSettings()).not.toHaveProperty("extensions");
  });
});
