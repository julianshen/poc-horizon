# Tab Hibernation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the already-declared `autoHibernate` / `hibernationTimeoutMinutes` / `maxActiveTabs` settings to a working tab-hibernation system that destroys idle tabs' `webContents` and rebuilds them on demand.

**Architecture:** Two-unit split per `docs/superpowers/specs/2026-05-28-tab-hibernation-design.md`. `TabManager` gains primitive `hibernateTab` / `wakeTab` methods plus a `view: BrowserView | null` refactor for hibernated entries. A new `HibernationController` owns the policy: per-tab `lastActivatedAt` timestamps, a 60s sweep timer, exclusion rules, and count-based LRU eviction. IPC handlers wire `tab:hibernate` / `tab:wake` to the primitives; the renderer renders hibernated tabs with a faded style.

**Tech Stack:** TypeScript, Electron 33 (BrowserView, webContents.destroy), Vitest, React 19 + Zustand (renderer).

---

## File Structure

**Create:**
- `.electron/services/HibernationController.ts` — policy unit, ~150 lines
- `tests/unit/hibernation-controller.test.ts` — unit tests for the controller
- `tests/unit/tab-manager-hibernate.test.ts` — primitive + integration tests

**Modify:**
- `src/types/browser.ts` — add `hibernated: boolean` to `Tab`
- `.electron/services/TabManager.ts` — null-view refactor + primitives + listener-setup extraction
- `.electron/ipc/main-handlers.ts` — register two new handlers
- `.electron/main.ts` — instantiate + start HibernationController per window
- `src/stores/browserStore.ts` — handle `tab:hibernated` / `tab:woken` events
- `src/components/chrome/TabBar.tsx` — faded style for `tab.hibernated === true`
- `vite.config.ts` — extend `coverage.include` for new files

---

## Task 1: Add `hibernated` field to Tab type

**Files:**
- Modify: `src/types/browser.ts`

- [ ] **Step 1: Inspect current Tab interface**

Run: `rtk proxy sed -n '1,40p' src/types/browser.ts`
Expected: shows `export interface Tab` with fields like `id`, `url`, `title`, `pinned`, `createdAt`.

- [ ] **Step 2: Add the field**

Edit `src/types/browser.ts`. Inside `export interface Tab { ... }`, add a new field after `pinned: boolean;` (or near it — order is cosmetic):

```ts
  /** True when the tab's webContents has been destroyed and only metadata remains. */
  hibernated: boolean;
```

- [ ] **Step 3: Type-check**

Run: `rtk proxy npx tsc --noEmit -p tsconfig.json`
Expected: errors in TabManager.ts where new `Tab` records are constructed without `hibernated`. We will fix these in Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/types/browser.ts
git commit -m "feat(types): add hibernated flag to Tab"
```

---

## Task 2: Null-view refactor in TabManager

The internal map type changes from `{ tab: Tab; view: BrowserView }` to `{ tab: Tab; view: BrowserView | null }`. Every existing dereference of `entry.view` needs a null guard. Hibernated tabs (Task 4) will have `view: null`, but this refactor lands first so the surface compiles cleanly.

**Files:**
- Modify: `.electron/services/TabManager.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tab-manager-hibernate.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserView: class {
    webContents = {
      loadURL: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      isLoading: vi.fn(() => false),
      isCurrentlyAudible: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      destroy: vi.fn(),
      session: { on: vi.fn() },
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
      },
    };
    setBounds = vi.fn();
    setAutoResize = vi.fn();
  },
  BrowserWindow: class {},
}));

import { TabManager } from "@electron/services/TabManager";

function fakeWindow() {
  return {
    isDestroyed: () => false,
    addBrowserView: vi.fn(),
    removeBrowserView: vi.fn(),
    setBrowserView: vi.fn(),
    webContents: { send: vi.fn(), isDestroyed: () => false },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    close: vi.fn(),
  } as unknown as import("electron").BrowserWindow;
}

function fakeHistory() {
  return { addEntry: vi.fn() } as unknown as
    import("../../.electron/services/HistoryManager").HistoryManager;
}

describe("TabManager: null-view tolerance", () => {
  it("new tab record has hibernated=false", () => {
    const tm = new TabManager(fakeWindow(), {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const t = tm.createTab("https://example.com");
    expect(t.hibernated).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts`
Expected: FAIL — TypeScript error in TabManager.ts: missing `hibernated` field on Tab.

- [ ] **Step 3: Refactor the map type and tab-record construction**

In `.electron/services/TabManager.ts`:

1. Change the private field declaration around line 74:

```ts
  private tabs = new Map<string, { tab: Tab; view: BrowserView | null }>();
```

2. In `createTab`, ensure the new Tab record initializes `hibernated: false`. Find the `const tab: Tab = { ... }` literal and add the field:

```ts
      hibernated: false,
```

3. For each call site that does `entry.view.<something>` or `current.view.<something>` (back/forward/reload/navigate/find/zoom/devtools/print/setBounds/removeBrowserView), wrap with a null guard. The pattern is:

```ts
    if (entry.view) {
      entry.view.webContents.<whatever>;
    }
```

For `closeTab` specifically (around line 430), the existing block becomes:

```ts
  closeTab(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    if (entry.view) {
      if (!this.window.isDestroyed()) {
        this.window.removeBrowserView(entry.view);
      }
      const wc = entry.view.webContents as Electron.WebContents & {
        destroy?: () => void;
      };
      if (wc && !wc.isDestroyed()) {
        wc.destroy?.();
      }
    }
    this.tabs.delete(tabId);
    this.safeSend("tab:closed", { tabId });

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.values());
      if (remaining.length > 0) {
        this.activateTab(remaining[remaining.length - 1].tab.id);
      } else {
        this.activeTabId = null;
        this.window.close();
      }
    }
  }
```

For `navigate`, `goBack`, `goForward`, `reload`, `stop`, `setContentBounds`, and similar methods — add an early `if (!entry.view) return;` at the top of each, immediately after the existing `if (!entry) return;` guard.

For `activateTab`, the active-tab switching block that calls `setBrowserView`/`removeBrowserView` becomes conditional on `view !== null`. (Task 5 will add the auto-wake here; for now, just guard.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts`
Expected: PASS.

- [ ] **Step 5: Full type-check**

Run: `rtk proxy npx tsc --noEmit -p tsconfig.json`
Expected: zero new errors. (Pre-existing errors per CLAUDE.md "Known config debt" are out of scope.)

- [ ] **Step 6: Existing TabManager tests still pass**

Run: `npx vitest run tests/unit/tab-manager-groups.test.ts tests/unit/tab-manager-reorder.test.ts tests/unit/tab-manager-content-bounds.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .electron/services/TabManager.ts tests/unit/tab-manager-hibernate.test.ts
git commit -m "refactor(TabManager): allow null view to prepare for hibernation"
```

---

## Task 3: Extract listener setup from createTab

Hibernation will need to rebuild the BrowserView and re-wire the same listeners that `createTab` wires. Extract the listener block now so both paths share it.

**Files:**
- Modify: `.electron/services/TabManager.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/tab-manager-hibernate.test.ts`:

```ts
describe("TabManager: setupTabListeners is reusable", () => {
  it("createTab wires title/url/favicon events via the shared setup", () => {
    const tm = new TabManager(fakeWindow(), {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const t = tm.createTab("https://example.com");
    const entry = (tm as unknown as {
      tabs: Map<string, { tab: import("@/types/browser").Tab; view: any }>;
    }).tabs.get(t.id);
    const wcOn = entry?.view?.webContents.on as ReturnType<typeof vi.fn>;
    const wiredEvents = wcOn.mock.calls.map((c) => c[0]);
    expect(wiredEvents).toEqual(
      expect.arrayContaining(["page-title-updated", "page-favicon-updated"]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts`
Expected: PASS already (the current `createTab` does wire these events). The test exists to guard the refactor below.

- [ ] **Step 3: Extract the listener setup**

In `.electron/services/TabManager.ts`, find the existing block in `createTab` that registers `webContents.on(...)` for events like `page-title-updated`, `page-favicon-updated`, `did-start-loading`, `did-stop-loading`, `did-finish-load`, `did-fail-load`. Move that whole block into a new private method:

```ts
  private setupTabListeners(tabId: string, view: BrowserView): void {
    // Paste the entire existing listener block here verbatim, replacing
    // the `id` / `view` variable names with the parameter names.
  }
```

Then in `createTab`, replace the inlined block with:

```ts
    this.setupTabListeners(id, view);
```

There is also an existing `setupWebContentsEvents(tabId, view)` method (line 204). If that *is* the listener block, no extraction is needed — instead just confirm it's callable from `wakeTab` later. If there are listeners outside `setupWebContentsEvents` that get wired inline in `createTab`, move those into `setupWebContentsEvents` so the single method covers everything.

- [ ] **Step 4: Run all TabManager tests**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts tests/unit/tab-manager-groups.test.ts tests/unit/tab-manager-reorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .electron/services/TabManager.ts tests/unit/tab-manager-hibernate.test.ts
git commit -m "refactor(TabManager): consolidate per-tab listener setup"
```

---

## Task 4: Implement `hibernateTab` and `wakeTab` primitives

**Files:**
- Modify: `.electron/services/TabManager.ts`
- Modify: `.electron/ipc/channels.ts` — already has the constants, no change
- Modify: `tests/unit/tab-manager-hibernate.test.ts`

- [ ] **Step 1: Write the failing test for hibernateTab**

Append to `tests/unit/tab-manager-hibernate.test.ts`:

```ts
describe("TabManager.hibernateTab", () => {
  it("destroys webContents, marks tab hibernated, emits events", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    tm.activateTab(a.id);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    const ok = tm.hibernateTab(b.id);
    expect(ok).toBe(true);
    expect(tm.getTab(b.id)?.hibernated).toBe(true);
    const channels = send.mock.calls.map((c) => c[0]);
    expect(channels).toContain("tab:hibernated");
    expect(channels).toContain("tab:updated");
  });

  it("refuses to hibernate the active tab", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    tm.activateTab(a.id);
    expect(tm.hibernateTab(a.id)).toBe(false);
    expect(tm.getTab(a.id)?.hibernated).toBe(false);
  });

  it("is a no-op on an already-hibernated tab", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    tm.activateTab(a.id);
    tm.hibernateTab(b.id);
    expect(tm.hibernateTab(b.id)).toBe(false);
  });
});

describe("TabManager.wakeTab", () => {
  it("rebuilds the view, calls loadURL, marks tab non-hibernated, emits events", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    tm.activateTab(a.id);
    tm.hibernateTab(b.id);
    const send = win.webContents.send as ReturnType<typeof vi.fn>;
    send.mockClear();

    tm.wakeTab(b.id);
    expect(tm.getTab(b.id)?.hibernated).toBe(false);
    const channels = send.mock.calls.map((c) => c[0]);
    expect(channels).toContain("tab:woken");
    expect(channels).toContain("tab:updated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts`
Expected: FAIL — `hibernateTab is not a function`.

- [ ] **Step 3: Implement `hibernateTab`**

Add to `TabManager` class in `.electron/services/TabManager.ts`:

```ts
  hibernateTab(tabId: string): boolean {
    const entry = this.tabs.get(tabId);
    if (!entry) return false;
    if (entry.tab.id === this.activeTabId) return false;
    if (entry.tab.hibernated) return false;
    if (!entry.view) return false;

    // Race re-check: a load may have started since the policy decision.
    if (entry.view.webContents.isLoading()) return false;

    if (!this.window.isDestroyed()) {
      this.window.removeBrowserView(entry.view);
    }
    const wc = entry.view.webContents as Electron.WebContents & {
      destroy?: () => void;
    };
    if (wc && !wc.isDestroyed()) {
      wc.destroy?.();
    }

    entry.view = null;
    entry.tab.hibernated = true;

    this.safeSend("tab:hibernated", { tabId });
    this.safeSend("tab:updated", { tab: entry.tab });
    return true;
  }
```

- [ ] **Step 4: Implement `wakeTab`**

Add to `TabManager`:

```ts
  wakeTab(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    if (!entry.tab.hibernated) return;

    const view = new BrowserView({
      webPreferences: this.defaultWebPreferences(),
    });
    entry.view = view;
    this.setupWebContentsEvents(tabId, view);
    this.window.addBrowserView(view);
    view.webContents.loadURL(entry.tab.url);

    entry.tab.hibernated = false;

    this.safeSend("tab:woken", { tabId });
    this.safeSend("tab:updated", { tab: entry.tab });
  }
```

If `defaultWebPreferences()` does not already exist as a method in TabManager, extract the `webPreferences` literal currently inlined in `createTab` into one. Both `createTab` and `wakeTab` then use it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .electron/services/TabManager.ts tests/unit/tab-manager-hibernate.test.ts
git commit -m "feat(TabManager): hibernateTab and wakeTab primitives"
```

---

## Task 5: Auto-wake on activateTab + null-view-in-activate guards

**Files:**
- Modify: `.electron/services/TabManager.ts`
- Modify: `tests/unit/tab-manager-hibernate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/tab-manager-hibernate.test.ts`:

```ts
describe("TabManager.activateTab auto-wakes hibernated tabs", () => {
  it("activating a hibernated tab wakes it first", () => {
    const win = fakeWindow();
    const tm = new TabManager(win, {
      kind: "default",
      historyManager: fakeHistory(),
    });
    const a = tm.createTab("https://a");
    const b = tm.createTab("https://b");
    tm.activateTab(a.id);
    tm.hibernateTab(b.id);
    expect(tm.getTab(b.id)?.hibernated).toBe(true);

    tm.activateTab(b.id);
    expect(tm.getTab(b.id)?.hibernated).toBe(false);
    expect(tm.getActiveTabId()).toBe(b.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts -t "auto-wakes"`
Expected: FAIL — activeTab is `b.id` but `hibernated` is still true (or a crash on `entry.view` access).

- [ ] **Step 3: Add auto-wake to activateTab**

At the top of `activateTab(tabId)` in `.electron/services/TabManager.ts`, immediately after the `const entry = this.tabs.get(tabId); if (!entry) return;` guard, add:

```ts
    if (entry.tab.hibernated) {
      this.wakeTab(tabId);
    }
```

The rest of `activateTab` proceeds normally — `entry.view` is now non-null.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .electron/services/TabManager.ts tests/unit/tab-manager-hibernate.test.ts
git commit -m "feat(TabManager): activateTab auto-wakes hibernated tabs"
```

---

## Task 6: HibernationController — unit-testable policy

**Files:**
- Create: `.electron/services/HibernationController.ts`
- Create: `tests/unit/hibernation-controller.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/hibernation-controller.test.ts`:

```ts
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
  incognito?: boolean;
};

function makeFakeTabManager(tabs: Tab[], activeId: string | null) {
  const tabMap = new Map(tabs.map((t) => [t.id, { ...t }]));
  return {
    getAllTabs: () => Array.from(tabMap.values()),
    getActiveTabId: () => activeId,
    isLoading: (id: string) => !!tabMap.get(id)?.loading,
    isAudible: (id: string) => !!tabMap.get(id)?.audible,
    isIncognito: () => false, // overridden per test if needed
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
    // Activate in order; t1 oldest, t4 newest, t0 is active.
    for (const t of tabs) {
      now += 1;
      c.noteActivated(t.id);
    }
    c.sweep();
    // Live eligible = [t1, t2, t3, t4]. Cap=3. Surplus=1. LRU=t1.
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
    now = 60_001; // > 1 minute
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
    // Internal map state — accessed via a public size getter for testability.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/hibernation-controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the controller**

Create `.electron/services/HibernationController.ts`:

```ts
interface TabRecord {
  id: string;
  url: string;
  pinned: boolean;
  hibernated: boolean;
  createdAt: number;
}

export interface HibernationTabManagerHooks {
  getAllTabs(): TabRecord[];
  getActiveTabId(): string | null;
  isLoading(tabId: string): boolean;
  isAudible(tabId: string): boolean;
  isIncognito(): boolean;
  hibernateTab(tabId: string): boolean;
}

export interface HibernationSettings {
  autoHibernate: boolean;
  hibernationTimeoutMinutes: number;
  maxActiveTabs: number;
}

export interface HibernationControllerOptions {
  tabManager: HibernationTabManagerHooks;
  getSettings: () => HibernationSettings;
  now?: () => number;
  sweepIntervalMs?: number;
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

export class HibernationController {
  private readonly tabManager: HibernationTabManagerHooks;
  private readonly getSettings: () => HibernationSettings;
  private readonly now: () => number;
  private readonly sweepIntervalMs: number;
  private readonly lastActivatedAt = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: HibernationControllerOptions) {
    this.tabManager = opts.tabManager;
    this.getSettings = opts.getSettings;
    this.now = opts.now ?? Date.now;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  noteActivated(tabId: string): void {
    this.lastActivatedAt.set(tabId, this.now());
  }

  forgetTab(tabId: string): void {
    this.lastActivatedAt.delete(tabId);
  }

  trackedTabCount(): number {
    return this.lastActivatedAt.size;
  }

  sweep(): void {
    const settings = this.getSettings();
    if (!settings.autoHibernate) return;

    const timeoutMs = Math.max(1, settings.hibernationTimeoutMinutes) * 60_000;
    const cap = Math.max(1, settings.maxActiveTabs);
    const now = this.now();
    const tabs = this.tabManager.getAllTabs();
    const activeId = this.tabManager.getActiveTabId();
    const incognito = this.tabManager.isIncognito();

    const eligible = (t: TabRecord): boolean => {
      if (t.id === activeId) return false;
      if (t.hibernated) return false;
      if (t.pinned) return false;
      if (t.url.startsWith("horizon://")) return false;
      if (incognito) return false;
      if (this.tabManager.isLoading(t.id)) return false;
      if (this.tabManager.isAudible(t.id)) return false;
      return true;
    };

    // Phase 1 — time-based.
    for (const t of tabs) {
      if (!eligible(t)) continue;
      const last = this.lastActivatedAt.get(t.id) ?? t.createdAt;
      if (now - last >= timeoutMs) {
        this.tabManager.hibernateTab(t.id);
      }
    }

    // Phase 2 — count-based safety net.
    const liveEligible = tabs.filter(eligible);
    if (liveEligible.length <= cap) return;
    const surplus = liveEligible.length - cap;
    const victims = liveEligible
      .slice()
      .sort((a, b) => {
        const la = this.lastActivatedAt.get(a.id) ?? a.createdAt;
        const lb = this.lastActivatedAt.get(b.id) ?? b.createdAt;
        if (la !== lb) return la - lb;
        return a.createdAt - b.createdAt;
      })
      .slice(0, surplus);
    for (const v of victims) {
      this.tabManager.hibernateTab(v.id);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/hibernation-controller.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add .electron/services/HibernationController.ts tests/unit/hibernation-controller.test.ts
git commit -m "feat: HibernationController policy unit with time + count eviction"
```

---

## Task 7: TabManager hooks for HibernationController

**Files:**
- Modify: `.electron/services/TabManager.ts`

The controller depends on `getAllTabs`, `getActiveTabId`, `isLoading`, `isAudible`, `isIncognito`. Add the missing accessors to TabManager and also call `noteActivated` / `forgetTab` from the right lifecycle points.

- [ ] **Step 1: Inspect existing accessors**

Run: `rtk proxy grep -nE "getAllTabs|getActiveTabId|getTabs\(|getTab\(" .electron/services/TabManager.ts`
Expected: existing methods — some may be present, some not.

- [ ] **Step 2: Add accessors that don't yet exist**

Add to TabManager any missing methods:

```ts
  getAllTabs(): Tab[] {
    return Array.from(this.tabs.values()).map((e) => e.tab);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  isTabLoading(tabId: string): boolean {
    const entry = this.tabs.get(tabId);
    return !!entry?.view && entry.view.webContents.isLoading();
  }

  isTabAudible(tabId: string): boolean {
    const entry = this.tabs.get(tabId);
    return !!entry?.view && entry.view.webContents.isCurrentlyAudible();
  }

  isIncognito(): boolean {
    return this.kind === "incognito";
  }
```

If any of these already exist with the same name, leave the existing one. If one exists with a different signature, keep this new name and update the controller hookup in Task 8 accordingly.

- [ ] **Step 3: Wire `noteActivated` and `forgetTab`**

A clean way to do this without TabManager importing the controller: add a small callback interface:

```ts
  setLifecycleObserver(observer: {
    onActivated?: (tabId: string) => void;
    onClosed?: (tabId: string) => void;
  }): void {
    this.lifecycleObserver = observer;
  }
```

with a private field `private lifecycleObserver?: { onActivated?: (id: string) => void; onClosed?: (id: string) => void };`.

In `activateTab`, after the activeTabId is updated, call:

```ts
    this.lifecycleObserver?.onActivated?.(tabId);
```

In `createTab`, just before returning the new Tab, call:

```ts
    this.lifecycleObserver?.onActivated?.(id);
```

In `closeTab`, after `this.tabs.delete(tabId)`, call:

```ts
    this.lifecycleObserver?.onClosed?.(tabId);
```

- [ ] **Step 4: Type-check**

Run: `rtk proxy npx tsc --noEmit -p tsconfig.json`
Expected: zero new errors.

- [ ] **Step 5: Existing tests still pass**

Run: `npx vitest run tests/unit/tab-manager-hibernate.test.ts tests/unit/tab-manager-groups.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .electron/services/TabManager.ts
git commit -m "feat(TabManager): expose hooks for HibernationController"
```

---

## Task 8: IPC handlers for `tab:hibernate` and `tab:wake`

**Files:**
- Modify: `.electron/ipc/main-handlers.ts`
- Create: `tests/unit/main-handlers-hibernate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/main-handlers-hibernate.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  app: { getVersion: () => "1.0.0" },
}));

import { registerMainHandlers } from "@electron/ipc/main-handlers";

function ctx(extras: Record<string, unknown> = {}) {
  return {
    tabManager: {
      hibernateTab: vi.fn(() => true),
      wakeTab: vi.fn(),
      ...extras,
    },
    window: {},
  };
}

describe("IPC: tab:hibernate / tab:wake", () => {
  beforeEach(() => handlers.clear());

  it("tab:hibernate calls tabManager.hibernateTab", async () => {
    const c = ctx();
    registerMainHandlers({
      resolveContext: () => c as never,
      // Pass nulls / stubs for managers the test doesn't exercise:
    } as never);
    const fn = handlers.get("tab:hibernate")!;
    const ok = await fn({}, { tabId: "t1" });
    expect(c.tabManager.hibernateTab).toHaveBeenCalledWith("t1");
    expect(ok).toBe(true);
  });

  it("tab:wake calls tabManager.wakeTab", async () => {
    const c = ctx();
    registerMainHandlers({
      resolveContext: () => c as never,
    } as never);
    const fn = handlers.get("tab:wake")!;
    await fn({}, { tabId: "t1" });
    expect(c.tabManager.wakeTab).toHaveBeenCalledWith("t1");
  });
});
```

If `registerMainHandlers` requires more args than `resolveContext` (it likely does — settings, bookmarks, etc.), pass `{} as never` style stubs that only set the methods the two handlers we're testing actually use. Inspect the existing signature: `rtk proxy grep -n "export function registerMainHandlers" .electron/ipc/main-handlers.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/main-handlers-hibernate.test.ts`
Expected: FAIL — `Cannot read properties of undefined ... handlers.get("tab:hibernate")` because handlers aren't registered.

- [ ] **Step 3: Register the handlers**

In `.electron/ipc/main-handlers.ts`, find the existing `handle("tab:duplicate", ...)` and `handle("tab:reorder", ...)` block (around lines 99–103). Add right after:

```ts
  handle("tab:hibernate", (event, { tabId }) =>
    ctx(event).tabManager.hibernateTab(tabId),
  );
  handle("tab:wake", (event, { tabId }) =>
    ctx(event).tabManager.wakeTab(tabId),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/main-handlers-hibernate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .electron/ipc/main-handlers.ts tests/unit/main-handlers-hibernate.test.ts
git commit -m "feat(ipc): wire tab:hibernate and tab:wake handlers"
```

---

## Task 9: Instantiate HibernationController per window in main.ts

**Files:**
- Modify: `.electron/main.ts`

- [ ] **Step 1: Locate per-window TabManager construction**

Run: `rtk proxy grep -n "new TabManager\|localTabManager" .electron/main.ts | head`
Expected: shows `const localTabManager = new TabManager(...)` around line 711 and `contexts.set(...)` shortly after.

- [ ] **Step 2: Add controller instantiation and wiring**

In `.electron/main.ts`, immediately after `const localTabManager = new TabManager(...)`, add:

```ts
  const hibernationController = new HibernationController({
    tabManager: {
      getAllTabs: () => localTabManager.getAllTabs(),
      getActiveTabId: () => localTabManager.getActiveTabId(),
      isLoading: (id) => localTabManager.isTabLoading(id),
      isAudible: (id) => localTabManager.isTabAudible(id),
      isIncognito: () => localTabManager.isIncognito(),
      hibernateTab: (id) => localTabManager.hibernateTab(id),
    },
    getSettings: () => {
      const s = settingsManager.getAll();
      return {
        autoHibernate: s.autoHibernate,
        hibernationTimeoutMinutes: s.hibernationTimeoutMinutes,
        maxActiveTabs: s.maxActiveTabs,
      };
    },
  });
  localTabManager.setLifecycleObserver({
    onActivated: (id) => hibernationController.noteActivated(id),
    onClosed: (id) => hibernationController.forgetTab(id),
  });
  hibernationController.start();

  win.on("closed", () => {
    hibernationController.stop();
  });
```

Add the import at the top of `main.ts`:

```ts
import { HibernationController } from "./services/HibernationController";
```

- [ ] **Step 3: Build to verify it integrates**

Run: `rtk proxy npm run build 2>&1 | rtk proxy grep -iE "error|HibernationController" | head -20`
Expected: no new errors. (Pre-existing errors per CLAUDE.md may surface but should not be in any of these new files.)

- [ ] **Step 4: Commit**

```bash
git add .electron/main.ts
git commit -m "feat(main): wire HibernationController per window"
```

---

## Task 10: Renderer — handle hibernation events in browserStore

**Files:**
- Modify: `src/stores/browserStore.ts`

- [ ] **Step 1: Inspect store**

Run: `rtk proxy grep -n "tab:updated\|TAB_UPDATED\|hibernated" src/stores/browserStore.ts | head`
Expected: shows existing tab:updated handling.

- [ ] **Step 2: Add hibernated / woken listeners**

In `src/stores/browserStore.ts`, find the existing `window.horizonAPI.on("tab:updated", ...)` registration and add two new subscriptions nearby:

```ts
window.horizonAPI.on("tab:hibernated", ({ tabId }: { tabId: string }) => {
  setTabs((tabs) =>
    tabs.map((t) => (t.id === tabId ? { ...t, hibernated: true } : t)),
  );
});

window.horizonAPI.on("tab:woken", ({ tabId }: { tabId: string }) => {
  setTabs((tabs) =>
    tabs.map((t) => (t.id === tabId ? { ...t, hibernated: false } : t)),
  );
});
```

Adjust the `setTabs` call to match the store's actual mutation API (e.g., Zustand's `set((state) => ...)` form). The key invariant: tabs with `id === tabId` get their `hibernated` field flipped.

- [ ] **Step 3: Type-check renderer**

Run: `rtk proxy npx tsc --noEmit -p tsconfig.json`
Expected: zero new errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/browserStore.ts
git commit -m "feat(renderer): sync hibernated state from main"
```

---

## Task 11: Renderer — faded style for hibernated tabs

**Files:**
- Modify: `src/components/chrome/TabBar.tsx`

- [ ] **Step 1: Locate per-tab rendering**

Run: `rtk proxy grep -n "tab.title\|tab.favicon\|className=" src/components/chrome/TabBar.tsx | head`
Expected: shows the per-tab `<div>` or `<button>` render block.

- [ ] **Step 2: Apply conditional class**

In the per-tab render, add `tab.hibernated && "opacity-60"` (or the project's preferred faded class — match the bookmark/disabled style used elsewhere) to the existing className string. Example shape:

```tsx
className={cn(
  "tab-base-classes",
  tab.active && "tab-active-classes",
  tab.hibernated && "opacity-60",
)}
title={tab.hibernated ? `${tab.title} (sleeping)` : tab.title}
```

- [ ] **Step 3: Visual smoke test (manual)**

Run: `npm run dev`
Open three or four tabs, manually invoke from the renderer devtools console:

```js
window.horizonAPI.invoke("tab:hibernate", { tabId: "<id of a background tab>" });
```

Expected: the targeted tab fades in the tab bar. Clicking it wakes it (existing load-progress UI shows briefly).

- [ ] **Step 4: Commit**

```bash
git add src/components/chrome/TabBar.tsx
git commit -m "feat(TabBar): render hibernated tabs with faded style"
```

---

## Task 12: Extend coverage scope

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Inspect coverage config**

Run: `rtk proxy grep -nE "coverage|include" vite.config.ts | head`
Expected: shows `coverage: { include: [...] }`.

- [ ] **Step 2: Extend the include glob**

Add to the `coverage.include` array entries that cover the new files:

```ts
".electron/services/HibernationController.ts",
".electron/services/TabManager.ts",
```

Per CLAUDE.md, this enforces the ≥90% threshold on these files. The unit tests in Task 6 and the integration tests in Tasks 2–5 should be sufficient — if the coverage run flags gaps, add focused tests for the uncovered branches (most likely: the null-view guards in TabManager methods that the existing tests don't exercise).

- [ ] **Step 3: Run coverage and verify thresholds**

Run: `rtk proxy npm run test:coverage 2>&1 | tail -30`
Expected: HibernationController.ts ≥ 90% on lines/branches/functions/statements. TabManager.ts may drop below 90% if existing untested code paths are now in scope — if so, add targeted tests just for the new methods (`hibernateTab`, `wakeTab`, `setLifecycleObserver`, the new accessors) and scope the coverage `include` more narrowly to a list of files rather than `.electron/services/TabManager.ts` whole if necessary. Adjust until thresholds pass.

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "test: include hibernation files in coverage scope"
```

---

## Task 13: Final integration smoke test

**Files:** none — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 2: Build**

Run: `rtk proxy npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual end-to-end smoke**

Run: `npm run dev`
Open Horizon, open ~5 tabs. In Settings, temporarily lower `hibernationTimeoutMinutes` to 1 (or invoke the controller's sweep directly through devtools by setting a much shorter timeout). Wait, observe background tabs fade in the tab bar. Click a faded tab — verify it loads back to its URL. Close a hibernated tab — verify no crash.

- [ ] **Step 4: Restore default settings**

Settings back to `hibernationTimeoutMinutes: 30`.

- [ ] **Step 5: Final commit if any tweaks were needed**

```bash
git status
# If anything changed during smoke testing:
git add -p
git commit -m "fix: <whatever needed adjustment>"
```

---

## Done

The full path is now wired: a background tab sits idle for 30 minutes → controller sweep finds it eligible → calls `TabManager.hibernateTab` → webContents destroyed, events emitted → renderer fades the tab. User clicks it → IPC `tab:activate` → TabManager auto-wakes → loadURL → normal load-progress UI takes over.
