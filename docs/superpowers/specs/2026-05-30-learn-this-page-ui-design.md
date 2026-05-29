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
triggers**: a toolbar button, a ⌘K command-palette entry, and a quick
chip inside the AI panel.

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
[Toolbar button]  ┐
[⌘K command item] ┼─→ store.requestLearnPage()
[AI-panel chip]   ┘        → { showAI: true, pendingLearnRequest: true }
                                        │
                                        ▼
                 AIPanel useEffect drains pendingLearnRequest
                 → handleSend(LEARN_PROMPT)   (existing overridePrompt path)
                 → agent turn → browser_learn_page_actions → reply (tool chip + summary)
```

The AI-panel chip is inside `AIPanel` and can call the local send
handler directly; for consistency all three converge on the same
`LEARN_PROMPT` constant.

### 2.1 Shared prompt

```
Learn what actions I can take on this page. Call browser_learn_page_actions,
then give me a short summary of the available actions (search, create,
navigation, filters, etc.), any forms, and any API endpoints you observed.
```

Exact wording lives in one `LEARN_PROMPT` constant **defined and exported from `AIPanel.tsx`** (it is the only consumer — the toolbar button, command item, and store only flip the flag; none need the prompt text).

## 3. Components / files touched

All small additions to existing files; all are already in
`vite.config.ts` `coverage.include`.

| File | Change |
|---|---|
| `src/stores/browserStore.ts` | Add `pendingLearnRequest: boolean`; `requestLearnPage()` (sets `showAI: true`, flag `true`); `consumeLearnRequest()` (clears flag). Mirrors `pendingSelection`. |
| `src/components/chrome/Toolbar.tsx` | New `icon-btn` button (magnifier-with-sparkle inline SVG, `aria-label="Learn this page"`, `title`), placed **between the ⌘K button and the AI toggle**. `onClick` wrapped in `useCallback` calls `requestLearnPage()`. |
| `src/hooks/useCommandItems.ts` | New item `{ kind: "page", label: "Learn this page's actions", hint: "AI", action: () => { requestLearnPage(); close(); } }`. |
| `src/components/overlays/AIPanel.tsx` | (a) A "🔎 Learn this page" quick chip above the input; (b) a `useEffect` draining `pendingLearnRequest` → `handleSend(LEARN_PROMPT)` → `consumeLearnRequest()`. |
| (within `AIPanel.tsx`) | Define + export the `LEARN_PROMPT` constant. |

No `enum`, no inline JSX handlers (wrap in `useCallback`), files stay
under their size caps (per AGENTS.md §3, §12.4).

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
