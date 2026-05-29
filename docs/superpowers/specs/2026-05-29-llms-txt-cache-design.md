# llms.txt Cache & Freshness — Design Spec

**Date:** 2026-05-29
**Status:** Approved, ready for implementation plan
**Sub-project:** A of 4 (cache hygiene). B (skill lifecycle), C (smarter agent context), D (user curation) are independent follow-ups.

## 1. Goal

Replace the in-memory-only `LlmsTxtResolver` with a disk-backed cache that survives app restarts, validates content with HTTP conditional requests, and defends against oversized responses. Keep the resolver's public API (`fetch`, `fetchBoth`, `invalidate`) so callers — `handleNavigateForLlmsTxt`, AI turn prompt augmentation, `piSkillWriter` — need no changes.

Today's behavior:

- Every app restart re-fetches every origin (`Map`-backed cache).
- No freshness model: cache lives forever within a session.
- No protocol awareness: refetches send unconditional `GET`s, wasting bandwidth and server resources for unchanged files.
- No size guard: a 100 MB response is bounded only by the 3-second timeout.

Target behavior:

- Disk-persistent cache at `userData/llms-cache.json`, atomic writes.
- 24-hour fast-path TTL on hits (no network), then conditional revalidation via `If-None-Match` / `If-Modified-Since`.
- 7-day TTL on confirmed 404s (negative cache), distinguished from transient errors which are NOT cached as negatives.
- 256 KB hard cap per response body.
- Parallel fetch of `/llms.txt` and `/llms-full.txt` (today: sequential).
- Stale-while-revalidate: stale hits return cached content immediately and refresh in the background.

## 2. Architecture

Two units. Each has one responsibility and is testable in isolation.

```
┌─────────────────────────────────────────────────────────────────┐
│  main.ts                                                        │
│   const cacheStore = new LlmsTxtCacheStore(                     │
│     path.join(userData, "llms-cache.json")                      │
│   );                                                            │
│   const llmsTxtResolver = new LlmsTxtResolver(cacheStore);      │
│   app.on("before-quit", () => cacheStore.flush());              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LlmsTxtResolver  (network + freshness orchestration)           │
│   - inflight dedup, swr, conditional headers, 256 KB cap        │
│   - public API unchanged: fetch, fetchBoth, invalidate          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  LlmsTxtCacheStore  (disk + schema + TTL math)                  │
│   - load at construction, debounced atomic save                 │
│   - get/put/bumpFetchedAt/invalidate/flush, no HTTP awareness   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 LlmsTxtCacheStore

Lives in `.electron/services/LlmsTxtCacheStore.ts`. Owns the JSON file, schema, TTL math, atomic write. Zero HTTP awareness.

Constructor: `new LlmsTxtCacheStore(filePath: string, now?: () => number)`. The `now` injection point exists so tests can drive TTL transitions without `setTimeout`; defaults to `Date.now`.

Public API:

```ts
get(origin: string): { entry: CacheEntry; freshness: "fresh" | "stale" } | null;
put(origin: string, entry: CacheEntry): void;
bumpFetchedAt(origin: string): void;
invalidate(origin: string): void;
has(origin: string): boolean;
flush(): Promise<void>;
```

`get` and `has` are synchronous — entries live in memory, loaded once at construction. `put` / `bumpFetchedAt` / `invalidate` mutate the in-memory copy synchronously and schedule a 500 ms debounced disk flush. `flush()` is async and exposed for the `before-quit` handler in main.ts.

### 2.2 LlmsTxtResolver

Lives in `.electron/services/LlmsTxtResolver.ts` (refactored — most internals replaced, public API preserved).

Constructor: `new LlmsTxtResolver(store: LlmsTxtCacheStore, now?: () => number)`.

Public API (unchanged signatures):

```ts
fetch(origin: string): Promise<string | null>;
fetchBoth(origin: string): Promise<{ llmsTxt: string | null; llmsFullTxt: string | null }>;
invalidate(origin: string): void;
```

`fetch` returns the best available file (full preferred, index fallback). `fetchBoth` returns both. `invalidate` delegates to the store.

## 3. Schema

`userData/llms-cache.json`:

```ts
interface LlmsCacheFile {
  schemaVersion: 1;
  entries: Record<string /* origin */, CacheEntry>;
}

interface CacheEntry {
  llmsTxt: string | null;       // /llms.txt body, or null if 404
  llmsFullTxt: string | null;   // /llms-full.txt body, or null if 404
  etagIndex?: string;
  etagFull?: string;
  lastModifiedIndex?: string;
  lastModifiedFull?: string;
  fetchedAt: number;            // ms epoch, drives TTL
}
```

- A "404 entry" has both `llmsTxt: null` and `llmsFullTxt: null`. Distinguished from "never fetched" by key presence.
- ETag/Last-Modified tracked per file — `/llms.txt` and `/llms-full.txt` are independent endpoints.
- One `fetchedAt` per entry; a single revalidation cycle re-stamps both files.

## 4. Freshness

```ts
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;     // 24 hours
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
```

```ts
function freshnessOf(entry: CacheEntry, now: number): "fresh" | "stale" {
  const age = now - entry.fetchedAt;
  const isNegative = entry.llmsTxt === null && entry.llmsFullTxt === null;
  const ttl = isNegative ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
  return age < ttl ? "fresh" : "stale";
}
```

Constants are module-private in `LlmsTxtCacheStore`. Not exposed via Settings in v1; if needed later, the constructor grows a second arg.

### 4.1 How the resolver acts on each verdict

| Store result | Resolver action |
|---|---|
| `null` (no entry) | Fetch both files, write entry, return bodies. Caller blocks. |
| `{ entry, "fresh" }` | Return cached bodies immediately. No network. |
| `{ entry, "stale" }` | Return cached bodies immediately. Fire background revalidation. |

### 4.2 Background revalidation

For each file (parallel):

| Server response | Cache mutation |
|---|---|
| 200 with body | Replace `llmsTxt`/`llmsFullTxt` + ETag + Last-Modified |
| 304 | Keep all fields, only `bumpFetchedAt` |
| 404 | Set body to `null`, clear ETag/Last-Modified |
| Network error / timeout / oversized | Keep all fields, only `bumpFetchedAt` (avoid re-hammering offline) |

Both files share a single `fetchedAt` bump after either path completes — see §6.4 for the merge rule.

## 5. Resolver mechanics

### 5.1 `fetchBoth(origin)` orchestration

```
1. Check inflight map for this origin. If a promise is in flight, return it.
2. store.get(origin):
     null     → goto FRESH_FETCH
     fresh    → return cached bodies immediately
     stale    → return cached bodies immediately AND fire-and-forget REVALIDATE

FRESH_FETCH:
  Parallel: tryGet(`${origin}/llms.txt`, null)
            tryGet(`${origin}/llms-full.txt`, null)
  If shouldPersistAsNegative(indexResult, fullResult) OR either succeeded:
    store.put(origin, buildEntry(results, now))
  Else (both transient errors):
    Do NOT store.put — return null bodies, let next call retry.
  Return bodies.

REVALIDATE (background, swallows errors):
  Read existing entry to extract its ETags/Last-Modified.
  Parallel: tryGet with conditional headers per file.
  Apply the per-file mutation rules from §4.2.
  store.put(origin, mergedEntry).
```

Inflight dedup applies only to fresh fetches (no entry yet). swr revalidation has its own inflight bookkeeping to prevent concurrent revalidations for the same origin.

### 5.2 `fetch(origin)` — thin wrapper

```ts
async fetch(origin: string): Promise<string | null> {
  const both = await this.fetchBoth(origin);
  return both.llmsFullTxt ?? both.llmsTxt;
}
```

The "prefer full" preference lives in this one expression. Today's sequential `doFetch` is gone.

### 5.3 `tryGet(url, conditional?)`

```ts
interface TryGetResult {
  status: 200 | 304 | 404 | "error";
  body: string | null;          // only populated on 200
  etag?: string;
  lastModified?: string;
}

interface ConditionalHeaders {
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}
```

Status simplification:

- Any 2xx with body → `200`
- `304 Not Modified` → `304`
- Any 4xx → `404` (definitively not present — site is reachable and says no)
- Any 5xx → `"error"` (transient — server is broken, the file may still exist)
- Network errors, timeouts, oversized aborts → `"error"`

The 4xx-vs-5xx distinction matters: classifying 503/500 as `"error"` instead of `404` prevents a temporarily-broken server from poisoning the cache as a 7-day negative.

Mechanics:

- `net.request({ method: "GET", url, redirect: "follow" })`
- Apply conditional headers if provided via `req.setHeader`
- 3-second hard timeout (existing behavior)
- On response:
  - 304 → resolve `{ status: 304, body: null, etag, lastModified }` and skip body
  - 200 → accumulate body chunks; if `body.length > 256 * 1024` → `req.abort()`, resolve `{ status: "error" }`
  - else → resolve `{ status: 404 }`
- On error/abort → `{ status: "error" }`

ETag/Last-Modified read from `res.headers` (lowercased keys per Electron's `IncomingMessage`).

### 5.4 Conditional headers

```ts
function conditional(etag?: string, lastModified?: string): ConditionalHeaders {
  return { ifNoneMatch: etag, ifModifiedSince: lastModified };
}
```

If both present, send both. If neither, send nothing (unconditional GET; response is 200 or 404 or error, treated identically to fresh-fetch). RFC 7232: servers respect `If-None-Match` over `If-Modified-Since` when both present.

### 5.5 `invalidate(origin)`

```ts
invalidate(origin: string): void {
  this.store.invalidate(origin);
  // No inflight cancellation — if a revalidation is in flight, it
  // completes and writes its result. Next fetch starts over.
}
```

## 6. Cache store internals

### 6.1 Load semantics (construction)

```
constructor(filePath, now = Date.now):
  this.filePath = filePath
  this.now = now
  this.entries = {}
  this.lastSavedJson = ""

  try:
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion === 1 && parsed.entries && typeof parsed.entries === "object"):
      this.entries = parsed.entries
      this.lastSavedJson = raw
    else:
      console.warn("[llms-cache] ignoring incompatible cache file")
  catch (err if err.code === "ENOENT"):
    /* first run — normal */
  catch (err):
    console.warn("[llms-cache] failed to read cache, starting fresh:", err.message)
```

Synchronous read is fine — file is small (KB to low MB), one-time cost at app start. Matches `BookmarkManager` / `HistoryManager` / `DownloadStore` patterns.

Malformed-file recovery: empty `entries`, do NOT delete the bad file. Next debounced save overwrites it atomically.

### 6.2 Mutation + debounced save

```
put(origin, entry):
  this.entries[origin] = entry
  this.scheduleFlush()

bumpFetchedAt(origin):
  const e = this.entries[origin]
  if (!e) return
  e.fetchedAt = this.now()
  this.scheduleFlush()

invalidate(origin):
  if (origin in this.entries):
    delete this.entries[origin]
    this.scheduleFlush()

private scheduleFlush():
  if (this.flushTimer) clearTimeout(this.flushTimer)
  this.flushTimer = setTimeout(() => { void this.flush() }, 500)
```

500 ms debounce balances "writes coalesce" against "data on disk soon."

### 6.3 `flush()` — atomic write

```
async flush():
  if (this.flushTimer) clearTimeout(this.flushTimer)
  this.flushTimer = null

  const json = JSON.stringify({ schemaVersion: 1, entries: this.entries })
  if (json === this.lastSavedJson) return   // no-op skip

  const tmpPath = this.filePath + ".tmp"
  await fs.promises.writeFile(tmpPath, json, "utf8")
  await fs.promises.rename(tmpPath, this.filePath)
  this.lastSavedJson = json
```

`writeFile → rename` is the standard atomic-write idiom: POSIX `rename` is atomic, so a reader sees either the old complete file or the new complete file. If the process crashes between `writeFile` and `rename`, a stray `.tmp` is left; next `flush()` overwrites it.

`lastSavedJson` comparison is the cheapest "skip the I/O" check, and lets the `before-quit` `flush()` exit fast when nothing has changed.

### 6.4 Merge rule for revalidation

After a background revalidation completes, the per-file results merge with the existing entry:

```ts
function mergeRevalidation(
  existing: CacheEntry,
  indexResult: TryGetResult,
  fullResult: TryGetResult,
  now: number,
): CacheEntry {
  const merged: CacheEntry = { ...existing, fetchedAt: now };
  applyPerFile(merged, "Index", indexResult);     // llmsTxt, etagIndex, lastModifiedIndex
  applyPerFile(merged, "Full",  fullResult);      // llmsFullTxt, etagFull, lastModifiedFull
  return merged;
}

function applyPerFile(merged, kind: "Index" | "Full", result: TryGetResult) {
  const bodyKey = kind === "Index" ? "llmsTxt" : "llmsFullTxt";
  const etagKey = kind === "Index" ? "etagIndex" : "etagFull";
  const lmKey   = kind === "Index" ? "lastModifiedIndex" : "lastModifiedFull";
  switch (result.status) {
    case 200:
      merged[bodyKey] = result.body;
      merged[etagKey] = result.etag;
      merged[lmKey]   = result.lastModified;
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
      // Keep existing fields. fetchedAt is bumped at the outer scope to avoid re-hammering.
      break;
  }
}
```

### 6.5 Boundaries deliberately out

- **No vacuuming.** Entries accumulate; realistic browsing hits hundreds of origins → ~50 MB worst case at the 256 KB cap. Eviction is a follow-up if real-world usage demands it.
- **No file-write retries.** A failed atomic write logs and moves on; in-memory cache stays correct for the session.
- **No multi-process safety.** Horizon is single-process per user data dir.

## 7. Error handling — failure modes

| Failure | Behavior |
|---|---|
| Cache file missing (first run) | Empty entries. Normal. |
| Cache file unparseable / wrong schema | Logged warn, empty entries. File overwritten on next save. |
| `writeFile` fails | In-memory state correct. Logged warn. Subsequent sessions don't benefit. |
| `rename` fails | `.tmp` left behind. Next `flush()` overwrites. Logged warn. |
| Network error during fresh fetch | If both GETs returned `"error"` → do NOT persist entry. Caller gets null bodies. Next call retries. |
| 404 + 404 on fresh fetch | Persist as negative entry (7-day TTL). |
| Network error during revalidation | Bump `fetchedAt`. Existing cached values stay. |
| Oversized response | `tryGet` aborts, returns `"error"`. Treated as transient. |
| Concurrent puts to same origin | Last writer wins. Inflight dedup prevents concurrent fresh fetches. Debounced flush coalesces disk writes. |
| App killed mid-flush | Atomic write → file is old-complete or new-complete. Worst case loses ≤500 ms of pending mutations. |
| Clock skew backward | `age < 0 < TTL`, so entry stays fresh until clock catches up. Self-healing. |

### 7.1 Negative cache vs transient error — the key distinction

```ts
function shouldPersistAsNegative(
  indexResult: TryGetResult,
  fullResult: TryGetResult,
): boolean {
  return indexResult.status === 404 && fullResult.status === 404;
}
```

If either was `"error"`, return `{ llmsTxt: null, llmsFullTxt: null }` to the caller but do NOT `store.put`. Without this rule, a transient network blip would poison the cache for 7 days.

Special case: `"error" + 200` (one succeeded, one transient-failed) on a fresh fetch — the success is dropped. We don't write half-entries because the negative-TTL math depends on "both null = negative." This is rare and acceptable; the next call retries. Document this trade-off in a comment in the resolver.

## 8. Testing

### 8.1 `LlmsTxtCacheStore` — unit tests

Real fs in a temp dir; injected clock. No network.

- Missing file → empty entries; `get` returns `null`.
- Existing valid file → entries loaded; `get` returns parsed entry with correct freshness.
- Malformed file → logged warn, empty entries.
- Wrong `schemaVersion` → logged warn, empty entries.
- `put` then `get` → entry retrievable immediately, freshness computed against injected clock.
- TTL transitions: positive entry fresh at 23 h, stale at 25 h; negative entry fresh at 6 d, stale at 8 d.
- `bumpFetchedAt` extends freshness without changing content.
- `invalidate` removes entry; subsequent `get` returns `null`.
- Debounced flush coalesces N rapid puts into one write.
- `flush()` while no changes since last save → no I/O.
- Atomic write: simulate crash between writeFile and rename → file on disk is either old or new, never partial.

### 8.2 `LlmsTxtResolver` — unit tests

Mock `electron.net`; real `LlmsTxtCacheStore` with temp file; injected clock.

- Cache miss → both files fetched in parallel → cache entry written → bodies returned.
- Cache hit fresh → no network call (verify mock counts).
- Cache hit stale → cached bodies returned synchronously; background revalidation fires; 304 → `bumpFetchedAt`; 200 → entry replaced; error → fetchedAt bumped.
- Inflight dedup: two concurrent fresh fetches for same origin → only one network call.
- 404 + 404 → entry persisted as negative.
- "error" + "error" → entry NOT persisted (next call retries).
- "error" + 200 → no persistence, partial result returned (documented trade-off).
- 503/500 response → classified as `"error"`, not persisted as negative.
- 256 KB cap: simulate a streaming response over cap → `tryGet` aborts, returns `"error"`.
- Conditional headers: revalidation with stored ETag sends `If-None-Match`; 304 doesn't replace body; 200 does.
- `invalidate` clears entry; next call re-fetches.

### 8.3 Coverage

Both new files added to `vite.config.ts` `coverage.include`. Per project memory, ≥90% threshold on all metrics.

### 8.4 Existing tests

- `tests/unit/llms-txt-parser.test.ts` — untouched (parser unchanged).
- `tests/unit/useLlmsTxtGuide.test.tsx` — untouched (renderer unchanged).
- `tests/unit/piSkillWriter.test.ts` — untouched (skill writer unchanged in this sub-project).
- `tests/unit/AIPanel.test.tsx` — untouched.

## 9. Migration / rollout

- **First run after upgrade:** no `userData/llms-cache.json` → empty start. Every origin fetched fresh on first visit. Identical to today's behavior. No data migration needed because today's cache was in-memory only.
- **Settings impact:** none. TTLs are hardcoded; `aiUseLlmsTxt` continues to gate prompt augmentation as it does today.
- **Pi skill writer:** unchanged. The "rewrite SKILL.md when content changes" concern is sub-project B; this design provides the cheap content-hash primitive (ETag comparison) that B will use.
- **`llmsTxtShownOrigins: Set<string>` in main.ts** — the in-session dedup of "don't pop the AI panel twice for the same origin" is separate from the cache. Leave alone; sub-project D will revisit if we expose an auto-open toggle.

## 10. Out of scope (parked for other sub-projects)

- **B — Skill lifecycle:** rewrite Pi skill when llms.txt content changes; move skill storage out of `~/.pi/agent/skills/`.
- **C — Smarter agent context:** structure-aware truncation of llms.txt before prompt augmentation. Uses existing `llmsTxtParser`, no cache changes needed.
- **D — User control:** opt-out of auto-open AI panel; user-authored llms.txt override per origin.

## 11. File checklist for the implementation plan

- Create: `.electron/services/LlmsTxtCacheStore.ts`
- Modify: `.electron/services/LlmsTxtResolver.ts` (refactor — most internals replaced; public API preserved)
- Modify: `.electron/main.ts` (instantiate store with `path.join(userData, "llms-cache.json")`, pass to resolver, wire `before-quit` flush)
- Create: `tests/unit/llms-txt-cache-store.test.ts`
- Create: `tests/unit/llms-txt-resolver.test.ts`
- Modify: `vite.config.ts` (add the two new files to `coverage.include`)
