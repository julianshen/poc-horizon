import React, { useCallback, useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const SidePanel: React.FC<Props> = ({
  open,
  title,
  onClose,
  children,
}) => {
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onKey]);

  if (!open) return null;

  return (
    <>
      <div
        className="absolute inset-0 z-30"
        style={{ background: "rgba(0,0,0,0.18)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="absolute right-0 top-0 bottom-0 z-40 w-[380px] flex flex-col fade-in"
        style={{
          background: "var(--surface-1)",
          borderLeft: "1px solid var(--chrome-border)",
          boxShadow: "var(--shadow-lg)",
        }}
        role="dialog"
        aria-label={title}
      >
        <header
          className="h-12 flex items-center px-4 shrink-0"
          style={{ borderBottom: "1px solid var(--chrome-border)" }}
        >
          <h2
            className="text-sm font-semibold tracking-tight"
            style={{ color: "var(--chrome-fg)" }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="icon-btn ml-auto"
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
};
