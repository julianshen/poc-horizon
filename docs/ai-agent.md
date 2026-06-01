# AI Agent Architecture

This document describes the AI agent layer that ships with Horizon. The browser core (tabs, omnibox, history, etc.) is documented elsewhere; this file is exclusively about the agent.

## Goals

1. **Give the agent the same handles a human gets.** Coordinate clicks, key events, full CDP — not a chat sidebar that screenshots from outside.
2. **Let the agent accumulate knowledge.** It should leave notes for its future self, not redo discovery on every visit.
3. **Stay observable and gateable.** Every tool call goes through one router; the user can flip a setting to confirm risky actions.
4. **Survive the LLM going stale.** Some tasks should run deterministically once recorded; not every visit needs the LLM in the loop.

## Process layout

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  Pi subprocess               │         │  Electron main               │
│  (one per BrowserWindow)     │         │                              │
│                              │         │                              │
│  ┌────────────────────────┐  │         │  ┌────────────────────────┐  │
│  │  horizon-bridge.ts     │  │   TCP   │  │  HorizonBridgeServer   │  │
│  │  (Pi extension)        │◄─┼─────────┼─►│  (loopback, JSON-line) │  │
│  │  registers 26 tools    │  │ random  │  └───────────┬────────────┘  │
│  └────────────────────────┘  │  port   │              │               │
│                              │         │   dispatch() ▼               │
│           ▲                  │         │  ┌──────────────────────┐    │
│           │ JSON-RPC stdio   │         │  │  AiActionGuard       │    │
│  ┌────────┴─────────────┐    │         │  │  (per-tool approval) │    │
│  │   PiSession          │    │         │  └─────────┬────────────┘    │
│  └────────────┬─────────┘    │         │            ▼                 │
└───────────────┼──────────────┘         │  ┌──────────────────────┐    │
                │ events                  │  │  router (run/case)   │    │
                │                         │  └─┬────────────────┬───┘    │
┌───────────────▼─────────────┐           │    │                │       │
│  Renderer (React)           │           │    ▼                ▼       │
│  AIPanel + AiActionPrompt   │           │  ┌─────────────┐  ┌──────┐  │
└─────────────────────────────┘           │  │BrowserHarn. │  │Help/ │  │
                                          │  │  attach(wc) │  │Skills│  │
                                          │  │  + CDP      │  │ /Rec │  │
                                          │  └─────────────┘  └──────┘  │
                                          └──────────────────────────────┘
```

- **PiSession** spawns `pi --mode rpc -e horizon-bridge.ts`, talks JSON-RPC over stdio, emits events to the renderer's AI panel.
- **HorizonBridgeServer** is the only bridge between Pi (running in a subprocess) and main-process services. JSON-line TCP, loopback only, random ephemeral port — no auth needed beyond OS process boundaries.
- **BrowserHarness** wraps `webContents.debugger` and exposes the low-level primitives. One harness shared globally; attaches to the active tab's webContents at the start of each AI turn; detaches at `turn_end` so DevTools and other single-client CDP consumers can re-attach.
- **AiActionGuard** sits in the dispatch path. Reads `aiConfirmActions` from Settings on every call; emits an `ai:actionPrompt` IPC event when approval is needed.
- Per-window: regular and incognito windows have **separate Pi subprocesses** keyed by `webContents.id`, so chats never co-mingle.

## Tool catalogue

26 tools. Full descriptions are in `resources/pi-extension/horizon-bridge.ts`; this is the short index.

### Perception

| Tool                | Returns                                              | When                                                                                     |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `screenshot`        | PNG + viewport size                                  | Reading content; verifying state after an action                                         |
| `screenshot_marked` | PNG + viewport + `marks[]` (numbered, reading-order) | About to click — pick a mark id, click its (x,y)                                         |
| `axtree`            | Accessibility tree                                   | Want names/roles/rects without an image (cheaper than screenshot for vision-less models) |
| `get_dom`           | Structured DOM snapshot                              | Need to traverse structure (rare)                                                        |
| `describe_at`       | Tag/id/classes/rect/text under a point               | Inspecting what's there before clicking                                                  |
| `reader_extract`    | Mozilla Readability output                           | Reading articles — far cheaper than full DOM                                             |

`screenshot_marked` numbers in **reading order** by default: top-to-bottom rows, left-to-right within each row. Mark 1 is the top-left interactive element. "Click the third result" therefore means the third visually-appearing result. Pass `order: 'dom'` to override (rare).

### Input

| Tool                           | Notes                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `navigate({ url })`            | Returns `{ ok, host, domainSkillsAvailable? }` — the auto-hint surfaces saved per-site notes in the same response |
| `click({ x, y, button? })`     | `Input.dispatchMouseEvent` — passes through iframes, shadow DOM, cross-origin                                     |
| `type({ text, delayMs? })`     | One `Input.dispatchKeyEvent` per char into the focused element                                                    |
| `scroll({ deltaX?, deltaY? })` | Mouse wheel event under the cursor                                                                                |

### Coordination

| Tool                                                                | Notes                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `wait_for({ selector?, networkIdleMs?, urlContains?, timeoutMs? })` | The default wait after navigate or any navigation-triggering click |
| `dismiss_overlays`                                                  | Strips cookie banners, GDPR walls, newsletter pop-ups              |

### Tabs

| Tool                 | Returns                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `tab_open({ url? })` | Creates + activates + returns `{id, url, title, isActive}`. Harness debugger re-attaches automatically |
| `tab_switch({ id })` | Re-attach to the named tab                                                                             |
| `tab_close({ id })`  | Close and return `{closed: bool}`                                                                      |
| `tab_list`           | `[{id, url, title, isActive}, ...]`                                                                    |

### JS helpers — persistent named snippets

Stored in `userData/js-helpers.json`. Helpers are **expressions evaluating to a function**, not function bodies — `(x) => ...`, `async (...) => ...`, IIFEs returning a function all valid.

| Tool                                              | Notes                                                 |
| ------------------------------------------------- | ----------------------------------------------------- |
| `save_helper({ name, expression, description? })` | Overwrites by name (refining is one call)             |
| `call_helper({ name, args? })`                    | Inlines the helper + calls `(helpers[name])(...args)` |
| `list_helpers`                                    | Names + descriptions                                  |
| `remove_helper({ name })`                         | Delete                                                |

### CDP

| Tool                             | Notes                                                            |
| -------------------------------- | ---------------------------------------------------------------- |
| `cdp({ method, params? })`       | Raw CDP — escape hatch when no higher-level tool fits            |
| `cdp_subscribe({ method })`      | Auto-enables the matching domain; events buffer until `_collect` |
| `cdp_collect({ method?, max? })` | Drains and returns; clears the bucket                            |
| `cdp_unsubscribe({ method? })`   | Specific method or omit for "all"                                |

Subscriptions persist across harness `detach`/`reattach` — the agent doesn't lose interest between turns. Per-method ring buffer capped at 200 events.

### Skills library (bundled, read-only)

| Tool                               | Returns                                       |
| ---------------------------------- | --------------------------------------------- |
| `skill_preamble`                   | Full `SKILL.md` body — the top-level playbook |
| `skill_list_interactions`          | Filenames of every bundled interaction skill  |
| `skill_read_interaction({ name })` | Body of one interaction skill                 |

13 interaction skills covering: scrolling, dropdowns, iframes, shadow-dom, dialogs, uploads, downloads, infinite-scroll, login-walls, captcha, network-spying, helpers, forms.

### Domain skills (per-host, user-writable)

Stored in `userData/domain-skills/<host>/<name>.md`. Hosts normalized (`www.` stripped, lowercased). File names must end in `.md` with no path separators.

| Tool                                      | Notes                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `domain_skill_list({ host })`             | Filenames for one host                                                                            |
| `domain_skill_read({ host, name })`       | Full `{name, host, body, bytes, updatedAt}`                                                       |
| `domain_skill_save({ host, name, body })` | Overwrites by name                                                                                |
| `domain_skill_remove({ host, name })`     | Delete                                                                                            |
| `domain_skill_search({ query, limit? })`  | Substring search across all hosts; returns matching files ranked by match count, recency for ties |

`navigate` auto-hints `domainSkillsAvailable: [...]` when the host has saved notes.

### Workflows — record + replay

Stored in `userData/action-workflows.json`. Side-effecting tool calls between `record_start` and `record_stop` are captured; read-only (`screenshot`, `axtree`, `get_dom`, `get_url`, `list_helpers`, …) and meta (`workflow*`) tools are filtered out.

| Tool                                            | Notes                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `workflow_record_start({ name, description? })` | Begin capturing                                                  |
| `workflow_record_stop`                          | Save and return the recording                                    |
| `workflow_run({ name, stepDelayMs? })`          | Replay through the same dispatch path — same safety checks apply |
| `workflow_list`                                 | Names only                                                       |
| `workflow_delete({ name })`                     | Delete                                                           |

Replay stops on the first failed step (page state has diverged).

### Reflection + UI

`get_url`, `get_title`, `render_ui` (A2UI v0.8 declarative panels rendered inside the AI side panel).

## Safety: AiActionGuard

`aiConfirmActions` setting controls the gate:

| Value             | Behavior                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `never` (default) | Pass-through. No prompts. Preserves the POC user experience                                                                                                                                                            |
| `risky`           | Prompts for tools in the risky set: `click`, `type`, `scroll`, `navigate`, `evaluate`, raw `cdp`, `callHelper`, `saveHelper`, `removeHelper`, `domainSkillSave`, `domainSkillRemove`, `cdpSubscribe`, `cdpUnsubscribe` |
| `all`             | Prompts before every tool call                                                                                                                                                                                         |

Read-only tools (`screenshot`, `axtree`, `get_dom`, `get_url`, list/read/search) **never** prompt under `risky` — they're cheap and reversible, and the agent makes hundreds of those calls per task.

Flow:

1. `bridge.dispatch(req)`
2. `guard.needsApproval(req.tool)` — reads policy, returns bool
3. If approval needed, `guard.request(tool, args)` returns `Promise<bool>`
4. Guard emits `'prompt'` event → main broadcasts `ai:actionPrompt` to every window
5. `AiActionPrompt` component (React) shows a pill with the tool name + human summary + Allow/Block
6. User clicks → renderer invokes `ai:actionDecide` → main calls `guard.decide(id, allow)` → Promise resolves
7. Tool runs (or returns `{ok:false, error:"denied by user: <tool>"}` to the agent)

Auto-deny on 60s timeout protects against a crashed renderer.

## Knowledge layers — and why they're separate

| Layer                     | Source      | Editable by                               | Loaded                                                   |
| ------------------------- | ----------- | ----------------------------------------- | -------------------------------------------------------- |
| `SKILL.md`                | Bundled     | Never (ships with binary)                 | Once per task via `skill_preamble`                       |
| `interaction-skills/*.md` | Bundled     | Never                                     | On demand by name when the agent hits the mechanic       |
| `domain-skills/<host>/`   | `userData/` | The agent itself, via `domain_skill_save` | Auto-hinted on navigate; explicit read on agent's choice |
| `js-helpers.json`         | `userData/` | The agent itself, via `save_helper`       | Inlined per-call into `window.__horizon.helpers`         |
| `action-workflows.json`   | `userData/` | The agent itself, via `workflow_record_*` | `workflow_run` replays through dispatch                  |

Bundled = generic knowledge that applies to every site; user-writable = learned knowledge specific to this user / this site / this task. The split mirrors browser-use/browser-harness's `interaction-skills/` vs `agent-workspace/domain-skills/` distinction, with one tweak: domain skills are always-on (no opt-in env flag) because in a single-user desktop browser there's no "audit before enabling" concern — the only contributor is the user's own agent.

## Service map

```
.electron/services/
├── BrowserHarness.ts        — wraps webContents.debugger, exposes primitives
├── HorizonBridgeServer.ts   — JSON-line TCP bridge to Pi subprocess
├── HelperRegistry.ts        — userData/js-helpers.json CRUD
├── DomainSkills.ts          — userData/domain-skills/ CRUD + search
├── SkillsLibrary.ts         — resources/pi-extension/skills/ (bundled, RO)
├── AiActionGuard.ts         — confirmation policy + IPC prompt emit
├── ActionRecorder.ts        — userData/action-workflows.json record/replay
└── (browser-core services: TabManager, WindowManager, ...)
```

Resource bundle:

```
resources/pi-extension/
├── horizon-bridge.ts        — Pi extension registering all 26 tools
└── skills/
    ├── SKILL.md             — top-level playbook
    └── interaction-skills/
        ├── scrolling.md
        ├── dropdowns.md
        ├── iframes.md
        ├── shadow-dom.md
        ├── dialogs.md
        ├── uploads.md
        ├── downloads.md
        ├── infinite-scroll.md
        ├── login-walls.md
        ├── captcha.md
        ├── network-spying.md
        ├── helpers.md
        └── forms.md
```

## Agent Policy v1 (site-declared contract)

Horizon implements the [Agent Policy v1 spec](https://github.com/julianshen/horizon/blob/main/docs/agent/spec/agent-policy-v1.md) — a machine-readable contract sites publish at `/agent.json` declaring what an AI agent may do autonomously, what requires human confirmation, and what's prohibited. See **[`docs/agent-policy-status.md`](agent-policy-status.md)** for the full per-section implementation status.

The agent layer's interaction with site policy:

```
browser_navigate({ url })
  → AgentPolicyResolver fetches <origin>/agent.json (ETag-cached, 24h TTL)
  → response includes { agentPolicy: { level: 0|1|2|3, site, summary } }
  → AiActionGuard.setSitePolicy(policy) refreshes the active gate rules
```

Per tool call the guard now makes a three-state decision: `allow` / `prompt` / `deny`. Site policy can only _raise_ the bar (force prompt, or hard deny on `prohibited` triggers); it can't lower it past the user's `aiConfirmActions` setting. Most-restrictive-wins, as the spec requires.

The agent can also pull the full policy on demand via `browser_get_agent_policy`. Outgoing requests carry `X-Horizon-Agent: true` (toggleable via `aiAdvertiseAgent` setting) so sites can identify agent-driven traffic.

Spec coverage today: site-wide `/agent.json` resolution, conformance level reporting (0–3), `requires_human` → prompt gating, `prohibited` → hard deny gating, agent identification header. Per-page `<meta>` / per-element `data-agent-*` reading and structured action invocation (`actions[]`) are tracked in the status doc as next-up.

## Packaging & provider configuration

Pi ships **bundled** — no global install required.

- **Build:** `npm run build:pi` (in `scripts/build-pi.mjs`) uses `bun build --compile` to pack `@earendil-works/pi-coding-agent` into a single executable at `resources/bin/pi` (git-ignored), copying the assets Pi loads relative to the binary (`package.json`, `theme/`, `assets/`, `export-html/`, `docs/`, photon WASM). The `dist*` scripts run it automatically; cross-compile with `--target=bun-<os>-<arch>`.
- **Packaging:** `electron-builder.json5` ships `resources/bin` and `resources/pi-extension` as `extraResources` (real on-disk paths, since the external Pi process can't read inside `app.asar`). `resolvePiResource()` in `main.ts` prefers the `process.resourcesPath` copy and falls back to the dev tree. `resolvePiBinary()` prefers an absolute `aiPiBinary` override, then the bundled binary, then `pi` on `$PATH`.
- **App-local config + workspace:** the Pi subprocess runs with `cwd` = `<userData>/pi` and `PI_CODING_AGENT_DIR` = `<userData>/pi/agent`, so all of Pi's config/auth/sessions live inside the app's data dir rather than `~/.pi`.
- **Provider/model setup:** Settings → *AI Provider* writes `aiProvider` / `aiModel` / `aiApiKey` / `aiBaseUrl`. `PiConfigWriter.writePiConfig()` (pure builders in `piConfig.ts`) materializes them into the agent dir before each spawn: `settings.json` (`defaultProvider`/`defaultModel`), `auth.json` (`{provider: {type:"api_key", key}}`, `0600`), and — when a custom base URL is set — a generated `registerProvider` override extension. Changing any of these keys disposes running Pi sessions (`onAiConfigChanged`) so the next `ai:start` respawns with fresh config.

## Inspirations

- **Anthropic Computer Use** — Set-of-Marks perception pattern (numbered overlays on clickable targets).
- **browser-use / browser-harness** — three-layer skills (preamble + interaction-skills + domain-skills) and the "agent leaves notes for itself" pattern.
- **Playwright** — `wait_for` semantics (selector / network-idle / url-contains).
- **Firefox Reader View** — the Readability algorithm `reader_extract` uses.

## Pointers for extending

- Adding a new tool: add (a) a route in `HorizonBridgeServer.run()`, (b) a method on `BrowserHarness` (or a service), (c) a `pi.registerTool` entry in `resources/pi-extension/horizon-bridge.ts` with a clear LLM-facing description.
- Adding a bundled interaction skill: drop a markdown file in `resources/pi-extension/skills/interaction-skills/`. It's picked up automatically by `SkillsLibrary.listInteractions`.
- Marking a new tool as risky: add to `RISKY_TOOLS` in `AiActionGuard.ts`. Risky-vs-read-only is also reflected in the recorder's `READ_ONLY` set in `ActionRecorder.ts` — they're related but evolve independently.
- Native dependencies: add to `rollupOptions.external` in `electron.vite.config.ts`.
