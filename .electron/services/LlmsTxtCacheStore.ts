import { readFileSync } from "fs";
import { promises as fs } from "fs";

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

export const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
export const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FLUSH_DEBOUNCE_MS = 500;
export const SCHEMA_VERSION = 1;

/**
 * Disk-backed cache store for llms.txt/llms-full.txt responses.
 *
 * Provides TTL-based freshness evaluation (24h positive, 7d negative),
 * debounced atomic writes, and JSON persistence. All public mutations
 * trigger a debounced flush to disk; {@link flush} can also be called
 * directly for immediate persistence.
 */
export class LlmsTxtCacheStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private entries: Record<string, CacheEntry> = {};
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedJson = "";
  private flushPromise: Promise<void> | null = null;

  /**
   * @param filePath - Path to the on-disk JSON cache file.
   * @param now - Dependency-injected clock (defaults to `Date.now`).
   */
  constructor(filePath: string, now: () => number = Date.now) {
    this.filePath = filePath;
    this.now = now;
    this.loadSync();
  }

  /**
   * Synchronous read of the disk cache at construction time.
   * Non-existent or malformed files are silently ignored; the store
   * starts with an empty entry map.
   */
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
      (parsed as LlmsCacheFile).schemaVersion !== SCHEMA_VERSION ||
      typeof (parsed as LlmsCacheFile).entries !== "object" ||
      (parsed as LlmsCacheFile).entries === null
    ) {
      console.warn("[llms-cache] ignoring incompatible cache file");
      return;
    }
    this.entries = (parsed as LlmsCacheFile).entries;
    this.lastSavedJson = raw;
  }

  /**
   * Look up a cached entry for an origin.
   *
   * @param origin - The origin URL string used as the cache key.
   * @returns The entry and its freshness (`"fresh"` or `"stale"`),
   *          or `null` when no entry exists.
   */
  get(origin: string): GetResult | null {
    const entry = this.entries[origin];
    if (!entry) return null;
    const age = this.now() - entry.fetchedAt;
    const isNegative = entry.llmsTxt === null && entry.llmsFullTxt === null;
    const ttl = isNegative ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
    return { entry, freshness: age < ttl ? "fresh" : "stale" };
  }

  /**
   * Insert or replace a cached entry.
   *
   * @param origin - The origin URL string used as the cache key.
   * @param entry - The full {@link CacheEntry} to store.
   */
  put(origin: string, entry: CacheEntry): void {
    this.entries[origin] = entry;
    this.scheduleFlush();
  }

  /**
   * Update the `fetchedAt` timestamp on an existing entry without
   * changing the content or conditional headers.
   *
   * @param origin - The origin URL string used as the cache key.
   */
  bumpFetchedAt(origin: string): void {
    const entry = this.entries[origin];
    if (!entry) return;
    entry.fetchedAt = this.now();
    this.scheduleFlush();
  }

  /**
   * Remove an entry from the in-memory map and schedule a flush.
   *
   * @param origin - The origin URL string used as the cache key.
   */
  invalidate(origin: string): void {
    if (!(origin in this.entries)) return;
    delete this.entries[origin];
    this.scheduleFlush();
  }

  /**
   * Check whether an entry exists for the given origin.
   *
   * @param origin - The origin URL string used as the cache key.
   */
  has(origin: string): boolean {
    return origin in this.entries;
  }

  /**
   * Schedule a debounced flush. Repeated calls within the debounce
   * window coalesce into a single write.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * Immediately persist the current entry map to disk.
   *
   * Concurrent callers are serialized — if a flush is already in
   * progress the new caller chains onto the existing promise. Writes
   * are atomic (write to a temp file then rename), and an identical
   * payload from the last successful write is a no-op.
   *
   * @returns A promise that resolves when the write (or skip) completes.
   *          Errors during I/O are logged but never propagated.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Serialize: chain onto any in-progress flush so writes don't race
    if (this.flushPromise) {
      await this.flushPromise;
    }
    const doFlush = async (): Promise<void> => {
      const json = JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        entries: this.entries,
      });
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
    };
    this.flushPromise = doFlush().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }
}
