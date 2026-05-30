import React, { useCallback, useEffect, useState } from "react";

interface Proposal {
  id: string; // main-side correlation id; unused in the renderer (no round-trip)
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

  const save = useCallback(async () => {
    if (!current || !name.trim()) return;
    if (kind === "skill" && !host.trim()) return;
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
      aria-modal="true"
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
            onClick={() => { setKind("skill"); setError(null); }}
            aria-pressed={kind === "skill"}
            className="px-2 py-1 text-xs rounded-md"
            style={{ background: kind === "skill" ? "var(--accent-primary)" : "transparent", color: kind === "skill" ? "var(--accent-text)" : "var(--chrome-fg-muted)" }}
          >
            Site skill
          </button>
          <button
            type="button"
            onClick={() => { setKind("action"); setError(null); }}
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
          autoFocus
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
