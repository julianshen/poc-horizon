// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { applyA2UIMessage, resolveValue, type A2UIMessage, type SurfaceState } from '@/types/a2ui';

describe('applyA2UIMessage', () => {
  it('beginRendering creates a new surface and seeds root/styles', () => {
    const msg: A2UIMessage = { beginRendering: { surfaceId: 's1', root: 'root', styles: { primaryColor: '#ff0000' } } };
    const s = applyA2UIMessage(null, msg);
    expect(s).toMatchObject({ id: 's1', root: 'root' });
    expect(s?.styles?.primaryColor).toBe('#ff0000');
    expect(s?.components.size).toBe(0);
  });

  it('surfaceUpdate merges components by id; latest write wins', () => {
    let s: SurfaceState | null = applyA2UIMessage(null, { beginRendering: { surfaceId: 's1', root: 'r' } });
    s = applyA2UIMessage(s, {
      surfaceUpdate: { surfaceId: 's1', components: [
        { id: 'r', component: { Text: { text: { literalString: 'first' } } } },
      ] },
    });
    s = applyA2UIMessage(s, {
      surfaceUpdate: { surfaceId: 's1', components: [
        { id: 'r', component: { Text: { text: { literalString: 'second' } } } },
        { id: 'extra', component: { Text: { text: { literalString: 'hi' } } } },
      ] },
    });
    expect(s?.components.size).toBe(2);
    const r = s?.components.get('r');
    expect(r?.component).toEqual({ Text: { text: { literalString: 'second' } } });
  });

  it('surfaceUpdate alone (no prior beginRendering) seeds root from first component', () => {
    const s = applyA2UIMessage(null, {
      surfaceUpdate: { surfaceId: 's1', components: [
        { id: 'a', component: { Text: { text: { literalString: 'A' } } } },
      ] },
    });
    expect(s?.root).toBe('a');
  });

  it('dataModelUpdate sets a path value', () => {
    let s = applyA2UIMessage(null, { beginRendering: { surfaceId: 's1', root: 'r' } });
    s = applyA2UIMessage(s, { dataModelUpdate: { surfaceId: 's1', path: '/title', contents: 'Hello' } });
    expect(s?.dataModel['/title']).toBe('Hello');
  });

  it('deleteSurface returns null when ids match, preserves state when they don\'t', () => {
    const s = applyA2UIMessage(null, { beginRendering: { surfaceId: 's1', root: 'r' } });
    expect(applyA2UIMessage(s, { deleteSurface: { surfaceId: 's1' } })).toBeNull();
    expect(applyA2UIMessage(s, { deleteSurface: { surfaceId: 'other' } })).toBe(s);
  });

  it('messages targeting a different surfaceId are ignored', () => {
    const s = applyA2UIMessage(null, { beginRendering: { surfaceId: 's1', root: 'r' } });
    const after = applyA2UIMessage(s, { dataModelUpdate: { surfaceId: 'other', path: '/x', contents: 1 } });
    expect(after).toBe(s);
  });
});

describe('resolveValue', () => {
  it('returns the literal string when set', () => {
    expect(resolveValue({ literalString: 'x' }, {})).toBe('x');
  });
  it('returns the path value from the data model', () => {
    expect(resolveValue({ path: '/title' }, { '/title': 'Hello' })).toBe('Hello');
  });
  it('returns empty for missing path', () => {
    expect(resolveValue({ path: '/missing' }, {})).toBe('');
  });
  it('returns empty for undefined ref', () => {
    expect(resolveValue(undefined, {})).toBe('');
  });
  it('coerces non-string data-model values to strings', () => {
    expect(resolveValue({ path: '/n' }, { '/n': 42 })).toBe('42');
  });
});
