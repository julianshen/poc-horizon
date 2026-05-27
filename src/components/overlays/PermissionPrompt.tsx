import React, { useCallback, useEffect, useState } from "react";

interface Prompt {
  id: string;
  permission: string;
  origin: string;
}

const LABELS: Record<string, string> = {
  geolocation: "know your location",
  notifications: "send notifications",
  media: "use your camera and microphone",
  midi: "access your MIDI devices",
  midiSysex: "send MIDI system exclusive messages",
  pointerLock: "capture your mouse pointer",
  "display-capture": "capture your screen",
  "clipboard-read": "read your clipboard",
  "idle-detection": "detect when you are idle",
  "window-management": "manage windows on your screens",
  openExternal: "open an external application",
};

export const PermissionPrompt: React.FC = () => {
  // FIFO queue: a second request that arrives while the first is open
  // gets added to the queue rather than overwriting (which would have
  // leaked the in-flight broker callback).
  const [queue, setQueue] = useState<Prompt[]>([]);

  useEffect(() => {
    return window.horizonAPI.on("permission:request", (p: Prompt) =>
      setQueue((q) => [...q, p]),
    );
  }, []);

  const current = queue[0];

  const respond = useCallback(
    (decision: "allow" | "block") => {
      if (!current) return;
      window.horizonAPI.invoke("permission:respond", {
        id: current.id,
        decision,
      });
      setQueue((q) => q.slice(1));
    },
    [current],
  );

  if (!current) return null;

  const label = LABELS[current.permission] ?? `use ${current.permission}`;
  const remaining = queue.length - 1;

  return (
    <div
      role="dialog"
      aria-label="Permission request"
      className="absolute top-[140px] left-1/2 z-50 fade-in"
      style={{
        transform: "translateX(-50%)",
        background: "var(--surface-1)",
        boxShadow: "var(--shadow-lg)",
        border: "0.5px solid var(--chrome-border-strong)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        width: "min(420px, 90vw)",
      }}
    >
      <div
        className="text-sm font-semibold mb-1"
        style={{ color: "var(--chrome-fg)" }}
      >
        {current.origin || "This site"} wants to {label}
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--chrome-fg-muted)" }}>
        Permission · {current.permission}
        {remaining > 0 && (
          <span className="ml-2" style={{ color: "var(--accent-primary)" }}>
            +{remaining} more
          </span>
        )}
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => respond("block")}
          className="px-3 py-1.5 text-xs rounded-md"
          style={{
            background: "transparent",
            color: "var(--chrome-fg-muted)",
            border: "0.5px solid var(--chrome-border-strong)",
          }}
        >
          Block
        </button>
        <button
          type="button"
          onClick={() => respond("allow")}
          className="px-3 py-1.5 text-xs rounded-md font-medium"
          style={{
            background: "var(--accent-primary)",
            color: "var(--accent-text)",
          }}
        >
          Allow
        </button>
      </div>
    </div>
  );
};
