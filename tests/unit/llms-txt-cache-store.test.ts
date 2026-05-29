import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "fs";
import { LlmsTxtCacheStore } from "@electron/services/LlmsTxtCacheStore";
import { useTmpDir } from "../helpers/tmpdir";

const tmp = useTmpDir("horizon-llms-cache");
const cachePath = () => tmp.path("llms-cache.json");

const baseEntry = {
  llmsTxt: "# example\n> summary",
  llmsFullTxt: null as string | null,
  etagIndex: '"abc123"',
  etagFull: undefined,
  lastModifiedIndex: "Wed, 21 May 2026 07:28:00 GMT",
  lastModifiedFull: undefined,
  fetchedAt: 0,
};

describe("LlmsTxtCacheStore: load + get", () => {
  it("get returns null when no entry exists", () => {
    const store = new LlmsTxtCacheStore(cachePath(), () => 0);
    expect(store.get("https://example.com")).toBeNull();
  });

  it("returns 'fresh' for an entry within 24h", () => {
    const store = new LlmsTxtCacheStore(cachePath(), () => 1000);
    store.put("https://example.com", { ...baseEntry, fetchedAt: 1000 });
    const r = store.get("https://example.com");
    expect(r?.freshness).toBe("fresh");
    expect(r?.entry.llmsTxt).toBe("# example\n> summary");
  });

  it("returns 'stale' after 24h for a positive entry", () => {
    let now = 1000;
    const store = new LlmsTxtCacheStore(cachePath(), () => now);
    store.put("https://example.com", { ...baseEntry, fetchedAt: 1000 });
    now = 1000 + 25 * 60 * 60 * 1000;
    expect(store.get("https://example.com")?.freshness).toBe("stale");
  });

  it("returns 'fresh' for a negative entry within 7d", () => {
    const store = new LlmsTxtCacheStore(cachePath(), () => 0);
    store.put("https://example.com", {
      llmsTxt: null,
      llmsFullTxt: null,
      fetchedAt: 0,
    });
    expect(store.get("https://example.com")?.freshness).toBe("fresh");
  });

  it("returns 'stale' after 7d for a negative entry", () => {
    let now = 0;
    const store = new LlmsTxtCacheStore(cachePath(), () => now);
    store.put("https://example.com", {
      llmsTxt: null,
      llmsFullTxt: null,
      fetchedAt: 0,
    });
    now = 8 * 24 * 60 * 60 * 1000;
    expect(store.get("https://example.com")?.freshness).toBe("stale");
  });

  it("loads entries from an existing well-formed file at construction", () => {
    const p = cachePath();
    writeFileSync(
      p,
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          "https://example.com": { ...baseEntry, fetchedAt: 500 },
        },
      }),
      "utf8",
    );
    const store = new LlmsTxtCacheStore(p, () => 1000);
    const r = store.get("https://example.com");
    expect(r?.entry.fetchedAt).toBe(500);
  });

  it("ignores a malformed file and starts with empty entries", () => {
    const p = cachePath();
    writeFileSync(p, "{not json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new LlmsTxtCacheStore(p, () => 0);
    expect(store.get("https://example.com")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores a wrong-schemaVersion file", () => {
    const p = cachePath();
    writeFileSync(
      p,
      JSON.stringify({ schemaVersion: 999, entries: {} }),
      "utf8",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new LlmsTxtCacheStore(p, () => 0);
    expect(store.get("https://example.com")).toBeNull();
    warn.mockRestore();
  });
});

describe("LlmsTxtCacheStore: invalidate / has / bumpFetchedAt", () => {
  it("invalidate removes the entry", () => {
    const store = new LlmsTxtCacheStore(cachePath(), () => 0);
    store.put("https://example.com", { ...baseEntry, fetchedAt: 0 });
    expect(store.has("https://example.com")).toBe(true);
    store.invalidate("https://example.com");
    expect(store.has("https://example.com")).toBe(false);
    expect(store.get("https://example.com")).toBeNull();
  });

  it("bumpFetchedAt updates timestamp without changing content", () => {
    let now = 1000;
    const store = new LlmsTxtCacheStore(cachePath(), () => now);
    store.put("https://example.com", { ...baseEntry, fetchedAt: 1000 });
    now = 1000 + 25 * 60 * 60 * 1000;
    expect(store.get("https://example.com")?.freshness).toBe("stale");
    store.bumpFetchedAt("https://example.com");
    const r = store.get("https://example.com");
    expect(r?.freshness).toBe("fresh");
    expect(r?.entry.llmsTxt).toBe("# example\n> summary");
  });

  it("bumpFetchedAt is a no-op for unknown origin", () => {
    const store = new LlmsTxtCacheStore(cachePath(), () => 1000);
    expect(() => store.bumpFetchedAt("https://nope.com")).not.toThrow();
  });
});
