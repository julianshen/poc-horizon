import { describe, it, expect } from 'vitest';
import { SEARCH_ENGINES } from '@shared/constants';
import { normalizeUrl } from '@/utils/url';

const searchUrl = (engine: keyof typeof SEARCH_ENGINES, query: string): string =>
  SEARCH_ENGINES[engine].url.replace('{query}', encodeURIComponent(query));

describe('normalizeUrl', () => {
  it('adds https:// to bare domain', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });

  it('routes plain text to the default search engine', () => {
    expect(normalizeUrl('hello world')).toBe(searchUrl('duckduckgo', 'hello world'));
  });

  it('preserves an existing http scheme', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('preserves an existing https scheme', () => {
    expect(normalizeUrl('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1'
    );
  });

  it('preserves non-http schemes', () => {
    expect(normalizeUrl('chrome://settings')).toBe('chrome://settings');
    expect(normalizeUrl('file:///tmp/x.html')).toBe('file:///tmp/x.html');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('   example.com   ')).toBe('https://example.com');
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
  });

  it('uses the requested search engine when provided', () => {
    expect(normalizeUrl('cats', 'google')).toBe(searchUrl('google', 'cats'));
    expect(normalizeUrl('cats', 'bing')).toBe(searchUrl('bing', 'cats'));
  });
});
