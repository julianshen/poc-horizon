import React, { useMemo } from 'react';
import type { SurfaceState, ComponentEntry, ComponentBody } from '../../types/a2ui';
import { resolveValue } from '../../types/a2ui';

interface Props { surface: SurfaceState }

/**
 * A2UI renderer. Walks the adjacency-list component tree from
 * surface.root and emits React elements. Render-only — Button onPress
 * and TextInput onChange are wired to console.log placeholders until
 * the client→server action channel lands.
 */
export const A2UISurface: React.FC<Props> = ({ surface }) => {
  const ctx = useMemo<RenderCtx>(() => ({ surface, seen: new Set() }), [surface]);
  // If the named root isn't (yet) in the components map, fall back to
  // the first component we have — useful when an LLM streams components
  // before a final beginRendering, or omits root entirely.
  const rootId = surface.components.has(surface.root)
    ? surface.root
    : (Array.from(surface.components.keys())[0] ?? '');
  const hasAny = surface.components.size > 0;
  return (
    <div
      style={{
        background: 'var(--surface-1)',
        border: '0.5px solid var(--chrome-border)',
        borderRadius: 10,
        padding: 12,
        fontSize: 13,
        color: 'var(--chrome-fg)',
      }}
    >
      {hasAny ? renderNode(rootId, ctx) : (
        <span style={{ color: 'var(--chrome-fg-subtle)', fontStyle: 'italic' }}>
          A2UI surface received but no components yet…
        </span>
      )}
    </div>
  );
};

interface RenderCtx { surface: SurfaceState; seen: Set<string> }

function renderNode(id: string, ctx: RenderCtx): React.ReactNode {
  if (ctx.seen.has(id)) return null; // cycle guard
  const entry = ctx.surface.components.get(id);
  if (!entry) return null;
  const next: RenderCtx = { surface: ctx.surface, seen: new Set(ctx.seen).add(id) };
  return <Component key={id} entry={entry} ctx={next} />;
}

const Component: React.FC<{ entry: ComponentEntry; ctx: RenderCtx }> = ({ entry, ctx }) => {
  return renderBody(entry.component, ctx);
};

function renderBody(body: ComponentBody, ctx: RenderCtx): React.ReactNode {
  const dm = ctx.surface.dataModel;

  if ('Text' in body) {
    const text = resolveValue(body.Text.text, dm);
    return <TextNode text={text} hint={body.Text.usageHint} />;
  }
  if ('Heading' in body) {
    const text = resolveValue(body.Heading.text, dm);
    return <TextNode text={text} hint={`h${body.Heading.level ?? 2}` as 'h2'} />;
  }
  if ('Image' in body) {
    const src = resolveValue(body.Image.src, dm);
    const alt = resolveValue(body.Image.alt, dm);
    return <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }} />;
  }
  if ('Row' in body) {
    return (
      <div style={{ display: 'flex', flexDirection: 'row', gap: body.Row.gap ?? 8, alignItems: alignOf(body.Row.align) }}>
        {body.Row.children.map((cid) => renderNode(cid, ctx))}
      </div>
    );
  }
  if ('Column' in body) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: body.Column.gap ?? 8, alignItems: alignOf(body.Column.align) }}>
        {body.Column.children.map((cid) => renderNode(cid, ctx))}
      </div>
    );
  }
  if ('Card' in body) {
    return (
      <div style={{
        background: 'var(--surface-2)',
        borderRadius: 8,
        padding: 10,
        boxShadow: '0 1px 2px rgba(20,15,10,0.04)',
      }}>
        {renderNode(body.Card.child, ctx)}
      </div>
    );
  }
  if ('Button' in body) {
    const label = resolveValue(body.Button.label, dm);
    return (
      <button
        type="button"
        onClick={() => {
          void window.horizonAPI.invoke('ai:uiAction', {
            kind: 'button',
            surfaceId: ctx.surface.id,
            label,
            action: body.Button.action,
          });
        }}
        style={{
          background: 'var(--accent-primary)',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        {label || 'Button'}
      </button>
    );
  }
  if ('TextInput' in body) {
    const placeholder = resolveValue(body.TextInput.placeholder, dm);
    const value = resolveValue(body.TextInput.value, dm);
    return (
      <input
        defaultValue={value}
        placeholder={placeholder}
        onBlur={(e) => {
          const next = e.currentTarget.value;
          if (next === value) return; // no change → no spam
          void window.horizonAPI.invoke('ai:uiAction', {
            kind: 'input',
            surfaceId: ctx.surface.id,
            path: body.TextInput.path,
            placeholder,
            value: next,
          });
        }}
        style={{
          background: 'var(--surface-1)',
          border: '0.5px solid var(--chrome-border)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 13,
          outline: 'none',
          color: 'var(--chrome-fg)',
        }}
      />
    );
  }
  if ('Divider' in body) {
    return <hr style={{ border: 0, borderTop: '0.5px solid var(--chrome-border)', margin: '4px 0' }} />;
  }
  if ('List' in body) {
    return (
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {body.List.children.map((cid) => <li key={cid}>{renderNode(cid, ctx)}</li>)}
      </ul>
    );
  }
  // Unknown component type — render placeholder so the agent's intent is visible.
  return <span style={{ color: 'var(--chrome-fg-subtle)', fontStyle: 'italic' }}>[unsupported A2UI component]</span>;
}

const TextNode: React.FC<{ text: string; hint?: 'h1'|'h2'|'h3'|'h4'|'h5'|'caption'|'body' }> = ({ text, hint = 'body' }) => {
  if (hint === 'caption') return <span style={{ fontSize: 11, color: 'var(--chrome-fg-muted)' }}>{text}</span>;
  if (hint === 'body') return <span>{text}</span>;
  const size: Record<string, number> = { h1: 20, h2: 17, h3: 15, h4: 14, h5: 13 };
  return <div style={{ fontSize: size[hint], fontWeight: 600, lineHeight: 1.2 }}>{text}</div>;
};

function alignOf(a?: 'start' | 'center' | 'end'): React.CSSProperties['alignItems'] {
  if (a === 'center') return 'center';
  if (a === 'end') return 'flex-end';
  return 'flex-start';
}
