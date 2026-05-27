import React, { useCallback, useEffect, useState } from "react";

interface Workflow {
  id: string;
  name: string;
  prompt: string;
  attach: "activeTab" | "allTabs" | "none";
  createdAt: number;
}

interface Props {
  /** Last user message in this turn — used for "Save current as…". */
  lastPrompt?: string;
  /** Mention strategy that produced lastPrompt — used for save. */
  lastAttach?: "activeTab" | "allTabs" | "none";
  /** Called when the user runs a workflow. */
  onRun: (w: Workflow) => void;
  /** Close the popover. */
  onClose: () => void;
}

/**
 * Popover anchored under the workflows button in the AI panel header.
 * Lists saved workflows + a "Save current message" affordance when
 * there's a recent user prompt to save.
 */
export const WorkflowsPopover: React.FC<Props> = ({
  lastPrompt,
  lastAttach = "none",
  onRun,
  onClose,
}) => {
  const [list, setList] = useState<Workflow[]>([]);
  const [savingName, setSavingName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const l = (await window.horizonAPI.invoke(
      "workflow:list",
      {},
    )) as Workflow[];
    setList(Array.isArray(l) ? l : []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Close on Escape / outside click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const remove = useCallback(
    async (id: string) => {
      await window.horizonAPI.invoke("workflow:delete", { id });
      await refresh();
    },
    [refresh],
  );

  const save = useCallback(async () => {
    if (!savingName?.trim() || !lastPrompt) return;
    await window.horizonAPI.invoke("workflow:create", {
      name: savingName.trim(),
      prompt: lastPrompt,
      attach: lastAttach,
    });
    setSavingName(null);
    await refresh();
  }, [savingName, lastPrompt, lastAttach, refresh]);

  return (
    <div
      data-testid="workflows-popover"
      className="absolute z-50 fade-in flex flex-col overflow-hidden"
      style={{
        top: "calc(100% + 4px)",
        right: 12,
        width: 260,
        background: "var(--surface-overlay)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        border: "0.5px solid var(--chrome-border-strong)",
        borderRadius: 12,
        boxShadow: "var(--shadow-lg)",
      }}
      role="menu"
      aria-label="Saved workflows"
    >
      <div
        className="px-3 py-2 text-[11px] uppercase tracking-wider"
        style={{ color: "var(--chrome-fg-subtle)", letterSpacing: "0.06em" }}
      >
        Workflows
      </div>
      <div className="max-h-64 overflow-y-auto">
        {list.length === 0 && (
          <div
            className="text-xs px-3 py-2"
            style={{ color: "var(--chrome-fg-subtle)" }}
          >
            No saved workflows yet.
          </div>
        )}
        {list.map((w) => (
          <div
            key={w.id}
            className="flex items-center gap-1 px-2 py-1 text-xs group"
            style={{ color: "var(--chrome-fg)" }}
          >
            <button
              type="button"
              onClick={() => {
                onRun(w);
                onClose();
              }}
              className="flex-1 text-left truncate px-1 py-0.5 rounded"
              style={{
                background: "transparent",
                border: 0,
                font: "inherit",
                cursor: "pointer",
                color: "inherit",
              }}
              title={w.prompt}
            >
              {w.name}
              <span
                className="ml-1 text-[10px]"
                style={{ color: "var(--chrome-fg-subtle)" }}
              >
                · {w.attach}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                void remove(w.id);
              }}
              aria-label={`Delete ${w.name}`}
              className="opacity-0 group-hover:opacity-100"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--chrome-fg-muted)",
                cursor: "pointer",
                padding: "2px 4px",
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {lastPrompt && (
        <div
          className="px-3 py-2"
          style={{ borderTop: "0.5px solid var(--chrome-border)" }}
        >
          {savingName === null ? (
            <button
              type="button"
              onClick={() => setSavingName("")}
              className="text-xs"
              style={{
                color: "var(--accent-primary)",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                padding: 0,
                font: "inherit",
              }}
            >
              + Save last prompt as workflow…
            </button>
          ) : (
            <div className="flex gap-1">
              <input
                autoFocus
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  else if (e.key === "Escape") setSavingName(null);
                }}
                placeholder="Workflow name"
                className="flex-1 text-xs outline-none"
                style={{
                  background: "var(--surface-1)",
                  color: "var(--chrome-fg)",
                  border: "0.5px solid var(--chrome-border)",
                  borderRadius: 6,
                  padding: "4px 8px",
                }}
              />
              <button
                type="button"
                onClick={() => void save()}
                disabled={!savingName.trim()}
                className="text-xs"
                style={{
                  background: "var(--accent-primary)",
                  color: "white",
                  border: 0,
                  borderRadius: 6,
                  padding: "4px 8px",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
