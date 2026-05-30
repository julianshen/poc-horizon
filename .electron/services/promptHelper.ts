import type { ParsedLlmsTxt } from "./llmsTxtParser";

/**
 * Truncate text to prevent model token limits being exceeded.
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) + "\n\n... [truncated to save token limit] ...\n"
  );
}

/**
 * Render a COMPACT, useful summary from a parsed llms.txt — the title,
 * one-line summary, and the section nav links. Deliberately excludes raw
 * document bodies (llms-full.txt content) so we never dump large docs into
 * the agent's token budget; the agent can fetch a linked doc on demand.
 * Returns "" when there's nothing useful to inject.
 */
export function summarizeLlmsGuide(parsed: ParsedLlmsTxt): string {
  const lines: string[] = [];
  if (parsed.title) lines.push(`# ${parsed.title}`);
  if (parsed.summary) lines.push(parsed.summary);
  for (const section of parsed.sections) {
    if (section.links.length === 0) continue;
    if (section.name) lines.push(`\n## ${section.name}`);
    for (const link of section.links) {
      lines.push(
        `- ${link.title}: ${link.url}${link.description ? ` — ${link.description}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Augment the agent prompt with site skills (from llms.txt/llms-full.txt) and @-mentioned tabs.
 * Injects `<site-skills>` and `<page>` tags.
 */
/** Total budget (chars) for ALL @-mentioned page content combined. Each
 *  page is also capped individually, but without an aggregate limit
 *  @-mentioning many tabs (e.g. "compare my open tabs") could blow the
 *  model's context window and get the request rejected (400 "prompt too
 *  long"). ~60k chars ≈ ~15k tokens. */
const DEFAULT_PAGES_TOTAL_CAP = 60_000;

export function buildAugmentedPrompt({
  prompt,
  skills,
  origin,
  pages,
  pagesTotalCap = DEFAULT_PAGES_TOTAL_CAP,
}: {
  prompt: string;
  skills?: string | null;
  origin?: string;
  pages?: Array<{ url: string; title: string; text: string; cap: number }>;
  pagesTotalCap?: number;
}): string {
  let augmentedPrompt = prompt;
  if (skills && origin) {
    // Truncate to save token limit! E.g. max 15,000 characters.
    const truncatedSkills = truncateText(skills, 15000);
    augmentedPrompt = `<site-skills origin="${origin}">\n${truncatedSkills}</site-skills>\n\n${augmentedPrompt}`;
  }

  if (pages && pages.length > 0) {
    const blocks: string[] = [];
    let used = 0;
    let omitted = 0;
    for (const page of pages) {
      const remaining = pagesTotalCap - used;
      if (remaining <= 0) {
        omitted += 1;
        continue;
      }
      // Each page is bounded by its own cap AND the shared remaining budget.
      const perPage = Math.min(page.cap, remaining);
      const truncated =
        page.text.length > perPage
          ? page.text.slice(0, perPage) + "\n…[truncated]"
          : page.text;
      used += truncated.length;
      blocks.push(
        `<page url="${escapeAttr(page.url)}" title="${escapeAttr(page.title)}">\n${truncated}\n</page>`,
      );
    }
    if (omitted > 0) {
      // Surface the drop instead of silently swallowing pages.
      blocks.push(
        `<!-- ${omitted} more @-mentioned page(s) omitted to stay within the token budget -->`,
      );
    }
    if (blocks.length > 0) {
      augmentedPrompt = `${blocks.join("\n\n")}\n\n${augmentedPrompt}`;
    }
  }

  return augmentedPrompt;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
