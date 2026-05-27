import React, { useCallback, useEffect, useRef, useState } from "react";
import { useBrowserStore } from "../../stores/browserStore";
import { useCommandItems } from "../../hooks/useCommandItems";
import { CommandPaletteIcon } from "./CommandPaletteIcon";

export const CommandPalette: React.FC = () => {
  const { showCmd, toggleOverlay } = useBrowserStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const close = useCallback(() => toggleOverlay("showCmd"), [toggleOverlay]);
  const items = useCommandItems(q, close);

  useEffect(() => {
    if (!showCmd) return;
    setQ("");
    setSel(0);
    inputRef.current?.focus();
  }, [showCmd]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(items.length - 1, s + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(0, s - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items.length === 0) return;
        const idx = Math.min(sel, items.length - 1);
        items[idx].action();
      }
    },
    [close, items, sel],
  );

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQ(e.target.value);
    setSel(0);
  }, []);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  if (!showCmd) return null;

  return (
    <div
      className="absolute inset-0 z-[60] flex items-start justify-center pt-[10%] fade-in"
      style={{ background: "rgba(0,0,0,0.42)", backdropFilter: "blur(3px)" }}
      onClick={close}
    >
      <div
        onClick={stop}
        className="w-full max-w-[680px] mx-6 flex flex-col overflow-hidden relative"
        style={{
          background: "var(--surface-1)",
          borderRadius: 20,
          boxShadow: "var(--shadow-lg)",
          border: "0.5px solid var(--chrome-border-strong)",
        }}
        role="dialog"
        aria-label="Command palette"
      >
        <div
          className="absolute inset-x-0 top-0 h-16 pointer-events-none"
          style={{
            background: "linear-gradient(180deg, var(--ai-tint), transparent)",
          }}
          aria-hidden
        />
        <div
          className="flex items-center gap-3 px-5 py-4 relative"
          style={{ borderBottom: "0.5px solid var(--chrome-border)" }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ color: "var(--accent-primary)" }}
            aria-hidden
          >
            <path d="M12 3l1.8 4.4L18.2 9.2 13.8 11 12 15.4 10.2 11 5.8 9.2 10.2 7.4z" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={onChange}
            onKeyDown={onKey}
            placeholder="Ask Horizon, or type a command…"
            className="flex-1 bg-transparent outline-none text-base font-medium italic"
            style={{ color: "var(--chrome-fg)", letterSpacing: "-0.015em" }}
            spellCheck={false}
          />
          <span
            className="text-[10px] px-1.5 py-1 rounded font-mono"
            style={{
              background: "var(--surface-hover)",
              color: "var(--chrome-fg-muted)",
            }}
          >
            esc
          </span>
        </div>
        <div className="max-h-[380px] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div
              className="py-5 text-center text-sm"
              style={{ color: "var(--chrome-fg-subtle)" }}
            >
              No matches.
            </div>
          ) : (
            items.map((it, i) => (
              <button
                key={i}
                type="button"
                onClick={it.action}
                onMouseEnter={() => setSel(i)}
                className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm"
                style={{
                  background:
                    i === sel
                      ? "linear-gradient(135deg, var(--accent-soft), var(--ai-tint))"
                      : "transparent",
                  color: "var(--chrome-fg)",
                  transition: "background var(--transition-fast)",
                }}
              >
                <span
                  style={{
                    color:
                      it.kind === "ai"
                        ? "var(--accent-primary)"
                        : "var(--chrome-fg-muted)",
                  }}
                  className="flex"
                >
                  <CommandPaletteIcon kind={it.kind} />
                </span>
                <span className="flex-1 truncate">{it.label}</span>
                <span
                  className="text-[11px]"
                  style={{
                    color:
                      i === sel
                        ? "var(--accent-primary)"
                        : "var(--chrome-fg-subtle)",
                  }}
                >
                  {it.hint}
                </span>
              </button>
            ))
          )}
        </div>
        <div
          className="flex gap-3 px-4 py-2 text-[11px]"
          style={{
            borderTop: "0.5px solid var(--chrome-border)",
            color: "var(--chrome-fg-subtle)",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
};
