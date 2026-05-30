import type { AgentPolicy, AgentAction } from "./agentPolicy";

/**
 * Invoke a site-declared action from `/agent.json` via HTTP through
 * the page's session. Prefer this over UI automation when the site
 * publishes structured actions — faster, more reliable, no layout
 * brittleness.
 *
 * Auth support (v1): `"none"` and `"cookie"` only.
 * `"bearer"` and `"header:<name>"` throw with a clear "not in v1" message.
 */
export class StructuredActionInvoker {
  /** Per-action-name last-call timestamps for rate-limit enforcement. */
  private rateLimitMap = new Map<string, number>();

  /**
   * Look up an action by name, validate args against its schema,
   * perform the HTTP request through the active tab's context.
   *
   * @param harness - Object with an `evaluate` method (BrowserHarness subset).
   * @param policy - Parsed AgentPolicy from the resolver.
   * @param actionName - Must match an entry in `policy.actions[]`.
   * @param args - Caller-supplied arguments; validated against `action.args_schema`.
   * @returns The JSON-decoded response body, or raw text for non-JSON responses.
   */
  async invoke(
    harness: { evaluate: (expr: string) => Promise<{ ok: boolean; value?: unknown; error?: string }> },
    policy: AgentPolicy,
    actionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const action = (policy.actions ?? []).find((a) => a.name === actionName);
    if (!action) {
      throw new Error(
        `Action "${actionName}" not found in agent.json. ` +
        `Available: ${(policy.actions ?? []).map((a) => a.name).join(", ") || "(none)"}`,
      );
    }

    this.validateArgs(action, args);
    this.checkRateLimit(action);
    this.assertSupportedAuth(action);

    const expr = this.buildEvaluateExpr(action, args);
    const isIdempotent = action.idempotent === true;

    const attempt = async (): Promise<unknown> => {
      const result = await harness.evaluate(expr);
      if (!result.ok) throw new Error(result.error ?? "evaluate failed");
      return result.value;
    };

    try {
      return await attempt();
    } catch (err) {
      if (isIdempotent) {
        // Retry once after 1s for idempotent actions.
        await new Promise((r) => setTimeout(r, 1000));
        return attempt();
      }
      throw err;
    }
  }

  // ─── Validation ─────────────────────────────────────────────────────

  private validateArgs(
    action: AgentAction,
    args: Record<string, unknown>,
  ): void {
    const schema = action.args_schema;
    if (!schema || typeof schema !== "object") return;

    for (const [key, typeHint] of Object.entries(schema)) {
      if (typeof typeHint !== "string") continue;
      // Only check required-ness: if the schema declares a key, it must
      // be present in args. We don't do deep type validation (v1).
      if (!(key in args)) {
        throw new Error(
          `Missing required argument "${key}" for action "${action.name}" ` +
          `(expected type: ${typeHint})`,
        );
      }
    }
  }

  private assertSupportedAuth(action: AgentAction): void {
    const auth = action.auth ?? "none";
    if (auth === "none" || auth === "cookie") return;
    if (auth === "bearer") {
      throw new Error(
        `Action "${action.name}" requires bearer auth — not supported in v1. ` +
        `Secret store integration is planned for a future release.`,
      );
    }
    if (auth.startsWith("header:")) {
      throw new Error(
        `Action "${action.name}" requires "${auth}" — not supported in v1. ` +
        `Secret store integration is planned for a future release.`,
      );
    }
  }

  // ─── Rate limiting ──────────────────────────────────────────────────

  private checkRateLimit(action: AgentAction): void {
    const spec = action.rate_limit;
    if (!spec) return;

    const windowMs = parseRateLimit(spec);
    if (windowMs === null) return; // unparseable spec → skip enforcement

    const lastCall = this.rateLimitMap.get(action.name) ?? 0;
    const elapsed = Date.now() - lastCall;
    if (elapsed < windowMs) {
      const remaining = Math.ceil((windowMs - elapsed) / 1000);
      throw new Error(
        `Rate limit exceeded for action "${action.name}". ` +
        `Limit: ${spec}. Try again in ${remaining}s.`,
      );
    }
    this.rateLimitMap.set(action.name, Date.now());
  }

  // ─── Evaluate expression builder ────────────────────────────────────

  private buildEvaluateExpr(
    action: AgentAction,
    args: Record<string, unknown>,
  ): string {
    const [method, ...pathParts] = action.endpoint.split(" ");
    const path = pathParts.join(" ");
    const useCredentials = (action.auth ?? "none") === "cookie";

    const bodyLiteral = method === "GET" || method === "HEAD"
      ? "undefined"
      : JSON.stringify(args);

    const headersLiteral = (method === "GET" || method === "HEAD")
      ? "undefined"
      : JSON.stringify({ "Content-Type": "application/json" });

    const resolvedPath = this.resolvePathParams(path, args);

    return [
      `(async () => {`,
      `  const res = await fetch(${JSON.stringify(resolvedPath)}, {`,
      `    method: ${JSON.stringify(method)},`,
      `    headers: ${headersLiteral},`,
      `    body: ${bodyLiteral},`,
      `    credentials: ${JSON.stringify(useCredentials ? "include" : "omit")},`,
      `  });`,
      `  const text = await res.text();`,
      `  if (!res.ok) throw new Error(text || res.statusText);`,
      `  try { return JSON.parse(text); } catch { return text; }`,
      `})()`,
    ].join("");
  }

  /**
   * Replace `:param` path segments with values from args.
   * e.g., `DELETE /api/items/:id` + `{ id: "abc" }` → `DELETE /api/items/abc`
   */
  private resolvePathParams(
    path: string,
    args: Record<string, unknown>,
  ): string {
    return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, paramName) => {
      const value = args[paramName];
      if (value === undefined || value === null) return `:${paramName}`;
      return encodeURIComponent(String(value));
    });
  }
}

// ─── Rate-limit parser ────────────────────────────────────────────────

/**
 * Parse an agent.json rate_limit string into milliseconds.
 * Supported formats: "N/s" (per second), "N/m" (per minute), "N/h" (per hour).
 * Returns null for unparseable strings (enforcement is skipped rather than
 * crashing the invocation).
 */
function parseRateLimit(spec: string): number | null {
  const m = /^(\d+)\s*\/\s*(s|m|h)$/.exec(spec.trim());
  if (!m) return null;
  const count = parseInt(m[1], 10);
  const unit = m[2];
  // Window = the time period divided by count.
  // "1/m" → 60s, "10/m" → 6s, "1/s" → 1s.
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000 }[unit];
  return Math.ceil(unitMs / count);
}
