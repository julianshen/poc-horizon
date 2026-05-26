import type { WebContents } from 'electron';
import { translateBatch } from './LlmTranslator';

/** Extract translatable text nodes from the active page into an indexed list. */
const EXTRACT_SCRIPT = `(function() {
  // Reuse the same backing store across invocations so a "translate again
  // to another language" run can re-apply against the originals.
  if (!window.__horizonTranslate) {
    window.__horizonTranslate = { nodes: new Map() };
  }
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','MATH','CODE','PRE','TEXTAREA','INPUT','OBJECT','EMBED']);
  const out = [];
  let nextId = 1;
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.nodeValue || '').replace(/\\s+/g, ' ').trim();
      // Heuristic: at least 2 chars, contain a letter — skip whitespace + pure-symbol nodes.
      if (t.length < 2 || !/[\\p{L}]/u.test(t)) return;
      const id = nextId++;
      window.__horizonTranslate.nodes.set(id, { node, original: node.nodeValue });
      out.push({ id, text: t });
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName;
      if (SKIP_TAGS.has(tag)) return;
      // aria-hidden + display:none branches: skip.
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return;
      try {
        const cs = window.getComputedStyle(node);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return;
      } catch (_) {}
      for (const child of Array.from(node.childNodes)) walk(child);
    }
  };
  walk(document.body);
  return out;
})()`;

/** Apply translations back to the page using the stored node references. */
const APPLY_SCRIPT = (translations: { id: number; text: string }[]) => `(function() {
  const store = window.__horizonTranslate;
  if (!store) return { applied: 0 };
  const list = ${JSON.stringify(translations)};
  let applied = 0;
  for (const { id, text } of list) {
    const entry = store.nodes.get(id);
    if (!entry || !text) continue;
    try {
      entry.node.nodeValue = text;
      applied++;
    } catch (_) { /* node detached — skip */ }
  }
  return { applied };
})()`;

const RESTORE_SCRIPT = `(function() {
  const store = window.__horizonTranslate;
  if (!store) return { restored: 0 };
  let restored = 0;
  for (const [, entry] of store.nodes) {
    try { entry.node.nodeValue = entry.original; restored++; } catch (_) {}
  }
  store.nodes.clear();
  return { restored };
})()`;

interface TranslateResult {
  ok: boolean;
  translated?: number;
  total?: number;
  error?: string;
}

/**
 * Translate the visible page in-place. Extracts text nodes, batches
 * them, sends each batch to the LLM, applies translations preserving
 * the page's DOM structure. Originals are remembered so a future
 * restorePage() call can roll back.
 *
 * Batches are sized by character count, not node count, so a page
 * with a few huge paragraphs and a thousand tiny labels both fit
 * within the LLM's context budget.
 */
export async function translatePage(
  wc: WebContents,
  targetLang: string,
  onProgress?: (translated: number, total: number) => void,
): Promise<TranslateResult> {
  let nodes: Array<{ id: number; text: string }>;
  try {
    nodes = (await wc.executeJavaScript(EXTRACT_SCRIPT, true)) as Array<{ id: number; text: string }>;
  } catch (err) {
    return { ok: false, error: `extract failed: ${(err as Error).message}` };
  }
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, error: 'no translatable text found' };
  }

  const BATCH_CHAR_CAP = 4000;
  const batches: Array<Array<{ id: number; text: string }>> = [];
  let current: Array<{ id: number; text: string }> = [];
  let currentSize = 0;
  for (const n of nodes) {
    if (currentSize + n.text.length > BATCH_CHAR_CAP && current.length > 0) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(n);
    currentSize += n.text.length;
  }
  if (current.length > 0) batches.push(current);

  let totalApplied = 0;
  for (const batch of batches) {
    const translated = await translateBatch(batch.map((n) => n.text), targetLang);
    const out: { id: number; text: string }[] = [];
    for (let i = 0; i < batch.length; i++) {
      const t = translated[i];
      if (t) out.push({ id: batch[i].id, text: t });
    }
    if (out.length > 0) {
      try {
        const r = (await wc.executeJavaScript(APPLY_SCRIPT(out), true)) as { applied: number };
        totalApplied += r.applied ?? 0;
      } catch { /* tab closed mid-flight — abort */ break; }
    }
    onProgress?.(totalApplied, nodes.length);
  }
  return { ok: true, translated: totalApplied, total: nodes.length };
}

/** Roll back a translated page to its original text content. */
export async function restorePage(wc: WebContents): Promise<{ restored: number }> {
  try {
    return (await wc.executeJavaScript(RESTORE_SCRIPT, true)) as { restored: number };
  } catch {
    return { restored: 0 };
  }
}
