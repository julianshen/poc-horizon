import { describe, it, expect, vi } from "vitest";
import { writeFileSync, existsSync, readFileSync, statSync } from "fs";
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

describe("LlmsTxtCacheStore: debounced flush", () => {
  it("flush() persists current entries to disk", async () => {
    const p = cachePath();
    const store = new LlmsTxtCacheStore(p, () => 1000);
    store.put("https://example.com", { ...baseEntry, fetchedAt: 1000 });
    await store.flush();
    expect(existsSync(p)).toBe(true);
    const onDisk = JSON.parse(readFileSync(p, "utf8"));
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.entries["https://example.com"].llmsTxt).toBe(
      "# example\n> summary",
    );
  });

  it("flush() is a no-op when nothing has changed since last save", async () => {
    const p = cachePath();
    const store = new LlmsTxtCacheStore(p, () => 1000);
    store.put("https://example.com", { ...baseEntry, fetchedAt: 1000 });
    await store.flush();
    const mtimeFirst = statSync(p).mtimeMs;
    await new Promise((r) => setTimeout(r, 5));
    await store.flush();
    const mtimeSecond = statSync(p).mtimeMs;
    expect(mtimeSecond).toBe(mtimeFirst);
  });

  it("a new construction reads back what a previous instance flushed", async () => {
    const p = cachePath();
    const store1 = new LlmsTxtCacheStore(p, () => 1000);
    store1.put("https://example.com", { ...baseEntry, fetchedAt: 1000 });
    await store1.flush();

    const store2 = new LlmsTxtCacheStore(p, () => 1000);
    const r = store2.get("https://example.com");
    expect(r?.entry.llmsTxt).toBe("# example\n> summary");
  });

  it("debounced flush coalesces rapid puts into one write", async () => {
    const p = cachePath();
    const store = new LlmsTxtCacheStore(p, () => 1000);
    store.put("https://a.com", { ...baseEntry, fetchedAt: 1000 });
    store.put("https://b.com", { ...baseEntry, fetchedAt: 1000 });
    store.put("https://c.com", { ...baseEntry, fetchedAt: 1000 });
    expect(existsSync(p)).toBe(false);
    // Wait for the debounced flush to complete (500ms + some margin)
    await new Promise((r) => setTimeout(r, 600));
    expect(existsSync(p)).toBe(true);
    const onDisk = JSON.parse(readFileSync(p, "utf8"));
    expect(Object.keys(onDisk.entries)).toHaveLength(3);
  });
});
