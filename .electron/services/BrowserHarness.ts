import { WebContents } from "electron";

/** Minimal TabManager surface used by BrowserHarness for multi-tab
 *  orchestration. Typed locally so BrowserHarness stays decoupled from
 *  the full TabManager class (which imports Electron BrowserView, etc).
 *  Real TabManager implements this implicitly. */
export interface TabManagerLike {
  createTab(url?: string): { id: string };
  closeTab(id: string): void;
  activateTab(id: string): void;
  getAllTabs(): Array<{
    id: string;
    url: string;
    title: string;
    isActive: boolean;
  }>;
  getActiveTabId(): string | null;
  getBrowserView(id: string): { webContents: WebContents } | undefined;
}

/**
 * Result types for harness primitives. JSON-serialisable so the agent
 * subprocess can consume them without special decoders.
 */
export interface ClickArgs {
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
}
export interface TypeArgs {
  text: string;
  delayMs?: number;
}
export interface ScrollArgs {
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
}
export interface ScreenshotResult {
  format: "png" | "jpeg";
  base64: string;
  width: number;
  height: number;
}
export interface ScreenshotOptions {
  /** PNG (lossless, larger) or JPEG (smaller, lossy). Defaults vary per call site. */
  format?: "png" | "jpeg";
  /** JPEG only; 1-100. Default 70. */
  quality?: number;
  /** Scale factor (e.g. 0.5) to downscale screenshot to save LLM tokens. */
  scale?: number;
}
export type EvaluateResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };
export interface Mark {
  id: number;
  x: number;
  y: number; // click target = center of rect
  w: number;
  h: number;
  tag: string;
  role: string | null;
  label: string; // accessible name / text, trimmed
  href: string | null;
}

export interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue?: string;
  attributes?: string[];
  childNodes?: DomNode[];
}

/**
 * Browser harness: wraps webContents.debugger and exposes high-level
 * browser primitives the agent uses to drive the page. The agent loop
 * (PiSession, anthropic, etc.) is intentionally NOT in this class —
 * BrowserHarness is a thin, testable IO layer.
 *
 * Pattern is inspired by browse.sh and Playwright's CDP backend: keep
 * primitives small + composable. Higher-level "skills" (login flow,
 * fill cart, etc.) belong in llms.txt or skill files, not here.
 */
export class BrowserHarness {
  private attachedTo: WebContents | null = null;
  /** CDP events buffered for the agent to collect later, keyed by method.
   *  Capped per-method to keep memory bounded. */
  private eventBuf = new Map<string, unknown[]>();
  /** Set of CDP methods the agent has subscribed to. */
  private subscribed = new Set<string>();
  /** Bound listener — kept so we can remove cleanly on detach. */
  private cdpListener:
    | ((event: Electron.Event, method: string, params: unknown) => void)
    | null = null;
  private static EVENT_BUF_CAP = 200;

  /** When set, multi-tab tools (openTab / switchTab / closeTab / listTabs)
   *  drive this TabManager. Bound by the caller via `attach(wc, tm)`. */
  private tm: TabManagerLike | null = null;

  /** Attach the debugger to the given webContents. Idempotent per tab.
   *  Optional `tm` binds a TabManager so the agent can open / switch /
   *  close tabs in addition to driving the current one. */
  attach(wc: WebContents, tm?: TabManagerLike): void {
    if (tm !== undefined) this.tm = tm;
    if (this.attachedTo === wc) return;
    if (this.attachedTo) this.detach();
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    this.attachedTo = wc;
    // Re-bind the CDP event listener so existing subscriptions resume on the new wc.
    this.cdpListener = (
      _event: Electron.Event,
      method: string,
      params: unknown,
    ): void => {
      if (!this.subscribed.has(method)) return;
      const bucket = this.eventBuf.get(method) ?? [];
      bucket.push({ at: Date.now(), method, params });
      if (bucket.length > BrowserHarness.EVENT_BUF_CAP) {
        bucket.splice(0, bucket.length - BrowserHarness.EVENT_BUF_CAP);
      }
      this.eventBuf.set(method, bucket);
    };
    wc.debugger.on("message", this.cdpListener);
  }

  /** Detach if attached. Safe to call multiple times. */
  detach(): void {
    if (!this.attachedTo) return;
    try {
      if (this.cdpListener)
        this.attachedTo.debugger.off("message", this.cdpListener);
      if (this.attachedTo.debugger.isAttached())
        this.attachedTo.debugger.detach();
    } catch {
      /* webContents may be destroyed; ignore */
    }
    this.attachedTo = null;
    this.cdpListener = null;
    // Keep subscribed set + buffered events across detach/re-attach so the
    // agent doesn't lose interest in events between turns; only an explicit
    // unsubscribe clears them.
  }

  private require(): WebContents {
    if (!this.attachedTo)
      throw new Error(
        "BrowserHarness: not attached. Call attach(webContents) first.",
      );
    return this.attachedTo;
  }

  // ─── Primitives ─────────────────────────────────────────────────────

  async navigate(url: string): Promise<void> {
    const wc = this.require();
    await wc.debugger.sendCommand("Page.navigate", { url });
  }

  async click({ x, y, button = "left" }: ClickArgs): Promise<void> {
    const wc = this.require();
    const common = { x, y, button, clickCount: 1 };
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      ...common,
      type: "mousePressed",
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      ...common,
      type: "mouseReleased",
    });
  }

  async type({ text, delayMs = 0 }: TypeArgs): Promise<void> {
    const wc = this.require();
    for (const ch of text) {
      await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
        type: "char",
        text: ch,
      });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  async scroll({
    x = 0,
    y = 0,
    deltaX = 0,
    deltaY = 0,
  }: ScrollArgs): Promise<void> {
    const wc = this.require();
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX,
      deltaY,
    });
  }

  /**
   * Screenshot the viewport with numbered boxes overlaid on every visible
   * interactive element. Returns the PNG plus a `marks` array mapping each
   * number to the click target's center + descriptor.
   *
   * Pattern: agent calls this once, then `browser_click({x, y})` with the
   * coords of mark N instead of pixel-hunting. Cuts the perception loop
   * from "screenshot → human-eye → guess pixel → verify" to "screenshot
   * → pick number". Same idea as Anthropic Computer Use's set-of-marks
   * and browser-use's SoM.
   *
   * The overlay is injected, captured, and removed in one Runtime.evaluate
   * call so we leave no DOM residue if the agent's next action races us.
   */
  async screenshotMarked({
    order = "reading",
    format = "jpeg",
    quality = 70,
    scale,
  }: { order?: "reading" | "dom" } & ScreenshotOptions = {}): Promise<
    ScreenshotResult & { marks: Mark[] }
  > {
    const wc = this.require();
    // Phase 1: mount the overlay + collect marks. Returns marks; we use them
    // *after* the screenshot so we can remove the overlay first.
    // `order` is JSON-encoded so the script is still a single self-contained
    // expression that Runtime.evaluate accepts.
    const mount = (await wc.debugger.sendCommand("Runtime.evaluate", {
      expression: MARK_INJECT_JS.replace('"__ORDER__"', JSON.stringify(order)),
      returnByValue: true,
      awaitPromise: true,
    })) as { exceptionDetails?: { text: string }; result: { value?: Mark[] } };
    if (mount.exceptionDetails)
      throw new Error(`screenshotMarked mount: ${mount.exceptionDetails.text}`);
    const marks: Mark[] = mount.result.value ?? [];
    const metrics = (await wc.debugger.sendCommand(
      "Page.getLayoutMetrics",
    )) as {
      visualViewport: { clientWidth: number; clientHeight: number };
    };
    // Phase 2: capture. JPEG default keeps marked screenshots small for
    // the high-iteration agent loop (PNG screenshots accumulate to ~MBs
    // per session and blow upstream API request limits).
    const captureParams: Record<string, unknown> =
      format === "jpeg" ? { format: "jpeg", quality } : { format: "png" };
    if (scale !== undefined) {
      captureParams.clip = {
        x: 0,
        y: 0,
        width: Math.round(metrics.visualViewport.clientWidth),
        height: Math.round(metrics.visualViewport.clientHeight),
        scale,
      };
    }
    const { data } = (await wc.debugger.sendCommand(
      "Page.captureScreenshot",
      captureParams,
    )) as { data: string };
    // Phase 3: remove the overlay. Best-effort — page may already be navigating.
    try {
      await wc.debugger.sendCommand("Runtime.evaluate", {
        expression: MARK_REMOVE_JS,
        returnByValue: true,
      });
    } catch {
      /* */
    }
    return {
      format,
      base64: data,
      width: Math.round(metrics.visualViewport.clientWidth),
      height: Math.round(metrics.visualViewport.clientHeight),
      marks,
    };
  }

  async screenshot({
    format = "jpeg",
    quality = 70,
    scale,
  }: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    const wc = this.require();
    const metrics = (await wc.debugger.sendCommand(
      "Page.getLayoutMetrics",
    )) as {
      visualViewport: { clientWidth: number; clientHeight: number };
    };
    const captureParams: Record<string, unknown> =
      format === "jpeg" ? { format: "jpeg", quality } : { format: "png" };
    if (scale !== undefined) {
      captureParams.clip = {
        x: 0,
        y: 0,
        width: Math.round(metrics.visualViewport.clientWidth),
        height: Math.round(metrics.visualViewport.clientHeight),
        scale,
      };
    }
    const { data } = (await wc.debugger.sendCommand(
      "Page.captureScreenshot",
      captureParams,
    )) as { data: string };
    return {
      format,
      base64: data,
      width: Math.round(metrics.visualViewport.clientWidth),
      height: Math.round(metrics.visualViewport.clientHeight),
    };
  }

  /**
   * Run an expression in the page's main world and return the result.
   * Returns `{ok:false, error}` on exception so the caller can decide
   * whether to surface to the agent or retry. `returnByValue` means
   * complex objects come back as JSON; functions / DOM nodes won't
   * survive the boundary (that's correct for an agent — it should
   * use querySelector + .textContent / .value patterns).
   */
  async evaluate(expression: string): Promise<EvaluateResult> {
    const wc = this.require();
    const res = (await wc.debugger.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      exceptionDetails?: { text: string; exception?: { description?: string } };
      result: { value?: unknown };
    };
    if (res.exceptionDetails) {
      const msg =
        res.exceptionDetails.exception?.description ??
        res.exceptionDetails.text;
      return { ok: false, error: msg };
    }
    return { ok: true, value: res.result.value };
  }

  /**
   * Capture the current document tree (no styles, depth-limited). Useful
   * as a low-token DOM summary for the agent — much cheaper than
   * captureSnapshot's full DOM+CSS dump. depth=-1 means full tree.
   */
  async getDom(depth = 4): Promise<DomNode> {
    const wc = this.require();
    const res = (await wc.debugger.sendCommand("DOM.getDocument", {
      depth,
      pierce: false,
    })) as { root: DomNode };
    return res.root;
  }

  async getUrl(): Promise<string> {
    return this.require().getURL();
  }

  async getTitle(): Promise<string> {
    return this.require().getTitle();
  }

  /**
   * Get the full outerHTML of the page document. Used by readerExtract
   * (Readability needs the original HTML, not just the visible text).
   */
  async getHtml(): Promise<string> {
    const r = await this.evaluate("document.documentElement.outerHTML");
    if (!r.ok) throw new Error(r.error);
    return String(r.value ?? "");
  }

  /**
   * Send an arbitrary Chrome DevTools Protocol command to the attached
   * webContents. Power-user escape hatch when the high-level primitives
   * don't cover the operation. See https://chromedevtools.github.io/devtools-protocol/
   */
  async cdp(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const wc = this.require();
    return await wc.debugger.sendCommand(method, params ?? {});
  }

  /**
   * Capture the page's accessibility tree — the same semantic
   * structure screen readers use (headings, links, buttons, ARIA
   * roles + names). Far cheaper than getDom for "find the Submit
   * button" tasks and more meaningful for LLM perception than raw DOM.
   *
   * `interestingOnly: true` (CDP default) filters out non-interactive
   * decorative nodes — what the agent actually needs.
   */
  async getAxTree(): Promise<unknown> {
    return await this.cdp("Accessibility.getFullAXTree", {});
  }

  /**
   * Wait for one of several conditions to be met, polling the page
   * with a JS predicate every ~100ms. Returns when the condition
   * holds or times out. Replaces the agent's instinct to "sleep then
   * retry" with a declarative waiter the page can satisfy as soon as
   * it's ready (often 10-100× faster than a fixed sleep).
   *
   * Conditions:
   *   { selector: 'button.submit' }      — element exists + visible
   *   { selectorGone: '.spinner' }        — element no longer in DOM
   *   { networkIdle: 500 }                — no in-flight requests for N ms
   *   { url: /\/checkout\// }             — current URL matches
   *   { predicate: 'document.title === "Done"' } — arbitrary JS expression truthy
   */
  async waitFor(args: {
    selector?: string;
    selectorGone?: string;
    networkIdleMs?: number;
    urlMatch?: string;
    predicate?: string;
    timeoutMs?: number;
  }): Promise<{ ok: boolean; reason: string }> {
    const wc = this.require();
    const timeoutMs = args.timeoutMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;
    const sel = args.selector;
    const selGone = args.selectorGone;
    const urlRe = args.urlMatch;
    const pred = args.predicate;
    const idle = args.networkIdleMs;

    // networkIdle uses Network.* events — enable the domain once.
    let lastRequestAt = Date.now();
    let idleHandler: ((event: Electron.Event, method: string) => void) | null =
      null;
    if (idle) {
      await wc.debugger.sendCommand("Network.enable", {}).catch(() => {});
      idleHandler = (_e: Electron.Event, method: string): void => {
        if (
          method === "Network.requestWillBeSent" ||
          method === "Network.responseReceived"
        ) {
          lastRequestAt = Date.now();
        }
      };
      wc.debugger.on("message", idleHandler);
    }
    const cleanup = (): void => {
      if (idleHandler) wc.debugger.off("message", idleHandler);
    };

    try {
      while (Date.now() < deadline) {
        if (sel) {
          const r = await this.evaluate(
            `(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!(e && e.offsetParent !== null);})()`,
          );
          if (r.ok && r.value === true) return { ok: true, reason: "selector" };
        }
        if (selGone) {
          const r = await this.evaluate(
            `!document.querySelector(${JSON.stringify(selGone)})`,
          );
          if (r.ok && r.value === true)
            return { ok: true, reason: "selectorGone" };
        }
        if (urlRe) {
          const re = new RegExp(urlRe);
          if (re.test(wc.getURL())) return { ok: true, reason: "urlMatch" };
        }
        if (pred) {
          const r = await this.evaluate(`!!(${pred})`);
          if (r.ok && r.value === true)
            return { ok: true, reason: "predicate" };
        }
        if (idle && Date.now() - lastRequestAt >= idle) {
          return { ok: true, reason: "networkIdle" };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ok: false, reason: "timeout" };
    } finally {
      cleanup();
    }
  }

  /**
   * Detect and remove modal/overlay/dialog elements that intercept
   * clicks. Targets the common pattern: fixed-position elements with
   * high z-index covering most of the viewport. Returns the count of
   * removed elements so the agent knows whether to retry the action.
   *
   * Heuristics:
   *  - position: fixed | sticky | absolute (covering viewport)
   *  - z-index >= 100 OR contains role="dialog" / aria-modal="true"
   *  - covers >25% of viewport area
   *  - body/html `overflow: hidden` styles also stripped (modal scroll lock)
   */
  async dismissOverlays(): Promise<{ removed: number; nodes: string[] }> {
    const r = await this.evaluate(`(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const removed = [];
      const candidates = Array.from(document.querySelectorAll('*'));
      for (const el of candidates) {
        const cs = window.getComputedStyle(el);
        const pos = cs.position;
        const ariaModal = el.getAttribute('aria-modal') === 'true';
        const role = el.getAttribute('role');
        const isModalRole = role === 'dialog' || role === 'alertdialog';
        const zi = parseInt(cs.zIndex, 10) || 0;
        if (!ariaModal && !isModalRole && zi < 100) continue;
        if (pos !== 'fixed' && pos !== 'sticky' && pos !== 'absolute') continue;
        const r = el.getBoundingClientRect();
        const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) *
                     Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        if (area < vw * vh * 0.25) continue;
        const tag = el.tagName.toLowerCase();
        const id = el.id ? ('#' + el.id) : '';
        const cls = (el.className && typeof el.className === 'string')
          ? '.' + el.className.split(/\\s+/).slice(0,2).join('.') : '';
        removed.push(tag + id + cls);
        el.remove();
      }
      // Strip body/html scroll locks so the user (and agent) can scroll again.
      for (const el of [document.body, document.documentElement]) {
        if (el && window.getComputedStyle(el).overflow === 'hidden') {
          el.style.overflow = 'auto';
        }
      }
      return { removed: removed.length, nodes: removed };
    })()`);
    if (!r.ok) return { removed: 0, nodes: [] };
    return r.value as { removed: number; nodes: string[] };
  }

  /**
   * Describe the element that would receive a click at (x, y). Used
   * as fallback error context when click() does the right thing
   * physically but the page intercepted it (modal, transparent
   * overlay, click-jacking layer). Returns the tag, id, classes,
   * bounding rect, and aria-role of the element at the point.
   */
  /**
   * Subscribe to a CDP event method. Events arriving while subscribed
   * land in an in-memory ring buffer the agent can drain later with
   * collectEvents(). Auto-enables the matching CDP domain so the
   * agent doesn't have to think about Network.enable / Page.enable etc.
   *
   * Example:
   *   subscribeEvent('Network.responseReceived')
   *   // user clicks a button → events accumulate
   *   collectEvents() → ten Network.responseReceived events
   */
  async subscribeEvent(method: string): Promise<{ ok: boolean }> {
    if (!method.includes(".")) return { ok: false };
    this.subscribed.add(method);
    if (!this.eventBuf.has(method)) this.eventBuf.set(method, []);
    const domain = method.split(".")[0];
    try {
      await this.cdp(`${domain}.enable`, {});
    } catch {
      /* not all domains have .enable */
    }
    return { ok: true };
  }

  /** Stop receiving a specific method, or all methods if no arg. */
  unsubscribeEvent(method?: string): { ok: boolean; cleared: number } {
    if (!method) {
      const n = this.subscribed.size;
      this.subscribed.clear();
      this.eventBuf.clear();
      return { ok: true, cleared: n };
    }
    this.subscribed.delete(method);
    this.eventBuf.delete(method);
    return { ok: true, cleared: 1 };
  }

  /**
   * Drain buffered events. After drain, the buffer for the given method
   * (or all methods) is cleared so the next collect only returns NEW
   * events. Caller can pass a method to filter, otherwise gets all.
   */
  collectEvents(method?: string, max?: number): unknown[] {
    if (method) {
      const bucket = this.eventBuf.get(method) ?? [];
      const out = max ? bucket.slice(0, max) : bucket;
      this.eventBuf.set(method, max ? bucket.slice(out.length) : []);
      return out;
    }
    const all: unknown[] = [];
    for (const [m, bucket] of this.eventBuf) {
      for (const ev of bucket) {
        all.push(ev);
        if (max && all.length >= max) break;
      }
      if (max && all.length >= max) break;
      this.eventBuf.set(m, []);
    }
    return all;
  }

  // ─── Multi-tab orchestration ────────────────────────────────────────

  private requireTm(): TabManagerLike {
    if (!this.tm)
      throw new Error(
        "BrowserHarness: no TabManager bound. Multi-tab ops require attach(wc, tm).",
      );
    return this.tm;
  }

  /** Open a new tab, switch the harness's debugger to it, return the descriptor. */
  openTab(url?: string): {
    id: string;
    url: string;
    title: string;
    isActive: boolean;
  } {
    const tm = this.requireTm();
    const tab = tm.createTab(url);
    tm.activateTab(tab.id);
    const view = tm.getBrowserView(tab.id);
    if (view) this.attach(view.webContents);
    const full = tm.getAllTabs().find((t) => t.id === tab.id);
    return full ?? { id: tab.id, url: url ?? "", title: "", isActive: true };
  }

  /** Switch the active tab + re-attach the debugger to its webContents. */
  switchTab(id: string): {
    id: string;
    url: string;
    title: string;
    isActive: boolean;
  } {
    const tm = this.requireTm();
    const tab = tm.getAllTabs().find((t) => t.id === id);
    if (!tab) throw new Error(`switchTab: unknown tab ${id}`);
    tm.activateTab(id);
    const view = tm.getBrowserView(id);
    if (view) this.attach(view.webContents);
    return { ...tab, isActive: true };
  }

  closeTabById(id: string): { closed: boolean } {
    const tm = this.requireTm();
    const before = tm.getAllTabs().length;
    tm.closeTab(id);
    const after = tm.getAllTabs().length;
    // If the closed tab was the one we were attached to, the next-active
    // tab's wc isn't ours yet — caller should call switchTab if it wants
    // to keep going. listTabs() will report whichever became active.
    return { closed: after < before };
  }

  listTabs(): Array<{
    id: string;
    url: string;
    title: string;
    isActive: boolean;
  }> {
    return this.requireTm().getAllTabs();
  }

  /**
   * Inject + call a saved JS helper from a HelperRegistry. The
   * registry's inlineInjection() defines window.__horizon.helpers,
   * then we call the named function with the supplied args.
   */
  async callHelper(
    registryInjection: string,
    name: string,
    args: unknown[] = [],
  ): Promise<EvaluateResult> {
    const callExpr = `(function(){
      ${registryInjection};
      var fn = window.__horizon && window.__horizon.helpers && window.__horizon.helpers[${JSON.stringify(name)}];
      if (typeof fn !== 'function') return { __horizonError: 'helper not found: ' + ${JSON.stringify(name)} };
      return fn.apply(null, ${JSON.stringify(args)});
    })()`;
    return await this.evaluate(callExpr);
  }

  async describeElementAt(x: number, y: number): Promise<unknown> {
    const r = await this.evaluate(`(() => {
      const el = document.elementFromPoint(${x}, ${y});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean),
        role: el.getAttribute('role') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        text: (el.textContent || '').slice(0, 80).trim(),
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      };
    })()`);
    return r.ok ? r.value : null;
  }
}

/**
 * Page-side script: find visible interactive elements, draw numbered
 * badges over them in a single mount, return the rect + descriptor of
 * each. The overlay is a single absolutely-positioned div with
 * `id="__horizon_marks"`; removal is one line. Each badge is rendered
 * as an inline-block with a fixed style so we don't pollute the page's
 * own CSS.
 */
const MARK_INJECT_JS = `(() => {
  const ORDER = "__ORDER__";
  const PREV = document.getElementById('__horizon_marks');
  if (PREV) PREV.remove();
  const cap = 80;
  const sel = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]',
    '[role=checkbox]', '[role=radio]', '[role=switch]',
    '[contenteditable=""]', '[contenteditable=true]', '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  const vw = window.innerWidth, vh = window.innerHeight;
  const seen = new Set();
  // Phase 1: collect candidate rects (no numbering, no painting yet).
  const cand = [];
  for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
    const label = (el.getAttribute('aria-label') ||
                   el.getAttribute('title') ||
                   el.getAttribute('placeholder') ||
                   el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    cand.push({
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
      h: Math.round(r.height),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      label,
      href: el.getAttribute('href'),
      _rect: { l: r.left, t: r.top, w: r.width, h: r.height },
    });
  }
  // Phase 2: re-rank by visual reading order (top-to-bottom rows, left-to-right
  // within a row). DOM order is hostile here — a sticky footer or absolutely-
  // positioned nav can give "click 3" wildly counterintuitive coordinates.
  if (ORDER === 'reading') {
    // Cluster by y. Row tolerance scales with median element height so dense
    // grids cluster differently from text-paragraphs of icons.
    const heights = cand.map(c => c.h).sort((a, b) => a - b);
    const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 24;
    const rowTol = Math.max(8, Math.min(medianH * 0.6, 40));
    // Sort by y first so we can sweep rows in order.
    const byY = cand.slice().sort((a, b) => a._rect.t - b._rect.t);
    const rows = [];
    for (const c of byY) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(c._rect.t - last[0]._rect.t) <= rowTol) last.push(c);
      else rows.push([c]);
    }
    for (const row of rows) row.sort((a, b) => a._rect.l - b._rect.l);
    cand.length = 0;
    for (const row of rows) for (const c of row) cand.push(c);
  }
  // Phase 3: number + paint.
  const marks = cand.slice(0, cap).map((c, i) => ({ id: i + 1, ...c }));
  const overlay = document.createElement('div');
  overlay.id = '__horizon_marks';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const colors = ['#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#46f0f0','#f032e6'];
  for (const m of marks) {
    const r = m._rect;
    const box = document.createElement('div');
    const c = colors[(m.id - 1) % colors.length];
    box.style.cssText = 'position:absolute;left:'+r.l+'px;top:'+r.t+'px;width:'+r.w+'px;height:'+r.h+'px;border:2px solid '+c+';box-sizing:border-box';
    const tag = document.createElement('div');
    tag.textContent = String(m.id);
    tag.style.cssText = 'position:absolute;left:-2px;top:-18px;background:'+c+';color:#fff;font:bold 12px/16px sans-serif;padding:0 4px;min-width:14px;text-align:center;border-radius:2px';
    box.appendChild(tag);
    overlay.appendChild(box);
    delete m._rect;
  }
  document.documentElement.appendChild(overlay);
  return marks;
})()`;

const MARK_REMOVE_JS = `(() => { const o = document.getElementById('__horizon_marks'); if (o) o.remove(); })()`;

/**
 * Shape of an as-yet-unsorted mark candidate. Mirrors the object built
 * by MARK_INJECT_JS phase 1, before numbering. `_rect` is the original
 * page-coordinate rectangle the sort needs to read.
 */
export interface RawMark {
  x: number;
  y: number;
  w: number;
  h: number;
  tag: string;
  role: string | null;
  label: string;
  href: string | null;
  _rect: { l: number; t: number; w: number; h: number };
}

/**
 * Visual reading-order rerank: cluster by y into rows (tolerance scales
 * with the median element height so dense grids and loose paragraphs
 * cluster sensibly), then sort each row left-to-right. The exact same
 * algorithm runs inside MARK_INJECT_JS — exported here so it's testable
 * without a real DOM.
 */
export function rerankMarksReadingOrder<T extends RawMark>(marks: T[]): T[] {
  if (marks.length === 0) return marks;
  const heights = marks.map((m) => m.h).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)];
  const rowTol = Math.max(8, Math.min(medianH * 0.6, 40));
  const byY = marks.slice().sort((a, b) => a._rect.t - b._rect.t);
  const rows: T[][] = [];
  for (const c of byY) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(c._rect.t - last[0]._rect.t) <= rowTol) last.push(c);
    else rows.push([c]);
  }
  for (const row of rows) row.sort((a, b) => a._rect.l - b._rect.l);
  return rows.flat();
}
