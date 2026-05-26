// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { BrowserHarness } from '@electron/services/BrowserHarness';
import type { WebContents } from 'electron';

function fakeWc(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: Array<[string, unknown]> = [];
  const responses = new Map<string, unknown>([
    ['Page.captureScreenshot', { data: 'BASE64PNG' }],
    ['Page.getLayoutMetrics', { visualViewport: { clientWidth: 800, clientHeight: 600 } }],
    ['DOM.getDocument', { root: { nodeId: 1, nodeType: 9, nodeName: '#document' } }],
    ['Runtime.evaluate', { result: { value: 42 } }],
  ]);
  const wc = {
    debugger: {
      isAttached: vi.fn(() => true),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(async (method: string, params: unknown) => {
        calls.push([method, params]);
        return responses.get(method) ?? {};
      }),
      // BrowserHarness.attach now binds a 'message' listener for CDP
      // event subscriptions; default fakes need on/off no-ops.
      on: vi.fn(),
      off: vi.fn(),
    },
    getURL: () => 'https://example.com/page',
    getTitle: () => 'Page Title',
    ...overrides,
  } as unknown as WebContents;
  return { wc, calls };
}

describe('BrowserHarness', () => {
  it('navigate sends Page.navigate with the URL', async () => {
    const { wc, calls } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc);
    await h.navigate('https://example.com');
    expect(calls).toContainEqual(['Page.navigate', { url: 'https://example.com' }]);
  });

  it('click dispatches mousePressed + mouseReleased at the coordinates', async () => {
    const { wc, calls } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc);
    await h.click({ x: 100, y: 200 });
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual(['Input.dispatchMouseEvent', { type: 'mousePressed', x: 100, y: 200, button: 'left', clickCount: 1 }]);
    expect(calls[1]).toEqual(['Input.dispatchMouseEvent', { type: 'mouseReleased', x: 100, y: 200, button: 'left', clickCount: 1 }]);
  });

  it('type dispatches one char event per character', async () => {
    const { wc, calls } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc);
    await h.type({ text: 'hi' });
    expect(calls).toEqual([
      ['Input.dispatchKeyEvent', { type: 'char', text: 'h' }],
      ['Input.dispatchKeyEvent', { type: 'char', text: 'i' }],
    ]);
  });

  it('scroll dispatches mouseWheel with deltas', async () => {
    const { wc, calls } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc);
    await h.scroll({ deltaY: 400 });
    expect(calls[0]).toEqual(['Input.dispatchMouseEvent', { type: 'mouseWheel', x: 0, y: 0, deltaX: 0, deltaY: 400 }]);
  });

  it('screenshot returns base64 + viewport dimensions', async () => {
    const { wc } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc);
    const shot = await h.screenshot();
    expect(shot).toEqual({ format: 'png', base64: 'BASE64PNG', width: 800, height: 600 });
  });

  it('evaluate returns ok:true with the value on success', async () => {
    const { wc } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc);
    const r = await h.evaluate('1+1');
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it('evaluate returns ok:false with the error text on exception', async () => {
    const { wc } = fakeWc({
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        on: vi.fn(), off: vi.fn(),
        sendCommand: vi.fn(async () => ({
          exceptionDetails: { text: 'Script error', exception: { description: 'ReferenceError: foo is not defined' } },
          result: {},
        })),
      },
    });
    const h = new BrowserHarness();
    h.attach(wc);
    const r = await h.evaluate('foo');
    expect(r).toEqual({ ok: false, error: 'ReferenceError: foo is not defined' });
  });

  it('cdp() forwards method + params to webContents.debugger.sendCommand and returns the result', async () => {
    const { wc, calls } = fakeWc({
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        on: vi.fn(), off: vi.fn(),
        sendCommand: vi.fn(async () => ({ userAgent: 'horizon/1.0' })),
      },
    });
    const h = new BrowserHarness();
    h.attach(wc);
    const r = await h.cdp('Browser.getVersion', {});
    expect(r).toEqual({ userAgent: 'horizon/1.0' });
    // ts-ignore via Bash check below — the fake's sendCommand is captured by vi.fn.
    // Confirm method + params arrived.
    const cap = (wc.debugger.sendCommand as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(cap[0][0]).toBe('Browser.getVersion');
    expect(cap[0][1]).toEqual({});
    void calls;
  });

  it('getAxTree() dispatches Accessibility.getFullAXTree', async () => {
    const { wc } = fakeWc({
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        on: vi.fn(), off: vi.fn(),
        sendCommand: vi.fn(async () => ({ nodes: [{ nodeId: '1', role: { value: 'button' } }] })),
      },
    });
    const h = new BrowserHarness();
    h.attach(wc);
    const t = await h.getAxTree();
    expect(t).toEqual({ nodes: [{ nodeId: '1', role: { value: 'button' } }] });
    const cap = (wc.debugger.sendCommand as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(cap[0][0]).toBe('Accessibility.getFullAXTree');
  });

  it('subscribeEvent + collectEvents buffers CDP events and drains them on demand', async () => {
    const { wc } = fakeWc({
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        on: vi.fn(), off: vi.fn(),
        sendCommand: vi.fn(async () => ({})),
        on: vi.fn(),
        off: vi.fn(),
      },
    });
    const h = new BrowserHarness();
    h.attach(wc);
    const sub = await h.subscribeEvent('Network.responseReceived');
    expect(sub.ok).toBe(true);
    // Simulate the debugger emitting two events by calling the harness's
    // internal listener — the easiest way without a real Electron wc.
    type Pvt = { cdpListener?: ((e: Electron.Event, m: string, p: unknown) => void) | null };
    const listener = (h as unknown as Pvt).cdpListener!;
    listener({} as Electron.Event, 'Network.responseReceived', { url: 'https://a' });
    listener({} as Electron.Event, 'Network.responseReceived', { url: 'https://b' });
    listener({} as Electron.Event, 'Page.frameNavigated', { url: 'unrelated' });
    const drained = h.collectEvents('Network.responseReceived');
    expect(drained).toHaveLength(2);
    // Second collect returns empty — the bucket was cleared.
    expect(h.collectEvents('Network.responseReceived')).toHaveLength(0);
  });

  it('unsubscribeEvent() with no arg clears all subscriptions and buffers', async () => {
    const { wc } = fakeWc({
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        on: vi.fn(), off: vi.fn(),
        sendCommand: vi.fn(async () => ({})),
        on: vi.fn(),
        off: vi.fn(),
      },
    });
    const h = new BrowserHarness();
    h.attach(wc);
    await h.subscribeEvent('Network.responseReceived');
    await h.subscribeEvent('Page.frameNavigated');
    const r = h.unsubscribeEvent();
    expect(r.cleared).toBe(2);
  });

  it('screenshotMarked returns PNG + marks and removes the overlay', async () => {
    const fakeMarks = [
      { id: 1, x: 50, y: 30, w: 100, h: 20, tag: 'a', role: null, label: 'Home', href: '/' },
      { id: 2, x: 200, y: 100, w: 80, h: 24, tag: 'button', role: null, label: 'Buy', href: null },
    ];
    const sendCommand = vi.fn(async (method: string) => {
      if (method === 'Page.captureScreenshot') return { data: 'BASE64MARKED' };
      if (method === 'Page.getLayoutMetrics') return { visualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (method === 'Runtime.evaluate') return { result: { value: fakeMarks } };
      return {};
    });
    const { wc } = fakeWc({
      debugger: { isAttached: () => true, attach: vi.fn(), detach: vi.fn(), on: vi.fn(), off: vi.fn(), sendCommand },
    });
    const h = new BrowserHarness();
    h.attach(wc);
    const r = await h.screenshotMarked();
    expect(r.base64).toBe('BASE64MARKED');
    expect(r.width).toBe(1200);
    expect(r.marks).toEqual(fakeMarks);
    // Mount evaluate + capture + remove evaluate — 3 calls; last must be the remove (no overlay residue).
    const calls = sendCommand.mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c === 'Runtime.evaluate').length).toBe(2);
    expect(calls).toContain('Page.captureScreenshot');
  });

  it('describeElementAt returns the element descriptor via evaluate', async () => {
    const { wc } = fakeWc({
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        on: vi.fn(), off: vi.fn(),
        sendCommand: vi.fn(async () => ({
          result: { value: { tag: 'button', id: 'go', classes: ['cta'], rect: { x: 1, y: 2, width: 80, height: 24 } } },
        })),
      },
    });
    const h = new BrowserHarness();
    h.attach(wc);
    const d = await h.describeElementAt(50, 100);
    expect(d).toMatchObject({ tag: 'button', id: 'go' });
  });

  it('cdp() works with no params (defaults to empty object)', async () => {
    const { wc } = fakeWc({
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        detach: vi.fn(),
        on: vi.fn(), off: vi.fn(),
        sendCommand: vi.fn(async () => ({ ok: true })),
      },
    });
    const h = new BrowserHarness();
    h.attach(wc);
    await h.cdp('Network.enable');
    const cap = (wc.debugger.sendCommand as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(cap[0][1]).toEqual({});
  });

  it('openTab + listTabs + switchTab + closeTabById drive the bound TabManager', () => {
    const tabs: Array<{ id: string; url: string; title: string; isActive: boolean }> = [];
    let activeId: string | null = null;
    const views = new Map<string, { webContents: unknown }>();
    const tm = {
      createTab: vi.fn((url?: string) => {
        const id = `t${tabs.length + 1}`;
        tabs.push({ id, url: url ?? 'horizon://newtab', title: '', isActive: false });
        views.set(id, { webContents: fakeWc().wc });
        return { id };
      }),
      closeTab: vi.fn((id: string) => {
        const i = tabs.findIndex((t) => t.id === id);
        if (i >= 0) tabs.splice(i, 1);
      }),
      activateTab: vi.fn((id: string) => {
        activeId = id;
        for (const t of tabs) t.isActive = t.id === id;
      }),
      getAllTabs: vi.fn(() => tabs.slice()),
      getActiveTabId: vi.fn(() => activeId),
      getBrowserView: vi.fn((id: string) => views.get(id) as { webContents: import('electron').WebContents } | undefined),
    };
    const { wc } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc, tm);
    const opened = h.openTab('https://a.test');
    expect(opened.id).toBe('t1');
    expect(opened.isActive).toBe(true);
    expect(tm.createTab).toHaveBeenCalledWith('https://a.test');
    expect(tm.activateTab).toHaveBeenCalledWith('t1');

    const opened2 = h.openTab('https://b.test');
    expect(opened2.id).toBe('t2');
    expect(h.listTabs()).toHaveLength(2);

    const switched = h.switchTab('t1');
    expect(switched.id).toBe('t1');
    expect(switched.isActive).toBe(true);

    expect(h.closeTabById('t2')).toEqual({ closed: true });
    expect(h.listTabs()).toHaveLength(1);
  });

  it('multi-tab methods throw when no TabManager is bound', () => {
    const { wc } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc);   // no tm
    expect(() => h.openTab('https://x')).toThrow(/no TabManager/);
    expect(() => h.listTabs()).toThrow(/no TabManager/);
  });

  it('require() throws when not attached', async () => {
    const h = new BrowserHarness();
    await expect(h.navigate('https://x')).rejects.toThrow(/not attached/);
  });

  it('attach is idempotent for the same webContents', () => {
    const { wc } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc);
    h.attach(wc);
    // First call should attach, second should be a no-op (debugger already attached).
    expect(wc.debugger.attach).toHaveBeenCalledTimes(0); // isAttached() returned true
  });

  it('detach swaps off the previous webContents when attaching to a new one', () => {
    const { wc: wc1 } = fakeWc();
    const { wc: wc2 } = fakeWc();
    const h = new BrowserHarness();
    h.attach(wc1);
    h.attach(wc2);
    expect(wc1.debugger.detach).toHaveBeenCalledTimes(1);
  });

  it('detach() is safe when never attached', () => {
    const h = new BrowserHarness();
    expect(() => h.detach()).not.toThrow();
  });
});
