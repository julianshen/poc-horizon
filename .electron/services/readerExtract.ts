import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ReaderArticle {
  title: string;
  byline: string | null;
  excerpt: string | null;
  /** Cleaned-up HTML (safe to render, links/images preserved). */
  contentHtml: string;
  /** Plain text — useful as agent context. */
  textContent: string;
  /** Approximate length in characters. */
  length: number;
  /** Estimated reading time in minutes (200 wpm). */
  readingMinutes: number;
  /** Detected language ISO code, if present. */
  lang: string | null;
  siteName: string | null;
}

/**
 * Extract a "reader mode" article from a page's HTML using Mozilla's
 * Readability library. Same algorithm Firefox Reader View uses.
 *
 * Returns null when Readability can't find article content (e.g. login
 * walls, app shells, JSON-only API responses). Caller decides whether
 * to surface the failure or fall back to raw text.
 */
export function readerExtract(
  html: string,
  pageUrl: string,
): ReaderArticle | null {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url: pageUrl });
  } catch {
    return null;
  }
  const article = new Readability(dom.window.document).parse();
  if (!article) return null;
  const text = article.textContent ?? "";
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    title: article.title ?? "",
    byline: article.byline,
    excerpt: article.excerpt,
    contentHtml: article.content ?? "",
    textContent: text,
    length: article.length ?? text.length,
    readingMinutes: Math.max(1, Math.round(wordCount / 200)),
    lang: article.lang ?? null,
    siteName: article.siteName ?? null,
  };
}
