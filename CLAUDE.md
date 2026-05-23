# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Horizon — a cross-platform desktop web browser built on Electron 33 + React 19 + TypeScript, bundled with `electron-vite`. State is managed with Zustand. Styled with Tailwind.

## Mandatory reading

`AGENTS.md` at the repo root defines the **enforced** coding rules: TDD cycle, coverage thresholds, naming, security (`nodeIntegration: false`, `contextIsolation: true`, no `eval`/`innerHTML`), IPC patterns, conventional-commit format, and a "Known Pitfalls" table for Electron-specific gotchas. Read it before making changes — those rules override default behavior.

Non-obvious style rules worth surfacing (full list in AGENTS.md §3, §12.4):

- **No `enum`** — use `const X = { ... } as const` objects instead.
- **Prefer `interface` over `type`** for object shapes.
- **No inline JSX handlers** — wrap with `useCallback`.
- **File-size caps**: component 200 lines, hook 150, service 300, test 200. Exceeding requires splitting.
- **No `console.log` in production code**, no magic numbers, no functions > 50 lines without decomposition.

## Spec, plan, and task tracking

- **Design spec (source of truth):** `docs/superpowers/specs/2026-05-21-horizon-browser-design.md` — v1 scope, architecture, data shapes, IPC contracts. Per AGENTS.md §12.1, check this before proposing architecture changes.
- **Implementation plan:** `docs/superpowers/plans/2026-05-21-horizon-browser-v1.md` — 4 chunks, 13 tasks (1.1 Scaffold → 4.3 Packaging). Tasks are tracked **inside the plan file** via `- [ ]` checkboxes; there is no separate task tree. The plan's header instructs executing it with `superpowers:subagent-driven-development`.
- `.rpiv/artifacts/{designs,plans,research,reviews,discover,handoffs}/` exist but are currently empty — reserved for future artifacts, not a current source of truth.

## Commands

```bash
npm run dev              # electron-vite dev (main + preload + renderer)
npm run build            # electron-vite build → dist/ + dist-electron/
npm run dist[:mac|:win|:linux]   # electron-builder package
npm test                 # vitest (unit)
npm test -- --coverage   # enforce coverage thresholds from AGENTS.md §2
npx vitest run path/to/file.test.ts   # single file
npx vitest -t "test name"             # single test by name pattern
npm run test:e2e         # playwright
npm run lint             # eslint .ts,.tsx
npx tsc --noEmit         # type-check only
```

If `npm install` hits peer-dep conflicts with `electron-vite`, use `--legacy-peer-deps`.

## Process / source layout

Electron three-process split with sources in distinct trees:

- **`.electron/`** (note the leading dot) — main + preload TypeScript. `main.ts`, `preload.ts`, `ipc/channels.ts` (channel name constants), `ipc/main-handlers.ts` (handler registration), and `services/` (one manager per domain: `TabManager`, `WindowManager`, `SessionManager`, `HistoryManager`, `BookmarkManager`, `DownloadManager`, `PasswordManager`, `AutofillManager`, `SettingsManager`). Built to `dist-electron/`.
- **`src/`** — React renderer. `components/chrome/` is the browser UI shell (TabBar, Omnibox, Toolbar, TitleBar, BrowserContentArea), `components/overlays/` is in-page UI (FindInPage, PageErrorOverlay), `hooks/` wraps IPC for the UI (`useTabs`, `useNavigation`, `useKeyboardShortcuts`), `stores/browserStore.ts` is the single Zustand store, `types/` holds shared TS types including the `window.horizonAPI` global. Built to `dist/`.
- **`shared/`** — code reachable from any process (`constants.ts` has `IPC_CHANNELS`, `DEFAULT_SETTINGS`, `SEARCH_ENGINES`). Aliased as `@shared` in all three Vite configs.

Path aliases: `@` → `src/`, `@shared` → `shared/`. Both must be added to `electron.vite.config.ts` when changing layout.

## Architecture rules that span files

1. **IPC is the only renderer↔main channel.** Renderer must call `window.horizonAPI.invoke(channel, payload)` (exposed via preload `contextBridge`); it must not import from `.electron/` or call Node APIs directly. New IPC requires: (a) channel constant in `shared/constants.ts` (`IPC_CHANNELS`), (b) handler registration in `.electron/ipc/main-handlers.ts` with payload validation, (c) typed wrapper if used by a hook. Every channel needs a round-trip test (AGENTS.md §2.2).

2. **Services own state, not the window.** Managers in `.electron/services/` hold the `BrowserWindow` reference and push updates via `win.webContents.send(...)` — do not emit IPC events from a service that doesn't know its window (AGENTS.md §11.3).

3. **Tabs use BrowserViews per tab.** Closing a tab must call `webContents.destroy()` to free memory. Use `webContents.navigationHistory.canGoBack()` — the old `canGoBack()` is deprecated. Pop-up handling goes through `webContents.setWindowOpenHandler` on the tab's webContents, **not** `session.setWindowOpenHandler` (which throws).

4. **Native modules are externalized, not bundled.** `better-sqlite3`, `electron`, `electron-updater`, and Node built-ins (`path`, `fs`, `os`, `crypto`) are in `rollupOptions.external` of `electron.vite.config.ts` main build. History currently uses JSON (not sqlite) for dev-mode compatibility — see commit `b507862`. Adding a native module requires updating the external list.

5. **State flow is one-way.** Main → IPC event → hook updates Zustand store → components re-render. Components never mutate state outside store actions; hooks never bypass the store to call IPC handlers that should update shared state.

## Config files of note

- `electron.vite.config.ts` — primary build config (main + preload + renderer in one file).
- `vite.main.config.ts` / `vite.preload.config.ts` / `vite.config.ts` — legacy/standalone Vite configs; keep aligned with `electron.vite.config.ts` if edited.
- `electron-builder.json5` — packaging config for `npm run dist`.
- `tsconfig.main.json` / `tsconfig.preload.json` — per-process TS configs; ensure new files under `.electron/` are included.
