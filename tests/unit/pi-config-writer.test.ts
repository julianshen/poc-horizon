import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { writePiConfig } from "@electron/services/PiConfigWriter";
import type { PiProvidersConfig } from "@electron/services/piConfig";

const cfg = (over: Partial<PiProvidersConfig> = {}): PiProvidersConfig => ({
  activeProvider: "anthropic",
  apiKeys: {},
  models: {},
  baseUrls: {},
  ...over,
});

describe("writePiConfig", () => {
  let dir: string;
  const settingsPath = () => path.join(dir, "settings.json");
  const authPath = () => path.join(dir, "auth.json");
  const readSettings = () =>
    JSON.parse(readFileSync(settingsPath(), "utf-8")) as Record<string, unknown>;
  const readAuth = () =>
    JSON.parse(readFileSync(authPath(), "utf-8")) as Record<string, unknown>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pi-cfg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes defaults + auth for every configured provider (0600)", () => {
    writePiConfig(
      dir,
      cfg({
        activeProvider: "anthropic",
        apiKeys: { anthropic: "sk-a", openai: "sk-o" },
        models: { anthropic: "claude-x", openai: "gpt-4o" },
      }),
    );
    expect(readSettings()).toMatchObject({
      defaultProvider: "anthropic",
      defaultModel: "claude-x",
      enabledModels: ["claude-x", "gpt-4o"],
    });
    expect(readAuth()).toEqual({
      anthropic: { type: "api_key", key: "sk-a" },
      openai: { type: "api_key", key: "sk-o" },
    });
    expect(statSync(authPath()).mode & 0o777).toBe(0o600);
  });

  it("drops a previously-set model when the Model field is cleared", () => {
    writePiConfig(dir, cfg({ apiKeys: { openai: "k" }, models: { openai: "gpt-x" }, activeProvider: "openai" }));
    expect(readSettings().defaultModel).toBe("gpt-x");
    writePiConfig(dir, cfg({ apiKeys: { openai: "k" }, activeProvider: "openai" }));
    expect(readSettings()).not.toHaveProperty("defaultModel");
    expect(readSettings().defaultProvider).toBe("openai");
  });

  it("preserves unmanaged Pi-written settings keys", () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ sessionDir: ".pi/sessions", theme: "dark" }),
    );
    writePiConfig(dir, cfg({ activeProvider: "openai", apiKeys: { openai: "k" } }));
    const s = readSettings();
    expect(s.sessionDir).toBe(".pi/sessions");
    expect(s.theme).toBe("dark");
    expect(s.defaultProvider).toBe("openai");
  });

  it("prunes a Horizon-written key for a provider whose key is cleared, keeping others", () => {
    writePiConfig(dir, cfg({ apiKeys: { anthropic: "sk-a", openai: "sk-o" } }));
    expect(Object.keys(readAuth()).sort()).toEqual(["anthropic", "openai"]);
    // Clear anthropic only.
    writePiConfig(dir, cfg({ apiKeys: { openai: "sk-o" } }));
    expect(readAuth()).toEqual({ openai: { type: "api_key", key: "sk-o" } });
  });

  it("scrubs all Horizon-written keys on a full clear (and removes auth.json)", () => {
    writePiConfig(dir, cfg({ apiKeys: { anthropic: "sk-a", openai: "sk-o" } }));
    expect(existsSync(authPath())).toBe(true);
    writePiConfig(dir, cfg()); // everything cleared
    expect(existsSync(authPath())).toBe(false);
  });

  it("keeps a same-provider OAuth token when the api_key is cleared", () => {
    writeFileSync(
      authPath(),
      JSON.stringify({ anthropic: { type: "oauth", key: "login-tok" } }),
    );
    writePiConfig(dir, cfg({ activeProvider: "anthropic" }));
    expect(readAuth()).toEqual({ anthropic: { type: "oauth", key: "login-tok" } });
  });

  it("uses a provider authed outside Horizon as the settings default", () => {
    // anthropic authed via a preserved /login token, no Horizon key set.
    writeFileSync(
      authPath(),
      JSON.stringify({ anthropic: { type: "oauth", key: "login-tok" } }),
    );
    writePiConfig(
      dir,
      cfg({ activeProvider: "anthropic", models: { anthropic: "claude-x" } }),
    );
    expect(readSettings()).toMatchObject({
      defaultProvider: "anthropic",
      defaultModel: "claude-x",
    });
  });

  it("keeps a once-managed key that was replaced with a different value", () => {
    // Horizon writes sk-a (ownership hash recorded for that value)…
    writePiConfig(dir, cfg({ apiKeys: { anthropic: "sk-a" } }));
    // …then Pi/the user replaces the entry with a different api_key…
    writeFileSync(
      authPath(),
      JSON.stringify({ anthropic: { type: "api_key", key: "sk-replaced" } }),
    );
    // …and the user clears the Horizon field. The value no longer matches
    // what Horizon wrote, so it must be preserved.
    writePiConfig(dir, cfg({ activeProvider: "anthropic" }));
    expect(readAuth()).toEqual({
      anthropic: { type: "api_key", key: "sk-replaced" },
    });
  });

  it("never deletes an api_key entry Horizon did not write", () => {
    // Simulates a Pi `/login` api_key created out-of-band.
    writeFileSync(
      authPath(),
      JSON.stringify({ anthropic: { type: "api_key", key: "pi-login-key" } }),
    );
    writePiConfig(dir, cfg({ activeProvider: "anthropic" }));
    expect(readAuth()).toEqual({
      anthropic: { type: "api_key", key: "pi-login-key" },
    });
  });

  it("registers base-URL overrides for all providers and prunes when cleared", () => {
    writeFileSync(settingsPath(), JSON.stringify({ extensions: ["/user/ext.mjs"] }));
    writePiConfig(
      dir,
      cfg({
        apiKeys: { openai: "k" },
        baseUrls: { openai: "https://proxy.example.com/v1" },
      }),
    );
    const overridePath = path.join(dir, "horizon-provider-override.mjs");
    expect(existsSync(overridePath)).toBe(true);
    expect(readFileSync(overridePath, "utf-8")).toContain(
      'pi.registerProvider("openai"',
    );
    expect(readSettings().extensions).toEqual(["/user/ext.mjs", overridePath]);
    // Clear the base URL → override + managed extension entry go, user ext stays.
    writePiConfig(dir, cfg({ apiKeys: { openai: "k" } }));
    expect(existsSync(overridePath)).toBe(false);
    expect(readSettings().extensions).toEqual(["/user/ext.mjs"]);
  });

  it("surfaces a malformed settings.json instead of clobbering it", () => {
    writeFileSync(settingsPath(), "{ not valid json");
    expect(() => writePiConfig(dir, cfg())).toThrow();
    expect(readFileSync(settingsPath(), "utf-8")).toBe("{ not valid json");
  });

  it("rejects a settings.json that is valid JSON but not an object", () => {
    writeFileSync(settingsPath(), "[1, 2, 3]");
    expect(() => writePiConfig(dir, cfg())).toThrow(/must contain a JSON object/);
    expect(readFileSync(settingsPath(), "utf-8")).toBe("[1, 2, 3]");
  });
});
