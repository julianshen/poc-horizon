import { WebContents } from 'electron';

/**
 * Result types for harness primitives. JSON-serialisable so the agent
 * subprocess can consume them without special decoders.
 */
export interface ClickArgs { x: number; y: number; button?: 'left' | 'right' | 'middle' }
export interface TypeArgs { text: string; delayMs?: number }
export interface ScrollArgs { x?: number; y?: number; deltaX?: number; deltaY?: number }
export interface ScreenshotResult { format: 'png'; base64: string; width: number; height: number }
export type EvaluateResult = { ok: true; value: unknown } | { ok: false; error: string };
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
  private cdpListener: ((event: Electron.Event, method: string, params: unknown) => void) | null = null;
  private static EVENT_BUF_CAP = 200;

  /** Attach the debugger to the given webContents. Idempotent per tab. */
  attach(wc: WebContents): void {
    if (this.attachedTo === wc) return;
    if (this.attachedTo) this.detach();
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    this.attachedTo = wc;
    // Re-bind the CDP event listener so existing subscriptions resume on the new wc.
    this.cdpListener = (_event: Electron.Event, method: string, params: unknown): void => {
      if (!this.subscribed.has(method)) return;
      const bucket = this.eventBuf.get(method) ?? [];
      bucket.push({ at: Date.now(), method, params });
      if (bucket.length > BrowserHarness.EVENT_BUF_CAP) {
        bucket.splice(0, bucket.length - BrowserHarness.EVENT_BUF_CAP);
      }
      this.eventBuf.set(method, bucket);
    };
    wc.debugger.on('message', this.cdpListener);
  }

  /** Detach if attached. Safe to call multiple times. */
  detach(): void {
    if (!this.attachedTo) return;
    try {
      if (this.cdpListener) this.attachedTo.debugger.off('message', this.cdpListener);
      if (this.attachedTo.debugger.isAttached()) this.attachedTo.debugger.detach();
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
    if (!this.attachedTo) throw new Error('BrowserHarness: not attached. Call attach(webContents) first.');
    return this.attachedTo;
  }

  // ─── Primitives ─────────────────────────────────────────────────────

  async navigate(url: string): Promise<void> {
    const wc = this.require();
    await wc.debugger.sendCommand('Page.navigate', { url });
  }

  async click({ x, y, button = 'left' }: ClickArgs): Promise<void> {
    const wc = this.require();
    const common = { x, y, button, clickCount: 1 };
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { ...common, type: 'mousePressed' });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', { ...common, type: 'mouseReleased' });
  }

  async type({ text, delayMs = 0 }: TypeArgs): Promise<void> {
    const wc = this.require();
    for (const ch of text) {
      await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: ch });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  async scroll({ x = 0, y = 0, deltaX = 0, deltaY = 0 }: ScrollArgs): Promise<void> {
    const wc = this.require();
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x, y, deltaX, deltaY,
    });
  }

  async screenshot(): Promise<ScreenshotResult> {
    const wc = this.require();
    const { data } = (await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' })) as { data: string };
    const metrics = (await wc.debugger.sendCommand('Page.getLayoutMetrics')) as {
      visualViewport: { clientWidth: number; clientHeight: number };
    };
    return {
      format: 'png',
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
    const res = (await wc.debugger.sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { exceptionDetails?: { text: string; exception?: { description?: string } }; result: { value?: unknown } };
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
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
    const res = (await wc.debugger.sendCommand('DOM.getDocument', {
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
    const r = await this.evaluate('document.documentElement.outerHTML');
    if (!r.ok) throw new Error(r.error);
    return String(r.value ?? '');
  }

  /**
   * Send an arbitrary Chrome DevTools Protocol command to the attached
   * webContents. Power-user escape hatch when the high-level primitives
   * don't cover the operation. See https://chromedevtools.github.io/devtools-protocol/
   */
  async cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
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
    return await this.cdp('Accessibility.getFullAXTree', {});
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
    let idleHandler: ((event: Electron.Event, method: string) => void) | null = null;
    if (idle) {
      await wc.debugger.sendCommand('Network.enable', {}).catch(() => {});
      idleHandler = (_e: Electron.Event, method: string): void => {
        if (method === 'Network.requestWillBeSent' || method === 'Network.responseReceived') {
          lastRequestAt = Date.now();
        }
      };
      wc.debugger.on('message', idleHandler);
    }
    const cleanup = (): void => { if (idleHandler) wc.debugger.off('message', idleHandler); };

    try {
      while (Date.now() < deadline) {
        if (sel) {
          const r = await this.evaluate(
            `(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!(e && e.offsetParent !== null);})()`
          );
          if (r.ok && r.value === true) return { ok: true, reason: 'selector' };
        }
        if (selGone) {
          const r = await this.evaluate(`!document.querySelector(${JSON.stringify(selGone)})`);
          if (r.ok && r.value === true) return { ok: true, reason: 'selectorGone' };
        }
        if (urlRe) {
          const re = new RegExp(urlRe);
          if (re.test(wc.getURL())) return { ok: true, reason: 'urlMatch' };
        }
        if (pred) {
          const r = await this.evaluate(`!!(${pred})`);
          if (r.ok && r.value === true) return { ok: true, reason: 'predicate' };
        }
        if (idle && Date.now() - lastRequestAt >= idle) {
          return { ok: true, reason: 'networkIdle' };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return { ok: false, reason: 'timeout' };
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
    if (!method.includes('.')) return { ok: false };
    this.subscribed.add(method);
    if (!this.eventBuf.has(method)) this.eventBuf.set(method, []);
    const domain = method.split('.')[0];
    try { await this.cdp(`${domain}.enable`, {}); } catch { /* not all domains have .enable */ }
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

  /**
   * Inject + call a saved JS helper from a HelperRegistry. The
   * registry's inlineInjection() defines window.__horizon.helpers,
   * then we call the named function with the supplied args.
   */
  async callHelper(registryInjection: string, name: string, args: unknown[] = []): Promise<EvaluateResult> {
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
