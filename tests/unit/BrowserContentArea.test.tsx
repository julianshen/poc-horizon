// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { BrowserContentArea } from "@/components/chrome/BrowserContentArea";
import { useBrowserStore } from "@/stores/browserStore";

// jsdom doesn't ship ResizeObserver. A minimal stub: capture the
// observed element so each test can synthesise a "resize fired" event.
class StubResizeObserver {
  static last: StubResizeObserver | null = null;
  cb: ResizeObserverCallback;
  observed: Element | null = null;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    StubResizeObserver.last = this;
  }
  observe(el: Element): void {
    this.observed = el;
  }
  unobserve(): void {}
  disconnect(): void {}
  trigger(): void {
    this.cb([], this as unknown as ResizeObserver);
  }
}
(
  globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }
).ResizeObserver = StubResizeObserver;

// jsdom's requestAnimationFrame uses a real ~16ms timer. Replace with a
// synchronous version so we can assert on the first frame's IPC call
// without waiting.
const rafFns: Array<FrameRequestCallback> = [];
(
  globalThis as unknown as {
    requestAnimationFrame: (cb: FrameRequestCallback) => number;
  }
).requestAnimationFrame = (cb: FrameRequestCallback): number => {
  rafFns.push(cb);
  return rafFns.length;
};
(
  globalThis as unknown as { cancelAnimationFrame: (id: number) => void }
).cancelAnimationFrame = (): void => {};
function flushRaf(): void {
  const fns = rafFns.splice(0);
  for (const fn of fns) fn(performance.now());
}

describe("BrowserContentArea (renderer-reported content bounds)", () => {
  const { api } = setupRendererTest();

  it("reports its bounding rect via ui:contentBounds on mount", () => {
    // Pin a deterministic rect on the placeholder div.
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        x: 12,
        y: 146,
        top: 146,
        left: 12,
        right: 892,
        bottom: 746,
        width: 880,
        height: 600,
        toJSON: () => ({}),
      },
    );
    render(<BrowserContentArea />);
    flushRaf();
    const call = api().invokes.find((i) => i.channel === "ui:contentBounds");
    expect(call).toBeDefined();
    expect(call!.payload).toMatchObject({
      x: 12,
      y: 146,
      width: 880,
      height: 600,
    });
  });

  it("re-reports when the showAI store flag toggles", () => {
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        x: 12,
        y: 146,
        top: 146,
        left: 12,
        right: 892,
        bottom: 746,
        width: 880,
        height: 600,
        toJSON: () => ({}),
      },
    );
    render(<BrowserContentArea />);
    flushRaf();
    const before = api().invokes.filter(
      (i) => i.channel === "ui:contentBounds",
    ).length;
    act(() => useBrowserStore.setState({ showAI: true }));
    flushRaf();
    const after = api().invokes.filter(
      (i) => i.channel === "ui:contentBounds",
    ).length;
    expect(after).toBeGreaterThan(before);
  });

  it("re-reports when ResizeObserver fires (window resize triggers reflow)", () => {
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        x: 12,
        y: 146,
        top: 146,
        left: 12,
        right: 892,
        bottom: 746,
        width: 880,
        height: 600,
        toJSON: () => ({}),
      },
    );
    render(<BrowserContentArea />);
    flushRaf();
    const before = api().invokes.filter(
      (i) => i.channel === "ui:contentBounds",
    ).length;
    StubResizeObserver.last!.trigger();
    flushRaf();
    const after = api().invokes.filter(
      (i) => i.channel === "ui:contentBounds",
    ).length;
    expect(after).toBe(before + 1);
  });

  it("reports 0×0 when an obscuring overlay is open (menu, palette, panel)", () => {
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        x: 12,
        y: 146,
        top: 146,
        left: 12,
        right: 892,
        bottom: 746,
        width: 880,
        height: 600,
        toJSON: () => ({}),
      },
    );
    render(<BrowserContentArea />);
    flushRaf();
    act(() => useBrowserStore.setState({ showCmd: true }));
    flushRaf();
    const last = api()
      .invokes.filter((i) => i.channel === "ui:contentBounds")
      .slice(-1)[0];
    expect(last.payload).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("restores the measured rect when the overlay closes", () => {
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        x: 12,
        y: 146,
        top: 146,
        left: 12,
        right: 892,
        bottom: 746,
        width: 880,
        height: 600,
        toJSON: () => ({}),
      },
    );
    render(<BrowserContentArea />);
    flushRaf();
    act(() => useBrowserStore.setState({ showAppMenu: true }));
    flushRaf();
    act(() => useBrowserStore.setState({ showAppMenu: false }));
    flushRaf();
    const last = api()
      .invokes.filter((i) => i.channel === "ui:contentBounds")
      .slice(-1)[0];
    expect(last.payload).toMatchObject({
      x: 12,
      y: 146,
      width: 880,
      height: 600,
    });
  });

  it("re-reports on window resize", () => {
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        x: 12,
        y: 146,
        top: 146,
        left: 12,
        right: 892,
        bottom: 746,
        width: 880,
        height: 600,
        toJSON: () => ({}),
      },
    );
    render(<BrowserContentArea />);
    flushRaf();
    const before = api().invokes.filter(
      (i) => i.channel === "ui:contentBounds",
    ).length;
    window.dispatchEvent(new Event("resize"));
    flushRaf();
    const after = api().invokes.filter(
      (i) => i.channel === "ui:contentBounds",
    ).length;
    expect(after).toBe(before + 1);
  });
});
