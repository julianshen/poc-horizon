import { describe, it, expect } from "vitest";
import {
  buildPiSettings,
  buildPiAuth,
  buildProviderOverrideExtension,
  type PiProvidersConfig,
} from "@electron/services/piConfig";

const cfg = (over: Partial<PiProvidersConfig> = {}): PiProvidersConfig => ({
  activeProvider: "anthropic",
  apiKeys: {},
  models: {},
  baseUrls: {},
  ...over,
});

const authed = (...providers: string[]) => new Set(providers);

describe("buildPiSettings", () => {
  it("maps the active provider and its model to Pi's defaults", () => {
    expect(
      buildPiSettings(
        cfg({ activeProvider: "anthropic", models: { anthropic: "claude-x" } }),
        authed("anthropic"),
      ),
    ).toMatchObject({ defaultProvider: "anthropic", defaultModel: "claude-x" });
  });

  it("omits defaultModel when the active provider has no model", () => {
    expect(
      buildPiSettings(cfg({ activeProvider: "openai" }), authed("openai")),
    ).toEqual({ defaultProvider: "openai" });
  });

  it("does not set a default for an unauthenticated active provider", () => {
    // User selected openai but it isn't authed anywhere → don't point Pi at it.
    const s = buildPiSettings(
      cfg({ activeProvider: "openai", models: { openai: "gpt-4o" } }),
      authed(),
    );
    expect(s).not.toHaveProperty("defaultProvider");
    expect(s).not.toHaveProperty("defaultModel");
  });

  it("honors an active provider authed outside Horizon (preserved auth.json)", () => {
    // No Horizon key, but anthropic has a /login/OAuth entry → respect it.
    const s = buildPiSettings(
      cfg({ activeProvider: "anthropic", models: { anthropic: "claude-x" } }),
      authed("anthropic"),
    );
    expect(s).toMatchObject({
      defaultProvider: "anthropic",
      defaultModel: "claude-x",
    });
  });

  it("falls back to an authed provider when the active one is unauthed", () => {
    const s = buildPiSettings(
      cfg({
        activeProvider: "openai", // not authed
        models: { anthropic: "claude-x" },
      }),
      authed("anthropic"),
    );
    expect(s).toMatchObject({
      defaultProvider: "anthropic",
      defaultModel: "claude-x",
    });
  });

  it("builds enabledModels from authed providers that have a model", () => {
    const s = buildPiSettings(
      cfg({
        activeProvider: "anthropic",
        // google is authed but has no model → excluded from the cycle
        models: { anthropic: "claude-x", openai: "gpt-4o" },
      }),
      authed("anthropic", "openai", "google"),
    );
    expect(s.enabledModels).toEqual(["claude-x", "gpt-4o"]);
  });

  it("excludes models of providers that are not authed from the cycle", () => {
    const s = buildPiSettings(
      cfg({ models: { anthropic: "claude-x", openai: "gpt-4o" } }),
      authed("anthropic"),
    );
    expect(s.enabledModels).toEqual(["claude-x"]);
  });

  it("omits enabledModels when no authed provider has a model", () => {
    expect(
      buildPiSettings(cfg({ activeProvider: "anthropic" }), authed("anthropic")),
    ).not.toHaveProperty(
      "enabledModels",
    );
  });
});

describe("buildPiAuth", () => {
  it("emits an api_key entry for every provider that has a key", () => {
    expect(
      buildPiAuth(cfg({ apiKeys: { anthropic: "sk-a", openai: "sk-o" } })),
    ).toEqual({
      anthropic: { type: "api_key", key: "sk-a" },
      openai: { type: "api_key", key: "sk-o" },
    });
  });

  it("skips providers with an empty key and returns {} when none", () => {
    expect(buildPiAuth(cfg({ apiKeys: { anthropic: "", openai: "sk-o" } }))).toEqual(
      { openai: { type: "api_key", key: "sk-o" } },
    );
    expect(buildPiAuth(cfg())).toEqual({});
  });
});

describe("buildProviderOverrideExtension", () => {
  it("registers a base-URL override for every provider that has one", () => {
    const src = buildProviderOverrideExtension(
      cfg({
        baseUrls: {
          openai: "https://proxy.example.com/v1",
          anthropic: "https://ac.example.com",
        },
      }),
    );
    expect(src).toContain("export default function (pi)");
    expect(src).toContain(
      'pi.registerProvider("openai", { baseUrl: "https://proxy.example.com/v1" });',
    );
    expect(src).toContain(
      'pi.registerProvider("anthropic", { baseUrl: "https://ac.example.com" });',
    );
  });

  it("JSON-escapes provider and base URL", () => {
    const src = buildProviderOverrideExtension(
      cfg({ baseUrls: { 'ev"il': 'http://x"y' } }),
    );
    expect(src).toContain('pi.registerProvider("ev\\"il"');
    expect(src).toContain('baseUrl: "http://x\\"y"');
  });

  it("returns null when no provider has a base URL", () => {
    expect(
      buildProviderOverrideExtension(cfg({ baseUrls: { openai: "" } })),
    ).toBeNull();
    expect(buildProviderOverrideExtension(cfg())).toBeNull();
  });
});
