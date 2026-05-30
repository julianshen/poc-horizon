# Save Learned Actions & Skills — Design Spec

**Date:** 2026-05-30
**Status:** Approved — ready for implementation plan
**Related:**
- `docs/superpowers/specs/2026-05-30-learn-this-page-ui-design.md` (the learn affordance this builds on)
- `docs/superpowers/research/2026-05-29-skill-sourcing-learn-from-web.md` §5, §7 (Sub-project B: agent proposes, user confirms; output feeds existing knowledge layers)

## 1. Goal

Let the user **save what the agent learned or did, for reuse** — via an
agent-drafted, user-confirmed flow. Two artifact types:

- **Site skill** — per-host knowledge (markdown) the agent automatically
  reads on future visits. Backed by the existing `DomainSkills` service.
- **Reusable action** — a named, re-runnable request. Backed by the
  existing workflows store (the `WorkflowsPopover` already lists/runs them).

Helpers (raw JS snippets) stay agent-internal — not exposed to users.

**Authoring model:** the agent drafts; the user reviews/edits/confirms in
a card (research §7 trust principle). **Trigger model:** user-initiated —
the user clicks "Save…"; the agent does not save autonomously.

## 2. Architecture

Renderer + a thin bridge addition. The save itself is a plain
renderer→main IPC; the agent only *drafts* the proposal.

```
                 user clicks "Save…" (on an AI reply / tool-call chip)
                              │
                              ▼
        AIPanel dispatches a constrained agent request:
        "propose a saved item from what we just learned/did"
                              │
                              ▼
        agent calls NEW non-blocking tool browser_propose_save({
          kind: "skill" | "action", name, content, host?, attach?
        })
                              │  (bridge → emitter → main, mirrors AiActionGuard's
                              ▼   AI_ACTION_PROMPT path)
        main: win.webContents.send(IPC_CHANNELS.AI_SAVE_PROPOSAL, proposal)
                              │
                              ▼
        renderer renders the editable confirm card (SaveProposalCard)
                              │
              ┌───────────────┴───────────────┐
         user edits + Save                user Cancel
              │                                 │
              ▼                                 ▼
   IPC persist (no agent round-trip)        dismiss, nothing saved
   - kind "skill"  → domainSkill:save → DomainSkills.save(host,name,content)
   - kind "action" → workflow:create  (EXISTING IPC)
```

### 2.1 The propose tool (`browser_propose_save`)

Registered in `resources/pi-extension/horizon-bridge.ts`. **Non-blocking**
— it surfaces a proposal to the UI and returns immediately (e.g. returns
`{ proposed: true }`). It does NOT wait for the user's decision; the
confirm/save happens entirely in the renderer via IPC. This mirrors how
`navigate` already emits a domain-skill hint rather than blocking.

```ts
pi.registerTool({
  name: "browser_propose_save",
  label: "Propose a save",
  description:
    "Surface a draft 'site skill' or 'reusable action' to the user for confirmation. " +
    "Call this when the user asks to save what they learned/did. The user reviews and confirms in the UI; " +
    "you do not save directly. kind='skill' for per-site knowledge (markdown content + host), " +
    "kind='action' for a re-runnable request (name + prompt + attach).",
  parameters: Type.Object({
    kind: Type.Union([Type.Literal("skill"), Type.Literal("action")]),
    name: Type.String(),
    content: Type.String(),          // markdown (skill) or prompt (action)
    host: Type.Optional(Type.String()),     // skill only; defaults to active origin
    attach: Type.Optional(Type.String()),   // action only: "activeTab"|"allTabs"|"none"
  }),
  execute: async (_id, params) => bridge("proposeSave", params as Record<string, unknown>),
});
```

### 2.2 Bridge → renderer emit

`HorizonBridgeServer` gets a `proposeSave` case. The bridge cannot reach
the window directly (services own the window, not the bridge — CLAUDE.md
§11.3), so it surfaces the proposal through an injected emitter, exactly
like `AiActionGuard` surfaces prompts:

- Add an `onSaveProposal?` callback constructor dependency to
  `HorizonBridgeServer` (sibling of `compactSession`), OR reuse an
  EventEmitter the guard already exposes. **The plan picks one and wires
  `main.ts` to forward it to `win.webContents.send(IPC_CHANNELS.AI_SAVE_PROPOSAL, proposal)`.**
- New channel constant: `AI_SAVE_PROPOSAL: "ai:saveProposal"` in
  `.electron/ipc/channels.ts` and `shared/constants.ts`.

The proposal payload is `{ kind, name, content, host?, attach? }` plus a
generated `id` (for the renderer's queue).

### 2.3 Confirm card (`SaveProposalCard.tsx`)

New overlay component under `src/components/overlays/`. Renders the
editable card (see the brainstorm mockup):

- A type toggle: **Site skill** ◧ / **Reusable action** ▷ (pre-selected
  from `proposal.kind`; user can flip).
- **Name** field.
- Site skill: **host** field (prefilled with the proposal's host or the
  active origin) + a **content** textarea (markdown, agent-drafted).
- Reusable action: a **prompt/"what it does"** textarea + an **attach**
  selector (activeTab / allTabs / none).
- **Save** and **Cancel** buttons.

Multiple proposals queue FIFO and are shown one at a time — reuse the
queue pattern from `AiActionPrompt.tsx`. **`AIPanel` owns the queue:** it
listens to `ai:saveProposal` (the same place it already listens to
`ai:event`), keeps a local `proposals` array in state, and renders
`SaveProposalCard` for the head of the queue. No store slice is added for
this.

On **Save**:
- `kind === "skill"` → `window.horizonAPI.invoke("domainSkill:save", { host, name, content })`
- `kind === "action"` → `window.horizonAPI.invoke("workflow:create", { name, prompt: content, attach })` (existing channel)

On **Cancel** → dequeue, nothing persisted.

### 2.4 Save entry points

- **B1:** a "Save…" button in the **AI panel header** (beside the existing
  Summarize / Learn buttons). Clicking it dispatches the constrained
  "propose a save" request to the agent via `runPreset` with a new
  `SAVE_LABEL` preset (consistent with the Learn/Summarize buttons).
  Disabled while a turn is running and until at least one turn has
  completed (nothing to draw from otherwise).
- **B3:** a small save icon on agent **tool-call chips** (`ToolChip`),
  seeding the same propose request scoped to that tool call.

### 2.5 New IPC (renderer → main)

Added to `IPC_CHANNELS` (`shared/constants.ts`) + handlers (co-located
with the existing `workflow:*` handlers; `main.ts` already constructs the
`DomainSkills` instance):

| Channel | Payload | Backed by |
|---|---|---|
| `domainSkill:save` | `{ host, name, content }` | `DomainSkills.save` |
| `domainSkill:list` | `{ host? }` | `DomainSkills.list` / `listHosts` |
| `domainSkill:remove` | `{ host, name }` | `DomainSkills.remove` |

`workflow:list` / `workflow:create` / `workflow:delete` already exist.

### 2.6 Management surface (B2)

Extend `WorkflowsPopover` (or a sibling "Saved" panel) to also list
**site skills** grouped by host, alongside reusable actions:

- Reusable actions: run (existing `onRun`) / delete (existing).
- Site skills: view content, delete (`domainSkill:remove`). "Run" is not
  applicable — a site skill is passive knowledge the agent auto-reads; the
  list is for review/management.

## 3. Components / files

| File | Change | Phase |
|---|---|---|
| `resources/pi-extension/horizon-bridge.ts` | Register `browser_propose_save` | B1 |
| `.electron/services/HorizonBridgeServer.ts` | `proposeSave` case → emitter | B1 |
| `.electron/ipc/channels.ts` + `shared/constants.ts` | `AI_SAVE_PROPOSAL` + `domainSkill:save/list/remove` | B1/B2 |
| `.electron/main.ts` | Wire emitter → `webContents.send`; register `domainSkill:*` handlers | B1/B2 |
| `src/types/*` (horizonAPI typing) | Type the new channels | B1/B2 |
| `src/components/overlays/SaveProposalCard.tsx` (NEW) | The confirm card | B1 |
| `src/components/overlays/AIPanel.tsx` | "Save…" trigger; listen `ai:saveProposal`; render card | B1 |
| `src/components/overlays/WorkflowsPopover.tsx` (or new SavedPanel) | List + manage site skills | B2 |
| `src/components/overlays/AIPanel.tsx` (`ToolChip`) | Save icon on tool-call chips | B3 |

## 4. Error / edge handling

- **Nothing to propose / agent returns no proposal:** the agent replies
  normally ("nothing worth saving"); no card appears. The "Save…" button
  is disabled until a turn has completed.
- **Malformed/empty proposal:** the card opens with whatever fields are
  present; empty required fields (name, or content) disable **Save** until
  filled. The user can always author manually in the card.
- **Duplicate name:** site skill — `DomainSkills.save(host,name)` overwrites
  by `(host,name)`; the card warns "a skill named X exists for this host —
  saving overwrites it." Reusable action — if a workflow with the name
  exists, the card warns and the user renames or confirms overwrite (plan
  defines the exact dup policy for `workflow:create`).
- **No host for a site skill** (e.g. `about:blank`, no active tab): the
  Site-skill type is disabled with a hint; only Reusable action is offered.
- **Card shown mid-turn:** proposals queue FIFO (AiActionPrompt pattern);
  shown one at a time.
- **Persist failure (disk/IPC):** the IPC rejects; the card stays open and
  shows the error — never a silent success.

## 5. Testing

- **`browser_propose_save` routing:** bridge `proposeSave` case invokes the
  emitter with the normalized proposal (kind/name/content/host/attach + id).
- **`SaveProposalCard`:** renders a skill proposal and an action proposal;
  flipping the type swaps fields; Save with `kind:"skill"` calls
  `domainSkill:save` with edited values; Save with `kind:"action"` calls
  `workflow:create`; Cancel dequeues without an IPC; empty name/content
  disables Save; the duplicate/no-host warnings render.
- **IPC handlers:** `domainSkill:save/list/remove` call the `DomainSkills`
  methods with validated payloads and round-trip (per AGENTS.md §2.2).
- **Queue:** two proposals show one at a time; resolving the first reveals
  the second.
- **AIPanel:** the "Save…" trigger dispatches the propose request; an
  incoming `ai:saveProposal` enqueues and mounts the card.
- Coverage: new renderer files + touched files added to
  `vite.config.ts` `coverage.include`; target ≥90% on new files (the
  repo-wide gate is pre-existing debt, tracked separately).

## 6. Phasing (each shippable)

- **B1 — Core save flow:** propose tool + `AI_SAVE_PROPOSAL` event +
  `SaveProposalCard` + `domainSkill:save` + "Save…" on the reply.
  Delivers "teach about this site" and "one-click action" from learn
  results.
- **B2 — Saved-items management:** `domainSkill:list`/`remove` + the
  "Saved" surface (extend `WorkflowsPopover`) to review/run/delete.
- **B3 — Save any tool-call:** save icon on `ToolChip` feeding the B1 flow.

## 7. Out of scope

- Exposing **helper (JS snippet)** authoring to users — stays agent-only.
- Editing a site skill's content *after* saving from the management list
  (delete + re-save instead, v1).
- Syncing/sharing saved items across devices.
- A blocking agent-proactive `browser_suggest_skill` tool (we chose
  user-triggered; the non-blocking `browser_propose_save` is the only new
  agent tool).
