import { net } from "electron";
import { StringDecoder } from "string_decoder";
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

  /**
   * @param store - The backing cache store for persistence and TTL math.
   * @param now - Dependency-injected clock (defaults to `Date.now`).
   */
  constructor(store: LlmsTxtCacheStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }

  /**
   * Fetch the best available llms.txt content for an origin.
   *
   * Prefers `/llms-full.txt` when available; falls back to `/llms.txt`.
   * May return cached data immediately and refresh in the background
   * (stale-while-revalidate).
   *
   * @param origin - The origin URL string (e.g. `"https://example.com"`).
   * @returns The content string, or `null` when neither file is available.
   */
  async fetch(origin: string): Promise<string | null> {
    const both = await this.fetchBoth(origin);
    return both.llmsFullTxt ?? both.llmsTxt;
  }

  /**
   * Fetch both `/llms.txt` and `/llms-full.txt` for an origin.
   *
   * On a cache miss, performs two parallel GET requests and persists the
   * result. On a cache hit with stale data, returns the stale content
   * immediately while scheduling a background revalidation using
   * conditional headers (`If-None-Match`, `If-Modified-Since`).
   * Concurrent calls for the same origin are deduplicated.
   *
   * @param origin - The origin URL string (e.g. `"https://example.com"`).
   * @returns An object with `llmsTxt` and `llmsFullTxt` — each is the
   *          content string or `null`.
   */
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

  /**
   * Remove a cached entry for the given origin.
   *
   * @param origin - The origin URL string used as the cache key.
   */
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

  private scheduleRevalidate(origin: string, existing: CacheEntry): void {
    if (this.inflightRevalidate.has(origin)) return;
    this.inflightRevalidate.add(origin);
    void this.doRevalidate(origin, existing)
      .catch((err) => {
        console.warn(
          `[llms-resolver] revalidation failed for ${origin}:`,
          err,
        );
      })
      .finally(() => {
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

    // Don't bump fetchedAt or write the cache when both fetches failed.
    const bothFailed = indexResult.status === "error" && fullResult.status === "error";
    if (bothFailed) return;

    const merged: CacheEntry = { ...existing, fetchedAt: this.now() };
    applyPerFile(merged, "Index", indexResult);
    applyPerFile(merged, "Full", fullResult);
    this.store.put(origin, merged);
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

      const decoder = new StringDecoder("utf8");
      let body = "";
      let bytesReceived = 0;
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
            bytesReceived += chunk.length;
            if (bytesReceived > MAX_BODY_BYTES) {
              aborted = true;
              clearTimeout(timer);
              req.abort();
              resolve({ status: "error", body: null });
              return;
            }
            body += decoder.write(chunk);
          });
          res.on("end", () => {
            if (aborted) return;
            body += decoder.end();
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
        clearTimeout(timer);
        if (status === 404 || status === 410) {
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
      // Keep existing fields. fetchedAt is bumped at the outer scope
      // only when at least one fetch succeeded.
      break;
  }
}
