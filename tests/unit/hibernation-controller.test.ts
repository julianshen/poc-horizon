// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { HibernationController } from "@electron/services/HibernationController";

type Tab = {
  id: string;
  url: string;
  pinned: boolean;
  hibernated: boolean;
  createdAt: number;
  audible?: boolean;
  loading?: boolean;
};

function makeFakeTabManager(tabs: Tab[], activeId: string | null) {
  const tabMap = new Map(tabs.map((t) => [t.id, { ...t }]));
  return {
    getAllTabs: () => Array.from(tabMap.values()),
    getActiveTabId: () => activeId,
    isLoading: (id: string) => !!tabMap.get(id)?.loading,
    isAudible: (id: string) => !!tabMap.get(id)?.audible,
    isIncognito: () => false,
    hibernateTab: vi.fn((id: string) => {
      const t = tabMap.get(id);
      if (!t || t.id === activeId || t.hibernated) return false;
      t.hibernated = true;
      return true;
    }),
  };
}

const defaultSettings = {
  autoHibernate: true,
  hibernationTimeoutMinutes: 30,
  maxActiveTabs: 20,
};

describe("HibernationController.sweep — time-based", () => {
  it("hibernates a tab idle past the timeout", () => {
    const tm = makeFakeTabManager(
      [
        { id: "a", url: "https://a", pinned: false, hibernated: false, createdAt: 0 },
        { id: "b", url: "https://b", pinned: false, hibernated: false, createdAt: 0 },
      ],
      "a",
    );
    let now = 0;
    const c = new HibernationController({
      tabManager: tm as never,
      getSettings: () => defaultSettings,
      now: () => now,
    });
    c.noteActivated("a");
    c.noteActivated("b");
    now = 30 * 60_000;
    c.sweep();
    expect(tm.hibernateTab).toHaveBeenCalledWith("b");
    expect(tm.hibernateTab).not.toHaveBeenCalledWith("a");
  });

  it("does not hibernate before the timeout", () => {
    const tm = makeFakeTabManager(
      [
        { id: "a", url: "https://a", pinned: false, hibernated: false, createdAt: 0 },
        { id: "b", url: "https://b", pinned: false, hibernated: false, createdAt: 0 },
      ],
      "a",
    );
    let now = 0;
    const c = new HibernationController({
      tabManager: tm as never,
      getSettings: () => defaultSettings,
      now: () => now,
    });
    c.noteActivated("a");
    c.noteActivated("b");
    now = 29 * 60_000;
    c.sweep();
    expect(tm.hibernateTab).not.toHaveBeenCalled();
  });
});

describe("HibernationController.sweep — exclusions", () => {
  function setup(extra: Partial<Tab>) {
    const tm = makeFakeTabManager(
      [
        { id: "a", url: "https://a", pinned: false, hibernated: false, createdAt: 0 },
        {
          id: "b",
          url: "https://b",
          pinned: false,
          hibernated: false,
          createdAt: 0,
          ...extra,
        },
      ],
      "a",
    );
    let now = 0;
    const c = new HibernationController({
      tabManager: tm as never,
      getSettings: () => defaultSettings,
      now: () => now,
    });
    c.noteActivated("a");
    c.noteActivated("b");
    now = 60 * 60_000;
    c.sweep();
    return tm;
  }

  it("excludes pinned tabs", () => {
    const tm = setup({ pinned: true });
    expect(tm.hibernateTab).not.toHaveBeenCalledWith("b");
  });
  it("excludes horizon:// internal pages", () => {
    const tm = setup({ url: "horizon://newtab" });
    expect(tm.hibernateTab).not.toHaveBeenCalledWith("b");
  });
  it("excludes audible tabs", () => {
    const tm = setup({ audible: true });
    expect(tm.hibernateTab).not.toHaveBeenCalledWith("b");
  });
  it("excludes loading tabs", () => {
    const tm = setup({ loading: true });
    expect(tm.hibernateTab).not.toHaveBeenCalledWith("b");
  });
  it("excludes hibernated tabs (idempotent)", () => {
    const tm = setup({ hibernated: true });
    expect(tm.hibernateTab).not.toHaveBeenCalledWith("b");
  });
});

describe("HibernationController.sweep — count-based eviction", () => {
  it("hibernates LRU tabs when live count exceeds cap", () => {
    const tabs: Tab[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      url: `https://t${i}`,
      pinned: false,
      hibernated: false,
      createdAt: i,
    }));
    const tm = makeFakeTabManager(tabs, "t0");
    let now = 0;
    const c = new HibernationController({
      tabManager: tm as never,
      getSettings: () => ({ ...defaultSettings, maxActiveTabs: 3 }),
      now: () => now,
    });
    for (const t of tabs) {
      now += 1;
      c.noteActivated(t.id);
    }
    c.sweep();
    expect(tm.hibernateTab).toHaveBeenCalledWith("t1");
    expect(tm.hibernateTab).toHaveBeenCalledTimes(1);
  });
});

describe("HibernationController.sweep — settings", () => {
  it("does nothing when autoHibernate is false", () => {
    const tm = makeFakeTabManager(
      [
        { id: "a", url: "https://a", pinned: false, hibernated: false, createdAt: 0 },
        { id: "b", url: "https://b", pinned: false, hibernated: false, createdAt: 0 },
      ],
      "a",
    );
    let now = 0;
    const c = new HibernationController({
      tabManager: tm as never,
      getSettings: () => ({ ...defaultSettings, autoHibernate: false }),
      now: () => now,
    });
    c.noteActivated("a");
    c.noteActivated("b");
    now = 60 * 60_000;
    c.sweep();
    expect(tm.hibernateTab).not.toHaveBeenCalled();
  });

  it("clamps timeout and cap to >= 1", () => {
    const tm = makeFakeTabManager(
      [
        { id: "a", url: "https://a", pinned: false, hibernated: false, createdAt: 0 },
        { id: "b", url: "https://b", pinned: false, hibernated: false, createdAt: 0 },
      ],
      "a",
    );
    let now = 0;
    const c = new HibernationController({
      tabManager: tm as never,
      getSettings: () => ({
        autoHibernate: true,
        hibernationTimeoutMinutes: 0,
        maxActiveTabs: -5,
      }),
      now: () => now,
    });
    c.noteActivated("a");
    c.noteActivated("b");
    now = 60_001;
    expect(() => c.sweep()).not.toThrow();
    expect(tm.hibernateTab).toHaveBeenCalledWith("b");
  });
});

describe("HibernationController.forgetTab", () => {
  it("removes the lastActivatedAt entry", () => {
    const tm = makeFakeTabManager(
      [{ id: "a", url: "https://a", pinned: false, hibernated: false, createdAt: 0 }],
      "a",
    );
    const c = new HibernationController({
      tabManager: tm as never,
      getSettings: () => defaultSettings,
      now: () => 0,
    });
    c.noteActivated("a");
    c.forgetTab("a");
    expect(c.trackedTabCount()).toBe(0);
  });
});

describe("HibernationController.start / stop", () => {
  it("start schedules sweeps; stop cancels them", () => {
    vi.useFakeTimers();
    try {
      const tm = makeFakeTabManager(
        [
          { id: "a", url: "https://a", pinned: false, hibernated: false, createdAt: 0 },
          { id: "b", url: "https://b", pinned: false, hibernated: false, createdAt: 0 },
        ],
        "a",
      );
      const c = new HibernationController({
        tabManager: tm as never,
        getSettings: () => defaultSettings,
        now: () => Date.now(),
        sweepIntervalMs: 1000,
      });
      c.noteActivated("a");
      c.noteActivated("b");
      c.start();
      vi.advanceTimersByTime(30 * 60_000 + 1000);
      expect(tm.hibernateTab).toHaveBeenCalledWith("b");
      c.stop();
      tm.hibernateTab.mockClear();
      vi.advanceTimersByTime(10 * 60_000);
      expect(tm.hibernateTab).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
