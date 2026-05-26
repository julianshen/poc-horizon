# Horizon Browser

A cross-platform desktop web browser with a first-class AI agent layer. Built on Electron 34 + Chromium 132, React 19, TypeScript, and Tailwind. The browser ships with a Pi-powered agent that can perceive the page, drive it through CDP, and accumulate per-site skills over time.

## What makes it different

Most browsers bolt AI on as a chat sidebar that screenshots what you see. Horizon goes the other direction: the agent gets the same low-level handles to the page that you do — coordinate clicks, key events, the full CDP surface, screenshots with numbered click targets, the accessibility tree — and learns from its own work. It can:

- **See** the page via screenshots with a numbered overlay on every clickable target (Set-of-Marks, reading-order numbered).
- **Act** through CDP — click at (x, y) passes through iframes, shadow DOM, and cross-origin frames at the compositor level.
- **Remember** what it figures out: persistent JS helpers, per-site playbooks, and replayable action workflows.
- **Watch** what the page does in response: subscribe to CDP events, drain the buffer after an action.
- **Ask** before doing anything risky, with a user-configurable confirmation policy.

Everything the agent does is observable through the AI side panel; everything risky can be gated through a single Settings dropdown.

## Feature catalogue

### Browser core
Tabs (with pin/mute/groups/right-click menus), Omnibox with suggestions + ⌘K Command Palette, navigation history, bookmarks, downloads with shelf, password store backed by Electron `safeStorage`, autofill, per-tab incognito windows, Find-in-page, side panels for History / Bookmarks / Settings / Workflows. Reader mode via Mozilla Readability. /llms.txt auto-discovery and context injection. Page translation (full page + selection) via headless Pi.

### AI agent layer
26 tools the agent calls through a local JSON-line bridge:

| Category | Tools |
|---|---|
| Perception | `screenshot` · `screenshot_marked` (Set-of-Marks, reading-order) · `axtree` · `get_dom` · `describe_at` · `reader_extract` |
| Input | `navigate` · `click` · `type` · `scroll` |
| Coordination | `wait_for` · `dismiss_overlays` |
| Tabs | `tab_open` · `tab_switch` · `tab_close` · `tab_list` |
| JS helpers | `save_helper` · `call_helper` · `list_helpers` · `remove_helper` |
| CDP | `cdp` (raw) · `cdp_subscribe` · `cdp_collect` · `cdp_unsubscribe` |
| Skills library | `skill_preamble` · `skill_list_interactions` · `skill_read_interaction` |
| Domain skills | `domain_skill_list` · `_read` · `_save` · `_remove` · `_search` |
| Workflows | `workflow_record_start` · `_stop` · `_run` · `_list` · `_delete` |
| Reflection | `get_url` · `get_title` |
| UI | `render_ui` (A2UI declarative panels) |

### Knowledge layer

Three layers, deliberately separate:

| Layer | Where it lives | Editor |
|---|---|---|
| `SKILL.md` — top-level playbook | bundled in `resources/pi-extension/skills/` | dev / shipped |
| `interaction-skills/*.md` — 13 reusable web mechanics | bundled | dev / shipped |
| `domain-skills/<host>/*.md` — per-site playbooks | `userData/domain-skills/` | agent itself |

On every `browser_navigate`, the response includes `domainSkillsAvailable: ["..."]` for the host so the agent can read its prior notes before re-deriving an approach. `domain_skill_search` cross-cuts hosts when the agent thinks "I've handled this kind of problem before, just not on this site."

### Self-extension

- **JS helper registry** (`userData/js-helpers.json`) — named JS expressions the agent saves once and calls thereafter. Persistent across restarts. Site-specific extractors live here.
- **Action workflows** (`userData/action-workflows.json`) — recorded tool-call sequences for deterministic replay. The agent runs a multi-step task once with the LLM in the loop, then `workflow_run` it cheaply afterwards.
- **CDP event subscription** — hook into events (`Network.responseReceived`, `Page.frameNavigated`, …), buffer them across turns, drain on demand. Lets the agent observe what a click *actually* did, not just what the page now looks like.

### Safety

`aiConfirmActions` setting — `never` (default), `risky`, or `all`:

- `never` — pass-through (preserves POC behavior).
- `risky` — prompt the user before tools with side effects: `click`, `type`, `navigate`, `evaluate`, raw `cdp`, helpers, skill writes. Read-only tools pass through.
- `all` — prompt before every tool call.

Prompts appear as a small pill at the top of the window with Allow / Block. Multiple pending prompts queue FIFO. Auto-deny on 60s timeout.

## Architecture at 30,000 ft

Three-process Electron split, three directory trees:

- **`.electron/`** — main + preload. Services live in `.electron/services/`: `BrowserHarness` (CDP wrapper), `HorizonBridgeServer` (JSON-line TCP bridge between Pi and main), `HelperRegistry`, `DomainSkills`, `SkillsLibrary`, `AiActionGuard`, `ActionRecorder`, plus the existing `TabManager`, `WindowManager`, `SessionManager`, `HistoryManager`, `BookmarkManager`, `DownloadManager`, `PasswordManager`, `AutofillManager`, `SettingsManager`, `WorkflowsManager`. Built to `dist-electron/`.
- **`src/`** — React renderer (Zustand store, Tailwind). Built to `dist/`.
- **`shared/`** — process-agnostic constants. Aliased `@shared` in all Vite configs.

Renderer ↔ main is IPC-only via `window.horizonAPI` (exposed by preload contextBridge). Renderer never imports from `.electron/`. Per-window AI sessions: regular and incognito windows have separate Pi subprocesses so chats never co-mingle.

Pi extension at `resources/pi-extension/horizon-bridge.ts` registers the tool catalog and forwards each call to `HorizonBridgeServer` over a loopback TCP socket (random ephemeral port, JSON-line protocol).

See [`docs/ai-agent.md`](docs/ai-agent.md) for the full AI layer breakdown.

## Development

```bash
npm install                       # if peer-dep conflicts, --legacy-peer-deps
npm run dev                       # electron-vite dev (main + preload + renderer)
npm test                          # vitest, watch mode
npm run test:coverage             # v8 coverage; enforces ≥90% per AGENTS.md §2.1
npm run test:e2e                  # playwright
npx vitest run path/file.test.ts  # single file
npx vitest -t "test name"         # single test by name pattern
npm run lint                      # eslint flat config
```

Coding rules in [`AGENTS.md`](AGENTS.md) — TDD cycle, naming, security (no `nodeIntegration`, no `eval`/`innerHTML`), IPC patterns, file-size caps. Read it before changing code.

## Build & distribute

```bash
npm run build                     # → dist/ + dist-electron/
npm run dist                      # electron-builder package
npm run dist:mac | dist:win | dist:linux
```

Native modules (`better-sqlite3`, `electron`, `electron-updater`, Node built-ins) are externalized in `electron.vite.config.ts`, not bundled. `resources/` is included in the packaged app — bundled skills travel with the binary.

## Status

POC. 536 unit tests + 24 E2E pass. The browser core is feature-complete enough to use; the AI layer is the actively-evolving surface.
