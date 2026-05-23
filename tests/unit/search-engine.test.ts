import { describe, it, expect } from 'vitest';
import { SEARCH_ENGINES } from '@shared/constants';

describe('SEARCH_ENGINES', () => {
  it('exposes duckduckgo as the documented default', () => {
    expect(SEARCH_ENGINES.duckduckgo).toBeDefined();
    expect(SEARCH_ENGINES.duckduckgo.url).toContain('{query}');
  });

  it('exposes google and bing as alternatives', () => {
    expect(SEARCH_ENGINES.google).toBeDefined();
    expect(SEARCH_ENGINES.bing).toBeDefined();
  });

  it('every engine uses the {query} placeholder in its url template', () => {
    for (const [name, engine] of Object.entries(SEARCH_ENGINES)) {
      expect(engine.url, `${name}.url`).toContain('{query}');
    }
  });
});
