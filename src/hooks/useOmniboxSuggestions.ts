import { useEffect, useState } from "react";
import type { HistoryEntry } from "../types/browser";

const DEBOUNCE_MS = 120;
const MAX_SUGGESTIONS = 8;

export function useOmniboxSuggestions(
  query: string,
  enabled: boolean,
): HistoryEntry[] {
  const [results, setResults] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (!enabled || !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = (await window.horizonAPI.invoke("history:search", {
          query,
          limit: MAX_SUGGESTIONS,
        })) as HistoryEntry[];
        if (!cancelled) setResults(Array.isArray(r) ? r : []);
      } catch (err) {
        console.warn("[useOmniboxSuggestions] history:search failed:", err);
        if (!cancelled) setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enabled]);

  return results;
}
