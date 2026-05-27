import { describe, it, expect } from 'vitest';
import { hexToRgba } from '@/utils/theme';

describe('hexToRgba', () => {
  it('converts a 6-digit hex to rgba', () => {
    expect(hexToRgba('#d44d7a', 0.1)).toBe('rgba(212, 77, 122, 0.1)');
  });

  it('converts a 3-digit hex to rgba', () => {
    expect(hexToRgba('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
  });

  it('returns empty string for invalid hex', () => {
    expect(hexToRgba('invalid', 0.1)).toBe('');
    expect(hexToRgba('', 0.1)).toBe('');
    expect(hexToRgba('#zzzzzz', 0.1)).toBe('');
  });

  it('handles edge values', () => {
    expect(hexToRgba('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
    expect(hexToRgba('#ffffff', 0)).toBe('rgba(255, 255, 255, 0)');
  });
});
