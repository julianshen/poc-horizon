# Save Learned Actions & Skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user save what the agent learned/did as a per-site **skill** or a re-runnable **action**, via an agent-drafted, user-confirmed card.

**Architecture:** A non-blocking `browser_propose_save` agent tool surfaces a draft proposal; the bridge forwards it through an `onSaveProposal` callback that `main.ts` broadcasts as `ai:saveProposal` (mirroring the existing `AiActionGuard` → `ai:actionPrompt` path). A `SaveProposalCard` overlay (mounted in `App.tsx`, FIFO queue like `AiActionPrompt`) lets the user edit and confirm; confirming persists via a new `domainSkill:save` IPC or the existing `workflow:create` IPC. No agent round-trip for the save itself.

**Tech Stack:** Electron, React 19, Zustand, TypeScript, Vitest + React Testing Library (jsdom), `tests/helpers/fakeHorizonAPI`.

**Spec:** `docs/superpowers/specs/2026-05-30-save-learned-actions-skills-design.md`

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `.electron/ipc/channels.ts` | `AI_SAVE_PROPOSAL`, `DOMAIN_SKILL_SAVE/LIST/REMOVE` constants | B1/B2 |
| `src/types/ipc.ts` | Channel→payload typings for the new channels | B1/B2 |
| `.electron/main.ts` | `domainSkill:*` IPC handlers; wire bridge `onSaveProposal` → broadcast `AI_SAVE_PROPOSAL` | B1/B2 |
| `.electron/services/HorizonBridgeServer.ts` | `onSaveProposal` ctor dep + `proposeSave` case | B1 |
| `resources/pi-extension/horizon-bridge.ts` | Register `browser_propose_save` | B1 |
| `src/components/overlays/SaveProposalCard.tsx` (NEW) | Editable confirm card + FIFO queue | B1 |
| `src/App.tsx` | Mount `SaveProposalCard` | B1 |
| `src/components/overlays/AIPanel.tsx` | "Save…" header button + `SAVE_LABEL` preset | B1 |
| `src/components/overlays/WorkflowsPopover.tsx` | List/delete site skills alongside actions | B2 |
| `src/components/overlays/AIPanel.tsx` (`ToolChip`) | Save icon on tool-call chips | B3 |
| `vite.config.ts` | Add `SaveProposalCard.tsx` to coverage include | B1 |

---

# Phase B1 — Core save flow

## Task 1: IPC channel constants + payload types

**Files:**
- Modify: `.electron/ipc/channels.ts`
- Modify: `src/types/ipc.ts`

- [ ] **Step 1: Add channel constants**

In `.electron/ipc/channels.ts`, after the `AI_ACTION_DECIDE: "ai:actionDecide",` line, add:

```ts
  AI_SAVE_PROPOSAL: "ai:saveProposal",
```

And after the `WORKFLOW_DELETE: "workflow:delete",` line, add:

```ts
  DOMAIN_SKILL_SAVE: "domainSkill:save",
  DOMAIN_SKILL_LIST: "domainSkill:list",
  DOMAIN_SKILL_REMOVE: "domainSkill:remove",
```

- [ ] **Step 2: Add payload types**

In `src/types/ipc.ts`, after the `"ai:actionDecide": { id: string; allow: boolean };` entry, add:

```ts
  /** Main → Renderer: the agent drafted something to save; the renderer
   *  shows an editable confirm card. */
  "ai:saveProposal": {
    id: string;
    kind: "skill" | "action";
    name: string;
    content: string;
    host?: string;
    attach?: "activeTab" | "allTabs" | "none";
  };
  /** Renderer → Main: persist a per-site skill. */
  "domainSkill:save": { host: string; name: string; content: string };
  /** Renderer → Main: list skill names for a host (or all hosts when host omitted). */
  "domainSkill:list": { host?: string };
  /** Renderer → Main: delete a per-site skill. */
  "domainSkill:remove": { host: string; name: string };
```

- [ ] **Step 3: Type-check & commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from these files.

```bash
git add .electron/ipc/channels.ts src/types/ipc.ts
git commit -m "feat(ipc): add ai:saveProposal + domainSkill:save/list/remove channels"
```

---

## Task 2: `domainSkill:save` IPC handler

**Files:**
- Modify: `.electron/main.ts`

- [ ] **Step 1: Register the handler**

In `.electron/main.ts`, immediately after the `IPC_CHANNELS.WORKFLOW_DELETE` handler block (around line 577), add:

```ts
  ipcMain.handle(
    IPC_CHANNELS.DOMAIN_SKILL_SAVE,
    (_event, { host, name, content }: { host: string; name: string; content: string }) => {
      if (!host || !name) throw new Error("domainSkill:save requires host and name");
      return domainSkills.save(host, name, content ?? "");
    },
  );
```

(`domainSkills` is the module-level `DomainSkills` instance constructed at
`main.ts:338`. `DomainSkills.save(host, name, body)` writes the markdown
file and returns a `DomainSkillFile`.)

- [ ] **Step 2: Build to verify wiring**

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add .electron/main.ts
git commit -m "feat(main): domainSkill:save IPC handler → DomainSkills.save"
```

---

## Task 3: `browser_propose_save` tool + bridge case + emit wiring

**Files:**
- Modify: `.electron/services/HorizonBridgeServer.ts`
- Modify: `.electron/main.ts`
- Modify: `resources/pi-extension/horizon-bridge.ts`

- [ ] **Step 1: Add the `onSaveProposal` constructor dependency**

In `.electron/services/HorizonBridgeServer.ts`, add a new constructor
parameter after `pageLearner`:

```ts
    private readonly pageLearner?: PageLearner,
    /** Surfaces an agent-drafted save proposal to the renderer. Wired by
     *  main to broadcast ai:saveProposal. */
    private readonly onSaveProposal?: (proposal: {
      id: string;
      kind: "skill" | "action";
      name: string;
      content: string;
      host?: string;
      attach?: "activeTab" | "allTabs" | "none";
    }) => void,
```

- [ ] **Step 2: Add the `proposeSave` dispatch case**

Find the dispatch `switch` (the same one with the `learnPageActions` case
added previously). Add this case alongside the others:

```ts
      // ─── Save proposal (agent drafts, user confirms in UI) ───────
      case "proposeSave": {
        if (!this.onSaveProposal) throw new Error("save proposal sink not enabled");
        const kind = args.kind === "action" ? "action" : "skill";
        const name = String(args.name ?? "").trim();
        const content = String(args.content ?? "");
        const host = typeof args.host === "string" ? args.host : undefined;
        const attach =
          args.attach === "activeTab" || args.attach === "allTabs" || args.attach === "none"
            ? args.attach
            : undefined;
        // Resolve a default host for skills from the active tab.
        let resolvedHost = host;
        if (kind === "skill" && !resolvedHost) {
          resolvedHost = this.hostFromUrl(await this.harness.getUrl()) ?? undefined;
        }
        const id = `save-${this.nextProposalSeq()}`;
        this.onSaveProposal({ id, kind, name, content, host: resolvedHost, attach });
        return { proposed: true, id };
      }
```

Add a tiny monotonic id helper as a private field + method on the class
(near the top of the class body, e.g. after `private rateLimit...` or just
add fresh):

```ts
  private proposalSeq = 0;
  private nextProposalSeq(): number {
    this.proposalSeq += 1;
    return this.proposalSeq;
  }
```

- [ ] **Step 3: Wire the emitter in main.ts**

In `.electron/main.ts`, in the `new HorizonBridgeServer(...)` call (around
line 194), add a final argument after `new PageLearner(),`:

```ts
      new PageLearner(),
      (proposal) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed())
            w.webContents.send(IPC_CHANNELS.AI_SAVE_PROPOSAL, proposal);
        }
      },
```

(This mirrors the existing `aiActionGuard.on("prompt", …)` broadcast at
main.ts ~350.)

- [ ] **Step 4: Register the agent tool**

In `resources/pi-extension/horizon-bridge.ts`, after the
`browser_learn_page_actions` registration, add:

```ts
  // ─── Save proposal ────────────────────────────────────────────────
  pi.registerTool({
    name: "browser_propose_save",
    label: "Propose a save",
    description:
      "Surface a draft to the user for confirmation when they ask to save what they learned or did. " +
      "You do NOT save directly — the user reviews and confirms in the UI. " +
      "kind='skill' for per-site knowledge (markdown 'content' + optional 'host', defaults to the active site); " +
      "kind='action' for a re-runnable request ('name' + a 'content' prompt + 'attach'=activeTab|allTabs|none). " +
      "Pick the single most useful thing to save and give it a short, clear name.",
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("skill"), Type.Literal("action")]),
      name: Type.String(),
      content: Type.String(),
      host: Type.Optional(Type.String()),
      attach: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) =>
      bridge("proposeSave", params as Record<string, unknown>),
  });
```

- [ ] **Step 5: Build to verify**

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 6: Commit**

```bash
git add .electron/services/HorizonBridgeServer.ts .electron/main.ts resources/pi-extension/horizon-bridge.ts
git commit -m "feat(ai): browser_propose_save tool → ai:saveProposal broadcast"
```

---

## Task 4: `SaveProposalCard` component

**Files:**
- Create: `src/components/overlays/SaveProposalCard.tsx`
- Test: `tests/unit/SaveProposalCard.test.tsx` (create)

The component listens to `ai:saveProposal`, queues FIFO (like
`AiActionPrompt`), renders the head as an editable card, and on Save calls
the right IPC. Built test-first.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/SaveProposalCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { SaveProposalCard } from "@/components/overlays/SaveProposalCard";

const skillProposal = {
  id: "save-1",
  kind: "skill" as const,
  name: "search-and-filter",
  content: "## Search\nUse the box.",
  host: "news.ycombinator.com",
};
const actionProposal = {
  id: "save-2",
  kind: "action" as const,
  name: "Search HN",
  content: "Search this site for {query}.",
  attach: "activeTab" as const,
};

describe("SaveProposalCard", () => {
  const { api } = setupRendererTest();

  it("renders nothing until a proposal arrives", () => {
    const { container } = render(<SaveProposalCard />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a skill proposal and saves via domainSkill:save with edited values", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", skillProposal));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api().invokes).toContainEqual({
      channel: "domainSkill:save",
      payload: { host: "news.ycombinator.com", name: "renamed", content: "## Search\nUse the box." },
    });
  });

  it("shows an action proposal and saves via workflow:create", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", actionProposal));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api().invokes).toContainEqual({
      channel: "workflow:create",
      payload: { name: "Search HN", prompt: "Search this site for {query}.", attach: "activeTab" },
    });
  });

  it("flips kind from skill to action and saves as a workflow", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", skillProposal));
    fireEvent.click(screen.getByRole("button", { name: "Reusable action" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const last = api().invokes.at(-1);
    expect(last!.channel).toBe("workflow:create");
  });

  it("Cancel dismisses without any IPC", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", skillProposal));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api().invokes.length).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables Save when the name is empty", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", { ...skillProposal, name: "" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the card open and shows an error when the save IPC rejects", async () => {
    api().invoke.mockRejectedValueOnce(new Error("disk full"));
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", skillProposal));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("disk full");
    expect(screen.queryByRole("dialog")).not.toBeNull(); // still open, not dequeued
  });

  it("queues FIFO — resolving the first reveals the second", async () => {
    render(<SaveProposalCard />);
    act(() => {
      api().emit("ai:saveProposal", skillProposal);
      api().emit("ai:saveProposal", actionProposal);
    });
    // First card = skill (Name shows "search-and-filter").
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("search-and-filter");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Second card = action.
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Search HN");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/SaveProposalCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/overlays/SaveProposalCard.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from "react";

interface Proposal {
  id: string;
  kind: "skill" | "action";
  name: string;
  content: string;
  host?: string;
  attach?: "activeTab" | "allTabs" | "none";
}

/**
 * Renders agent-drafted "save this" proposals for user confirmation. Main
 * broadcasts `ai:saveProposal`; the user edits and confirms; we persist via
 * `domainSkill:save` (skill) or `workflow:create` (action). Multiple
 * proposals queue FIFO — mirrors AiActionPrompt so we never lose one.
 */
export const SaveProposalCard: React.FC = () => {
  const [queue, setQueue] = useState<Proposal[]>([]);
  const current = queue[0];

  // Editable fields, re-seeded whenever the head of the queue changes.
  const [kind, setKind] = useState<"skill" | "action">("skill");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [content, setContent] = useState("");
  const [attach, setAttach] = useState<"activeTab" | "allTabs" | "none">("activeTab");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return window.horizonAPI.on("ai:saveProposal", (p: Proposal) =>
      setQueue((q) => [...q, p]),
    );
  }, []);

  useEffect(() => {
    if (!current) return;
    setKind(current.kind);
    setName(current.name);
    setHost(current.host ?? "");
    setContent(current.content);
    setAttach(current.attach ?? "activeTab");
    setError(null);
  }, [current]);

  const dequeue = useCallback(() => setQueue((q) => q.slice(1)), []);

  // Await the persist so a failure keeps the card open with an error
  // (never a silent success — only dequeue when the save actually lands).
  const save = useCallback(async () => {
    if (!current || !name.trim()) return;
    try {
      if (kind === "skill") {
        await window.horizonAPI.invoke("domainSkill:save", { host, name, content });
      } else {
        await window.horizonAPI.invoke("workflow:create", { name, prompt: content, attach });
      }
      setError(null);
      dequeue();
    } catch (e) {
      setError((e as Error)?.message || "Save failed");
    }
  }, [current, kind, name, host, content, attach, dequeue]);

  if (!current) return null;

  const remaining = queue.length - 1;
  const canSave = name.trim().length > 0 && (kind === "action" || host.trim().length > 0);

  return (
    <div
      role="dialog"
      aria-label="Save to Horizon"
      className="absolute top-[90px] left-1/2 z-50 fade-in"
      style={{
        transform: "translateX(-50%)",
        background: "var(--surface-1)",
        boxShadow: "var(--shadow-lg)",
        border: "0.5px solid var(--accent-primary)",
        borderRadius: "var(--radius-lg)",
        padding: 14,
        width: "min(440px, 92vw)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold" style={{ color: "var(--chrome-fg-muted)" }}>
          Save to Horizon{remaining > 0 && <span className="ml-2" style={{ color: "var(--accent-primary)" }}>+{remaining} more</span>}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setKind("skill")}
            aria-pressed={kind === "skill"}
            className="px-2 py-1 text-xs rounded-md"
            style={{ background: kind === "skill" ? "var(--accent-primary)" : "transparent", color: kind === "skill" ? "var(--accent-text)" : "var(--chrome-fg-muted)" }}
          >
            Site skill
          </button>
          <button
            type="button"
            onClick={() => setKind("action")}
            aria-pressed={kind === "action"}
            className="px-2 py-1 text-xs rounded-md"
            style={{ background: kind === "action" ? "var(--accent-primary)" : "transparent", color: kind === "action" ? "var(--accent-text)" : "var(--chrome-fg-muted)" }}
          >
            Reusable action
          </button>
        </div>
      </div>

      <label className="text-xs" style={{ color: "var(--chrome-fg-muted)" }}>
        Name
        <input
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full mt-0.5 px-2 py-1 text-sm rounded-md"
          style={{ background: "var(--surface-2)", color: "var(--chrome-fg)", border: "0.5px solid var(--chrome-border)" }}
        />
      </label>

      {kind === "skill" && (
        <label className="text-xs" style={{ color: "var(--chrome-fg-muted)" }}>
          Site
          <input
            aria-label="Site"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full mt-0.5 px-2 py-1 text-sm rounded-md"
            style={{ background: "var(--surface-2)", color: "var(--chrome-fg)", border: "0.5px solid var(--chrome-border)" }}
          />
        </label>
      )}

      <label className="text-xs" style={{ color: "var(--chrome-fg-muted)" }}>
        {kind === "skill" ? "Content" : "What it does"}
        <textarea
          aria-label="Content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={kind === "skill" ? 5 : 3}
          className="w-full mt-0.5 px-2 py-1 text-sm rounded-md resize-none"
          style={{ background: "var(--surface-2)", color: "var(--chrome-fg)", border: "0.5px solid var(--chrome-border)" }}
        />
      </label>

      {kind === "action" && (
        <label className="text-xs" style={{ color: "var(--chrome-fg-muted)" }}>
          Tabs
          <select
            aria-label="Tabs"
            value={attach}
            onChange={(e) => setAttach(e.target.value as "activeTab" | "allTabs" | "none")}
            className="w-full mt-0.5 px-2 py-1 text-sm rounded-md"
            style={{ background: "var(--surface-2)", color: "var(--chrome-fg)", border: "0.5px solid var(--chrome-border)" }}
          >
            <option value="activeTab">Active tab</option>
            <option value="allTabs">All tabs</option>
            <option value="none">No tabs</option>
          </select>
        </label>
      )}

      {error && (
        <div role="alert" className="text-xs" style={{ color: "var(--insecure)" }}>
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-1">
        <button
          type="button"
          onClick={dequeue}
          className="px-3 py-1.5 text-xs rounded-md"
          style={{ background: "transparent", color: "var(--chrome-fg-muted)", border: "0.5px solid var(--chrome-border-strong)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="px-3 py-1.5 text-xs rounded-md font-medium"
          style={{ background: canSave ? "var(--accent-primary)" : "var(--surface-2)", color: canSave ? "var(--accent-text)" : "var(--chrome-fg-subtle)" }}
        >
          Save
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/SaveProposalCard.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `npx eslint src/components/overlays/SaveProposalCard.tsx tests/unit/SaveProposalCard.test.tsx`
Expected: clean. (Inline arrow `onClick`/`onChange` handlers match the file-local pattern used by `AiActionPrompt`/form inputs; if the project's lint flags them, wrap the button handlers in `useCallback` — but `AiActionPrompt` and `SettingsPanel` use inline handlers and pass lint, so this should be clean.)

- [ ] **Step 6: Commit**

```bash
git add src/components/overlays/SaveProposalCard.tsx tests/unit/SaveProposalCard.test.tsx
git commit -m "feat(overlays): SaveProposalCard — editable agent-drafted save confirm"
```

---

## Task 5: Mount `SaveProposalCard` in App

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import and mount**

In `src/App.tsx`, add the import next to the existing `AiActionPrompt`
import:

```ts
import { SaveProposalCard } from "./components/overlays/SaveProposalCard";
```

And render it right after `<AiActionPrompt />`:

```tsx
      <AiActionPrompt />
      <SaveProposalCard />
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): mount SaveProposalCard overlay"
```

---

## Task 6: "Save…" header button + `SAVE_LABEL` preset

**Files:**
- Modify: `src/components/overlays/AIPanel.tsx`
- Test: `tests/unit/AIPanel.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append to the `describe("AIPanel", ...)` block in `tests/unit/AIPanel.test.tsx`:

```ts
  it("'Save…' header button dispatches a propose-save prompt to the agent", async () => {
    render(<AIPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Save what we learned" }));
    await waitFor(() => {
      const start = api().invokes.find((i) => i.channel === "ai:start");
      expect((start!.payload as { prompt: string }).prompt).toContain("browser_propose_save");
    });
  });
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npx vitest run tests/unit/AIPanel.test.tsx -t "Save"`
Expected: FAIL — button not found.

- [ ] **Step 3: Add the `SAVE_LABEL` preset**

In `src/components/overlays/AIPanel.tsx`, add a module constant beside
`LEARN_LABEL`:

```ts
const SAVE_LABEL = "Save what we learned";
```

In `resolvePreset`, add a branch before the final `return null;`:

```ts
  if (label === SAVE_LABEL) {
    return {
      prompt:
        "From what we just learned or did on this page, propose ONE useful thing to save by calling " +
        "browser_propose_save. Use kind='skill' (markdown notes + host) for reusable site knowledge, " +
        "or kind='action' (a name + a short prompt + attach) for a repeatable request. Give it a clear, short name.",
      attach: "activeTab",
    };
  }
```

- [ ] **Step 4: Add the header button**

In the panel header, directly after the "Learn this page actions" button
(added in the prior feature), add a sibling memoized handler and button.
Add near the other `useCallback`s (after `runPreset`):

```ts
  const saveWhatWeLearned = useCallback(() => runPreset(SAVE_LABEL), [runPreset]);
```

Button (sibling of the Learn button):

```tsx
        <button
          onClick={saveWhatWeLearned}
          disabled={running}
          aria-label="Save what we learned"
          title="Save a site skill or reusable action from this page"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M5 3h11l3 3v15a0 0 0 0 1 0 0H5z" fill="none" />
            <path d="M8 3v6h7V3" />
            <rect x="8" y="13" width="8" height="5" fill="none" />
          </svg>
        </button>
```

- [ ] **Step 5: Run to verify PASS**

Run: `npx vitest run tests/unit/AIPanel.test.tsx`
Expected: all PASS (prior tests + new).

- [ ] **Step 6: Lint & commit**

Run: `npx eslint src/components/overlays/AIPanel.tsx tests/unit/AIPanel.test.tsx`
Expected: clean.

```bash
git add src/components/overlays/AIPanel.tsx tests/unit/AIPanel.test.tsx
git commit -m "feat(ai-panel): Save what we learned button + propose-save preset"
```

---

## Task 7: Coverage wiring + B1 verification

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Add the new component to coverage include**

In `vite.config.ts`, in `test.coverage.include`, add (next to the other
overlay entries):

```ts
        "src/components/overlays/SaveProposalCard.tsx",
```

- [ ] **Step 2: Full verification**

Run: `npx vitest run`
Expected: all pass (prior count + the new SaveProposalCard + AIPanel tests).

Run: `npx eslint src/components/overlays/SaveProposalCard.tsx src/components/overlays/AIPanel.tsx src/App.tsx .electron/services/HorizonBridgeServer.ts`
Expected: clean.

Run: `npm run build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "test: include SaveProposalCard in coverage scope"
```

---

# Phase B2 — Saved-items management

## Task 8: `domainSkill:list` + `domainSkill:remove` IPC

**Files:**
- Modify: `.electron/main.ts`

- [ ] **Step 1: Register handlers** (after the `DOMAIN_SKILL_SAVE` handler from Task 2):

```ts
  ipcMain.handle(
    IPC_CHANNELS.DOMAIN_SKILL_LIST,
    async (_event, { host }: { host?: string }) => {
      if (host) return { host, names: await domainSkills.list(host) };
      const hosts = await domainSkills.listHosts();
      const byHost = await Promise.all(
        hosts.map(async (h) => ({ host: h, names: await domainSkills.list(h) })),
      );
      return byHost;
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.DOMAIN_SKILL_REMOVE,
    (_event, { host, name }: { host: string; name: string }) =>
      domainSkills.remove(host, name),
  );
```

- [ ] **Step 2: Build & commit**

Run: `npm run build` → clean.

```bash
git add .electron/main.ts
git commit -m "feat(main): domainSkill:list + domainSkill:remove IPC handlers"
```

---

## Task 9: Show site skills in the Workflows/"Saved" popover

**Files:**
- Modify: `src/components/overlays/WorkflowsPopover.tsx`
- Test: `tests/unit/WorkflowsPopover.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/WorkflowsPopover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { WorkflowsPopover } from "@/components/overlays/WorkflowsPopover";

describe("WorkflowsPopover — site skills section", () => {
  const { api } = setupRendererTest();

  it("lists site skills returned by domainSkill:list and removes one", async () => {
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "workflow:list") return Promise.resolve([]);
      if (channel === "domainSkill:list")
        return Promise.resolve([{ host: "example.com", names: ["search.md"] }]);
      return Promise.resolve(undefined);
    });
    render(<WorkflowsPopover onRun={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("search.md")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Delete site skill search.md" }));
    await waitFor(() =>
      expect(api().invokes).toContainEqual({
        channel: "domainSkill:remove",
        payload: { host: "example.com", name: "search.md" },
      }),
    );
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npx vitest run tests/unit/WorkflowsPopover.test.tsx`
Expected: FAIL — no site-skills rendering.

- [ ] **Step 3: Implement**

In `WorkflowsPopover.tsx`, add state + fetch for site skills and render a
section. Add near the existing `list` state:

```ts
  const [skills, setSkills] = useState<Array<{ host: string; names: string[] }>>([]);
```

Extend the existing `refresh` (or add a sibling effect) to also load skills:

```ts
  const refreshSkills = useCallback(async () => {
    const s = (await window.horizonAPI.invoke("domainSkill:list", {})) as
      | Array<{ host: string; names: string[] }>
      | undefined;
    setSkills(Array.isArray(s) ? s : []);
  }, []);
  useEffect(() => { void refreshSkills(); }, [refreshSkills]);

  const removeSkill = useCallback(
    async (host: string, name: string) => {
      await window.horizonAPI.invoke("domainSkill:remove", { host, name });
      void refreshSkills();
    },
    [refreshSkills],
  );
```

Render a "Site skills" section below the workflows list:

```tsx
      {skills.some((g) => g.names.length > 0) && (
        <div className="mt-2">
          <div className="text-xs font-semibold px-2 py-1" style={{ color: "var(--chrome-fg-muted)" }}>
            Site skills
          </div>
          {skills.flatMap((g) =>
            g.names.map((n) => (
              <div key={`${g.host}/${n}`} className="flex items-center justify-between px-2 py-1 text-sm">
                <span style={{ color: "var(--chrome-fg)" }}>{n}</span>
                <span className="text-xs" style={{ color: "var(--chrome-fg-subtle)" }}>{g.host}</span>
                <button
                  type="button"
                  aria-label={`Delete site skill ${n}`}
                  onClick={() => removeSkill(g.host, n)}
                  className="px-2 text-xs"
                  style={{ color: "var(--chrome-fg-muted)" }}
                >
                  ✕
                </button>
              </div>
            )),
          )}
        </div>
      )}
```

- [ ] **Step 4: Run to verify PASS**

Run: `npx vitest run tests/unit/WorkflowsPopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint & commit**

Run: `npx eslint src/components/overlays/WorkflowsPopover.tsx tests/unit/WorkflowsPopover.test.tsx`
Expected: clean.

```bash
git add src/components/overlays/WorkflowsPopover.tsx tests/unit/WorkflowsPopover.test.tsx vite.config.ts
git commit -m "feat(workflows): list + delete saved site skills"
```

(Add `src/components/overlays/WorkflowsPopover.tsx` to `vite.config.ts`
coverage include in this commit if not already present.)

---

# Phase B3 — Save any tool-call

## Task 10: Save icon on tool-call chips

**Files:**
- Modify: `src/components/overlays/AIPanel.tsx`
- Test: `tests/unit/AIPanel.test.tsx` (append)

The `ai:event` tool_use shape is `{ type: "tool_use", id, name, input }`
and `turn_end` (`{ type: "turn_end" }`) sets `running` false (verified:
AIPanel.tsx ~214/270). A tool chip appears *during* a running turn, but
`runPreset` no-ops while running — so the save icon is `disabled={running}`
and usable only after the turn ends.

- [ ] **Step 1: Write the failing test**

Append to the `describe("AIPanel", ...)` block in `tests/unit/AIPanel.test.tsx`:

```ts
  it("tool-call chip 'Save this action' dispatches a propose-save prompt (after the turn ends)", async () => {
    render(<AIPanel />);
    // Start a turn so there's an AI message to attach a tool chip to.
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), { target: { value: "go" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Ask anything/), { key: "Enter" });
    // Agent runs a tool, then the turn ends (running → false).
    act(() => {
      api().emit("ai:event", { type: "tool_use", id: "t1", name: "browser_click", input: { selector: "#go" } });
      api().emit("ai:event", { type: "turn_end" });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save this action" }));
    await waitFor(() => {
      const starts = api().invokes.filter((i) => i.channel === "ai:start");
      // Two starts total: the original turn + the propose-save turn.
      expect((starts.at(-1)!.payload as { prompt: string }).prompt).toContain("browser_propose_save");
    });
  });
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npx vitest run tests/unit/AIPanel.test.tsx -t "tool-call chip"`
Expected: FAIL — no "Save this action" button on chips.

- [ ] **Step 3: Implement**

`ToolChip` is rendered inside the memoized `MessageBubble` sub-component, so
`saveWhatWeLearned`/`running` are NOT in scope there — they must be threaded
as props (exactly like `onPreset` already is) and added to the memo
comparator.

**3a. `ToolChip` (signature at `const ToolChip: React.FC<{ tool: ToolCall }>`):**

```tsx
const ToolChip: React.FC<{ tool: ToolCall; onSave?: () => void; saveDisabled?: boolean }> = ({
  tool,
  onSave,
  saveDisabled,
}) => {
```

Render the button right after `<span>{tool.name}</span>`:

```tsx
        {onSave && (
          <button
            type="button"
            aria-label="Save this action"
            onClick={onSave}
            disabled={saveDisabled}
            className="ml-auto text-xs"
            style={{ background: "transparent", border: 0, color: "var(--chrome-fg-subtle)", cursor: saveDisabled ? "default" : "pointer" }}
            title="Save as a reusable action or site skill"
          >
            ⤓
          </button>
        )}
```

**3b. `MessageBubbleInner` props (the `React.FC<{ m; isLastAndStreaming; onPreset? }>` at ~line 708):** add two props:

```tsx
  onSave?: () => void;
  saveDisabled?: boolean;
```

and pass them to `ToolChip` where it's rendered inside `MessageBubbleInner`:

```tsx
            <ToolChip key={t.id} tool={t} onSave={onSave} saveDisabled={saveDisabled} />
```

**3c. The `MessageBubble = React.memo(MessageBubbleInner, (prev, next) => …)` comparator (~line 826):** add the new props so a chip re-renders when `running` flips (otherwise the save button stays disabled after the turn ends):

```tsx
    prev.m === next.m &&
    prev.isLastAndStreaming === next.isLastAndStreaming &&
    prev.onPreset === next.onPreset &&
    prev.onSave === next.onSave &&
    prev.saveDisabled === next.saveDisabled,
```

**3d. The `<MessageBubble>` usage in AIPanel's `messages.map` (~line 552):** pass the new props (`saveWhatWeLearned` is the Task 6 `useCallback`; `running` is component state — both in scope here):

```tsx
          <MessageBubble
            key={i}
            m={m}
            isLastAndStreaming={running && i === messages.length - 1}
            onPreset={runPreset}
            onSave={saveWhatWeLearned}
            saveDisabled={running}
          />
```

Reuses Task 6's `SAVE_LABEL` preset — the agent has the tool call in
conversation context, so no tool-scoped prompt is needed.

- [ ] **Step 4: Run to verify PASS**

Run: `npx vitest run tests/unit/AIPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint & commit**

Run: `npx eslint src/components/overlays/AIPanel.tsx tests/unit/AIPanel.test.tsx`
Expected: clean.

```bash
git add src/components/overlays/AIPanel.tsx tests/unit/AIPanel.test.tsx
git commit -m "feat(ai-panel): save action from a tool-call chip"
```

---

## Final verification (pre-merge)

- [ ] All new/affected tests: `npx vitest run tests/unit/SaveProposalCard.test.tsx tests/unit/AIPanel.test.tsx tests/unit/WorkflowsPopover.test.tsx`
- [ ] No regressions: `npx vitest run`
- [ ] Lint clean on every touched file
- [ ] `npm run build` succeeds
- [ ] Coverage ≥90% on new files (`SaveProposalCard.tsx`); global gate is pre-existing repo debt (tracked separately)
- [ ] Manual GUI smoke: header "Save…" → agent drafts → confirm card → Save → item appears in the Workflows/Saved popover (action) or is read on next visit (skill); cancel discards; two proposals queue.

---

## Notes for the implementer

- **The save never goes through the agent.** `browser_propose_save` only *surfaces* a draft (returns immediately); the confirm card persists via plain renderer→main IPC. This matches the spec and avoids a blocking tool.
- **Mirror `AiActionPrompt` exactly** for the queue + overlay positioning — same `window.horizonAPI.on(...)` listener shape, same FIFO `slice(1)` dequeue, same absolute-positioned dialog. It's the proven pattern for agent-initiated UI.
- **Reuse `workflow:create`** verbatim for actions: payload `{ name, prompt, attach }`. Only skills need the new `domainSkill:save`.
- **Running-guard interaction (Task 6/10):** `runPreset` early-returns while a turn runs and the header buttons are `disabled={running}`. Keep the tool-chip save consistent with that.
- **`Type` import** in `horizon-bridge.ts` is already in scope (used by every tool registration).
