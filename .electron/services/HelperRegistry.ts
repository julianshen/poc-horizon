import { promises as fs, existsSync, readFileSync } from "fs";

export interface JsHelper {
  /** Unique name; agent calls `browser_call_helper({name})`. */
  name: string;
  /** JS expression that evaluates to a function. Examples:
   *   '(x) => x * 2'
   *   'function(url, opts) { return fetch(url, opts).then(r => r.json()); }'  */
  expression: string;
  /** Optional human description — surfaced in browser_list_helpers output. */
  description?: string;
  createdAt: number;
}

/**
 * Persistent registry of named JS helper functions the agent has saved
 * for reuse across turns. JSON-backed; each window's BrowserHarness
 * injects them lazily on first call.
 *
 * Inspired by the Browser Harness "helpers.py at runtime" pattern —
 * the agent learns a useful page primitive once (e.g. "dismiss this
 * site's specific modal style") and reuses it without re-deriving.
 */
export class HelperRegistry {
  constructor(private readonly filePath: string) {}

  list(): JsHelper[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8"));
      return Array.isArray(data) ? (data as JsHelper[]) : [];
    } catch {
      return [];
    }
  }

  get(name: string): JsHelper | undefined {
    return this.list().find((h) => h.name === name);
  }

  async save(input: Omit<JsHelper, "createdAt">): Promise<JsHelper> {
    const helper: JsHelper = { ...input, createdAt: Date.now() };
    const next = this.list()
      .filter((h) => h.name !== helper.name)
      .concat(helper);
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), "utf8");
    return helper;
  }

  async remove(name: string): Promise<void> {
    const next = this.list().filter((h) => h.name !== name);
    await fs.writeFile(this.filePath, JSON.stringify(next, null, 2), "utf8");
  }

  /** Build a JS snippet that defines every helper on the page's
   *  window.__horizon.helpers namespace. Idempotent — overwriting an
   *  existing helper with the same name is intentional. */
  inlineInjection(): string {
    const helpers = this.list();
    const body = helpers
      .map((h) => `__h[${JSON.stringify(h.name)}] = (${h.expression});`)
      .join("\n");
    return `(function(){
      if (!window.__horizon) window.__horizon = {};
      if (!window.__horizon.helpers) window.__horizon.helpers = {};
      var __h = window.__horizon.helpers;
      ${body}
    })()`;
  }
}
