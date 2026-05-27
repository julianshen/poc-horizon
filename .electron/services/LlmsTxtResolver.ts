import { net } from "electron";

/**
 * llms.txt / llms-full.txt resolver.
 *
 * The llms.txt spec (proposed by Jeremy Howard, adopted by browse.sh and
 * others) is a sitemap of agent-friendly site skills published at the
 * origin root. Treat the file as untrusted UTF-8 documentation —
 * fetched once per origin, cached, never executed.
 *
 * - Tries /llms-full.txt first (richer), falls back to /llms.txt.
 * - Network fetch via Electron's `net` module so it respects the same
 *   session / proxy / TLS config the user sees in their tabs.
 * - In-memory cache only; cleared on app restart. No disk persistence
 *   yet — would need an integrity/freshness model first.
 */
export class LlmsTxtResolver {
  private cache = new Map<string, string | null>(); // origin → contents | null (404)
  private both = new Map<
    string,
    { llmsTxt: string | null; llmsFullTxt: string | null }
  >();
  private inflight = new Map<string, Promise<string | null>>();
  private inflightBoth = new Map<
    string,
    Promise<{ llmsTxt: string | null; llmsFullTxt: string | null }>
  >();

  /** Get the best available llms*.txt for an origin (full preferred). Null if neither. */
  async fetch(origin: string): Promise<string | null> {
    if (this.cache.has(origin)) return this.cache.get(origin) ?? null;
    const existing = this.inflight.get(origin);
    if (existing) return existing;
    const p = this.doFetch(origin);
    this.inflight.set(origin, p);
    try {
      const result = await p;
      this.cache.set(origin, result);
      return result;
    } finally {
      this.inflight.delete(origin);
    }
  }

  /** Get both files for an origin. Either or both may be null. Cached per-origin. */
  async fetchBoth(
    origin: string,
  ): Promise<{ llmsTxt: string | null; llmsFullTxt: string | null }> {
    if (this.both.has(origin)) return this.both.get(origin)!;
    const existing = this.inflightBoth.get(origin);
    if (existing) return existing;
    const p = (async () => ({
      llmsTxt: await this.tryGet(`${origin}/llms.txt`),
      llmsFullTxt: await this.tryGet(`${origin}/llms-full.txt`),
    }))();
    this.inflightBoth.set(origin, p);
    try {
      const result = await p;
      this.both.set(origin, result);
      return result;
    } finally {
      this.inflightBoth.delete(origin);
    }
  }

  private async doFetch(origin: string): Promise<string | null> {
    for (const path of ["/llms-full.txt", "/llms.txt"]) {
      const text = await this.tryGet(`${origin}${path}`);
      if (text !== null) return text;
    }
    return null;
  }

  private tryGet(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      const req = net.request({ method: "GET", url, redirect: "follow" });
      let body = "";
      // 3-second hard cap — agent shouldn't block on a slow llms.txt fetch.
      const timer = setTimeout(() => {
        req.abort();
        resolve(null);
      }, 3000);
      req.on("response", (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          clearTimeout(timer);
          resolve(null);
          return;
        }
        res.on("data", (chunk) => {
          body += chunk.toString("utf8");
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve(body || null);
        });
        res.on("error", () => {
          clearTimeout(timer);
          resolve(null);
        });
      });
      req.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
      req.end();
    });
  }

  /** Force-refresh an origin (e.g. user clicked "Re-scan site skills"). */
  invalidate(origin: string): void {
    this.cache.delete(origin);
  }
}
