/**
 * Detects whether this renderer is part of an incognito window. The flag
 * is propagated from main.ts via the URL search string (`?incognito=1`).
 * Returns a stable boolean — incognito-ness can't change mid-session.
 */
export function useIncognito(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("incognito") === "1";
  } catch {
    return false;
  }
}
