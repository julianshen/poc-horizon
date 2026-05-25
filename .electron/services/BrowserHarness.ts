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

  /** Attach the debugger to the given webContents. Idempotent per tab. */
  attach(wc: WebContents): void {
    if (this.attachedTo === wc) return;
    if (this.attachedTo) this.detach();
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    this.attachedTo = wc;
  }

  /** Detach if attached. Safe to call multiple times. */
  detach(): void {
    if (!this.attachedTo) return;
    try {
      if (this.attachedTo.debugger.isAttached()) this.attachedTo.debugger.detach();
    } catch {
      /* webContents may be destroyed; ignore */
    }
    this.attachedTo = null;
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
}
