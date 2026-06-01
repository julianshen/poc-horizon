import { describe, it, expect } from "vitest";
import {
  buildPiSettings,
  buildPiAuth,
  buildProviderOverrideExtension,
} from "@electron/services/piConfig";

describe("buildPiSettings", () => {
  it("maps provider and model to Pi's defaults", () => {
    expect(
      buildPiSettings({ provider: "anthropic", model: "claude-x" }),
    ).toEqual({
      defaultProvider: "anthropic",
      defaultModel: "claude-x",
    });
  });

  it("omits defaultModel when no model is set", () => {
    expect(buildPiSettings({ provider: "openai" })).toEqual({
      defaultProvider: "openai",
    });
  });

  it("omits defaultProvider when provider is empty", () => {
    expect(buildPiSettings({ provider: "" })).toEqual({});
  });

  it("includes extensions when provided", () => {
    expect(
      buildPiSettings({ provider: "openai" }, ["/cfg/override.mjs"]),
    ).toEqual({
      defaultProvider: "openai",
      extensions: ["/cfg/override.mjs"],
    });
  });
});

describe("buildPiAuth", () => {
  it("keys the api_key entry by provider id", () => {
    expect(
      buildPiAuth({ provider: "anthropic", apiKey: "sk-ant-123" }),
    ).toEqual({
      anthropic: { type: "api_key", key: "sk-ant-123" },
    });
  });

  it("returns null when no api key is configured", () => {
    expect(buildPiAuth({ provider: "anthropic" })).toBeNull();
  });

  it("returns null when no provider is set", () => {
    expect(buildPiAuth({ provider: "", apiKey: "x" })).toBeNull();
  });
});

describe("buildProviderOverrideExtension", () => {
  it("emits a registerProvider override with the base URL", () => {
    const src = buildProviderOverrideExtension({
      provider: "openai",
      baseUrl: "https://proxy.example.com/v1",
    });
    expect(src).toContain("export default function (pi)");
    expect(src).toContain(
      'pi.registerProvider("openai", { baseUrl: "https://proxy.example.com/v1" });',
    );
  });

  it("JSON-escapes provider and base URL", () => {
    const src = buildProviderOverrideExtension({
      provider: 'ev"il',
      baseUrl: 'http://x"y',
    });
    expect(src).toContain('pi.registerProvider("ev\\"il"');
    expect(src).toContain('baseUrl: "http://x\\"y"');
  });

  it("returns null without a base URL", () => {
    expect(
      buildProviderOverrideExtension({ provider: "openai" }),
    ).toBeNull();
  });

  it("returns null without a provider", () => {
    expect(
      buildProviderOverrideExtension({ provider: "", baseUrl: "http://x" }),
    ).toBeNull();
  });
});
