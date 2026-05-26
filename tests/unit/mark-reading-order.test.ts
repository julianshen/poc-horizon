// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rerankMarksReadingOrder, type RawMark } from '@electron/services/BrowserHarness';

const m = (label: string, l: number, t: number, w = 80, h = 30): RawMark => ({
  label, x: l + w / 2, y: t + h / 2, w, h, _rect: { l, t, w, h },
  tag: 'button', role: null, href: null,
});

describe('rerankMarksReadingOrder', () => {
  it('orders rows top-to-bottom, columns left-to-right within row', () => {
    const input = [
      m('B', 300, 100),
      m('D', 400, 300),
      m('A', 10,  100),
      m('C', 50,  300),
    ];
    const out = rerankMarksReadingOrder(input);
    expect(out.map((x) => x.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('clusters near-aligned rows (small y deltas = same row)', () => {
    const input = [
      m('mid',   200, 105),
      m('right', 400, 102),
      m('left',  10,  100),
    ];
    const out = rerankMarksReadingOrder(input);
    expect(out.map((x) => x.label)).toEqual(['left', 'mid', 'right']);
  });

  it('separates rows whose y gap exceeds tolerance', () => {
    const input = [
      m('row1-right', 400, 100),
      m('row2-left',  10,  300),
      m('row1-left',  10,  100),
    ];
    const out = rerankMarksReadingOrder(input);
    expect(out.map((x) => x.label)).toEqual(['row1-left', 'row1-right', 'row2-left']);
  });

  it('row tolerance scales with median height — dense grids cluster differently from sparse ones', () => {
    // Median height 100 → tolerance ~min(60, 40) = 40. y delta of 30 should stay in row.
    const input = [
      m('A', 10, 0,   200, 100),
      m('B', 300, 30, 200, 100),    // y delta 30 < 40 tolerance → same row
    ];
    const out = rerankMarksReadingOrder(input);
    expect(out.map((x) => x.label)).toEqual(['A', 'B']);
  });

  it('returns input as-is when empty', () => {
    expect(rerankMarksReadingOrder([])).toEqual([]);
  });
});
