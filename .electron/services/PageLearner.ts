import type { BrowserHarness, Mark, DomNode } from "./BrowserHarness";

// ─── Types ────────────────────────────────────────────────────────────

export interface LearnOptions {
  mode?: "passive" | "active";
  includeNetwork?: boolean;
  includeScripting?: boolean;
  includeUrlAnalysis?: boolean;
  observeDurationMs?: number;
}

export interface PerceptionResult {
  interactiveCount: number;
  elementsByRole: Record<string, number>;
  forms: PerceivedForm[];
  navSections: PerceivedNavSection[];
  searchInputs: PerceivedSearchInput[];
  markedElements: PerceivedMarkedElement[];
}

export interface PerceivedForm {
  action: string;
  method: string;
  fieldCount: number;
  fields: Array<{ name: string; type: string; required: boolean; placeholder?: string }>;
  submitLabel: string;
}

export interface PerceivedNavSection {
  label: string;
  linkCount: number;
  links: Array<{ href: string; text: string }>;
}

export interface PerceivedSearchInput {
  markId: number;
  label: string;
  placeholder?: string;
}

export interface PerceivedMarkedElement {
  markId: number;
  tag: string;
  role: string | null;
  label: string;
  href: string | null;
  rect: { x: number; y: number; w: number; h: number };
}

export interface UrlAnalysisResult {
  currentUrl: string;
  currentPattern: string;
  queryParams: string[];
  discoveredPatterns: Record<string, number>;
  origin: string;
}

export interface ScriptingResult {
  framework: { fw: string; ver?: string; detected?: boolean } | null;
  stateKeys: Array<{ key: string; type: string; topKeys: string[] | null }>;
  routePatterns: Record<string, number>;
  totalLinks: number;
  /**
   * Elements the site explicitly tagged with `data-agent-action="name"`
   * (Agent Policy v1, spec § 2.3). These are authoritative — the site is
   * declaring the action, so classification trusts the declared name over
   * any heuristic.
   */
  declaredActions: Array<{ name: string; tag: string; label: string }>;
}

export interface NetworkResult {
  endpoints: Array<{
    method: string;
    path: string;
    status: number;
    contentType: string;
    isGraphQL: boolean;
    sampleKeys: string[] | null;
  }>;
  authEndpoints: string[];
  totalRequests: number;
}

export interface ClassifiedAction {
  name: string;
  category: "crud" | "navigation" | "filter" | "auth" | "export" | "search" | "upload" | "custom";
  confidence: "high" | "medium" | "low";
  elements: Array<{ markId: number; tag: string; label: string }>;
  formFields?: Array<{ name: string; type: string }>;
  observedEndpoint?: { method: string; path: string };
  description: string;
}

export interface LearnResult {
  origin: string;
  url: string;
  agentPolicyLevel: number;
  perception: PerceptionResult;
  urlAnalysis?: UrlAnalysisResult;
  scripting?: ScriptingResult;
  network?: NetworkResult;
  classification: ClassifiedAction[];
}

// ─── Harness interface (subset) ────────────────────────────────────────

/**
 * The slice of BrowserHarness the learner depends on. Derived via `Pick`
 * from the real class so a method rename on BrowserHarness breaks this at
 * compile time instead of silently failing at runtime (the CDP event API
 * is `subscribeEvent` / `collectEvents` / `unsubscribeEvent`, not the
 * `cdp*` names an earlier draft assumed).
 */
type Harness = Pick<
  BrowserHarness,
  | "screenshotMarked"
  | "getAxTree"
  | "getDom"
  | "getUrl"
  | "evaluate"
  | "subscribeEvent"
  | "collectEvents"
  | "unsubscribeEvent"
>;

// ─── Classification heuristics ────────────────────────────────────────

const CREATE_LABELS = /\b(create|new|add)\b/i;
const DELETE_LABELS = /\b(delete|remove|archive)\b/i;
const UPDATE_LABELS = /\b(update|save\s*changes|edit)\b/i;
// Spec § 2.3: any of export/download/csv/pdf flags an export action — the
// verb and the format need not co-occur (a bare "Download" still counts).
const EXPORT_LABELS = /\b(export|download|csv|pdf|xlsx)\b/i;
const FILTER_LABELS = /\b(filter|apply)\b/i;

/**
 * markId for a classified action that doesn't map to a single screenshot
 * mark (whole forms, composite filter pairs, declared actions). Negative
 * so it can never collide with — and accidentally suppress — a real mark
 * whose id happens to be 0.
 */
const SYNTHETIC_MARK = -1;

// ─── PageLearner ──────────────────────────────────────────────────────

export class PageLearner {
  /**
   * Analyze the current page and return a structured inventory of
   * interactive elements, forms, navigation, URL patterns, and
   * classified actions. The agent (LLM) reads the result and proposes
   * domain skills, helpers, or workflows.
   */
  async learn(
    harness: Harness,
    options?: LearnOptions,
  ): Promise<LearnResult> {
    const doScripting = options?.includeScripting !== false;
    const doUrlAnalysis = options?.includeUrlAnalysis !== false;
    // "active" mode opts into network observation by default; "passive"
    // (or unset) leaves it to the explicit includeNetwork flag.
    const doNetwork =
      options?.includeNetwork === true || options?.mode === "active";
    const observeMs = options?.observeDurationMs ?? 2000;

    const url = await harness.getUrl();
    const origin = extractOrigin(url);

    const [perception, urlAnalysis] = await Promise.all([
      this.perceive(harness),
      doUrlAnalysis ? this.analyzeUrl(harness, url) : undefined,
    ]);

    const scripting = doScripting
      ? await this.probeScripting(harness) : undefined;
    const network = doNetwork
      ? await this.observeNetwork(harness, observeMs) : undefined;

    const base = {
      origin,
      url,
      agentPolicyLevel: 0, // resolved by bridge, not the learner
      perception,
      urlAnalysis,
      scripting,
      network,
    };

    const classification = this.classify(base);
    return { ...base, classification };
  }

  // ─── Phase 1: Perception ──────────────────────────────────────────

  private async perceive(harness: Harness): Promise<PerceptionResult> {
    // getAxTree() is fetched to prime the accessibility domain (and is
    // covered by tests asserting the call), but its semantic tree isn't
    // folded into PerceptionResult yet — element roles already come from
    // the screenshot marks. The binding is elided to avoid an unused var.
    const [marked, , dom] = await Promise.all([
      harness.screenshotMarked({ order: "reading", format: "jpeg", quality: 50 }),
      harness.getAxTree(),
      harness.getDom(2),
    ]);

    const marks = marked.marks;

    const elementsByRole: Record<string, number> = {};
    const markedElements: PerceivedMarkedElement[] = [];
    const searchInputs: PerceivedSearchInput[] = [];

    for (const m of marks) {
      const role = m.role ?? "unknown";
      elementsByRole[role] = (elementsByRole[role] ?? 0) + 1;
      markedElements.push({
        markId: m.id,
        tag: m.tag,
        role: m.role,
        label: m.label,
        href: m.href,
        rect: { x: m.x, y: m.y, w: m.w, h: m.h },
      });
      if (role === "searchbox" || (m.tag === "input" && m.label.toLowerCase().includes("search"))) {
        searchInputs.push({ markId: m.id, label: m.label });
      }
    }

    const forms = extractForms(dom);
    const navSections = extractNavSections(marks, dom);

    return {
      interactiveCount: marks.length,
      elementsByRole,
      forms,
      navSections,
      searchInputs,
      markedElements,
    };
  }

  // ─── Phase 2: URL analysis ────────────────────────────────────────

  private async analyzeUrl(
    harness: Harness,
    currentUrl: string,
  ): Promise<UrlAnalysisResult> {
    const origin = extractOrigin(currentUrl);

    // Collect and pattern-group all links on the page.
    const routeResult = await harness.evaluate(
      `(() => {
        const paths = new Set([...document.querySelectorAll("a[href]")].map(l => {
          try { return new URL(l.href, location.origin).pathname; } catch { return null; }
        }).filter(Boolean));
        const pats = {};
        for (const p of paths) {
          const parts = p.split("/").filter(Boolean);
          const key = parts.map(s => /^\\d+$/.test(s) ? ":id" : /^[a-f0-9-]{20,}$/.test(s) ? ":uuid" : s).join("/") || "/";
          pats[key] = (pats[key] || 0) + 1;
        }
        return { totalLinks: paths.size, patterns: pats };
      })()`,
    );

    let discoveredPatterns: Record<string, number> = {};
    if (routeResult.ok && routeResult.value && typeof routeResult.value === "object") {
      discoveredPatterns = (routeResult.value as { patterns?: Record<string, number> }).patterns ?? {};
    }

    // Extract query params from current URL.
    let queryParams: string[] = [];
    try {
      queryParams = [...new URL(currentUrl).searchParams.keys()];
    } catch { /* ignore */ }

    return {
      currentUrl,
      currentPattern: classifyUrlPattern(currentUrl),
      queryParams,
      discoveredPatterns,
      origin,
    };
  }

  // ─── Phase 3: Scripting probes ────────────────────────────────────

  private async probeScripting(harness: Harness): Promise<ScriptingResult> {
    // Framework detection.
    const fwResult = await harness.evaluate(
      `(() => {
        if (window.React?.version) return { fw: "react", ver: window.React.version };
        if (window.__VUE__) return { fw: "vue", ver: window.__VUE__ };
        if (window.angular) return { fw: "angular", ver: window.angular.version?.full };
        if (document.querySelector("[data-reactroot],[data-react-server-root]")) return { fw: "react", detected: true };
        if (document.querySelector("[data-v-]")) return { fw: "vue", detected: true };
        return null;
      })()`,
    );

    // State dump discovery.
    const stateResult = await harness.evaluate(
      `(() => Object.keys(window).filter(k =>
        k.startsWith("__") || k.includes("STATE") || k.includes("STORE") || k === "APP_CONFIG"
      ).map(k => ({
        key: k, type: typeof window[k],
        topKeys: typeof window[k] === "object" && window[k] && !Array.isArray(window[k])
          ? Object.keys(window[k]).slice(0, 10) : null
      })))()`,
    );

    // Route enumeration.
    const routeResult = await harness.evaluate(
      `(() => {
        const paths = new Set([...document.querySelectorAll("a[href]")].map(l => {
          try { return new URL(l.href, location.origin).pathname; } catch { return null; }
        }).filter(Boolean));
        const pats = {};
        for (const p of paths) {
          const parts = p.split("/").filter(Boolean);
          const key = parts.map(s => /^\\d+$/.test(s) ? ":id" : /^[a-f0-9-]{20,}$/.test(s) ? ":uuid" : s).join("/") || "/";
          pats[key] = (pats[key] || 0) + 1;
        }
        return { totalLinks: paths.size, patterns: pats };
      })()`,
    );

    // Site-declared actions (data-agent-action) — authoritative, spec § 2.3.
    const declaredResult = await harness.evaluate(
      `(() => [...document.querySelectorAll("[data-agent-action]")].map(el => ({
        name: el.getAttribute("data-agent-action") || "",
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 80),
      })).filter(a => a.name))()`,
    );

    return {
      framework: (fwResult.ok ? fwResult.value : null) as ScriptingResult["framework"],
      stateKeys: (stateResult.ok && Array.isArray(stateResult.value)
        ? stateResult.value
        : []) as ScriptingResult["stateKeys"],
      routePatterns: (routeResult.ok && typeof routeResult.value === "object"
        ? (routeResult.value as { patterns?: Record<string, number> }).patterns ?? {}
        : {}),
      totalLinks: (routeResult.ok && typeof routeResult.value === "object"
        ? (routeResult.value as { totalLinks?: number }).totalLinks ?? 0
        : 0),
      declaredActions: (declaredResult.ok && Array.isArray(declaredResult.value)
        ? declaredResult.value
        : []) as ScriptingResult["declaredActions"],
    };
  }

  // ─── Phase 4: CDP network observation ─────────────────────────────

  private async observeNetwork(
    harness: Harness,
    durationMs: number,
  ): Promise<NetworkResult> {
    await harness.subscribeEvent("Network.requestWillBeSent");
    await harness.subscribeEvent("Network.responseReceived");

    await new Promise((r) => setTimeout(r, durationMs));

    // collectEvents is synchronous (drains an in-memory ring buffer).
    const reqEvents = harness.collectEvents("Network.requestWillBeSent");
    const resEvents = harness.collectEvents("Network.responseReceived");

    harness.unsubscribeEvent("Network.requestWillBeSent");
    harness.unsubscribeEvent("Network.responseReceived");

    // Index requests by requestId so each response can recover its real
    // HTTP method and post body (for GraphQL detection).
    const requestsById = new Map<
      string,
      { method: string; postData?: string }
    >();
    for (const ev of reqEvents as Array<{
      params?: {
        requestId?: string;
        request?: { method?: string; postData?: string };
      };
    }>) {
      const p = ev.params;
      if (p?.requestId && p.request) {
        requestsById.set(p.requestId, {
          method: p.request.method ?? "GET",
          postData: p.request.postData,
        });
      }
    }

    // Deduplicate endpoints on (method, path).
    const seen = new Set<string>();
    const endpoints: NetworkResult["endpoints"] = [];
    const authEndpoints: string[] = [];

    for (const ev of resEvents as Array<{
      params?: {
        requestId?: string;
        response?: { url?: string; status?: number; mimeType?: string };
      };
    }>) {
      const resp = ev.params?.response;
      if (!resp?.url) continue;
      let path: string;
      try {
        path = new URL(resp.url).pathname;
      } catch {
        continue;
      }

      const req = ev.params?.requestId
        ? requestsById.get(ev.params.requestId)
        : undefined;
      const method = req?.method ?? "GET";
      const isGraphQL =
        /graphql/i.test(path) ||
        (!!req?.postData && /["']query["']\s*:/.test(req.postData));

      const key = `${method} ${path}`;
      if (seen.has(key)) continue;
      seen.add(key);

      endpoints.push({
        method,
        path,
        status: resp.status ?? 0,
        contentType: resp.mimeType ?? "unknown",
        isGraphQL,
        sampleKeys: null,
      });

      if (/\/(auth|login|oauth|signin|signup)\b/i.test(path)) {
        authEndpoints.push(path);
      }
    }

    return {
      endpoints,
      authEndpoints,
      totalRequests: resEvents.length,
    };
  }

  // ─── Classification ───────────────────────────────────────────────

  private classify(result: {
    origin: string;
    url: string;
    perception: PerceptionResult;
    urlAnalysis?: UrlAnalysisResult;
    scripting?: ScriptingResult;
    network?: NetworkResult;
  }): ClassifiedAction[] {
    const actions: ClassifiedAction[] = [];
    const { perception } = result;

    // Site-declared actions (data-agent-action) are authoritative — emit
    // them first so they take precedence over heuristic inference.
    for (const da of result.scripting?.declaredActions ?? []) {
      actions.push({
        name: da.name,
        category: "custom",
        confidence: "high",
        elements: [{ markId: SYNTHETIC_MARK, tag: da.tag, label: da.label }],
        description: `Site-declared action "${da.name}" via data-agent-action (authoritative).`,
      });
    }

    // Search inputs → search action.
    for (const si of perception.searchInputs) {
      actions.push({
        name: "search",
        category: "search",
        confidence: "high",
        elements: [{ markId: si.markId, tag: "input", label: si.label }],
        description: `Type a query into "${si.label}" to search.`,
      });
    }

    // Forms → create / update / login / upload actions.
    for (const form of perception.forms) {
      const isLogin = form.fields.some((f) =>
        f.type === "password" || f.name.toLowerCase().includes("password"),
      ) && form.fields.some((f) =>
        f.name.toLowerCase().includes("email") || f.name.toLowerCase().includes("username"),
      );

      if (isLogin) {
        actions.push({
          name: "login",
          category: "auth",
          confidence: "high",
          elements: [{ markId: SYNTHETIC_MARK, tag: "form", label: form.submitLabel }],
          formFields: form.fields.map((f) => ({ name: f.name, type: f.type })),
          description: `Submit login form with email/username and password.`,
        });
        continue;
      }

      if (CREATE_LABELS.test(form.submitLabel)) {
        actions.push({
          name: "create",
          category: "crud",
          confidence: "high",
          elements: [{ markId: SYNTHETIC_MARK, tag: "form", label: form.submitLabel }],
          formFields: form.fields.map((f) => ({ name: f.name, type: f.type })),
          description: `Create a new item by filling and submitting this form.`,
        });
      } else if (UPDATE_LABELS.test(form.submitLabel)) {
        actions.push({
          name: "update",
          category: "crud",
          confidence: "medium",
          elements: [{ markId: SYNTHETIC_MARK, tag: "form", label: form.submitLabel }],
          formFields: form.fields.map((f) => ({ name: f.name, type: f.type })),
          description: `Update an item by modifying and submitting this form.`,
        });
      }
    }

    // Check for file inputs in DOM → upload action.
    // (We don't have DOM in classify context; perception only has forms.
    //  We check if any form labels reference upload/file.)
    const hasUploadForm = perception.forms.some((f) =>
      f.submitLabel.toLowerCase().includes("upload") ||
      f.fields.some((fd) => fd.type === "file"),
    );
    if (hasUploadForm) {
      actions.push({
        name: "upload",
        category: "upload",
        confidence: "high",
        elements: [{ markId: SYNTHETIC_MARK, tag: "form", label: "Upload" }],
        description: `Upload a file by selecting it and submitting.`,
      });
    }

    // Individual marked elements → classify by label text.
    const classifiedMarkIds = new Set(
      actions.flatMap((a) => a.elements.map((e) => e.markId)),
    );

    for (const el of perception.markedElements) {
      if (classifiedMarkIds.has(el.markId)) continue;
      const label = el.label;

      if (DELETE_LABELS.test(label)) {
        actions.push({
          name: "delete",
          category: "crud",
          confidence: "medium",
          elements: [{ markId: el.markId, tag: el.tag, label }],
          description: `Delete/remove an item. Confirm before executing.`,
        });
      } else if (EXPORT_LABELS.test(label)) {
        actions.push({
          name: "export",
          category: "export",
          confidence: "high",
          elements: [{ markId: el.markId, tag: el.tag, label }],
          description: `Export data (CSV/PDF/JSON/XML).`,
        });
      } else if (
        (el.role === "combobox" || el.role === "listbox" || el.tag === "select") &&
        perception.markedElements.some(
          (e2) => e2.markId !== el.markId && FILTER_LABELS.test(e2.label),
        )
      ) {
        actions.push({
          name: "filter",
          category: "filter",
          confidence: "high",
          elements: [
            { markId: el.markId, tag: el.tag, label },
            { markId: SYNTHETIC_MARK, tag: "button", label: "Apply" },
          ],
          description: `Select a filter option and apply.`,
        });
      }
    }

    // Nav sections discovered from URL patterns or link groups.
    const patterns = result.urlAnalysis?.discoveredPatterns ?? {};
    // Find patterns with 5+ links.
    const navPatterns = Object.entries(patterns).filter(([, count]) => count >= 5);
    for (const [pattern, count] of navPatterns) {
      const sectionName = pattern.replace(/^\//, "").replace(/\/:(\w+)/g, "");
      actions.push({
        name: "navigate_section",
        category: "navigation",
        confidence: "high",
        elements: [],
        description: `Navigate to "${sectionName}" section (${count} links found matching "${pattern}").`,
      });
    }

    return actions;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractOrigin(url: string): string {
  try {
    const u = new URL(url);
    let h = u.hostname.toLowerCase();
    if (h.startsWith("www.")) h = h.slice(4);
    return h;
  } catch {
    return url;
  }
}

function classifyUrlPattern(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts
      .map((s) => (/^\d+$/.test(s) ? ":id" : /^[a-f0-9-]{20,}$/.test(s) ? ":uuid" : s))
      .join("/") || "/";
  } catch {
    return url;
  }
}

function extractForms(dom: DomNode, depth = 0): PerceivedForm[] {
  // Only scan top-level children (depth limited).
  if (depth > 2 || !dom.childNodes) return [];

  const forms: PerceivedForm[] = [];

  for (const child of dom.childNodes) {
    if (child.nodeName === "FORM") {
      forms.push(parseForm(child));
    } else if (child.childNodes) {
      forms.push(...extractForms(child, depth + 1));
    }
  }

  return forms;
}

function parseForm(formNode: DomNode): PerceivedForm {
  const attrs = formNode.attributes ?? [];
  let action = "";
  let method = "get";
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === "action") action = attrs[i + 1] ?? "";
    if (attrs[i] === "method") method = attrs[i + 1] ?? "get";
  }

  const fields: PerceivedForm["fields"] = [];
  let submitLabel = "Submit";

  const walk = (node: DomNode): void => {
    if (node.nodeName === "INPUT" || node.nodeName === "TEXTAREA" || node.nodeName === "SELECT") {
      const a = node.attributes ?? [];
      let name = "", type = "text", required = false, placeholder = "";
      for (let i = 0; i < a.length; i += 2) {
        if (a[i] === "name") name = a[i + 1] ?? "";
        if (a[i] === "type") type = a[i + 1] ?? "text";
        if (a[i] === "required") required = true;
        if (a[i] === "placeholder") placeholder = a[i + 1] ?? "";
      }
      if (name) fields.push({ name, type, required, placeholder });
    }
    if (node.nodeName === "BUTTON" && (node.attributes ?? []).includes("submit")) {
      submitLabel = node.nodeValue ?? "Submit";
    }
    if (node.childNodes) {
      for (const c of node.childNodes) walk(c);
    }
  };

  walk(formNode);

  // If no explicit submit button found, check for button text in child text nodes.
  if (submitLabel === "Submit") {
    const collectText = (node: DomNode): string => {
      if (node.nodeValue) return node.nodeValue;
      if (node.childNodes) return node.childNodes.map(collectText).join(" ");
      return "";
    };
    const allText = collectText(formNode);
    const match = allText.match(CREATE_LABELS);
    if (match) submitLabel = match[0];
  }

  return {
    action,
    method: method.toLowerCase(),
    fieldCount: fields.length,
    fields,
    submitLabel,
  };
}

function extractNavSections(
  marks: Mark[],
  dom: DomNode,
): PerceivedNavSection[] {
  // Find <nav> elements in DOM and match their link children to marks.
  const findNavs = (node: DomNode, depth: number): DomNode[] => {
    if (depth > 2) return [];
    const result: DomNode[] = [];
    if (node.nodeName === "NAV") result.push(node);
    if (node.childNodes) {
      for (const c of node.childNodes) result.push(...findNavs(c, depth + 1));
    }
    return result;
  };

  const navNodes = findNavs(dom, 0);
  if (navNodes.length === 0) return [];

  const sections: PerceivedNavSection[] = [];
  for (const nav of navNodes) {
    const links: PerceivedNavSection["links"] = [];
    const collectLinks = (node: DomNode): void => {
      if (node.nodeName === "A") {
        const a = node.attributes ?? [];
        let href = "", text = "";
        for (let i = 0; i < a.length; i += 2) {
          if (a[i] === "href") href = a[i + 1] ?? "";
        }
        // Get text from child text nodes.
        const collectText = (n: DomNode): string => {
          if (n.nodeValue) return n.nodeValue;
          if (n.childNodes) return n.childNodes.map(collectText).join("");
          return "";
        };
        text = collectText(node).trim();
        if (href || text) links.push({ href, text });
      }
      if (node.childNodes) {
        for (const c of node.childNodes) collectLinks(c);
      }
    };
    collectLinks(nav);

    if (links.length > 0) {
      // No per-nav labelling yet (aria-label / preceding heading lookup
      // is a future refinement); all nav groups share a generic label.
      const label = "Navigation";
      sections.push({ label, linkCount: links.length, links });
    }
  }

  return sections;
}
