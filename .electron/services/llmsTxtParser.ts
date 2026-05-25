/**
 * Minimal llms.txt parser per https://llmstxt.org/.
 *
 * Format:
 *   # Title
 *
 *   > One-line summary (blockquote)
 *
 *   Optional intro paragraph(s).
 *
 *   ## Section Name
 *
 *   - [Link Title](url): optional description
 *   - [Another](url)
 *
 *   ## Another Section
 *   ...
 *
 * Tolerant: missing summary / sections / intro are all fine. Returns
 * undefined fields rather than throwing.
 */

export interface ParsedLlmsLink {
  title: string;
  url: string;
  description?: string;
}

export interface ParsedLlmsSection {
  name: string;
  links: ParsedLlmsLink[];
}

export interface ParsedLlmsTxt {
  title?: string;
  summary?: string;
  sections: ParsedLlmsSection[];
}

const LINK_RE = /^[ \t]*-[ \t]*\[([^\]]+)\]\(([^)]+)\)(?::[ \t]*(.+))?[ \t]*$/;
const H1_RE = /^#[ \t]+/;
const H2_RE = /^##[ \t]+/;
const QUOTE_RE = /^>[ \t]+/;

export function parseLlmsTxt(text: string): ParsedLlmsTxt {
  const lines = text.split(/\r?\n/);
  const out: ParsedLlmsTxt = { sections: [] };
  let currentSection: ParsedLlmsSection | null = null;
  let sawTitle = false;

  for (const line of lines) {
    if (!sawTitle && H1_RE.test(line)) {
      out.title = line.replace(H1_RE, '').trim();
      sawTitle = true;
      continue;
    }
    if (!out.summary && QUOTE_RE.test(line)) {
      out.summary = line.replace(QUOTE_RE, '').trim();
      continue;
    }
    if (H2_RE.test(line)) {
      currentSection = { name: line.replace(H2_RE, '').trim(), links: [] };
      out.sections.push(currentSection);
      continue;
    }
    const m = LINK_RE.exec(line);
    if (m) {
      const link: ParsedLlmsLink = { title: m[1].trim(), url: m[2].trim() };
      if (m[3]) link.description = m[3].trim();
      if (!currentSection) {
        currentSection = { name: '', links: [] };
        out.sections.push(currentSection);
      }
      currentSection.links.push(link);
    }
  }
  out.sections = out.sections.filter((s) => s.links.length > 0);
  return out;
}
