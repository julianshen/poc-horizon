# Tab Hibernation — Design Spec

**Date:** 2026-05-28
**Status:** Approved, ready for implementation plan
**Related:** `docs/superpowers/specs/2026-05-21-horizon-browser-design.md` (v1 scope)

## 1. Goal

Reclaim memory from idle background tabs by discarding their `webContents` and rebuilding them on demand, keeping their identity (URL, title, favicon) visible in the tab bar throughout.

`DEFAULT_SETTINGS` in `shared/constants.ts` already declares the user-facing contract:

- `autoHibernate: true` — master toggle
- `hibernationTimeoutMinutes: 30` — time-based trigger
- `maxActiveTabs: 20` — count-based safety net

The IPC channels `tab:hibernate`, `tab:wake`, `tab:hibernated`, `tab:woken` are also already declared in `.electron/ipc/channels.ts` and typed in `src/types/ipc.ts`. Nothing in the backend implements any of it; this spec closes that gap.

## 2. User-visible behavior

A tab is **hibernated** when its `webContents` has been destroyed and only its metadata (URL, title, favicon) remains. Hibernated tabs:

- Render in the tab bar with a faded style and a small sleep indicator.
- Wake automatically when the user clicks them; the existing `LOAD_STARTED → LOAD_PROGRESS → LOAD_FINISHED` events drive the progress UI — no separate "waking" placeholder.
- Lose form input, scroll position, and in-memory JS state on hibernation. This matches Chrome/Edge "sleeping tabs" behavior.

A tab can be hibernated by:

1. The auto-policy (time-based primary, count-based fallback).
2. An explicit `tab:hibernate` IPC call (context menu, keyboard shortcut, or AI agent).

A tab wakes by:

1. Being activated via `tab:activate` (auto-wakes inside `TabManager.activateTab`).
2. An explicit `tab:wake` IPC call.

## 3. Eviction policy

The controller's `sweep()` runs every 60 seconds. The interval is hardcoded, not a setting.

### 3.1 Phase 1 — time-based

For each tab:

- Skip if not eligible (see 3.3).
- Compute `idleMs = now − lastActivatedAt`. Fall back to `tab.createdAt` if no activation has been recorded.
- If `idleMs ≥ hibernationTimeoutMinutes × 60_000`, hibernate.

### 3.2 Phase 2 — count-based (safety net)

After Phase 1, count tabs that are still both live (not hibernated) and eligible. If that count exceeds `maxActiveTabs`, hibernate the LRU surplus. Ties (e.g., post-session-restore where many tabs share a timestamp) break by tab creation order.

### 3.3 Exclusion rules

A tab is **ineligible** for auto-hibernation if any of the following holds. Evaluated cheap-first:

1. `tab.id === activeTabId`
2. `tab.hibernated` (already hibernated)
3. `tab.pinned`
4. `tab.url` starts with `horizon://`
5. The tab belongs to an incognito session
6. `webContents.isLoading()`
7. `webContents.isCurrentlyAudible()`

Manual `tab:hibernate` (IPC, context menu, agent) bypasses the exclusion list except for #1 (cannot hibernate the active tab) and #2 (no-op on already-hibernated). A user manually putting a `horizon://`, incognito, audible, or loading tab to sleep is honored — they asked for it. The loading-race re-check in §6.1 still applies on the manual path.

### 3.4 Settings interaction

- `autoHibernate: false` → sweep becomes a no-op; manual hibernate/wake still works.
- Settings changes take effect on the next sweep — no re-stamping or timer reset needed.
- Both `hibernationTimeoutMinutes` and `maxActiveTabs` are clamped to `Math.max(1, value)` inside the controller.

## 4. Architecture

Three units, each with one clear job.

```
┌─────────────────────────────────────────────────────────────────┐
│  Window (BrowserWindow + TabManager)                            │
│                                                                 │
│  ┌────────────────────────┐    ┌─────────────────────────────┐  │
│  │ TabManager (extended)  │◄───┤ HibernationController (new) │  │
│  │ + hibernateTab(id)     │    │  - lastActivatedAt: Map     │  │
│  │ + wakeTab(id)          │    │  - sweepTimer (60s)         │  │
│  │ + isHibernated(id)     │    │  - settings getter          │  │
│  │ + activateTab hooks ───┼───►│  - clock fn (injectable)    │  │
│  │ + createTab hooks  ────┼───►│ + start() / stop()          │  │
│  │ + closeTab hooks   ────┼───►│ + noteActivated(id)         │  │
│  └────────────────────────┘    │ + forgetTab(id)             │  │
│                                │ + sweep()                   │  │
│           │                    └─────────────────────────────┘  │
│           ▼                                                     │
│  IPC: tab:hibernate, tab:wake (renderer→main)                   │
│       tab:hibernated, tab:woken, tab:updated (main→renderer)    │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 TabManager — Electron-aware primitives

Lives in `.electron/services/TabManager.ts`. The internal map type changes from `Map<string, { tab: Tab; view: BrowserView }>` to `Map<string, { tab: Tab; view: BrowserView | null }>`; every existing call site that dereferences `entry.view` (currently ~12 — close, navigate, back/forward, reload, find, zoom, devtools, print, etc.) gains a null guard that returns early or no-ops for hibernated tabs. This is the bulk of the implementation diff. Most call paths are not reachable for hibernated tabs anyway (the UI doesn't expose back/forward on a sleeping tab) so the guards are defense-in-depth.

Gains:

- `hibernateTab(id: string): boolean` — returns `false` if the tab is the active tab, already hibernated, or its `webContents.isLoading()` flips true between the eligibility check and destruction. On success: removes the BrowserView from the window, calls `wc.destroy?.()` (same pattern as `closeTab`), sets `tab.hibernated = true` and `tab.view = null`, emits `TAB_HIBERNATED` and `TAB_UPDATED`.
- `wakeTab(id: string): void` — builds a fresh BrowserView attached to the same session/partition, wires the same listeners that `createTab` wires (factor the listener block into a shared `setupTabListeners(tab)` method so both paths use it), calls `view.webContents.loadURL(tab.url)`, sets `tab.hibernated = false`, emits `TAB_WOKEN` and `TAB_UPDATED`. Does **not** await the load — existing `LOAD_*` events handle UI.
- `isHibernated(id: string): boolean` — convenience accessor.
- `activateTab(id)` is extended to auto-wake if the target is hibernated, then proceed with the existing activate flow.

The `Tab` type in `src/types/browser.ts` gains:

```ts
hibernated: boolean;
```

Defaulted to `false` on creation.

### 4.2 HibernationController — policy

Lives in `.electron/services/HibernationController.ts`. Constructor signature:

```ts
new HibernationController({
  tabManager: TabManager,
  getSettings: () => Pick<Settings,
    "autoHibernate" | "hibernationTimeoutMinutes" | "maxActiveTabs">,
  now?: () => number,            // default Date.now
  sweepIntervalMs?: number,      // default 60_000
})
```

Public surface:

- `start()` / `stop()` — manage the sweep interval.
- `noteActivated(tabId: string)` — stamp `lastActivatedAt`.
- `forgetTab(tabId: string)` — clear map entry when a tab closes.
- `sweep()` — public for testability; the timer calls it.

The `now` and `sweepIntervalMs` injection points exist exclusively so unit tests can advance the clock without `setTimeout`. The controller does not import `electron`.

### 4.3 IPC wiring

In `.electron/ipc/main-handlers.ts`, register two new handlers alongside the other tab ops:

```ts
handle("tab:hibernate", (event, { tabId }) =>
  ctx(event).tabManager.hibernateTab(tabId),
);
handle("tab:wake", (event, { tabId }) =>
  ctx(event).tabManager.wakeTab(tabId),
);
```

The controller is instantiated and started in `main.ts` per window, alongside the existing TabManager construction, and stopped on window close.

### 4.4 Renderer

`browserStore` already receives `TAB_UPDATED`. Two changes:

- Listen for `TAB_HIBERNATED` and `TAB_WOKEN` to keep store state in sync (in addition to the `TAB_UPDATED` that fires alongside them — the dedicated events let the UI animate the transition if desired).
- `TabBar` renders a tab with `tab.hibernated === true` using a faded style and a small zzz/moon indicator. Implementation detail; not part of the spec contract.

## 5. Data flow

### 5.1 Hibernation tick

```
60s sweep ──► HibernationController.sweep()
                  │  (for each expired tab)
                  ▼
              TabManager.hibernateTab(id)
                  ├─► window.removeBrowserView(view)
                  ├─► wc.destroy?.()
                  ├─► tab.hibernated = true; tab.view = null
                  ├─► win.webContents.send(TAB_HIBERNATED, { tabId })
                  └─► win.webContents.send(TAB_UPDATED, tab)
                              │
                              ▼
                  renderer: browserStore updates,
                  TabBar re-renders with faded style
```

### 5.2 Wake on activation

```
TabBar click ──► IPC tab:activate(id)
                    │
                    ▼
                  TabManager.activateTab(id)
                    ├─ if tab.hibernated: this.wakeTab(id)
                    ├─► window.setBrowserView(tab.view)
                    ├─► controller.noteActivated(id)
                    └─► win.webContents.send(TAB_ACTIVATED, ...)

  LOAD_STARTED → LOAD_PROGRESS → LOAD_FINISHED flow normally
  from the new webContents.
```

## 6. Error handling & known pitfalls

1. **Hibernate races with in-flight loads.** Re-check `isLoading()` immediately before `wc.destroy()`. If true, abort the hibernation (return `false`); next sweep will retry.
2. **Hibernate races with user activation.** `hibernateTab` checks `id !== activeTabId` as its first action. TabManager is single-threaded so this is sufficient.
3. **Wake load failure.** Not awaited; existing `LOAD_FAILED` handling renders the error overlay.
4. **`wc.destroy?.()`** is the documented private API already used by `closeTab` (line 444). Same caveats — see AGENTS.md §11.
5. **Hibernated tab gets closed.** `closeTab` currently accesses `entry.view.webContents` directly (TabManager.ts:435,437). The null-view refactor in §4.1 covers this and every other dereference path. The null-guard pattern is: if `view === null`, skip the Electron call and proceed to the bookkeeping (delete from map, send `TAB_CLOSED`, activate fallback).
6. **Session restore.** Restored tabs always start non-hibernated. The controller stamps `noteActivated` for each at launch; time-based timer starts fresh.
7. **Active-tab guarantee.** A window must always have a non-hibernated active tab (or zero tabs). The sweep's `activeTabId` exclusion preserves this. Any code path that sets `activeTabId` directly without going through `activateTab` must be migrated to `activateTab` so the auto-wake fires (specifically: the close-tab fallback at TabManager.ts:449).
8. **Settings clamping.** `Math.max(1, value)` for both numeric settings inside the controller.
9. **Controller memory.** `forgetTab` clears the `lastActivatedAt` entry on close. Without it, a long session leaks a few bytes per closed tab.

## 7. Testing

### 7.1 HibernationController — unit tests (no Electron)

Inject a fake TabManager exposing only the methods the controller uses (`getAllTabs`, `getActiveTabId`, `hibernateTab`, plus eligibility hints surfaced on the Tab record). Inject a fake clock. Cover:

- Time-based eviction fires at exactly `timeoutMs`.
- Each exclusion rule blocks hibernation in isolation.
- Count-based eviction picks the LRU tabs; ties break by creation order.
- `autoHibernate: false` short-circuits the sweep.
- Settings clamping (`0`, negative, non-integer) does not crash.
- `forgetTab` removes the entry.
- `start()` / `stop()` manage the interval idempotently.

### 7.2 TabManager — integration tests (with BrowserWindow)

Match the pattern used by existing TabManager tests. Cover:

- `hibernateTab` destroys the webContents and emits the right events.
- `wakeTab` rebuilds a working BrowserView at the same URL.
- `activateTab` on a hibernated tab auto-wakes.
- `closeTab` works on a hibernated tab.
- Round-trip IPC tests for `tab:hibernate` and `tab:wake` per AGENTS.md §2.2.

### 7.3 Coverage

Both new files (`HibernationController.ts` and the modified `TabManager.ts` regions) are added to the `coverage.include` in `vite.config.ts` so the ≥90% threshold applies. Per project memory, coverage discipline is stricter than AGENTS.md's baseline.

## 8. Out of scope

- Form-input detection as an exclusion rule. Chrome does not do this either; revisit if user feedback demands it.
- Scroll-position restoration on wake. Possible follow-up; would require a content-script snapshot on hibernation.
- A "Wake all" command or menu entry. Easy to add later; no current ask.
- Memory-pressure-based eviction (reacting to OS signals). Out of v1.
- Telemetry / metrics on hibernation activity. Out of v1.

## 9. File checklist (for the implementation plan)

- `.electron/services/HibernationController.ts` — new
- `.electron/services/TabManager.ts` — add primitives + hooks; refactor listener setup into a shared method
- `.electron/ipc/main-handlers.ts` — two new handlers
- `.electron/main.ts` — instantiate + wire the controller per window
- `src/types/browser.ts` — add `hibernated: boolean` to `Tab`
- `src/stores/browserStore.ts` — handle `TAB_HIBERNATED` / `TAB_WOKEN` (in addition to existing `TAB_UPDATED`)
- `src/components/chrome/TabBar.tsx` — render hibernated style
- Tests:
  - `.electron/services/HibernationController.test.ts` — unit
  - `.electron/services/TabManager.test.ts` — extended integration
  - `.electron/ipc/main-handlers.test.ts` — IPC round-trip for the two channels
- `vite.config.ts` — extend `coverage.include` to cover the new files
