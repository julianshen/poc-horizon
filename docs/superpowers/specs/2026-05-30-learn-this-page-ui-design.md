# "Learn this page" UI Affordance — Design Spec

**Date:** 2026-05-30
**Status:** Approved — ready for implementation plan
**Related:** `docs/superpowers/specs/2026-05-29-structured-actions-learn-design.md` (sub-project A — the `browser_learn_page_actions` agent tool this UI surfaces)

## 1. Goal

Give users a discoverable, one-click way to invoke the agent's
`browser_learn_page_actions` capability. Today the tool exists but is
only reachable when the LLM chooses to call it mid-turn — there is no
user-facing trigger. This adds one.

**Behavior (agent-assisted):** a single action — open the AI panel and
**auto-send** a fixed "learn this page" prompt — exposed through **three
triggers**: a toolbar button, a ⌘K command-palette entry, and a button in
the AI panel header.

> **As-built note (synced 2026-05-30):** the in-panel affordance is a
> header icon button beside the existing "Summarize this page" button
> (not a chip above the input). This reuses the established preset/
> header-button pattern and keeps the prompt in one place — the
> `resolvePreset` registry. Decided at plan time and carried into
> implementation.

This is deliberately *not* a deterministic, no-LLM inspector. The user
chose the agent-assisted path: the agent runs the tool and replies with
a natural-language summary (and can go on to propose domain skills),
reusing the existing AI panel, agent loop, and tool-chip rendering.

## 2. Architecture

Renderer-only. No new IPC channel, no main-process changes, no harness
plumbing — the agent turn already attaches the `BrowserHarness` to the
active tab for the duration of the turn, so `browser_learn_page_actions`
works without special wiring.

Data flow follows Horizon's existing one-way pattern (main → store →
components; triggers flip store state, `AIPanel` reacts). It mirrors the
existing `pendingSelection` drain.

```
[Toolbar button]    ┐
[⌘K command item]   ┼─→ store.requestLearnPage()
                    │        → { showAI: true, pendingLearnRequest: true }
                    │                   │
                    │                   ▼
                    │   AIPanel useEffect drains pendingLearnRequest
                    │   → runPreset(LEARN_LABEL)  (consume flag, then run)
[AI-panel header ───┘   → send(preset.prompt, activeTab)  (existing path)
 button] ───────────────→ runPreset(LEARN_LABEL) directly
                        → agent turn → browser_learn_page_actions → reply (tool chip + summary)
```

The toolbar button and ⌘K command flip the store flag; `AIPanel` drains
it via `runPreset(LEARN_LABEL)`. The AI-panel header button is inside
`AIPanel` and calls `runPreset(LEARN_LABEL)` directly. All three resolve
the same prompt from one place — the `resolvePreset` registry.

### 2.1 Shared prompt

```
Learn what actions I can take on this page. Call browser_learn_page_actions,
then give me a short summary of the available actions (search, create,
navigation, filters, etc.), any forms, and any API endpoints you observed.
```

The prompt lives in exactly one place: the `LEARN_LABEL` branch of the
existing `resolvePreset()` registry in `AIPanel.tsx` (`attach: "activeTab"`,
so the agent targets the focused tab). `LEARN_LABEL` (`"Learn this page's
actions"`) is the single shared label/preset key — also used as the panel
button's `aria-label` and the drain target. No standalone exported
`LEARN_PROMPT` constant is needed; nothing outside `AIPanel` consumes the
prompt text (the toolbar/command only flip the store flag).

## 3. Components / files touched

All small additions to existing files; all are already in
`vite.config.ts` `coverage.include`.

| File | Change |
|---|---|
| `src/stores/browserStore.ts` | Add `pendingLearnRequest: boolean`; `requestLearnPage()` (sets `showAI: true`, flag `true`); `consumeLearnRequest()` (clears flag). Mirrors `pendingSelection`. |
| `src/components/chrome/Toolbar.tsx` | New `icon-btn` button (magnifier-with-sparkle inline SVG, `aria-label="Learn this page's actions"`, `title`), placed **between the ⌘K button and the AI toggle**. `onClick={requestLearnPage}` (the store action is a stable reference, so no `useCallback` wrapper — not an inline arrow). |
| `src/hooks/useCommandItems.ts` | New item `{ kind: "page", label: "Learn this page's actions", hint: "AI", action: () => { requestLearnPage(); close(); } }`; `requestLearnPage` added to the `useMemo` deps. |
| `src/components/overlays/AIPanel.tsx` | (a) `LEARN_LABEL` constant + a `resolvePreset` branch holding the prompt; (b) a header icon button beside "Summarize this page" with `aria-label={LEARN_LABEL}`, calling a memoized `runPreset(LEARN_LABEL)`; (c) a `useEffect` draining `pendingLearnRequest` → `consumeLearnRequest()` then `runPreset(LEARN_LABEL)` (no-ops while a turn runs). |

No `enum`. Inline JSX arrow handlers are wrapped in `useCallback` (Toolbar
uses the bare stable store action; the panel header button uses a memoized
`runPreset` wrapper, matching the file's pattern). `AIPanel.tsx` is a
pre-existing large file (>200-line cap); this feature adds ~40 lines and
does not split it — clearing that pre-existing debt is out of scope.

## 4. Error / edge handling

- **AI not configured / no API key:** triggers stay enabled (same as the
  existing AI toggle button). The turn surfaces whatever the AI panel
  already shows for an unconfigured agent. No new gating — consistent
  with current behavior, no silent failure.
- **A turn is already running:** `handleSend` already guards on
  `running`. The drain respects that guard; an incoming request that
  arrives mid-turn is **dropped** (flag cleared), not queued — avoids
  stacking a second turn.
- **No active tab / blank page:** the learn tool returns a near-empty
  `LearnResult`; the agent reports "nothing actionable found." No new
  crash path.

## 5. Testing

- **`browserStore`:** `requestLearnPage()` sets `showAI` + `pendingLearnRequest`; `consumeLearnRequest()` clears the flag.
- **`useCommandItems`:** the "Learn this page's actions" item is present and its `action` invokes `requestLearnPage()` and `close()`.
- **`AIPanel`:** when `pendingLearnRequest` flips `true`, `handleSend` is called with `LEARN_PROMPT` and the flag is consumed; the chip click does the same; **no** send fires when a turn is already running.
- **`Toolbar`:** the new button renders with its `aria-label` and calls `requestLearnPage()` on click.
- Coverage: target ≥90% on the touched files (already in `coverage.include`).

## 6. Out of scope

- **Deterministic no-LLM inspector** (direct IPC → `PageLearner`,
  rendering `LearnResult` as a card). Considered and rejected for this
  iteration in favor of the agent-assisted path.
- **Saving the result as a domain skill / confirmation UI** — that's
  sub-project B (`browser_suggest_skill`).
- **Keyboard shortcut** for the trigger — can be added later via
  `useKeyboardShortcuts`; not required for v1.
- **Disabling triggers when AI is unconfigured** — intentionally not
  gated (see §4).

## 7. File checklist

- Modify: `src/stores/browserStore.ts`
- Modify: `src/components/chrome/Toolbar.tsx`
- Modify: `src/hooks/useCommandItems.ts`
- Modify: `src/components/overlays/AIPanel.tsx`
- Add/extend tests: `tests/unit/browserStore.test.ts`, `tests/unit/useCommandItems.test.ts`, `tests/unit/AIPanel.test.tsx`, `tests/unit/Toolbar.test.tsx` (create any that don't yet exist)
