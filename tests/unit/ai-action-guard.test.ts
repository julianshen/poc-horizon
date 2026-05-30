// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  AiActionGuard,
  type ActionPolicy,
} from "@electron/services/AiActionGuard";

describe("AiActionGuard", () => {
  it("needsApproval is false for everything when policy is never", () => {
    const g = new AiActionGuard(() => "never");
    expect(g.needsApproval("click")).toBe(false);
    expect(g.needsApproval("evaluate")).toBe(false);
    expect(g.needsApproval("screenshot")).toBe(false);
  });

  it("needsApproval is true for risky tools and false for read-only when policy is risky", () => {
    const g = new AiActionGuard(() => "risky");
    expect(g.needsApproval("click")).toBe(true);
    expect(g.needsApproval("type")).toBe(true);
    expect(g.needsApproval("navigate")).toBe(true);
    expect(g.needsApproval("evaluate")).toBe(true);
    expect(g.needsApproval("cdp")).toBe(true);
    // Read-only — should pass through
    expect(g.needsApproval("screenshot")).toBe(false);
    expect(g.needsApproval("screenshotMarked")).toBe(false);
    expect(g.needsApproval("axtree")).toBe(false);
    expect(g.needsApproval("getDom")).toBe(false);
    expect(g.needsApproval("getUrl")).toBe(false);
    expect(g.needsApproval("listHelpers")).toBe(false);
    expect(g.needsApproval("domainSkillRead")).toBe(false);
    expect(g.needsApproval("domainSkillSearch")).toBe(false);
  });

  it("needsApproval is true for everything when policy is all", () => {
    const g = new AiActionGuard(() => "all");
    expect(g.needsApproval("screenshot")).toBe(true);
    expect(g.needsApproval("getUrl")).toBe(true);
  });

  it("request() emits a prompt event with a generated id + summary", async () => {
    const g = new AiActionGuard(() => "risky");
    const seen: unknown[] = [];
    g.on("prompt", (p) => seen.push(p));
    const promise = g.request("click", { x: 100, y: 50 });
    expect(seen).toHaveLength(1);
    const prompt = seen[0] as { id: string; tool: string; summary: string };
    expect(prompt.tool).toBe("click");
    expect(prompt.summary).toContain("100");
    expect(prompt.id).toMatch(/^a\d+_/);
    // decide(true) resolves
    expect(g.decide(prompt.id, true)).toBe(true);
    expect(await promise).toBe(true);
  });

  it("decide(false) resolves the pending promise with false (denial)", async () => {
    const g = new AiActionGuard(() => "risky");
    let id = "";
    g.on("prompt", (p) => {
      id = p.id;
    });
    const promise = g.request("navigate", { url: "https://x" });
    expect(g.decide(id, false)).toBe(true);
    expect(await promise).toBe(false);
  });

  it("decide() returns false on an unknown id", () => {
    const g = new AiActionGuard(() => "risky");
    expect(g.decide("nope", true)).toBe(false);
  });

  it("cancelAll resolves all pending with false", async () => {
    const g = new AiActionGuard(() => "all");
    const p1 = g.request("screenshot", {});
    const p2 = g.request("getUrl", {});
    expect(g.pendingCount()).toBe(2);
    g.cancelAll();
    expect(g.pendingCount()).toBe(0);
    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
  });

  it("auto-denies on timeout", async () => {
    vi.useFakeTimers();
    const g = new AiActionGuard(() => "risky", 1000);
    const promise = g.request("click", { x: 0, y: 0 });
    vi.advanceTimersByTime(1100);
    expect(await promise).toBe(false);
    vi.useRealTimers();
  });

  it("evaluate() returns deny when the site policy prohibits dismiss_overlays under dark_pattern_acceptance", () => {
    const g = new AiActionGuard(() => "never");
    g.setSitePolicy({
      version: "1.0",
      site: "X",
      capabilities: {},
      prohibited: [{ trigger: "dark_pattern_acceptance" }],
    });
    const decision = g.evaluate("dismissOverlays", {});
    expect(decision.kind).toBe("deny");
    if (decision.kind === "deny")
      expect(decision.reason).toContain("dark_pattern_acceptance");
  });

  it('evaluate() returns prompt when site requires_human matches even if user policy is "never"', () => {
    const g = new AiActionGuard(() => "never");
    g.setSitePolicy({
      version: "1.0",
      site: "X",
      capabilities: {},
      requires_human: [{ trigger: "payment" }],
    });
    expect(
      g.evaluate("navigate", { url: "https://shop.test/checkout/payment" })
        .kind,
    ).toBe("prompt");
    // A non-payment-shaped action is still allowed under policy=never.
    expect(
      g.evaluate("navigate", { url: "https://shop.test/products/foo" }).kind,
    ).toBe("allow");
  });

  it("evaluate() with no site policy still honors the user policy", () => {
    const g = new AiActionGuard(() => "risky");
    expect(g.evaluate("click", { x: 1, y: 1 }).kind).toBe("prompt");
    expect(g.evaluate("screenshot", {}).kind).toBe("allow");
  });

  it("policy is read at request time, not construction time", () => {
    let policy: ActionPolicy = "never";
    const g = new AiActionGuard(() => policy);
    expect(g.needsApproval("click")).toBe(false);
    policy = "risky";
    expect(g.needsApproval("click")).toBe(true);
  });

  it("gates invokeStructuredAction as risky (cookie-auth agent.json action)", () => {
    // A site-declared POST/DELETE must prompt in 'risky' mode, not slip
    // through unguarded.
    expect(
      new AiActionGuard(() => "risky").evaluate("invokeStructuredAction", {})
        .kind,
    ).toBe("prompt");
    expect(
      new AiActionGuard(() => "never").evaluate("invokeStructuredAction", {})
        .kind,
    ).toBe("allow");
  });
});

describe("HorizonBridgeServer + AiActionGuard integration", () => {
  it("a denied tool call returns ok:false with the denial reason", async () => {
    // Lightweight inline integration — full network harness lives in
    // horizon-bridge-server.test.ts. Here we exercise just the guard hook.
    const { HorizonBridgeServer } =
      await import("@electron/services/HorizonBridgeServer");
    const fakeHarness = {
      click: vi.fn(async () => {}),
    } as never;
    const guard = new AiActionGuard(() => "risky");
    guard.on("prompt", (p) => {
      guard.decide(p.id, false);
    }); // user denies
    const srv = new HorizonBridgeServer(
      fakeHarness,
      undefined,
      undefined,
      undefined,
      guard,
    );
    const port = await srv.listen();
    const { createConnection } = await import("net");
    await new Promise<void>((resolve, reject) => {
      const s = createConnection({ host: "127.0.0.1", port });
      let buf = "";
      s.setEncoding("utf8");
      s.on("data", (chunk: string) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        const resp = JSON.parse(buf.slice(0, nl)) as {
          ok: boolean;
          error?: string;
        };
        try {
          expect(resp.ok).toBe(false);
          expect(resp.error).toContain("denied by user");
          s.destroy();
          srv.close();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      s.on("connect", () =>
        s.write(
          JSON.stringify({ id: "q", tool: "click", args: { x: 1, y: 1 } }) +
            "\n",
        ),
      );
      s.on("error", reject);
    });
  });
});
