import { describe, it, expect } from 'vitest';
import { hexToRgba, getContrastTextColor, lightenColor, buildAccentStyle, resolveTheme } from '@/utils/theme';

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

describe('getContrastTextColor', () => {
  it('returns dark text for light backgrounds', () => {
    expect(getContrastTextColor('#ffffff')).toBe('#1a1612');
    expect(getContrastTextColor('#eeeeee')).toBe('#1a1612');
  });

  it('returns light text for dark backgrounds', () => {
    expect(getContrastTextColor('#1a1612')).toBe('#ffffff');
    expect(getContrastTextColor('#000000')).toBe('#ffffff');
  });

  it('returns dark text for medium-light colors', () => {
    expect(getContrastTextColor('#ffb3c6')).toBe('#1a1612');
  });

  it('returns empty string for invalid hex', () => {
    expect(getContrastTextColor('invalid')).toBe('');
  });
});

describe('lightenColor', () => {
  it('lightens a blue color', () => {
    const result = lightenColor('#2a82c8', 15);
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    const inputG = parseInt('82', 16);
    const resultG = parseInt(result.slice(3, 5), 16);
    expect(resultG).toBeGreaterThan(inputG);
  });

  it('clamps lightness at 100%', () => {
    const result = lightenColor('#ffffff', 50);
    expect(result).toBe('#ffffff');
  });

  it('returns empty string for invalid hex', () => {
    expect(lightenColor('invalid', 15)).toBe('');
  });
});

describe('buildAccentStyle', () => {
  it('returns empty string for empty accentColor', () => {
    expect(buildAccentStyle('')).toBe('');
  });

  it('returns empty string for invalid hex', () => {
    expect(buildAccentStyle('invalid')).toBe('');
  });

  it('builds CSS with valid hex', () => {
    const css = buildAccentStyle('#d44d7a');
    expect(css).toContain('--accent-primary: #d44d7a');
    expect(css).toContain('--accent-text: #ffffff');
    expect(css).toContain('--omnibox-ring: rgba(212, 77, 122, 0.2)');
  });

  it('includes gradient with lightened secondary stop', () => {
    const css = buildAccentStyle('#2a82c8');
    expect(css).toContain('linear-gradient(135deg, #2a82c8 0%,');
  });
});

describe('resolveTheme', () => {
  it('returns named presets directly', () => {
    expect(resolveTheme('dia', false)).toBe('dia');
    expect(resolveTheme('midnight', false)).toBe('midnight');
    expect(resolveTheme('ocean', true)).toBe('ocean');
    expect(resolveTheme('forest', false)).toBe('forest');
  });

  it('resolves system to dia on light OS', () => {
    expect(resolveTheme('system', false)).toBe('dia');
  });

  it('resolves system to midnight on dark OS', () => {
    expect(resolveTheme('system', true)).toBe('midnight');
  });
});
