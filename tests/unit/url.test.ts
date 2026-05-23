import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '@/utils/url';

describe('normalizeUrl', () => {
  it('adds https:// to bare domain', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });

  it('routes plain text to the default search engine', () => {
    expect(normalizeUrl('hello world')).toBe(
      'https://duckduckgo.com/?q=hello%20world'
    );
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

  it('returns empty string for empty or whitespace-only input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
  });

  it('uses the requested search engine when provided', () => {
    expect(normalizeUrl('cats', 'google')).toBe(
      'https://www.google.com/search?q=cats'
    );
  });

  it('falls back to duckduckgo for an unknown search engine', () => {
    expect(normalizeUrl('cats', 'bogus-engine')).toBe(
      'https://duckduckgo.com/?q=cats'
    );
  });
});
