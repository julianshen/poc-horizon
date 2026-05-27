import { net } from 'electron';
import { parseAgentPolicy, type AgentPolicy } from './agentPolicy';

interface CacheEntry {
  policy: AgentPolicy | null;
  etag: string | null;
  fetchedAt: number;
}

/**
 * Fetches and caches /agent.json per origin. Honors ETag + a 24h
 * soft TTL — beyond TTL we re-validate with If-None-Match. Failures
 * are cached as `null` to avoid re-hammering 404s.
 *
 * Discovery rules (spec § 2):
 *   1. /agent.json at the origin root (this resolver)
 *   2. <link rel="agent-policy"> per-page (not yet — needs per-page DOM read)
 *   3. <meta name="agent-policy"> per-page (not yet — same)
 *
 * Per spec § 11, an invalid file means falling back to defaults. We
 * never throw; the worst case is `null`, which the AiActionGuard
 * treats as "no site policy, apply user defaults."
 */
export class AgentPolicyResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 24 * 60 * 60 * 1000;

  constructor(
    /** Override for tests — defaults to Electron's net.request. */
    private readonly fetcher: (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string; etag: string | null }> = defaultFetcher,
  ) {}

  /** Normalize to a comparable origin key (http(s) only). Returns null
   *  for non-http schemes — agent.json doesn't apply to chrome://, file://. */
  static originOf(url: string): string | null {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.origin;
    } catch { return null; }
  }

  /** Get the cached policy for an origin without fetching. */
  cached(origin: string): AgentPolicy | null {
    return this.cache.get(origin)?.policy ?? null;
  }

  /** Fetch (or revalidate) /agent.json for the origin. Resolves to
   *  the parsed policy, or null when missing / invalid / errored. */
  async resolve(originOrUrl: string): Promise<AgentPolicy | null> {
    // Accept either a full URL or a bare origin. originOf returns null
    // for non-http schemes, so chrome://, file://, data: short-circuit
    // before any network call.
    const looksLikeOrigin = /^https?:\/\/[^/?#]+$/.test(originOrUrl);
    const origin = looksLikeOrigin ? originOrUrl : AgentPolicyResolver.originOf(originOrUrl);
    if (!origin) return null;

    const existing = this.cache.get(origin);
    const fresh = existing && (Date.now() - existing.fetchedAt) < this.TTL_MS;
    if (fresh && existing.policy !== null) return existing.policy;     // hot hit
    if (fresh && existing.policy === null && !existing.etag) return null;  // negative cache: known-missing

    const headers: Record<string, string> = {
      Accept: 'application/agent-policy+json, application/json',
    };
    if (existing?.etag) headers['If-None-Match'] = existing.etag;

    try {
      const { status, body, etag } = await this.fetcher(`${origin}/agent.json`, headers);
      if (status === 304 && existing) {
        // Not modified — touch the timestamp so we don't re-validate every call.
        existing.fetchedAt = Date.now();
        return existing.policy;
      }
      if (status === 404 || status === 410) {
        this.cache.set(origin, { policy: null, etag: null, fetchedAt: Date.now() });
        return null;
      }
      if (status < 200 || status >= 300) {
        // Transient — don't poison the cache; just return null this round.
        return existing?.policy ?? null;
      }
      let json: unknown;
      try { json = JSON.parse(body); } catch { return null; }
      const policy = parseAgentPolicy(json);
      this.cache.set(origin, { policy, etag, fetchedAt: Date.now() });
      return policy;
    } catch {
      return existing?.policy ?? null;
    }
  }

  /** Test seam: clear the cache. */
  clear(): void { this.cache.clear(); }
}

async function defaultFetcher(url: string, headers: Record<string, string>): Promise<{ status: number; body: string; etag: string | null }> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    // Collect Buffer chunks, decode once at end. Per-chunk toString('utf8')
    // corrupts multibyte codepoints when the TCP chunk boundary lands
    // mid-character, which is rare but causes JSON.parse failures on
    // legitimate non-ASCII /agent.json files. ETag header can be string
    // or string[] — normalize.
    const chunks: Buffer[] = [];
    req.on('response', (resp) => {
      const raw = resp.headers['etag'];
      const etag = Array.isArray(raw) ? (raw[0] ?? null) : (typeof raw === 'string' ? raw : null);
      resp.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      resp.on('end', () => resolve({
        status: resp.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        etag,
      }));
      resp.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
