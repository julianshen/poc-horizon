import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentPolicy } from "@electron/services/agentPolicy";
import { StructuredActionInvoker } from "@electron/services/StructuredActionInvoker";

/** Minimal BrowserHarness stub — only the evaluate method is needed. */
function mockHarness(evaluateImpl: (expr: string) => unknown) {
  return {
    evaluate: vi.fn(async (expr: string) => {
      try {
        const value = evaluateImpl(expr);
        return { ok: true as const, value };
      } catch (e) {
        return { ok: false as const, error: (e as Error).message };
      }
    }),
  } as unknown as { evaluate: (expr: string) => Promise<{ ok: boolean; value?: unknown; error?: string }> };
}

function makePolicy(overrides: Partial<AgentPolicy> = {}): AgentPolicy {
  return {
    version: "1.0",
    site: "example.com",
    capabilities: { click: { allowed: true } },
    actions: [
      {
        name: "search",
        endpoint: "GET /api/search",
        args_schema: { query: "string" },
        auth: "none",
        idempotent: true,
      },
      {
        name: "create_page",
        endpoint: "POST /api/pages",
        args_schema: { title: "string", content: "string" },
        auth: "cookie",
        idempotent: false,
      },
      {
        name: "delete_item",
        endpoint: "DELETE /api/items",
        args_schema: { id: "string" },
        auth: "cookie",
        idempotent: false,
      },
      {
        name: "no_schema_action",
        endpoint: "GET /api/ping",
        auth: "none",
        idempotent: true,
      },
    ],
    ...overrides,
  };
}

describe("StructuredActionInvoker", () => {
  let invoker: StructuredActionInvoker;

  beforeEach(() => {
    invoker = new StructuredActionInvoker();
  });

  describe("invoke — success paths", () => {
    it("returns JSON response for valid action with cookie auth", async () => {
      const harness = mockHarness((expr) => {
        expect(expr).toContain('"include"');
        return { results: [{ id: 1, title: "Hello" }] };
      });
      const policy = makePolicy();
      // create_page has auth: "cookie" so credentials should be "include"
      const result = await invoker.invoke(
        harness as never,
        policy,
        "create_page",
        { title: "Test", content: "Hello" },
      );
      expect(result).toEqual({ results: [{ id: 1, title: "Hello" }] });
    });

    it("returns JSON response for valid action with none auth", async () => {
      const harness = mockHarness(() => ({ status: "ok" }));
      const policy = makePolicy({
        actions: [{
          name: "ping",
          endpoint: "GET /api/ping",
          auth: "none",
          idempotent: true,
        }],
      });
      const result = await invoker.invoke(
        harness as never,
        policy,
        "ping",
        {},
      );
      expect(result).toEqual({ status: "ok" });
    });

    it("returns JSON response for action with no args_schema", async () => {
      const harness = mockHarness(() => ({ pong: true }));
      const policy = makePolicy();
      const result = await invoker.invoke(
        harness as never,
        policy,
        "no_schema_action",
        {},
      );
      expect(result).toEqual({ pong: true });
    });

    it("handles non-JSON response bodies (returns raw text)", async () => {
      const harness = mockHarness(() => "plain text response");
      const policy = makePolicy();
      const result = await invoker.invoke(
        harness as never,
        policy,
        "search",
        { query: "x" },
      );
      expect(result).toBe("plain text response");
    });
  });

  describe("invoke — error paths", () => {
    it("throws descriptive error for unknown action name", async () => {
      const harness = mockHarness(() => ({}));
      const policy = makePolicy();
      await expect(
        invoker.invoke(harness as never, policy, "nonexistent", {}),
      ).rejects.toThrow(/not found/);
    });

    it("throws validation error when args don't match args_schema", async () => {
      const harness = mockHarness(() => ({}));
      const policy = makePolicy();
      await expect(
        invoker.invoke(harness as never, policy, "search", {}),
      ).rejects.toThrow(/query/);
    });

    it("throws validation error when required arg is missing", async () => {
      const harness = mockHarness(() => ({}));
      const policy = makePolicy();
      await expect(
        invoker.invoke(harness as never, policy, "create_page", { title: "T" }),
      ).rejects.toThrow(/content/);
    });

    it("throws 'not configured in v1' for bearer auth", async () => {
      const harness = mockHarness(() => ({}));
      const policy = makePolicy({
        actions: [{
          name: "admin_action",
          endpoint: "GET /admin",
          auth: "bearer",
        }],
      });
      await expect(
        invoker.invoke(harness as never, policy, "admin_action", {}),
      ).rejects.toThrow(/bearer.*not.*v1/i);
    });

    it("throws 'not configured in v1' for header: auth", async () => {
      const harness = mockHarness(() => ({}));
      const policy = makePolicy({
        actions: [{
          name: "custom_auth",
          endpoint: "GET /custom",
          auth: "header:X-API-Key",
        }],
      });
      await expect(
        invoker.invoke(harness as never, policy, "custom_auth", {}),
      ).rejects.toThrow(/header.*not.*v1/i);
    });
  });

  describe("invoke — rate limiting", () => {
    it("enforces rate_limit and throws on second call within window", async () => {
      const harness = mockHarness(() => ({ ok: true }));
      const policy = makePolicy({
        actions: [{
          name: "rate_limited",
          endpoint: "GET /api/limited",
          auth: "none",
          rate_limit: "1/m", // 1 per minute
        }],
      });
      // First call succeeds.
      await invoker.invoke(harness as never, policy, "rate_limited", {});
      // Second call within the same minute → rate limited.
      await expect(
        invoker.invoke(harness as never, policy, "rate_limited", {}),
      ).rejects.toThrow(/rate limit/i);
    });

    it("allows call after rate limit window expires", async () => {
      const harness = mockHarness(() => ({ ok: true }));
      const policy = makePolicy({
        actions: [{
          name: "rl_short",
          endpoint: "GET /api/short",
          auth: "none",
          rate_limit: "1/s", // 1 per second
        }],
      });
      await invoker.invoke(harness as never, policy, "rl_short", {});
      // Wait just over 1 second.
      await new Promise((r) => setTimeout(r, 1100));
      // Should succeed now that the window has passed.
      await expect(
        invoker.invoke(harness as never, policy, "rl_short", {}),
      ).resolves.toEqual({ ok: true });
    });

    it("rate limit uses in-memory map (clears between invoker instances)", async () => {
      const harness = mockHarness(() => ({ ok: true }));
      const policy = makePolicy({
        actions: [{
          name: "rl_persist",
          endpoint: "GET /api/persist",
          auth: "none",
          rate_limit: "1/m",
        }],
      });
      // Invoker 1 hits rate limit.
      const inv1 = new StructuredActionInvoker();
      await inv1.invoke(harness as never, policy, "rl_persist", {});
      await expect(
        inv1.invoke(harness as never, policy, "rl_persist", {}),
      ).rejects.toThrow(/rate limit/i);
      // Invoker 2 has its own map — should succeed.
      const inv2 = new StructuredActionInvoker();
      await expect(
        inv2.invoke(harness as never, policy, "rl_persist", {}),
      ).resolves.toEqual({ ok: true });
    });
  });

  describe("invoke — idempotency", () => {
    it("retries once on network error for idempotent actions", async () => {
      let calls = 0;
      const harness = mockHarness(() => {
        calls++;
        if (calls === 1) throw new Error("network error");
        return { recovered: true };
      });
      const policy = makePolicy({
        actions: [{
          name: "idempotent_get",
          endpoint: "GET /api/data",
          auth: "none",
          idempotent: true,
        }],
      });
      const result = await invoker.invoke(
        harness as never,
        policy,
        "idempotent_get",
        {},
      );
      expect(result).toEqual({ recovered: true });
      expect(calls).toBe(2);
    });

    it("throws immediately on network error for non-idempotent actions", async () => {
      let calls = 0;
      const harness = mockHarness(() => {
        calls++;
        throw new Error("network error");
      });
      const policy = makePolicy();
      await expect(
        invoker.invoke(harness as never, policy, "create_page", {
          title: "T",
          content: "C",
        }),
      ).rejects.toThrow(/network error/);
      expect(calls).toBe(1); // No retry.
    });
  });

  describe("invoke — path params and edge cases", () => {
    it("resolves :param path segments from args (URL-encoded)", async () => {
      let captured = "";
      const harness = mockHarness((expr) => {
        captured = expr;
        return { deleted: true };
      });
      const policy = makePolicy({
        actions: [{
          name: "delete_by_id",
          endpoint: "DELETE /api/items/:id",
          args_schema: { id: "string" },
          auth: "cookie",
          idempotent: false,
        }],
      });
      const result = await invoker.invoke(harness as never, policy, "delete_by_id", { id: "a b/c" });
      expect(result).toEqual({ deleted: true });
      expect(captured).toContain("/api/items/a%20b%2Fc"); // encodeURIComponent
    });

    it("leaves :param literal when the arg is absent", async () => {
      let captured = "";
      const harness = mockHarness((expr) => { captured = expr; return {}; });
      const policy = makePolicy({
        actions: [{
          name: "get_opt",
          endpoint: "GET /api/items/:id",
          auth: "none",
          idempotent: true,
        }],
      });
      await invoker.invoke(harness as never, policy, "get_opt", {});
      expect(captured).toContain("/api/items/:id"); // unresolved, left as-is
    });

    it("skips rate-limit enforcement for an unparseable rate_limit spec", async () => {
      const harness = mockHarness(() => ({ ok: true }));
      const policy = makePolicy({
        actions: [{
          name: "weird_rl",
          endpoint: "GET /api/weird",
          auth: "none",
          rate_limit: "lots-per-fortnight",
        }],
      });
      await invoker.invoke(harness as never, policy, "weird_rl", {});
      // Second immediate call still succeeds (no enforcement).
      await expect(
        invoker.invoke(harness as never, policy, "weird_rl", {}),
      ).resolves.toEqual({ ok: true });
    });

    it("reports '(none)' available actions when policy has no actions array", async () => {
      const harness = mockHarness(() => ({}));
      const policy = makePolicy({ actions: undefined });
      await expect(
        invoker.invoke(harness as never, policy, "anything", {}),
      ).rejects.toThrow(/\(none\)/);
    });
  });

  describe("invoke — harness evaluate failure", () => {
    it("throws when harness.evaluate returns { ok: false }", async () => {
      const harness = {
        evaluate: vi.fn(async () => ({
          ok: false as const,
          error: "Page context destroyed",
        })),
      } as unknown as { evaluate: (expr: string) => Promise<{ ok: boolean; value?: unknown; error?: string }> };
      const policy = makePolicy();
      await expect(
        invoker.invoke(harness as never, policy, "search", { query: "x" }),
      ).rejects.toThrow(/Page context destroyed/);
    });
  });
});
