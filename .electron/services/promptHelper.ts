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
 * Augment the agent prompt with site skills (from llms.txt/llms-full.txt) and @-mentioned tabs.
 * Injects `<site-skills>` and `<page>` tags.
 */
export function buildAugmentedPrompt({
  prompt,
  skills,
  origin,
  pages,
}: {
  prompt: string;
  skills?: string | null;
  origin?: string;
  pages?: Array<{ url: string; title: string; text: string; cap: number }>;
}): string {
  let augmentedPrompt = prompt;
  if (skills && origin) {
    // Truncate to save token limit! E.g. max 15,000 characters.
    const truncatedSkills = truncateText(skills, 15000);
    augmentedPrompt = `<site-skills origin="${origin}">\n${truncatedSkills}</site-skills>\n\n${augmentedPrompt}`;
  }

  if (pages && pages.length > 0) {
    const blocks: string[] = [];
    for (const page of pages) {
      const truncated =
        page.text.length > page.cap
          ? page.text.slice(0, page.cap) + "\n…[truncated]"
          : page.text;
      blocks.push(
        `<page url="${escapeAttr(page.url)}" title="${escapeAttr(page.title)}">\n${truncated}\n</page>`,
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
