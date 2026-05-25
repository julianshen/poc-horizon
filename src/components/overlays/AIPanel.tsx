import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBrowserStore } from '../../stores/browserStore';
import type { AgentEvent } from '../../types/ai';
import { ChatMarkdown } from './ChatMarkdown';

interface ToolCall { id: string; name: string; input: Record<string, unknown>; output?: unknown; isError?: boolean }
interface Message {
  who: 'you' | 'ai';
  text: string;
  followup?: string[];
  loading?: boolean;
  tools?: ToolCall[];
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
  const [running, setRunning] = useState(false);
  // Auto-scroll: when messages mutate (text_delta, tool_use, etc.) we
  // scroll the chat container to the bottom unless the user has
  // manually scrolled up. Tracked via a "stick to bottom" flag.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickyRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // Within 32px of the bottom counts as "still at bottom" — accommodates
    // a small overshoot when the user is reading the latest reply.
    stickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  }, []);

  // Listen for streaming agent events. Each event mutates the last AI
  // message in place: text_delta appends, tool_use/result push into the
  // tools array, turn_end clears the loading flag.
  useEffect(() => {
    const unsub = window.horizonAPI.on('ai:event', (e: unknown) => {
      const ev = e as AgentEvent;
      setMessages((m) => {
        const next = m.slice();
        const last = next[next.length - 1];
        if (!last || last.who !== 'ai') return m;
        switch (ev.type) {
          case 'text_delta':
            next[next.length - 1] = { ...last, text: (last.text === 'Thinking…' ? '' : last.text) + ev.text, loading: false };
            return next;
          case 'tool_use': {
            const tools = (last.tools ?? []).concat({ id: ev.id, name: ev.name, input: ev.input });
            next[next.length - 1] = { ...last, tools };
            return next;
          }
          case 'tool_result': {
            const tools = (last.tools ?? []).map((t) => t.id === ev.id ? { ...t, output: ev.output, isError: ev.isError } : t);
            next[next.length - 1] = { ...last, tools };
            return next;
          }
          case 'turn_end':
            next[next.length - 1] = { ...last, loading: false };
            setRunning(false);
            return next;
          case 'error':
            next[next.length - 1] = { ...last, text: (last.text || '') + `\n\n⚠️ ${ev.message}`, loading: false };
            setRunning(false);
            return next;
          default:
            return m;
        }
      });
    });
    return unsub;
  }, []);

  const send = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || running) return;
    setMessages((m) => [...m, { who: 'you', text: trimmed }, { who: 'ai', text: 'Thinking…', loading: true, tools: [] }]);
    setDraft('');
    setRunning(true);
    void window.horizonAPI.invoke('ai:start', { prompt: trimmed });
  }, [draft, running]);

  const cancel = useCallback(() => {
    void window.horizonAPI.invoke('ai:cancel', {});
    setRunning(false);
  }, []);

  const newChat = useCallback(() => {
    void window.horizonAPI.invoke('ai:newChat', {});
    setMessages(INITIAL);
    setDraft('');
    setRunning(false);
  }, []);

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
        <button
          onClick={newChat}
          aria-label="New chat"
          title="Start a new conversation"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            {/* Pencil-on-paper "compose" glyph — same as the Mail "New Message" affordance. */}
            <path d="M4 20h4l10-10-4-4L4 16v4z" />
            <line x1="14" y1="6" x2="18" y2="10" />
          </svg>
        </button>
        <button onClick={toggleAI} aria-label="Close AI panel" className="icon-btn" style={{ width: 26, height: 26 }}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto flex flex-col gap-4"
        style={{ padding: '8px 18px 12px' }}
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} m={m} isLastAndStreaming={running && i === messages.length - 1} />
        ))}
      </div>

      {running && (
        <button
          onClick={cancel}
          className="self-end text-xs mr-4 mb-1 px-2 py-0.5 rounded-md"
          style={{ color: 'var(--chrome-fg-muted)', background: 'var(--surface-hover)' }}
        >
          Stop
        </button>
      )}

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

const MessageBubble: React.FC<{ m: Message; isLastAndStreaming?: boolean }> = ({ m, isLastAndStreaming }) => {
  const isYou = m.who === 'you';
  const hasText = m.text && m.text.length > 0;
  return (
    <div className={`flex flex-col gap-1.5 ${isYou ? 'items-end' : 'items-start'}`}>
      {(hasText || (m.loading && !hasText)) && (
        <div
          className="text-sm leading-relaxed"
          style={{
            background: isYou ? 'var(--accent-soft)' : 'var(--surface-1)',
            color: 'var(--chrome-fg)',
            padding: isYou ? '11px 14px' : '12px 14px',
            maxWidth: isYou ? '88%' : '92%',
            borderRadius: isYou ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            boxShadow: isYou ? 'none' : '0 1px 2px rgba(20,15,10,0.04), 0 0 0 0.5px var(--chrome-border)',
            wordBreak: 'break-word',
          }}
        >
          {m.loading && !hasText ? (
            <ThinkingDots />
          ) : isYou ? (
            // User messages: plain text, preserve their line breaks but
            // don't render their markdown (an over-eager * mid-sentence
            // shouldn't bold the rest of a paragraph).
            <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
          ) : (
            <>
              <ChatMarkdown text={m.text} />
              {isLastAndStreaming && <StreamCursor />}
            </>
          )}
        </div>
      )}
      {m.tools && m.tools.length > 0 && (
        <div className="flex flex-col gap-1 w-[92%] max-w-[92%]">
          {m.tools.map((t) => <ToolChip key={t.id} tool={t} />)}
        </div>
      )}
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

const StreamCursor: React.FC = () => (
  <span
    aria-hidden
    style={{
      display: 'inline-block',
      width: 6,
      height: '0.95em',
      verticalAlign: 'text-bottom',
      marginLeft: 2,
      background: 'var(--accent-primary)',
      borderRadius: 1,
      animation: 'hz-pulse 1s ease-in-out infinite',
    }}
  />
);

const ToolChip: React.FC<{ tool: ToolCall }> = ({ tool }) => {
  const [open, setOpen] = useState(false);
  const isImage = isImageResult(tool.output);
  const isPending = tool.output === undefined;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-left text-[11px] px-2 py-1 rounded-md font-mono flex items-center gap-1.5 self-start"
        style={{
          background: tool.isError ? 'rgba(212,77,77,0.10)' : 'var(--surface-2)',
          color: tool.isError ? 'var(--insecure)' : 'var(--chrome-fg-muted)',
        }}
      >
        <span style={{ opacity: 0.5, fontSize: 9 }}>{open ? '▾' : '▸'}</span>
        <span>{tool.name}</span>
        {isPending ? (
          <span className="inline-flex gap-0.5">
            <span className="hz-dot" style={{ animation: 'hz-bounce 1.2s ease-in-out 0s infinite' }} />
            <span className="hz-dot" style={{ animation: 'hz-bounce 1.2s ease-in-out 0.15s infinite' }} />
            <span className="hz-dot" style={{ animation: 'hz-bounce 1.2s ease-in-out 0.30s infinite' }} />
          </span>
        ) : null}
      </button>
      {open && (
        <div
          className="mt-1 text-[11px] rounded-md font-mono"
          style={{ background: 'var(--surface-2)', padding: '8px 10px', maxWidth: '100%', overflow: 'auto' }}
        >
          <div style={{ color: 'var(--chrome-fg-subtle)', marginBottom: 4 }}>input</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(tool.input, null, 2)}
          </pre>
          {!isPending && (
            <>
              <div style={{ color: 'var(--chrome-fg-subtle)', margin: '8px 0 4px' }}>output</div>
              {isImage ? (
                <img
                  alt="screenshot"
                  src={imageDataUri(tool.output)}
                  style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }}
                />
              ) : (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {typeof tool.output === 'string' ? tool.output : JSON.stringify(tool.output, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

/** True when the tool result looks like a base64 PNG (browser_screenshot). */
function isImageResult(out: unknown): boolean {
  if (!out || typeof out !== 'object') return false;
  const o = out as { format?: string; base64?: string };
  return o.format === 'png' && typeof o.base64 === 'string';
}
function imageDataUri(out: unknown): string {
  const o = out as { base64: string };
  return `data:image/png;base64,${o.base64}`;
}

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
