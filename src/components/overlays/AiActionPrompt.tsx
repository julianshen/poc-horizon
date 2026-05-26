import React, { useCallback, useEffect, useState } from 'react';

interface Prompt {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

/**
 * Renders pending agent-action approval prompts. The AiActionGuard in main
 * broadcasts `ai:actionPrompt`; the user clicks Allow/Block; we send
 * `ai:actionDecide` back. Multiple prompts queue FIFO — never overwrite an
 * in-flight callback, or the guard's pending Map leaks an unresolved Promise.
 *
 * Visual contrast vs PermissionPrompt is deliberate: that one is about a
 * *website* asking; this one is about the *agent* asking. Different actor,
 * different shape (small inline pill above the chrome rather than a centered
 * card) so the user reads them differently.
 */
export const AiActionPrompt: React.FC = () => {
  const [queue, setQueue] = useState<Prompt[]>([]);

  useEffect(() => {
    return window.horizonAPI.on('ai:actionPrompt', (p: Prompt) =>
      setQueue((q) => [...q, p])
    );
  }, []);

  const current = queue[0];

  const respond = useCallback(
    (allow: boolean) => {
      if (!current) return;
      window.horizonAPI.invoke('ai:actionDecide', { id: current.id, allow });
      setQueue((q) => q.slice(1));
    },
    [current]
  );

  const onAllow = useCallback(() => respond(true), [respond]);
  const onBlock = useCallback(() => respond(false), [respond]);

  if (!current) return null;

  const remaining = queue.length - 1;

  return (
    <div
      role="dialog"
      aria-label="Agent action approval"
      className="absolute top-[90px] left-1/2 z-50 fade-in"
      style={{
        transform: 'translateX(-50%)',
        background: 'var(--surface-1)',
        boxShadow: 'var(--shadow-lg)',
        border: '0.5px solid var(--accent-primary)',
        borderRadius: 'var(--radius-lg)',
        padding: 12,
        width: 'min(480px, 90vw)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 24, height: 24, borderRadius: 12,
          background: 'var(--accent-primary)', color: 'var(--accent-text)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 600, flexShrink: 0,
        }}
        aria-hidden
      >
        AI
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="text-xs font-semibold" style={{ color: 'var(--chrome-fg-muted)' }}>
          Agent wants to · {current.tool}
          {remaining > 0 && (
            <span className="ml-2" style={{ color: 'var(--accent-primary)' }}>
              +{remaining} more
            </span>
          )}
        </div>
        <div
          className="text-sm"
          style={{
            color: 'var(--chrome-fg)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={current.summary}
        >
          {current.summary}
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onBlock}
          className="px-3 py-1.5 text-xs rounded-md"
          style={{
            background: 'transparent',
            color: 'var(--chrome-fg-muted)',
            border: '0.5px solid var(--chrome-border-strong)',
          }}
        >
          Block
        </button>
        <button
          type="button"
          onClick={onAllow}
          className="px-3 py-1.5 text-xs rounded-md font-medium"
          style={{
            background: 'var(--accent-primary)',
            color: 'var(--accent-text)',
          }}
          autoFocus
        >
          Allow
        </button>
      </div>
    </div>
  );
};
