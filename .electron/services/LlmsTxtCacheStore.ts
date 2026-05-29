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
