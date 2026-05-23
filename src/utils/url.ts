import { SEARCH_ENGINES } from '@shared/constants';

export function normalizeUrl(input: string, searchEngine = 'duckduckgo'): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  if (trimmed.includes('://')) return trimmed;

  if (!trimmed.includes('.')) {
    const engine = SEARCH_ENGINES[searchEngine] ?? SEARCH_ENGINES.duckduckgo;
    return engine.url.replace('{query}', encodeURIComponent(trimmed));
  }

  return `https://${trimmed}`;
}
