import { describe, it, expect } from 'vitest';
import { formatBytes } from '@/utils/format';

describe('formatBytes', () => {
  it('returns "0 B" for zero, negative, or non-finite values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
  });

  it('formats whole-byte values without decimals', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('formats KB/MB/GB/TB with one decimal when below 10', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
  });

  it('drops decimals when value is at least 10', () => {
    expect(formatBytes(15 * 1024)).toBe('15 KB');
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
  });

  it('clamps very large values to TB', () => {
    expect(formatBytes(1024 ** 6)).toMatch(/TB$/);
  });
});
