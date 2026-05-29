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

const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class LlmsTxtCacheStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private entries: Record<string, CacheEntry> = {};
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedJson = "";

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
    this.lastSavedJson = raw;
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

  has(origin: string): boolean {
    return origin in this.entries;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, 500);
  }

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
}
