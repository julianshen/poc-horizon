/**
 * A2UI v0.8 — server→client subset Horizon renders today.
 *
 * Spec: https://github.com/google/A2UI/blob/main/specification/v0_8/
 *
 * Each A2UI message carries EXACTLY ONE of {beginRendering, surfaceUpdate,
 * dataModelUpdate, deleteSurface}. The standard catalog is implied
 * (catalogId omitted → v0.8 default). Adjacency-list model: each
 * component has an `id` and references children by ID — the tree is
 * walked starting at `root`.
 *
 * v1 scope: render-only. Buttons / TextInputs render but their actions
 * don't yet bubble back to the agent (that needs the client→server
 * channel + an action-routing IPC). Mark with TODO when wiring lands.
 */

export interface A2UIStyles {
  font?: string;
  primaryColor?: string;
}

export interface BeginRendering {
  surfaceId: string;
  catalogId?: string;
  root: string;
  styles?: A2UIStyles;
}

export interface ComponentEntry {
  id: string;
  weight?: number;
  component: ComponentBody;
}

export interface SurfaceUpdate {
  surfaceId: string;
  components: ComponentEntry[];
}

export interface DataModelUpdate {
  surfaceId: string;
  path: string;
  contents: unknown;
}

export interface DeleteSurface { surfaceId: string }

export type A2UIMessage =
  | { beginRendering: BeginRendering }
  | { surfaceUpdate: SurfaceUpdate }
  | { dataModelUpdate: DataModelUpdate }
  | { deleteSurface: DeleteSurface };

/** Reference to a literal or a path into the data model. */
export interface ValueRef { literalString?: string; path?: string }

export interface TextProps    { text: ValueRef; usageHint?: 'h1'|'h2'|'h3'|'h4'|'h5'|'caption'|'body' }
export interface HeadingProps { text: ValueRef; level?: 1|2|3|4|5 }
export interface ImageProps   { src: ValueRef; alt?: ValueRef }
export interface RowProps     { children: string[]; gap?: number; align?: 'start'|'center'|'end' }
export interface ColumnProps  { children: string[]; gap?: number; align?: 'start'|'center'|'end' }
export interface CardProps    { child: string }
export interface ButtonProps  { label: ValueRef; action?: string }
export interface TextInputProps { value?: ValueRef; placeholder?: ValueRef; path?: string }
export interface DividerProps   { /* none */ }
export interface ListProps      { children: string[] }

export type ComponentBody =
  | { Text: TextProps }
  | { Heading: HeadingProps }
  | { Image: ImageProps }
  | { Row: RowProps }
  | { Column: ColumnProps }
  | { Card: CardProps }
  | { Button: ButtonProps }
  | { TextInput: TextInputProps }
  | { Divider: DividerProps }
  | { List: ListProps };

/** State carried across messages for one surface. */
export interface SurfaceState {
  id: string;
  root: string;
  styles?: A2UIStyles;
  /** Adjacency list, keyed by id. Latest write wins on conflict. */
  components: Map<string, ComponentEntry>;
  /** Data model — paths like "/doc/title" → arbitrary value. */
  dataModel: Record<string, unknown>;
}

/**
 * Merge an incoming A2UI message into an existing surface state. Pure;
 * returns a NEW state object so React `useState` setters work.
 */
export function applyA2UIMessage(prev: SurfaceState | null, msg: A2UIMessage): SurfaceState | null {
  if ('beginRendering' in msg) {
    const b = msg.beginRendering;
    return {
      id: b.surfaceId,
      root: b.root,
      styles: b.styles,
      components: prev?.id === b.surfaceId ? prev.components : new Map(),
      dataModel: prev?.id === b.surfaceId ? prev.dataModel : {},
    };
  }
  if ('surfaceUpdate' in msg) {
    const u = msg.surfaceUpdate;
    // If we never saw beginRendering, surfaceUpdate can still seed: root
    // is unknown, so pick the first component as a fallback.
    const base = (prev && prev.id === u.surfaceId)
      ? prev
      : { id: u.surfaceId, root: u.components[0]?.id ?? '', components: new Map<string, ComponentEntry>(), dataModel: {} };
    const next = new Map(base.components);
    for (const c of u.components) next.set(c.id, c);
    return { ...base, components: next };
  }
  if ('dataModelUpdate' in msg) {
    if (!prev || prev.id !== msg.dataModelUpdate.surfaceId) return prev;
    return { ...prev, dataModel: { ...prev.dataModel, [msg.dataModelUpdate.path]: msg.dataModelUpdate.contents } };
  }
  if ('deleteSurface' in msg) {
    if (!prev || prev.id !== msg.deleteSurface.surfaceId) return prev;
    return null;
  }
  return prev;
}

/** Resolve a ValueRef against the surface's data model. */
export function resolveValue(ref: ValueRef | undefined, dataModel: Record<string, unknown>): string {
  if (!ref) return '';
  if (ref.literalString !== undefined) return ref.literalString;
  if (ref.path !== undefined) {
    const v = dataModel[ref.path];
    return v === undefined || v === null ? '' : String(v);
  }
  return '';
}
