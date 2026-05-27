import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBrowserStore } from '../../stores/browserStore';
import type { AgentEvent } from '../../types/ai';
import { ChatMarkdown } from './ChatMarkdown';
import { MentionPicker } from './MentionPicker';
import { WorkflowsPopover } from './WorkflowsPopover';
import { A2UISurface } from './A2UISurface';
import { applyA2UIMessage, type A2UIMessage, type SurfaceState } from '../../types/a2ui';

interface Mention { tabId: string; title: string }

interface ToolCall { id: string; name: string; input: Record<string, unknown>; output?: unknown; isError?: boolean }

interface LlmsLink { title: string; url: string; description?: string }
interface LlmsSection { name: string; links: LlmsLink[] }
interface LlmsTxtGuide {
  origin: string;
  title?: string;
  summary?: string;
  sections: LlmsSection[];
  hasFull: boolean;
  skillFile?: string;
}

interface Message {
  who: 'you' | 'ai' | 'system';
  text: string;
  followup?: string[];
  loading?: boolean;
  tools?: ToolCall[];
  mentions?: Mention[];
  /**
   * A2UI surfaces produced by `render_ui` tool calls in this turn,
   * keyed by surfaceId. The agent can stream multiple surfaceUpdate
   * messages targeting the same surfaceId — applyA2UIMessage merges
   * them into the existing state.
   */
  surfaces?: Map<string, SurfaceState>;
  /** System-message payload — present when who === 'system' for the
   *  llms.txt navigation guide card. */
  guide?: LlmsTxtGuide;
}

const INITIAL: Message[] = [
  {
    who: 'ai',
    text: 'I can see the page you\'re reading. Want a summary, or shall I look something up?',
    followup: ['Summarize this page', 'Compare my open tabs', 'Explain selected text'],
  },
];

/**
 * Known one-click presets. Maps the chip label (and the "Summarize"
 * header button) to a prompt + which tabs to auto-@-mention.
 *  - `activeTab`: include the focused tab as a mention.
 *  - `allTabs`: include every non-pinned tab (for multi-tab compare).
 *  - `none`: just send the literal prompt.
 */
function resolvePreset(label: string): { prompt: string; attach: 'activeTab' | 'allTabs' | 'none' } | null {
  if (label === 'Summarize this page') {
    return { prompt: 'Summarize the page I @-mentioned. Be concise — 4-6 bullet points covering what it is, key points, and any action items.', attach: 'activeTab' };
  }
  if (label === 'Compare my open tabs') {
    return { prompt: 'Compare the pages I @-mentioned. Call out what each is best for and the most important differences. Use a short table if it helps.', attach: 'allTabs' };
  }
  if (label === 'Explain selected text') {
    return { prompt: 'I\'ll send selected text in a moment — first acknowledge that you understand to wait for the selection, then I\'ll right-click on the page.', attach: 'none' };
  }
  return null;
}

const AI_WIDTH = 360;

// Outside the component so it persists across mount/unmount cycles
// (e.g. when the user closes + reopens the AI panel). Tracks origins
// for which we've already inserted the guide message THIS RENDER
// SESSION — paired with main's per-process Set, this prevents a guide
// re-render when the panel is reopened.
const seenGuides = new Set<string>();

export const AIPanel: React.FC = () => {
  const toggleAI = useBrowserStore((s) => s.toggleAI);
  const pendingGuides = useBrowserStore((s) => s.pendingLlmsGuides);
  const consumeGuides = useBrowserStore((s) => s.consumeLlmsGuides);
  const pendingSelection = useBrowserStore((s) => s.pendingSelection);
  const consumeSelection = useBrowserStore((s) => s.consumeSelection);

  // Hide Pi spawn latency: on first mount of the panel (which happens
  // when showAI flips true), kick off ai:preWarm so the subprocess is
  // ready by the time the user finishes typing.
  useEffect(() => {
    void window.horizonAPI.invoke('ai:preWarm', {});
  }, []);
  const [messages, setMessages] = useState<Message[]>(INITIAL);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  // @-mention chips queued for the next send.
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  // Last user prompt + its attach kind — surfaced to WorkflowsPopover
  // so the user can save the most recent message as a reusable workflow.
  const [lastSavable, setLastSavable] = useState<{ prompt: string; attach: 'activeTab' | 'allTabs' | 'none' } | null>(null);
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

  // Drain a pending "ask AI about this selection" request into the
  // draft. We prefill rather than auto-send so the user can refine
  // the question before hitting Enter.
  useEffect(() => {
    if (!pendingSelection) return;
    const { selection, pageUrl, pageTitle } = pendingSelection;
    consumeSelection();
    const quoted = selection.length > 600 ? selection.slice(0, 600) + '…' : selection;
    setDraft(`Regarding this selection from "${pageTitle}" (${pageUrl}):\n\n> ${quoted}\n\n`);
  }, [pendingSelection, consumeSelection]);

  // Drain queued llms.txt guides into the messages list as system cards.
  // Dedup per-origin within this AIPanel mount; main also dedups by
  // origin per process so we're double-protected against repeats.
  useEffect(() => {
    if (pendingGuides.length === 0) return;
    const fresh = pendingGuides.filter((g) => !seenGuides.has(g.origin));
    if (fresh.length === 0) { consumeGuides(); return; }
    for (const g of fresh) seenGuides.add(g.origin);
    consumeGuides();
    setMessages((m) => [
      ...m,
      ...fresh.map((g): Message => ({ who: 'system', text: '', guide: g })),
    ]);
  }, [pendingGuides, consumeGuides]);

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
            // If this is a render_ui result, merge the A2UI message(s)
            // into the message's surfaces map so <A2UISurface> can
            // render it. Also pass the agent's input (the message arg)
            // — LLMs sometimes leave the body in the tool input and
            // return only a stub output.
            const tool = tools.find((t) => t.id === ev.id);
            let surfaces = last.surfaces;
            if (tool?.name === 'render_ui' && !ev.isError) {
              const messages = [
                ...extractA2UIMessages(ev.output),
                ...extractA2UIMessages(tool.input),
              ];
              if (messages.length > 0) {
                surfaces = new Map(surfaces ?? new Map());
                for (const m of messages) {
                  const id = surfaceIdOf(m);
                  if (!id) continue;
                  const merged = applyA2UIMessage(surfaces.get(id) ?? null, m);
                  if (merged) surfaces.set(id, merged);
                  else surfaces.delete(id);
                }
              }
            }
            next[next.length - 1] = { ...last, tools, surfaces };
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

  const send = useCallback((overridePrompt?: string, overrideMentions?: Mention[]) => {
    const trimmed = (overridePrompt ?? draft).trim();
    if (!trimmed || running) return;
    const sentMentions = overrideMentions ?? mentions;
    setMessages((m) => [
      ...m,
      { who: 'you', text: trimmed, mentions: sentMentions.length ? sentMentions : undefined },
      { who: 'ai', text: 'Thinking…', loading: true, tools: [] },
    ]);
    if (!overridePrompt) setDraft('');
    setMentions([]);
    setRunning(true);
    // Remember what to save if the user picks "Save as workflow" next.
    setLastSavable({
      prompt: trimmed,
      attach: sentMentions.length === 0 ? 'none' : sentMentions.length === 1 ? 'activeTab' : 'allTabs',
    });
    void window.horizonAPI.invoke('ai:start', {
      prompt: trimmed,
      mentionTabIds: sentMentions.length ? sentMentions.map((m) => m.tabId) : undefined,
    });
  }, [draft, running, mentions]);

  /** Run a saved workflow — same mention-resolution as presets. */
  const runWorkflow = useCallback((w: { prompt: string; attach: 'activeTab' | 'allTabs' | 'none' }) => {
    if (running) return;
    const allTabs = useBrowserStore.getState().tabs;
    const activeId = useBrowserStore.getState().activeTabId;
    let mentions: Mention[] = [];
    if (w.attach === 'activeTab') {
      const active = allTabs.find((t) => t.id === activeId);
      if (active) mentions = [{ tabId: active.id, title: active.title || active.url }];
    } else if (w.attach === 'allTabs') {
      mentions = allTabs
        .filter((t) => !t.isPinned)
        .map((t) => ({ tabId: t.id, title: t.title || t.url }));
    }
    send(w.prompt, mentions);
  }, [running, send]);

  /** Trigger a preset by label. Used by chips and the header Summarize button. */
  const runPreset = useCallback((label: string) => {
    if (running) return;
    const preset = resolvePreset(label);
    if (!preset) {
      // Unknown preset — just put the label in the draft for the user to edit.
      setDraft(label);
      return;
    }
    const allTabs = useBrowserStore.getState().tabs;
    const activeId = useBrowserStore.getState().activeTabId;
    let mentions: Mention[] = [];
    if (preset.attach === 'activeTab') {
      const active = allTabs.find((t) => t.id === activeId);
      if (active) mentions = [{ tabId: active.id, title: active.title || active.url }];
    } else if (preset.attach === 'allTabs') {
      mentions = allTabs
        .filter((t) => !t.isPinned && t.id !== activeId)
        .concat(allTabs.find((t) => t.id === activeId) ?? [])
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({ tabId: t.id, title: t.title || t.url }));
    }
    send(preset.prompt, mentions);
  }, [running, send]);

  const addMention = useCallback((tabId: string, title: string) => {
    setMentions((cur) => cur.some((m) => m.tabId === tabId) ? cur : [...cur, { tabId, title }]);
  }, []);
  const removeMention = useCallback((tabId: string) => {
    setMentions((cur) => cur.filter((m) => m.tabId !== tabId));
  }, []);
  const pickedSet = useRef<Set<string>>(new Set());
  pickedSet.current = new Set(mentions.map((m) => m.tabId));

  const cancel = useCallback(() => {
    void window.horizonAPI.invoke('ai:cancel', {});
    setRunning(false);
  }, []);

  const newChat = useCallback(() => {
    void window.horizonAPI.invoke('ai:newChat', {});
    setMessages(INITIAL);
    setDraft('');
    setMentions([]);
    setPickerOpen(false);
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
          onClick={() => runPreset('Summarize this page')}
          disabled={running}
          aria-label="Summarize this page"
          title="Summarize the current page"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            {/* Document-with-lines glyph — the universal "summary" affordance. */}
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <polyline points="14 3 14 9 20 9" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="14" y2="17" />
          </svg>
        </button>
        <div className="relative" style={{ width: 26, height: 26 }}>
          <button
            onClick={() => setWorkflowsOpen((v) => !v)}
            aria-label="Workflows"
            aria-expanded={workflowsOpen}
            title="Saved workflows"
            className="icon-btn"
            style={{ width: 26, height: 26 }}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              {/* Three horizontal lines stacked — the universal "saved list" glyph. */}
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="15" y2="12" />
              <line x1="3" y1="18" x2="18" y2="18" />
            </svg>
          </button>
          {workflowsOpen && (
            <WorkflowsPopover
              lastPrompt={lastSavable?.prompt}
              lastAttach={lastSavable?.attach}
              onRun={runWorkflow}
              onClose={() => setWorkflowsOpen(false)}
            />
          )}
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
          <MessageBubble
            key={i}
            m={m}
            isLastAndStreaming={running && i === messages.length - 1}
            onPreset={runPreset}
          />
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

      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-1" data-testid="mention-chips">
          {mentions.map((m) => (
            <span
              key={m.tabId}
              className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent-primary)' }}
            >
              @ {m.title.length > 28 ? m.title.slice(0, 28) + '…' : m.title}
              <button
                type="button"
                onClick={() => removeMention(m.tabId)}
                aria-label={`Remove mention ${m.title}`}
                className="ml-0.5"
                style={{ opacity: 0.65, fontSize: 12, lineHeight: 1, cursor: 'pointer' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end relative" style={{ padding: '4px 14px 14px' }}>
        {pickerOpen && (
          <MentionPicker
            alreadyPicked={pickedSet.current}
            onPick={addMention}
            onClose={() => setPickerOpen(false)}
          />
        )}
        <button
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Mention a tab"
          title="@ Mention a tab to compare across pages"
          className="w-10 h-10 flex items-center justify-center shrink-0"
          style={{
            background: pickerOpen ? 'var(--accent-soft)' : 'var(--surface-1)',
            color: pickerOpen ? 'var(--accent-primary)' : 'var(--chrome-fg-muted)',
            boxShadow: '0 1px 2px rgba(20,15,10,0.04), 0 0 0 0.5px var(--chrome-border)',
            borderRadius: 14,
            cursor: 'pointer',
          }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="4" />
            <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
          </svg>
        </button>
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

const MessageBubbleInner: React.FC<{ m: Message; isLastAndStreaming?: boolean; onPreset?: (label: string) => void }> = ({ m, isLastAndStreaming, onPreset }) => {
  if (m.who === 'system' && m.guide) {
    return <LlmsTxtGuideCard guide={m.guide} />;
  }
  const isYou = m.who === 'you';
  const hasText = m.text && m.text.length > 0;
  return (
    <div className={`flex flex-col gap-1.5 ${isYou ? 'items-end' : 'items-start'}`}>
      {isYou && m.mentions && m.mentions.length > 0 && (
        <div className="flex flex-wrap gap-1 max-w-[88%] justify-end">
          {m.mentions.map((mention) => (
            <span
              key={mention.tabId}
              className="text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent-primary)' }}
            >
              @ {mention.title.length > 24 ? mention.title.slice(0, 24) + '…' : mention.title}
            </span>
          ))}
        </div>
      )}
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
            // Streamdown tolerates incomplete markdown (unclosed code
            // fences, dangling bold markers etc) and renders a built-in
            // streaming caret while isAnimating is true — so the same
            // component drives both streaming and post-stream output.
            <ChatMarkdown text={m.text} isAnimating={isLastAndStreaming} />
          )}
        </div>
      )}
      {!isYou && !m.loading && hasText && !isLastAndStreaming && (
        <AiBubbleActions text={m.text} />
      )}
      {m.surfaces && m.surfaces.size > 0 && (
        <div className="flex flex-col gap-2 w-[92%] max-w-[92%]">
          {Array.from(m.surfaces.values()).map((s) => <A2UISurface key={s.id} surface={s} />)}
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
            <button
              key={f}
              type="button"
              onClick={() => onPreset?.(f)}
              className="text-xs px-2.5 py-1 rounded-full cursor-pointer"
              style={{
                background: 'var(--surface-1)',
                color: 'var(--chrome-fg-muted)',
                boxShadow: '0 0 0 0.5px var(--chrome-border)',
                border: 0,
                font: 'inherit',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Memo wrapper around MessageBubbleInner. The chat panel re-renders
 * on every text_delta (~60Hz with coalescing). Without memo, every
 * bubble in the conversation re-renders on every delta — re-parsing
 * markdown for static history. Custom comparator: skip render when
 * the message reference is identical AND isLastAndStreaming hasn't
 * flipped. (m identity changes only when the streaming bubble's text
 * grows, since setMessages does a shallow copy.)
 */
const MessageBubble = React.memo(MessageBubbleInner, (prev, next) =>
  prev.m === next.m &&
  prev.isLastAndStreaming === next.isLastAndStreaming &&
  prev.onPreset === next.onPreset
);

/**
 * Action toolbar that appears under each completed AI message. Two
 * affordances:
 *   - Copy: write the message text to the OS clipboard
 *   - Paste into page: inject the text into the active page's currently
 *     focused <input>, <textarea>, or contenteditable element. Falls
 *     back to a "no input focused" hint when no editable target is on
 *     the page.
 * Both buttons show a one-second checkmark/label after the action
 * completes for tactile feedback.
 */
const AiBubbleActions: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState<'ok' | 'no-target' | 'err' | null>(null);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard permission denied — ignore */ }
  }, [text]);

  const paste = useCallback(async () => {
    const r = (await window.horizonAPI.invoke('ai:pasteToPage', { text })) as
      | { ok: true; target?: string }
      | { ok: false; reason?: string };
    if (r.ok) setPasted('ok');
    else if (r.reason === 'no-focused-input' || r.reason === 'focused-element-not-editable') setPasted('no-target');
    else setPasted('err');
    setTimeout(() => setPasted(null), 1500);
  }, [text]);

  return (
    <div className="flex gap-1 items-center" style={{ marginTop: 2 }}>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy AI response"
        title={copied ? 'Copied' : 'Copy'}
        className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
        style={{ color: 'var(--chrome-fg-subtle)', background: 'transparent', border: 0, cursor: 'pointer', font: 'inherit' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {copied ? (
          <>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          </>
        )}
      </button>
      <button
        type="button"
        onClick={paste}
        aria-label="Paste AI response into the page's focused input"
        title={
          pasted === 'ok' ? 'Pasted into page' :
          pasted === 'no-target' ? 'No input focused on the page' :
          pasted === 'err' ? 'Paste failed' :
          'Paste into the active input on the page'
        }
        className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
        style={{
          color: pasted === 'no-target' || pasted === 'err' ? 'var(--insecure)' : 'var(--chrome-fg-subtle)',
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          font: 'inherit',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {pasted === 'ok' ? (
          <>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Pasted
          </>
        ) : pasted === 'no-target' ? (
          'No input focused'
        ) : pasted === 'err' ? (
          'Paste failed'
        ) : (
          <>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" />
            </svg>
            Paste into page
          </>
        )}
      </button>
    </div>
  );
};

const LlmsTxtGuideCard: React.FC<{ guide: LlmsTxtGuide }> = ({ guide }) => {
  const goTo = (url: string): void => {
    const tabId = useBrowserStore.getState().activeTabId;
    if (tabId && url) void window.horizonAPI.invoke('navigation:go', { tabId, url });
  };
  return (
    <div
      data-testid="llms-guide-card"
      style={{
        background: 'var(--surface-1)',
        border: '0.5px solid var(--accent-soft)',
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: '0 1px 2px rgba(20,15,10,0.04), 0 0 0 0.5px var(--chrome-border)',
        width: '92%',
        maxWidth: '92%',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent-primary)' }}
          aria-hidden
        >
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        </span>
        <div className="text-[12px] font-semibold flex-1" style={{ color: 'var(--chrome-fg)' }}>
          Site guide{guide.title ? `: ${guide.title}` : ''}
        </div>
        <span className="text-[10px]" style={{ color: 'var(--chrome-fg-subtle)' }}>
          {new URL(guide.origin).host} · llms{guide.hasFull ? '-full' : ''}.txt
        </span>
      </div>
      {guide.summary && (
        <div className="text-[12px] mb-2" style={{ color: 'var(--chrome-fg-muted)', fontStyle: 'italic' }}>
          {guide.summary}
        </div>
      )}
      {guide.sections.slice(0, 4).map((s, i) => (
        <div key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>
          {s.name && (
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--chrome-fg-subtle)', letterSpacing: '0.06em' }}>
              {s.name}
            </div>
          )}
          <ul className="text-[12px] flex flex-col gap-0.5" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {s.links.slice(0, 6).map((link, j) => (
              <li key={j} className="truncate">
                <button
                  type="button"
                  onClick={() => goTo(link.url)}
                  className="text-left"
                  style={{
                    color: 'var(--accent-primary)',
                    background: 'transparent',
                    border: 0,
                    padding: 0,
                    font: 'inherit',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}
                  title={link.url}
                >
                  {link.title}
                </button>
                {link.description && (
                  <span style={{ color: 'var(--chrome-fg-muted)' }}> — {link.description}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {guide.skillFile && (
        <div className="text-[10px] mt-2" style={{ color: 'var(--chrome-fg-subtle)' }}>
          Skill saved for the Pi agent · use in your next prompt
        </div>
      )}
    </div>
  );
};

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

/**
 * Pi may return the render_ui payload either:
 *   - as the raw object (details survived round-trip), or
 *   - as a JSON-encoded string (PiSession concatenated content[0].text), or
 *   - wrapped in {message: ...} (the agent passed the message as the
 *     tool's input arg verbatim).
 * Furthermore, LLMs frequently shortcut the strict A2UI envelope:
 *   - {surfaceId, root, components: [...]} — emit BOTH beginRendering+update
 *   - {root, components: [...]} — synthesize surfaceId
 *   - {components: [...]} only — synthesize root from first component
 * extractA2UIMessages returns an ORDERED LIST so the caller can apply
 * begin + update in sequence.
 */
function extractA2UIMessages(out: unknown): A2UIMessage[] {
  let candidate: unknown = out;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return []; }
  }
  if (!candidate || typeof candidate !== 'object') return [];
  let obj = candidate as Record<string, unknown>;
  // Unwrap {message: ...} (the tool's input shape).
  if ('message' in obj && obj.message && typeof obj.message === 'object' && !('beginRendering' in obj) && !('surfaceUpdate' in obj)) {
    obj = obj.message as Record<string, unknown>;
  }
  // Strict envelope wins if present.
  const envelope = ['beginRendering', 'surfaceUpdate', 'dataModelUpdate', 'deleteSurface'] as const;
  const hit = envelope.find((k) => k in obj);
  if (hit) {
    const out: A2UIMessage[] = [{ [hit]: obj[hit] } as A2UIMessage];
    // Some LLMs combine beginRendering + surfaceUpdate in one object.
    if (hit === 'beginRendering' && 'surfaceUpdate' in obj) {
      out.push({ surfaceUpdate: obj.surfaceUpdate } as A2UIMessage);
    }
    return out;
  }
  // Flat shortcut: {root, components}, with or without surfaceId.
  const components = obj.components;
  if (Array.isArray(components)) {
    const surfaceId = typeof obj.surfaceId === 'string' ? obj.surfaceId : 'default';
    const root = typeof obj.root === 'string'
      ? obj.root
      : (components[0] as { id?: string })?.id ?? '';
    if (!root) return [];
    return [
      { beginRendering: { surfaceId, root } },
      { surfaceUpdate: { surfaceId, components: components as never } },
    ];
  }
  return [];
}

function surfaceIdOf(msg: A2UIMessage): string | null {
  if ('beginRendering' in msg) return msg.beginRendering.surfaceId;
  if ('surfaceUpdate' in msg) return msg.surfaceUpdate.surfaceId;
  if ('dataModelUpdate' in msg) return msg.dataModelUpdate.surfaceId;
  if ('deleteSurface' in msg) return msg.deleteSurface.surfaceId;
  return null;
}

/** True when the tool result looks like a base64 image (browser_screenshot / _marked). */
function isImageResult(out: unknown): boolean {
  if (!out || typeof out !== 'object') return false;
  const o = out as { format?: string; base64?: string };
  return (o.format === 'png' || o.format === 'jpeg') && typeof o.base64 === 'string';
}
function imageDataUri(out: unknown): string {
  const o = out as { format?: string; base64: string };
  const mime = o.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${o.base64}`;
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
