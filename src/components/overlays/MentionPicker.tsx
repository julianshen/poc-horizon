import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBrowserStore } from "../../stores/browserStore";

interface Props {
  /** Tab IDs already mentioned — these are de-emphasised in the list. */
  alreadyPicked: Set<string>;
  /** Called when the user picks a tab. */
  onPick: (tabId: string, title: string) => void;
  /** Close the picker (Esc / click-outside / pick). */
  onClose: () => void;
}

/**
 * Floating tab picker for AI panel @-mentions. Renders above the
 * composer, mirrors the AppMenu / OmniboxSuggestions visual style.
 * Arrow keys navigate, Enter selects, Esc closes.
 */
export const MentionPicker: React.FC<Props> = ({
  alreadyPicked,
  onPick,
  onClose,
}) => {
  const tabs = useBrowserStore((s) => s.tabs);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return tabs
      .filter(
        (t) =>
          !q ||
          t.title.toLowerCase().includes(q) ||
          t.url.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [tabs, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  const pick = useCallback(
    (tabId: string, title: string) => {
      onPick(tabId, title);
      onClose();
    },
    [onPick, onClose],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const pick0 = filtered[highlight];
        if (pick0) pick(pick0.id, pick0.title || pick0.url);
      }
    },
    [filtered, highlight, pick, onClose],
  );

  return (
    <div
      data-testid="mention-picker"
      className="absolute z-50 fade-in flex flex-col overflow-hidden"
      style={{
        bottom: "calc(100% + 6px)",
        left: 14,
        right: 14,
        background: "var(--surface-overlay)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        border: "0.5px solid var(--chrome-border-strong)",
        borderRadius: 12,
        boxShadow: "var(--shadow-lg)",
      }}
      role="listbox"
      aria-label="Mention a tab"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        placeholder="Mention a tab…"
        className="text-sm outline-none bg-transparent"
        style={{
          padding: "10px 14px",
          borderBottom: "0.5px solid var(--chrome-border)",
          color: "var(--chrome-fg)",
        }}
      />
      <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
        {filtered.length === 0 && (
          <div
            className="text-xs px-4 py-3"
            style={{ color: "var(--chrome-fg-subtle)" }}
          >
            No matching tabs
          </div>
        )}
        {filtered.map((t, i) => {
          const already = alreadyPicked.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id, t.title || t.url)}
              disabled={already}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs"
              style={{
                background:
                  i === highlight ? "var(--tab-bg-hover)" : "transparent",
                opacity: already ? 0.4 : 1,
                cursor: already ? "default" : "pointer",
                color: "var(--chrome-fg)",
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {t.favicon ? (
                <img
                  src={t.favicon}
                  alt=""
                  className="w-3.5 h-3.5 shrink-0 rounded-[4px]"
                />
              ) : (
                <span
                  className="w-3.5 h-3.5 rounded-[4px] shrink-0 flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ background: "var(--accent-primary)" }}
                >
                  {(t.title || "?").charAt(0).toUpperCase()}
                </span>
              )}
              <span className="flex-1 truncate">{t.title || t.url}</span>
              {already && (
                <span
                  className="text-[10px]"
                  style={{ color: "var(--chrome-fg-subtle)" }}
                >
                  added
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
