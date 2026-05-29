import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { useTmpDir } from "../helpers/tmpdir";

interface MockResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

const requestQueue: Array<{
  url: string;
  response: MockResponse | "timeout" | "error" | "oversized";
}> = [];

function enqueueResponse(
  url: string,
  response: MockResponse | "timeout" | "error" | "oversized",
): void {
  requestQueue.push({ url, response });
}

vi.mock("electron", () => {
  return {
    net: {
      request: ({ url }: { url: string }) => {
        const req = new EventEmitter() as EventEmitter & {
          setHeader: (k: string, v: string) => void;
          end: () => void;
          abort: () => void;
        };
        const sentHeaders: Record<string, string> = {};
        req.setHeader = (k, v) => {
          sentHeaders[k] = v;
        };
        (req as unknown as { sentHeaders: Record<string, string> }).sentHeaders = sentHeaders;
        req.abort = () => {
          /* no-op for tests */
        };
        req.end = () => {
          const idx = requestQueue.findIndex((r) => r.url === url);
          if (idx === -1) {
            setTimeout(() => req.emit("error", new Error("no queued response")), 0);
            return;
          }
          const { response } = requestQueue.splice(idx, 1)[0];
          if (response === "timeout") return;
          if (response === "error") {
            setTimeout(() => req.emit("error", new Error("network")), 0);
            return;
          }
          if (response === "oversized") {
            const res = new EventEmitter() as EventEmitter;
            (res as unknown as { statusCode: number; headers: Record<string, string> }).statusCode = 200;
            (res as unknown as { statusCode: number; headers: Record<string, string> }).headers = {};
            setTimeout(() => {
              req.emit("response", res);
              setTimeout(() => res.emit("data", Buffer.from("x".repeat(300 * 1024))), 0);
            }, 0);
            return;
          }
          const res = new EventEmitter() as EventEmitter;
          (res as unknown as { statusCode: number; headers: Record<string, string> }).statusCode = response.statusCode;
          (res as unknown as { statusCode: number; headers: Record<string, string> }).headers = response.headers ?? {};
          setTimeout(() => {
            req.emit("response", res);
            if (response.body !== undefined) {
              res.emit("data", Buffer.from(response.body, "utf8"));
            }
            setTimeout(() => res.emit("end"), 0);
          }, 0);
        };
        return req;
      },
    },
  };
});

import { LlmsTxtResolver } from "@electron/services/LlmsTxtResolver";
import { LlmsTxtCacheStore } from "@electron/services/LlmsTxtCacheStore";

const tmp = useTmpDir("horizon-llms-resolver");

beforeEach(() => {
  requestQueue.length = 0;
});

describe("LlmsTxtResolver.fetchBoth: fresh path", () => {
  it("on cache miss, fetches both files in parallel and persists entry", async () => {
    enqueueResponse("https://example.com/llms.txt", {
      statusCode: 200,
      body: "# index",
      headers: { etag: '"i1"' },
    });
    enqueueResponse("https://example.com/llms-full.txt", {
      statusCode: 200,
      body: "# full",
      headers: { etag: '"f1"' },
    });
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    const result = await r.fetchBoth("https://example.com");
    expect(result.llmsTxt).toBe("# index");
    expect(result.llmsFullTxt).toBe("# full");
    expect(store.has("https://example.com")).toBe(true);
    const entry = store.get("https://example.com")!.entry;
    expect(entry.etagIndex).toBe('"i1"');
    expect(entry.etagFull).toBe('"f1"');
  });

  it("404+404 persists as a negative entry", async () => {
    enqueueResponse("https://example.com/llms.txt", { statusCode: 404 });
    enqueueResponse("https://example.com/llms-full.txt", { statusCode: 404 });
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    const result = await r.fetchBoth("https://example.com");
    expect(result.llmsTxt).toBeNull();
    expect(result.llmsFullTxt).toBeNull();
    expect(store.has("https://example.com")).toBe(true);
    const entry = store.get("https://example.com")!.entry;
    expect(entry.llmsTxt).toBeNull();
    expect(entry.llmsFullTxt).toBeNull();
  });

  it("error + error does NOT persist (transient)", async () => {
    enqueueResponse("https://example.com/llms.txt", "error");
    enqueueResponse("https://example.com/llms-full.txt", "error");
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    const result = await r.fetchBoth("https://example.com");
    expect(result.llmsTxt).toBeNull();
    expect(result.llmsFullTxt).toBeNull();
    expect(store.has("https://example.com")).toBe(false);
  });

  it("503 is classified as transient — not persisted as negative", async () => {
    enqueueResponse("https://example.com/llms.txt", { statusCode: 503 });
    enqueueResponse("https://example.com/llms-full.txt", { statusCode: 503 });
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    await r.fetchBoth("https://example.com");
    expect(store.has("https://example.com")).toBe(false);
  });

  it("oversized response is aborted and treated as transient", async () => {
    enqueueResponse("https://example.com/llms.txt", "oversized");
    enqueueResponse("https://example.com/llms-full.txt", { statusCode: 404 });
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    const result = await r.fetchBoth("https://example.com");
    expect(result.llmsTxt).toBeNull();
    expect(store.has("https://example.com")).toBe(false);
  });

  it("inflight dedup: two concurrent fetchBoth calls cause one network round", async () => {
    enqueueResponse("https://example.com/llms.txt", {
      statusCode: 200,
      body: "# index",
    });
    enqueueResponse("https://example.com/llms-full.txt", { statusCode: 404 });
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    const [a, b] = await Promise.all([
      r.fetchBoth("https://example.com"),
      r.fetchBoth("https://example.com"),
    ]);
    expect(a).toEqual(b);
    expect(requestQueue).toHaveLength(0);
  });
});

describe("LlmsTxtResolver.fetch: prefer full, fallback to index", () => {
  it("returns full when both succeed", async () => {
    enqueueResponse("https://example.com/llms.txt", {
      statusCode: 200,
      body: "# index",
    });
    enqueueResponse("https://example.com/llms-full.txt", {
      statusCode: 200,
      body: "# full",
    });
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    expect(await r.fetch("https://example.com")).toBe("# full");
  });

  it("falls back to index when full is 404", async () => {
    enqueueResponse("https://example.com/llms.txt", {
      statusCode: 200,
      body: "# index",
    });
    enqueueResponse("https://example.com/llms-full.txt", { statusCode: 404 });
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    expect(await r.fetch("https://example.com")).toBe("# index");
  });

  it("returns null when both are 404", async () => {
    enqueueResponse("https://example.com/llms.txt", { statusCode: 404 });
    enqueueResponse("https://example.com/llms-full.txt", { statusCode: 404 });
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    const r = new LlmsTxtResolver(store, () => 1000);
    expect(await r.fetch("https://example.com")).toBeNull();
  });
});

describe("LlmsTxtResolver: cache hit fast path", () => {
  it("fresh cache hit returns immediately without any network calls", async () => {
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    store.put("https://example.com", {
      llmsTxt: "# cached index",
      llmsFullTxt: "# cached full",
      fetchedAt: 1000,
    });
    const r = new LlmsTxtResolver(store, () => 1000);
    const result = await r.fetchBoth("https://example.com");
    expect(result.llmsTxt).toBe("# cached index");
    expect(result.llmsFullTxt).toBe("# cached full");
    expect(requestQueue).toHaveLength(0);
  });

  it("invalidate causes the next fetch to hit the network", async () => {
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => 1000);
    store.put("https://example.com", {
      llmsTxt: "# cached",
      llmsFullTxt: null,
      fetchedAt: 1000,
    });
    const r = new LlmsTxtResolver(store, () => 1000);
    r.invalidate("https://example.com");
    enqueueResponse("https://example.com/llms.txt", { statusCode: 200, body: "# new" });
    enqueueResponse("https://example.com/llms-full.txt", { statusCode: 404 });
    const result = await r.fetchBoth("https://example.com");
    expect(result.llmsTxt).toBe("# new");
  });
});
