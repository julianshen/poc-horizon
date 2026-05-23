import { DEFAULT_SETTINGS, SEARCH_ENGINES, type SearchEngineKey } from '@shared/constants';

export function normalizeUrl(
  input: string,
  searchEngine: SearchEngineKey = DEFAULT_SETTINGS.defaultSearchEngine
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.includes('://')) return trimmed;

  if (!trimmed.includes('.')) {
    return SEARCH_ENGINES[searchEngine].url.replace('{query}', encodeURIComponent(trimmed));
  }

  return `https://${trimmed}`;
}
