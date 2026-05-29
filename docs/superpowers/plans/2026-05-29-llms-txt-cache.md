# llms.txt Cache & Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-memory-only `LlmsTxtResolver` cache with a disk-backed store, HTTP-validated freshness (ETag + Last-Modified), 256 KB response cap, parallel `fetchBoth`, and stale-while-revalidate — per `docs/superpowers/specs/2026-05-29-llms-txt-cache-design.md`.

**Architecture:** Two units. `LlmsTxtCacheStore` owns the JSON file at `userData/llms-cache.json`, the schema, atomic write, and TTL math — zero HTTP awareness. `LlmsTxtResolver` keeps its current public API (`fetch`, `fetchBoth`, `invalidate`) but delegates persistence to the store and adds conditional GETs, size caps, and swr orchestration on top.

**Tech Stack:** TypeScript, Electron 33 (`net.request`), Node `fs.promises`, Vitest. Existing `useTmpDir` test helper at `tests/helpers/tmpdir.ts` provides per-test temp directories.

---

## File Structure

**Create:**
- `.electron/services/LlmsTxtCacheStore.ts` (~140 lines)
- `tests/unit/llms-txt-cache-store.test.ts`
- `tests/unit/llms-txt-resolver.test.ts`

**Modify:**
- `.electron/services/LlmsTxtResolver.ts` (refactor — most internals replaced; public API preserved)
- `.electron/main.ts` (instantiate store, pass to resolver, wire `before-quit` flush)
- `vite.config.ts` (extend `coverage.include`)

---

## Task 1: LlmsTxtCacheStore — schema, load, get with freshness

**Files:**
- Create: `.electron/services/LlmsTxtCacheStore.ts`
- Create: `tests/unit/llms-txt-cache-store.test.ts`

### Step 1: Write the failing test

Create `tests/unit/llms-txt-cache-store.test.ts`:

```ts
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
    now = 1000 + 25 * 60 * 60 * 1000; // 25h
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
    now = 8 * 24 * 60 * 60 * 1000; // 8d
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
```

### Step 2: Run tests to verify they fail

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-cache-store.test.ts`
Expected: FAIL — `Cannot find module '@electron/services/LlmsTxtCacheStore'`.

### Step 3: Implement the store (load + get + put + invalidate + bumpFetchedAt + has, no flush yet)

Create `.electron/services/LlmsTxtCacheStore.ts`:

```ts
import { readFileSync } from "fs";

export interface CacheEntry {
  llmsTxt: string | null;
  llmsFullTxt: string | null;
  etagIndex?: string;
  etagFull?: string;
  lastModifiedIndex?: string;
  lastModifiedFull?: string;
  fetchedAt: number;
}

interface LlmsCacheFile {
  schemaVersion: 1;
  entries: Record<string, CacheEntry>;
}

export type Freshness = "fresh" | "stale";

export interface GetResult {
  entry: CacheEntry;
  freshness: Freshness;
}

const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class LlmsTxtCacheStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private entries: Record<string, CacheEntry> = {};

  constructor(filePath: string, now: () => number = Date.now) {
    this.filePath = filePath;
    this.now = now;
    this.loadSync();
  }

  private loadSync(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return;
      console.warn(
        "[llms-cache] failed to read cache, starting fresh:",
        (err as Error).message,
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(
        "[llms-cache] cache file is not valid JSON, starting fresh:",
        (err as Error).message,
      );
      return;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as LlmsCacheFile).schemaVersion !== 1 ||
      typeof (parsed as LlmsCacheFile).entries !== "object" ||
      (parsed as LlmsCacheFile).entries === null
    ) {
      console.warn("[llms-cache] ignoring incompatible cache file");
      return;
    }
    this.entries = (parsed as LlmsCacheFile).entries;
  }

  get(origin: string): GetResult | null {
    const entry = this.entries[origin];
    if (!entry) return null;
    const age = this.now() - entry.fetchedAt;
    const isNegative = entry.llmsTxt === null && entry.llmsFullTxt === null;
    const ttl = isNegative ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
    return { entry, freshness: age < ttl ? "fresh" : "stale" };
  }

  put(origin: string, entry: CacheEntry): void {
    this.entries[origin] = entry;
  }

  bumpFetchedAt(origin: string): void {
    const entry = this.entries[origin];
    if (!entry) return;
    entry.fetchedAt = this.now();
  }

  invalidate(origin: string): void {
    delete this.entries[origin];
  }

  has(origin: string): boolean {
    return origin in this.entries;
  }
}
```

### Step 4: Run tests, confirm they pass

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-cache-store.test.ts`
Expected: PASS (all cases).

### Step 5: Commit

```bash
cd /Users/julianshen/prj/mybrowser
git add .electron/services/LlmsTxtCacheStore.ts tests/unit/llms-txt-cache-store.test.ts
git commit -m "feat: LlmsTxtCacheStore schema and TTL math

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: LlmsTxtCacheStore — debounced atomic flush

**Files:**
- Modify: `.electron/services/LlmsTxtCacheStore.ts`
- Modify: `tests/unit/llms-txt-cache-store.test.ts`

### Step 1: Append failing tests

Append to `tests/unit/llms-txt-cache-store.test.ts`:

```ts
import { existsSync, readFileSync as readSync } from "fs";

describe("LlmsTxtCacheStore: debounced flush", () => {
  it("flush() persists current entries to disk", async () => {
    const p = cachePath();
    const store = new LlmsTxtCacheStore(p, () => 1000);
    store.put("https://example.com", { ...baseEntry, fetchedAt: 1000 });
    await store.flush();
    expect(existsSync(p)).toBe(true);
    const onDisk = JSON.parse(readSync(p, "utf8"));
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
    const mtimeFirst = (await import("fs")).statSync(p).mtimeMs;
    // Wait 5ms so any new write would have a distinguishable mtime.
    await new Promise((r) => setTimeout(r, 5));
    await store.flush();
    const mtimeSecond = (await import("fs")).statSync(p).mtimeMs;
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
    vi.useFakeTimers();
    const p = cachePath();
    const store = new LlmsTxtCacheStore(p, () => 1000);
    store.put("https://a.com", { ...baseEntry, fetchedAt: 1000 });
    store.put("https://b.com", { ...baseEntry, fetchedAt: 1000 });
    store.put("https://c.com", { ...baseEntry, fetchedAt: 1000 });
    expect(existsSync(p)).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(existsSync(p)).toBe(true);
    const onDisk = JSON.parse(readSync(p, "utf8"));
    expect(Object.keys(onDisk.entries)).toHaveLength(3);
    vi.useRealTimers();
  });
});
```

### Step 2: Run, expect failure

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-cache-store.test.ts -t "debounced flush"`
Expected: FAIL — `store.flush is not a function`.

### Step 3: Add flush + debounced scheduling

Edit `.electron/services/LlmsTxtCacheStore.ts`:

Add at the top of the file, with the other imports:

```ts
import { promises as fs } from "fs";
```

Add private fields to the class:

```ts
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedJson = "";
```

Add a private scheduler method:

```ts
  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, 500);
  }
```

Add the public `flush` method:

```ts
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const json = JSON.stringify({ schemaVersion: 1, entries: this.entries });
    if (json === this.lastSavedJson) return;
    const tmpPath = this.filePath + ".tmp";
    try {
      await fs.writeFile(tmpPath, json, "utf8");
      await fs.rename(tmpPath, this.filePath);
      this.lastSavedJson = json;
    } catch (err) {
      console.warn(
        "[llms-cache] failed to persist cache:",
        (err as Error).message,
      );
    }
  }
```

Update `loadSync` to set `this.lastSavedJson = raw` after successfully loading entries (so the very first `flush()` after construction is a no-op if nothing's changed):

```ts
    this.entries = (parsed as LlmsCacheFile).entries;
    this.lastSavedJson = raw;
```

Update `put`, `bumpFetchedAt`, and `invalidate` to call `this.scheduleFlush()` after their mutation:

```ts
  put(origin: string, entry: CacheEntry): void {
    this.entries[origin] = entry;
    this.scheduleFlush();
  }

  bumpFetchedAt(origin: string): void {
    const entry = this.entries[origin];
    if (!entry) return;
    entry.fetchedAt = this.now();
    this.scheduleFlush();
  }

  invalidate(origin: string): void {
    if (!(origin in this.entries)) return;
    delete this.entries[origin];
    this.scheduleFlush();
  }
```

### Step 4: Run tests, all pass

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-cache-store.test.ts`
Expected: PASS (all cases including the new ones).

### Step 5: Commit

```bash
cd /Users/julianshen/prj/mybrowser
git add .electron/services/LlmsTxtCacheStore.ts tests/unit/llms-txt-cache-store.test.ts
git commit -m "feat(LlmsTxtCacheStore): debounced atomic flush

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Refactor LlmsTxtResolver — accept store; tryGet with 256 KB cap and status discrimination

**Files:**
- Modify: `.electron/services/LlmsTxtResolver.ts`
- Create: `tests/unit/llms-txt-resolver.test.ts`

This task changes the resolver's constructor signature and rebuilds the network helper from scratch. Tasks 4 and 5 build on top.

### Step 1: Write the failing test

Create `tests/unit/llms-txt-resolver.test.ts`:

```ts
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
  headers: Record<string, string>;
  response: MockResponse | "timeout" | "error" | "oversized";
}> = [];

function enqueueResponse(
  url: string,
  response: MockResponse | "timeout" | "error" | "oversized",
  headers: Record<string, string> = {},
): void {
  requestQueue.push({ url, headers, response });
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
        const headers: Record<string, string> = {};
        req.setHeader = (k, v) => {
          headers[k.toLowerCase()] = v;
        };
        req.abort = () => {
          /* no-op for tests */
        };
        req.end = () => {
          // Look up the queued response for this URL.
          const idx = requestQueue.findIndex((r) => r.url === url);
          if (idx === -1) {
            setTimeout(() => req.emit("error", new Error("no queued response")), 0);
            return;
          }
          const { response } = requestQueue.splice(idx, 1)[0];
          // Save which headers the caller sent (for assertion).
          (req as unknown as { __sentHeaders: Record<string, string> }).__sentHeaders =
            headers;
          if (response === "timeout") return; // never resolves; relies on resolver's 3s timer
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
              // Emit 300 KB in one chunk to trip the 256 KB cap.
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
    // index was "error" (oversized → error); full was 404 → not a definitive
    // both-404 case → entry NOT persisted.
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
    expect(requestQueue).toHaveLength(0); // both were consumed once
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
```

### Step 2: Run, expect failure

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-resolver.test.ts`
Expected: FAIL — constructor signature mismatch and behavior gaps. Several tests fail.

### Step 3: Refactor `.electron/services/LlmsTxtResolver.ts`

Replace the entire file content with:

```ts
import { net } from "electron";
import {
  LlmsTxtCacheStore,
  CacheEntry,
} from "./LlmsTxtCacheStore";

/**
 * llms.txt / llms-full.txt resolver.
 *
 * Delegates persistence and TTL math to LlmsTxtCacheStore. Owns the
 * network: parallel GETs for /llms.txt and /llms-full.txt, conditional
 * revalidation via If-None-Match / If-Modified-Since, 256 KB per-body
 * cap, and stale-while-revalidate orchestration.
 */

const MAX_BODY_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 3000;

interface ConditionalHeaders {
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}

interface TryGetResult {
  status: 200 | 304 | 404 | "error";
  body: string | null;
  etag?: string;
  lastModified?: string;
}

export class LlmsTxtResolver {
  private readonly store: LlmsTxtCacheStore;
  private readonly now: () => number;
  private inflightBoth = new Map<
    string,
    Promise<{ llmsTxt: string | null; llmsFullTxt: string | null }>
  >();
  private inflightRevalidate = new Set<string>();

  constructor(store: LlmsTxtCacheStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  async fetch(origin: string): Promise<string | null> {
    const both = await this.fetchBoth(origin);
    return both.llmsFullTxt ?? both.llmsTxt;
  }

  async fetchBoth(
    origin: string,
  ): Promise<{ llmsTxt: string | null; llmsFullTxt: string | null }> {
    const cached = this.store.get(origin);
    if (cached) {
      if (cached.freshness === "stale") {
        this.scheduleRevalidate(origin, cached.entry);
      }
      return {
        llmsTxt: cached.entry.llmsTxt,
        llmsFullTxt: cached.entry.llmsFullTxt,
      };
    }
    const existing = this.inflightBoth.get(origin);
    if (existing) return existing;
    const p = this.doFreshFetch(origin);
    this.inflightBoth.set(origin, p);
    try {
      return await p;
    } finally {
      this.inflightBoth.delete(origin);
    }
  }

  invalidate(origin: string): void {
    this.store.invalidate(origin);
  }

  private async doFreshFetch(
    origin: string,
  ): Promise<{ llmsTxt: string | null; llmsFullTxt: string | null }> {
    const [indexResult, fullResult] = await Promise.all([
      this.tryGet(`${origin}/llms.txt`),
      this.tryGet(`${origin}/llms-full.txt`),
    ]);

    const isPersistable =
      indexResult.status === 200 ||
      fullResult.status === 200 ||
      (indexResult.status === 404 && fullResult.status === 404);

    if (isPersistable) {
      const entry = this.buildEntry(indexResult, fullResult, this.now());
      this.store.put(origin, entry);
    }

    return {
      llmsTxt: indexResult.status === 200 ? indexResult.body : null,
      llmsFullTxt: fullResult.status === 200 ? fullResult.body : null,
    };
  }

  private scheduleRevalidate(origin: string, _existing: CacheEntry): void {
    if (this.inflightRevalidate.has(origin)) return;
    this.inflightRevalidate.add(origin);
    // Filled in by Task 5.
    void Promise.resolve().finally(() => {
      this.inflightRevalidate.delete(origin);
    });
  }

  private buildEntry(
    indexResult: TryGetResult,
    fullResult: TryGetResult,
    fetchedAt: number,
  ): CacheEntry {
    const entry: CacheEntry = {
      llmsTxt: indexResult.status === 200 ? indexResult.body : null,
      llmsFullTxt: fullResult.status === 200 ? fullResult.body : null,
      fetchedAt,
    };
    if (indexResult.status === 200) {
      if (indexResult.etag) entry.etagIndex = indexResult.etag;
      if (indexResult.lastModified) entry.lastModifiedIndex = indexResult.lastModified;
    }
    if (fullResult.status === 200) {
      if (fullResult.etag) entry.etagFull = fullResult.etag;
      if (fullResult.lastModified) entry.lastModifiedFull = fullResult.lastModified;
    }
    return entry;
  }

  private tryGet(
    url: string,
    conditional?: ConditionalHeaders,
  ): Promise<TryGetResult> {
    return new Promise((resolve) => {
      const req = net.request({ method: "GET", url, redirect: "follow" });
      if (conditional?.ifNoneMatch) req.setHeader("If-None-Match", conditional.ifNoneMatch);
      if (conditional?.ifModifiedSince) req.setHeader("If-Modified-Since", conditional.ifModifiedSince);

      let body = "";
      let aborted = false;
      const timer = setTimeout(() => {
        aborted = true;
        req.abort();
        resolve({ status: "error", body: null });
      }, REQUEST_TIMEOUT_MS);

      req.on("response", (res) => {
        const status = res.statusCode;
        const headers = res.headers as Record<string, string | string[]>;
        const etag = first(headers["etag"]);
        const lastModified = first(headers["last-modified"]);

        if (status === 304) {
          clearTimeout(timer);
          resolve({ status: 304, body: null, etag, lastModified });
          return;
        }
        if (status >= 200 && status < 300) {
          res.on("data", (chunk: Buffer) => {
            if (aborted) return;
            body += chunk.toString("utf8");
            if (body.length > MAX_BODY_BYTES) {
              aborted = true;
              clearTimeout(timer);
              req.abort();
              resolve({ status: "error", body: null });
            }
          });
          res.on("end", () => {
            if (aborted) return;
            clearTimeout(timer);
            resolve({ status: 200, body, etag, lastModified });
          });
          res.on("error", () => {
            if (aborted) return;
            aborted = true;
            clearTimeout(timer);
            resolve({ status: "error", body: null });
          });
          return;
        }
        // Any 4xx → definitive "not present". Any 5xx → transient.
        clearTimeout(timer);
        if (status >= 400 && status < 500) {
          resolve({ status: 404, body: null });
        } else {
          resolve({ status: "error", body: null });
        }
      });

      req.on("error", () => {
        if (aborted) return;
        aborted = true;
        clearTimeout(timer);
        resolve({ status: "error", body: null });
      });

      req.end();
    });
  }
}

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
```

### Step 4: Run tests, all pass

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-resolver.test.ts`
Expected: PASS for fresh-path tests. (Tests for stale/revalidate live in Task 5.)

Also re-run cache store tests to confirm they still pass:

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-cache-store.test.ts`
Expected: PASS.

### Step 5: Commit

```bash
cd /Users/julianshen/prj/mybrowser
git add .electron/services/LlmsTxtResolver.ts tests/unit/llms-txt-resolver.test.ts
git commit -m "refactor(LlmsTxtResolver): delegate persistence to LlmsTxtCacheStore

Adds 256KB cap, 4xx-vs-5xx classification, parallel fetchBoth, and
the no-persist-on-transient rule. Stale-while-revalidate scaffolding
is in place but inert; Task 5 fills it in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Cache hit fast path — verify no network on fresh hits

**Files:**
- Modify: `tests/unit/llms-txt-resolver.test.ts`

The resolver already returns cached bodies without calling `tryGet` on fresh hits — Task 3's `fetchBoth` checks the store first. This task is purely an assertion layer.

### Step 1: Append failing tests

Append to `tests/unit/llms-txt-resolver.test.ts`:

```ts
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
    expect(requestQueue).toHaveLength(0); // none consumed; none enqueued either
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
```

### Step 2: Run tests, expect them to pass

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-resolver.test.ts -t "fast path"`
Expected: PASS.

### Step 3: Commit

```bash
cd /Users/julianshen/prj/mybrowser
git add tests/unit/llms-txt-resolver.test.ts
git commit -m "test(LlmsTxtResolver): assert fresh hits skip the network

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Stale-while-revalidate with conditional headers

**Files:**
- Modify: `.electron/services/LlmsTxtResolver.ts`
- Modify: `tests/unit/llms-txt-resolver.test.ts`

### Step 1: Append failing tests

Append to `tests/unit/llms-txt-resolver.test.ts`:

```ts
async function settle(): Promise<void> {
  // Let pending microtasks + the resolver's internal setTimeout(0)
  // chain in the EE-based mock drain.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe("LlmsTxtResolver: stale-while-revalidate", () => {
  it("stale hit returns cached immediately and fires revalidation in background", async () => {
    let now = 1000;
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => now);
    store.put("https://example.com", {
      llmsTxt: "# old index",
      llmsFullTxt: "# old full",
      etagIndex: '"i1"',
      etagFull: '"f1"',
      fetchedAt: 1000,
    });
    // Advance past 24h TTL so the cached entry is stale.
    now = 1000 + 25 * 60 * 60 * 1000;
    const r = new LlmsTxtResolver(store, () => now);

    enqueueResponse("https://example.com/llms.txt", {
      statusCode: 200,
      body: "# new index",
      headers: { etag: '"i2"' },
    });
    enqueueResponse("https://example.com/llms-full.txt", {
      statusCode: 304,
    });

    // Caller gets cached bodies immediately.
    const result = await r.fetchBoth("https://example.com");
    expect(result.llmsTxt).toBe("# old index");
    expect(result.llmsFullTxt).toBe("# old full");

    // Let background revalidation drain.
    await settle();

    const updated = store.get("https://example.com")!.entry;
    expect(updated.llmsTxt).toBe("# new index");      // 200 replaced body
    expect(updated.etagIndex).toBe('"i2"');
    expect(updated.llmsFullTxt).toBe("# old full");   // 304 kept body
    expect(updated.etagFull).toBe('"f1"');
    // fetchedAt was bumped to current `now`.
    expect(updated.fetchedAt).toBe(now);
  });

  it("revalidation network error keeps existing bodies and bumps fetchedAt", async () => {
    let now = 1000;
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => now);
    store.put("https://example.com", {
      llmsTxt: "# old",
      llmsFullTxt: null,
      etagIndex: '"i1"',
      fetchedAt: 1000,
    });
    now = 1000 + 25 * 60 * 60 * 1000;
    const r = new LlmsTxtResolver(store, () => now);

    enqueueResponse("https://example.com/llms.txt", "error");
    enqueueResponse("https://example.com/llms-full.txt", "error");

    await r.fetchBoth("https://example.com");
    await settle();

    const e = store.get("https://example.com")!.entry;
    expect(e.llmsTxt).toBe("# old"); // unchanged
    expect(e.fetchedAt).toBe(now);   // bumped
  });

  it("conditional revalidation sends If-None-Match when ETag is stored", async () => {
    let now = 1000;
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => now);
    store.put("https://example.com", {
      llmsTxt: "# cached",
      llmsFullTxt: null,
      etagIndex: '"abc"',
      fetchedAt: 1000,
    });
    now = 1000 + 25 * 60 * 60 * 1000;
    const r = new LlmsTxtResolver(store, () => now);

    let sentHeaders: Record<string, string> | undefined;
    requestQueue.push({
      url: "https://example.com/llms.txt",
      headers: {},
      response: { statusCode: 304 },
    });
    requestQueue.push({
      url: "https://example.com/llms-full.txt",
      headers: {},
      response: { statusCode: 404 },
    });
    // Intercept the mock to capture the headers actually sent on the
    // index request (the EventEmitter mock stashes them on the req).
    const origReq = (await import("electron")).net.request;
    vi.spyOn((await import("electron")).net, "request").mockImplementation(
      ((opts: { url: string }) => {
        const req = origReq(opts) as unknown as {
          setHeader: (k: string, v: string) => void;
          __sentHeaders?: Record<string, string>;
          end: () => void;
        };
        const orig = req.setHeader.bind(req);
        req.setHeader = (k: string, v: string) => {
          if (opts.url.endsWith("/llms.txt") && !opts.url.endsWith("/llms-full.txt")) {
            sentHeaders = { ...(sentHeaders ?? {}), [k]: v };
          }
          orig(k, v);
        };
        return req as never;
      }) as never,
    );

    await r.fetchBoth("https://example.com");
    await settle();

    expect(sentHeaders?.["If-None-Match"]).toBe('"abc"');
    vi.restoreAllMocks();
  });

  it("concurrent stale hits trigger only one revalidation", async () => {
    let now = 1000;
    const store = new LlmsTxtCacheStore(tmp.path("c.json"), () => now);
    store.put("https://example.com", {
      llmsTxt: "# cached",
      llmsFullTxt: null,
      fetchedAt: 1000,
    });
    now = 1000 + 25 * 60 * 60 * 1000;
    const r = new LlmsTxtResolver(store, () => now);

    enqueueResponse("https://example.com/llms.txt", { statusCode: 304 });
    enqueueResponse("https://example.com/llms-full.txt", { statusCode: 404 });
    // If a second revalidation fired, it would find an empty queue and crash.
    // The dedup must prevent this — no second pair enqueued.

    await Promise.all([
      r.fetchBoth("https://example.com"),
      r.fetchBoth("https://example.com"),
      r.fetchBoth("https://example.com"),
    ]);
    await settle();

    expect(requestQueue).toHaveLength(0);
  });
});
```

### Step 2: Run tests, expect failures

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-resolver.test.ts -t "stale-while-revalidate"`
Expected: FAIL — revalidation is a no-op stub from Task 3.

### Step 3: Implement `scheduleRevalidate`

Edit `.electron/services/LlmsTxtResolver.ts`. Replace the placeholder `scheduleRevalidate` and add a `doRevalidate` method:

```ts
  private scheduleRevalidate(origin: string, existing: CacheEntry): void {
    if (this.inflightRevalidate.has(origin)) return;
    this.inflightRevalidate.add(origin);
    void this.doRevalidate(origin, existing).finally(() => {
      this.inflightRevalidate.delete(origin);
    });
  }

  private async doRevalidate(
    origin: string,
    existing: CacheEntry,
  ): Promise<void> {
    const [indexResult, fullResult] = await Promise.all([
      this.tryGet(`${origin}/llms.txt`, {
        ifNoneMatch: existing.etagIndex,
        ifModifiedSince: existing.lastModifiedIndex,
      }),
      this.tryGet(`${origin}/llms-full.txt`, {
        ifNoneMatch: existing.etagFull,
        ifModifiedSince: existing.lastModifiedFull,
      }),
    ]);

    const merged: CacheEntry = { ...existing, fetchedAt: this.now() };
    applyPerFile(merged, "Index", indexResult);
    applyPerFile(merged, "Full", fullResult);
    this.store.put(origin, merged);
  }
```

Add (top-level, below the `first` helper at the bottom of the file):

```ts
function applyPerFile(
  merged: CacheEntry,
  kind: "Index" | "Full",
  result: TryGetResult,
): void {
  const bodyKey = kind === "Index" ? "llmsTxt" : "llmsFullTxt";
  const etagKey = kind === "Index" ? "etagIndex" : "etagFull";
  const lmKey = kind === "Index" ? "lastModifiedIndex" : "lastModifiedFull";
  switch (result.status) {
    case 200:
      merged[bodyKey] = result.body;
      if (result.etag) {
        merged[etagKey] = result.etag;
      } else {
        delete merged[etagKey];
      }
      if (result.lastModified) {
        merged[lmKey] = result.lastModified;
      } else {
        delete merged[lmKey];
      }
      break;
    case 304:
      // Keep existing body/etag/lm.
      break;
    case 404:
      merged[bodyKey] = null;
      delete merged[etagKey];
      delete merged[lmKey];
      break;
    case "error":
      // Keep existing fields. Outer scope bumps fetchedAt.
      break;
  }
}
```

### Step 4: Run tests, all pass

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run tests/unit/llms-txt-resolver.test.ts`
Expected: PASS (all describe blocks, including the new ones).

### Step 5: Commit

```bash
cd /Users/julianshen/prj/mybrowser
git add .electron/services/LlmsTxtResolver.ts tests/unit/llms-txt-resolver.test.ts
git commit -m "feat(LlmsTxtResolver): stale-while-revalidate with conditional GETs

Stale cache hits return cached bodies immediately and fire a background
revalidation that sends If-None-Match / If-Modified-Since. 304 keeps
existing content, 200 replaces, 404 nulls, error keeps content. All
paths bump fetchedAt to prevent re-hammering on every read.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire into main.ts

**Files:**
- Modify: `.electron/main.ts`

### Step 1: Inspect the wiring point

Run: `cd /Users/julianshen/prj/mybrowser && grep -n "llmsTxtResolver\|LlmsTxtResolver\|before-quit" .electron/main.ts | head -15`
Expected: shows the singleton at line ~116 and the existing `LlmsTxtResolver` import.

### Step 2: Add the store import and the wiring

Edit `.electron/main.ts`. Add this import near the existing `LlmsTxtResolver` import:

```ts
import { LlmsTxtCacheStore } from "./services/LlmsTxtCacheStore";
```

Replace the existing singleton declaration:

```ts
const llmsTxtResolver = new LlmsTxtResolver();
```

with a two-step initialization. The cache path needs `app.getPath("userData")`, which is only valid after `app.whenReady()` per Electron's docs. Look at the file for where other userData-bound managers (`SettingsManager`, `BookmarkManager`, `HistoryManager`) are constructed inside `initSingletons()` — that's the right place.

Find `initSingletons` (around line 317) and add the resolver init alongside the other managers. Change the declaration at the top of the file from a const initializer to a `let` placeholder:

```ts
let llmsTxtCacheStore: LlmsTxtCacheStore;
let llmsTxtResolver: LlmsTxtResolver;
```

Then inside `initSingletons()`, add (placement: after the `settingsManager` line, with the other `path.join(data, ...)` constructors):

```ts
  llmsTxtCacheStore = new LlmsTxtCacheStore(
    path.join(data, "llms-cache.json"),
  );
  llmsTxtResolver = new LlmsTxtResolver(llmsTxtCacheStore);
```

### Step 3: Wire `before-quit` flush

In `.electron/main.ts`, find the existing `before-quit` handler (search for `before-quit`). If there is one, add `await llmsTxtCacheStore?.flush();` near other persistence-related flushes. If there isn't one, add a new handler near the `app.on("window-all-closed", ...)` registration:

```ts
app.on("before-quit", async (event) => {
  if (llmsTxtCacheStore) {
    event.preventDefault();
    try {
      await llmsTxtCacheStore.flush();
    } catch {
      /* best-effort persistence */
    }
    app.exit(0);
  }
});
```

Inspect the existing patterns first — if there's already a `before-quit` handler doing other cleanup, append the flush call to that handler instead of creating a competing one. Run:

```
cd /Users/julianshen/prj/mybrowser && grep -n "before-quit\|persistableTabManagers\|tabSessionStore" .electron/main.ts | head -10
```

The existing `persistableTabManagers` cleanup at line ~377 already handles tab persistence in `before-quit`. Add the cache flush to the same handler rather than creating a second one.

### Step 4: Build

Run: `cd /Users/julianshen/prj/mybrowser && npm run build 2>&1 | tail -10`
Expected: build succeeds. The relevant `main.ts` file compiles without new errors.

### Step 5: Run the full test suite

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run`
Expected: all green, including the existing `tests/unit/llms-txt-parser.test.ts`, `tests/unit/useLlmsTxtGuide.test.tsx`, `tests/unit/piSkillWriter.test.ts`, `tests/unit/AIPanel.test.tsx`.

### Step 6: Commit

```bash
cd /Users/julianshen/prj/mybrowser
git add .electron/main.ts
git commit -m "feat(main): instantiate LlmsTxtCacheStore and wire before-quit flush

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Extend coverage scope

**Files:**
- Modify: `vite.config.ts`

### Step 1: Add the two new files to `coverage.include`

Edit `vite.config.ts`. In the `coverage.include` array (the same one that lists `HibernationController.ts` and the other `.electron/services/*.ts` entries), add:

```ts
".electron/services/LlmsTxtCacheStore.ts",
".electron/services/LlmsTxtResolver.ts",
```

### Step 2: Run coverage

Run: `cd /Users/julianshen/prj/mybrowser && npm run test:coverage 2>&1 | tail -40`

Look at the per-file rows for `LlmsTxtCacheStore.ts` and `LlmsTxtResolver.ts`. Confirm both ≥90% on lines/branches/functions/statements.

If `LlmsTxtResolver.ts` is below 90% on branches, the most likely uncovered paths are:
- `If-Modified-Since` branch in `tryGet` (we tested `If-None-Match` but not `If-Modified-Since`)
- `applyPerFile` error branch

Add targeted tests if needed.

### Step 3: Confirm overall threshold passes

The summary line at the end of the coverage output should show all four metrics ≥90% globally. If it doesn't pass and the regression is in one of these two new files, fix coverage. If it's in unrelated existing files, that's pre-existing debt — note it in the commit message and don't try to fix unrelated coverage gaps.

### Step 4: Commit

```bash
cd /Users/julianshen/prj/mybrowser
git add vite.config.ts
git commit -m "test: include LlmsTxtCacheStore and LlmsTxtResolver in coverage scope

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Smoke verification

**Files:** none — verification only.

### Step 1: Full test suite

Run: `cd /Users/julianshen/prj/mybrowser && npx vitest run`
Expected: all green.

### Step 2: Build

Run: `cd /Users/julianshen/prj/mybrowser && npm run build`
Expected: succeeds.

### Step 3: Lint

Run: `cd /Users/julianshen/prj/mybrowser && npm run lint`
Expected: no new errors (pre-existing `escapeAttr` / `llmsFullTxt` warnings per CLAUDE.md "Known config debt" are unchanged).

### Step 4: Manual smoke (optional — user-driven)

1. Delete any existing cache file: `rm -f ~/Library/Application\ Support/Horizon/llms-cache.json`
2. `npm run dev`
3. Navigate to a site with llms.txt (e.g., `https://docs.anthropic.com/`).
4. AI panel guide card should appear (existing behavior).
5. Quit and relaunch the app.
6. Re-navigate to the same site. The guide should appear *without* a visible re-fetch (cache hit). Confirm `~/Library/Application Support/Horizon/llms-cache.json` exists and contains the origin's entry.

### Step 5: Final commit if any tweaks were needed

```bash
cd /Users/julianshen/prj/mybrowser
git status
# If anything changed during smoke testing:
git add -p
git commit -m "fix: <whatever needed adjustment>"
```

---

## Done

The path is now wired: navigation triggers `resolver.fetchBoth(origin)` → cache hit returns immediately (no network) → cache miss fetches both files in parallel with the 256 KB cap → stale hit returns cached bodies + background revalidation with conditional headers. The `before-quit` handler flushes pending mutations to disk atomically. App restart sees the same cache.
