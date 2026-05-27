// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { AgentPolicyResolver } from "@electron/services/AgentPolicyResolver";

const validPolicy = JSON.stringify({
  version: "1.0",
  site: "Example",
  capabilities: { read: { allowed: true } },
});

function makeResolver(
  impl: (
    url: string,
    headers: Record<string, string>,
  ) => Promise<{ status: number; body: string; etag: string | null }>,
): AgentPolicyResolver {
  return new AgentPolicyResolver(impl);
}

describe("AgentPolicyResolver.originOf", () => {
  it("returns the origin for http(s) URLs", () => {
    expect(AgentPolicyResolver.originOf("https://example.com/path?q=1")).toBe(
      "https://example.com",
    );
  });
  it("returns null for non-http schemes", () => {
    expect(AgentPolicyResolver.originOf("chrome://settings")).toBeNull();
    expect(AgentPolicyResolver.originOf("file:///tmp/x")).toBeNull();
  });
  it("returns null for invalid URLs", () => {
    expect(AgentPolicyResolver.originOf("not-a-url")).toBeNull();
  });
});

describe("AgentPolicyResolver.resolve", () => {
  it("fetches /agent.json from the origin root and caches the result", async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      body: validPolicy,
      etag: '"a"',
    }));
    const r = makeResolver(fetcher);
    const p1 = await r.resolve("https://example.com/some/path");
    const p2 = await r.resolve("https://example.com/other/path");
    expect(p1?.site).toBe("Example");
    expect(p2?.site).toBe("Example");
    expect(fetcher).toHaveBeenCalledTimes(1); // second call is a cache hit
    expect(fetcher.mock.calls[0][0]).toBe("https://example.com/agent.json");
  });

  it("caches 404 as a known-missing result (no re-fetch within TTL)", async () => {
    const fetcher = vi.fn(async () => ({ status: 404, body: "", etag: null }));
    const r = makeResolver(fetcher);
    expect(await r.resolve("https://x.test")).toBeNull();
    expect(await r.resolve("https://x.test")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends If-None-Match on revalidation and reuses cached policy on 304", async () => {
    let calls = 0;
    const fetcher = vi.fn(
      async (_url: string, headers: Record<string, string>) => {
        calls++;
        if (calls === 1)
          return { status: 200, body: validPolicy, etag: '"v1"' };
        expect(headers["If-None-Match"]).toBe('"v1"');
        return { status: 304, body: "", etag: '"v1"' };
      },
    );
    const r = makeResolver(fetcher);
    await r.resolve("https://x.test");
    // Force re-validation by stomping the cache's fetchedAt.
    (r as unknown as { cache: Map<string, { fetchedAt: number }> }).cache.get(
      "https://x.test",
    )!.fetchedAt = 0;
    const p2 = await r.resolve("https://x.test");
    expect(p2?.site).toBe("Example");
    expect(calls).toBe(2);
  });

  it("returns null for invalid JSON", async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      body: "not json",
      etag: null,
    }));
    expect(await makeResolver(fetcher).resolve("https://x.test")).toBeNull();
  });

  it("returns null for valid JSON that fails the v1 shape check", async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      body: JSON.stringify({ foo: "bar" }),
      etag: null,
    }));
    expect(await makeResolver(fetcher).resolve("https://x.test")).toBeNull();
  });

  it("returns null for non-http URLs without fetching", async () => {
    const fetcher = vi.fn();
    const r = makeResolver(fetcher as never);
    expect(await r.resolve("chrome://settings")).toBeNull();
    expect(await r.resolve("file:///tmp/x")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("transient 5xx does not poison the cache — returns previously cached policy", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => {
      n++;
      if (n === 1) return { status: 200, body: validPolicy, etag: '"a"' };
      return { status: 503, body: "service down", etag: null };
    });
    const r = makeResolver(fetcher);
    await r.resolve("https://x.test");
    (r as unknown as { cache: Map<string, { fetchedAt: number }> }).cache.get(
      "https://x.test",
    )!.fetchedAt = 0;
    const result = await r.resolve("https://x.test");
    expect(result?.site).toBe("Example");
  });

  it("cached() returns whatever is in the cache without fetching", async () => {
    const fetcher = vi.fn(async () => ({
      status: 200,
      body: validPolicy,
      etag: null,
    }));
    const r = makeResolver(fetcher);
    expect(r.cached("https://x.test")).toBeNull();
    await r.resolve("https://x.test");
    expect(r.cached("https://x.test")?.site).toBe("Example");
  });
});
