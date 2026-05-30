// @vitest-environment node
import { describe, it, expect } from "vitest";
import { shouldAdvertiseAgent } from "@electron/services/agentTraffic";

// A cooperating origin published agent.json; everything else returns null.
// AgentPolicyResolver.originOf returns the full origin (scheme + host).
const cached = (origin: string): unknown =>
  origin === "https://coop.example"
    ? { version: "1.0", site: "coop.example" }
    : null;

describe("shouldAdvertiseAgent", () => {
  it("advertises to a cooperating origin when enabled + agent driving", () => {
    expect(
      shouldAdvertiseAgent("https://coop.example/api", true, true, cached),
    ).toBe(true);
  });

  it("does NOT advertise to a non-cooperating origin (e.g. Google sign-in)", () => {
    expect(
      shouldAdvertiseAgent(
        "https://accounts.google.com/RotateCookiesPage",
        true,
        true,
        cached,
      ),
    ).toBe(false);
  });

  it("does NOT advertise when the setting is disabled", () => {
    expect(
      shouldAdvertiseAgent("https://coop.example/api", false, true, cached),
    ).toBe(false);
  });

  it("does NOT advertise when no agent turn is in flight", () => {
    expect(
      shouldAdvertiseAgent("https://coop.example/api", true, false, cached),
    ).toBe(false);
  });

  it("does NOT advertise for non-http(s) URLs (origin is null)", () => {
    expect(
      shouldAdvertiseAgent("chrome://settings", true, true, cached),
    ).toBe(false);
  });
});
