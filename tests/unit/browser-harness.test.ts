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
