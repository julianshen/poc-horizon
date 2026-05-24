import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBrowserStore } from '../../stores/browserStore';

interface Message {
  who: 'you' | 'ai';
  text: string;
  followup?: string[];
  loading?: boolean;
}

const INITIAL: Message[] = [
  {
    who: 'ai',
    text: 'I can see the page you\'re reading. Want a summary, or shall I look something up?',
    followup: ['Summarize this page', 'Find related in my history', 'Explain selected text'],
  },
];

const AI_WIDTH = 360;

export const AIPanel: React.FC = () => {
  const toggleAI = useBrowserStore((s) => s.toggleAI);
  const [messages, setMessages] = useState<Message[]>(INITIAL);
  const [draft, setDraft] = useState('');
  // Track in-flight stub-reply timers so we cancel them on unmount and
  // don't call setMessages on an unmounted component.
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = pendingTimers.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const send = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setMessages((m) => [
      ...m,
      { who: 'you', text: trimmed },
      { who: 'ai', text: 'Thinking…', loading: true },
    ]);
    setDraft('');
    // Stub: in a real build this would call out to an LLM via main process.
    const timer = setTimeout(() => {
      pendingTimers.current.delete(timer);
      setMessages((m) => {
        const next = m.slice();
        const lastIdx = next.length - 1;
        if (next[lastIdx]?.loading) {
          next[lastIdx] = {
            who: 'ai',
            text: 'Horizon\'s AI surface is wired up but not connected to a model yet.',
            followup: ['Open settings', 'Try a different prompt'],
          };
        }
        return next;
      });
    }, 700);
    pendingTimers.current.add(timer);
  }, [draft]);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  return (
    <aside
      className="shrink-0 flex flex-col rounded-2xl relative overflow-hidden"
      style={{ width: AI_WIDTH, background: 'transparent' }}
      role="complementary"
      aria-label="Horizon AI"
    >
      <header
        className="flex items-center gap-2 relative"
        style={{ padding: '12px 18px 4px' }}
      >
        <span
          className="w-6 h-6 rounded-lg flex items-center justify-center text-white"
          style={{ background: 'var(--accent-gradient)', boxShadow: '0 2px 8px rgba(212,77,122,0.32)' }}
          aria-hidden
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 3l1.8 4.4L18.2 9.2 13.8 11 12 15.4 10.2 11 5.8 9.2 10.2 7.4z" />
          </svg>
        </span>
        <div className="text-sm font-semibold flex-1" style={{ letterSpacing: '-0.01em' }}>
          Horizon
          <span className="ml-1.5 text-[11px] font-medium" style={{ color: 'var(--chrome-fg-subtle)' }}>
            · Sidebar
          </span>
        </div>
        <button onClick={toggleAI} aria-label="Close AI panel" className="icon-btn" style={{ width: 26, height: 26 }}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </header>

      <div
        className="flex-1 overflow-y-auto flex flex-col gap-4"
        style={{ padding: '8px 18px 12px' }}
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} m={m} />
        ))}
      </div>

      <div className="flex gap-2 items-end relative" style={{ padding: '4px 14px 14px' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask anything about this page…"
          rows={1}
          className="flex-1 text-sm outline-none resize-none placeholder:italic"
          style={{
            background: 'var(--surface-1)',
            color: 'var(--chrome-fg)',
            boxShadow: '0 1px 2px rgba(20,15,10,0.04), 0 0 0 0.5px var(--chrome-border)',
            borderRadius: 14,
            padding: '12px 14px',
            minHeight: 40,
            maxHeight: 120,
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={send}
          disabled={!draft.trim()}
          aria-label="Send"
          className="w-10 h-10 flex items-center justify-center text-white shrink-0"
          style={{
            background: draft.trim() ? 'var(--chrome-fg)' : 'var(--surface-hover)',
            color: draft.trim() ? 'var(--surface-1)' : 'var(--chrome-fg-subtle)',
            boxShadow: draft.trim() ? '0 2px 8px rgba(20,15,10,0.18)' : 'none',
            borderRadius: 14,
            transition: 'background var(--transition-fast), box-shadow var(--transition-fast)',
            cursor: draft.trim() ? 'pointer' : 'default',
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </aside>
  );
};

const MessageBubble: React.FC<{ m: Message }> = ({ m }) => {
  const isYou = m.who === 'you';
  return (
    <div className={`flex flex-col gap-1.5 ${isYou ? 'items-end' : 'items-start'}`}>
      <div
        className="text-sm leading-relaxed"
        style={{
          background: isYou ? 'var(--accent-soft)' : 'var(--surface-1)',
          color: 'var(--chrome-fg)',
          padding: isYou ? '11px 14px' : '12px 14px',
          maxWidth: isYou ? '88%' : '92%',
          borderRadius: isYou ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          boxShadow: isYou ? 'none' : '0 1px 2px rgba(20,15,10,0.04), 0 0 0 0.5px var(--chrome-border)',
        }}
      >
        {m.loading ? <ThinkingDots /> : m.text}
      </div>
      {m.followup && !m.loading && (
        <div className="flex flex-wrap gap-1.5 mt-0.5">
          {m.followup.map((f) => (
            <span
              key={f}
              className="text-xs px-2.5 py-1 rounded-full cursor-pointer"
              style={{
                background: 'var(--surface-1)',
                color: 'var(--chrome-fg-muted)',
                boxShadow: '0 0 0 0.5px var(--chrome-border)',
              }}
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const ThinkingDots: React.FC = () => (
  <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--chrome-fg-muted)' }}>
    Thinking
    <span className="inline-flex gap-0.5">
      <span className="hz-dot" style={{ animation: 'hz-bounce 1.2s ease-in-out 0s infinite' }} />
      <span className="hz-dot" style={{ animation: 'hz-bounce 1.2s ease-in-out 0.15s infinite' }} />
      <span className="hz-dot" style={{ animation: 'hz-bounce 1.2s ease-in-out 0.30s infinite' }} />
    </span>
  </span>
);
