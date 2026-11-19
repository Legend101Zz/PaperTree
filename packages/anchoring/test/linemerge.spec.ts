/**
 * linemerge.spec — a selection or highlight paints as one band per line (#346), and a column gutter
 * is never painted across.
 */

import { describe, expect, it } from 'vitest';

import { mergeQuadsPerLine } from '../src/linemerge.js';

import type { BBox } from '@papertree/document-ir';

describe('mergeQuadsPerLine', () => {
  it('joins the spans of one line across an italic or maths gap into one band', () => {
    // "The formulation of" / italic "F(x)" / "+ x": three items with a space between each, the
    // maths run taller than the body text on both sides.
    const quads: BBox[] = [
      [72, 100, 150, 110],
      [153, 98.5, 175, 111],
      [178, 100, 260, 110],
    ];
    expect(mergeQuadsPerLine(quads)).toEqual([[72, 98.5, 260, 111]]);
  });

  it('keeps two lines as two bands, and a taller maths run does not reach into the next line', () => {
    const quads: BBox[] = [
      [72, 100, 300, 110],
      [120, 99, 140, 113.5],
      [72, 112, 210, 122],
    ];
    const bands = mergeQuadsPerLine(quads);
    expect(bands).toHaveLength(2);
    const [first, second] = bands as [BBox, BBox];
    expect(first[0]).toBe(72);
    expect(first[2]).toBe(300);
    expect(first[3]).toBeLessThanOrEqual(second[1]);
    expect(second).toEqual([72, 112, 210, 122]);
  });

  it('does not bridge a column gutter: the same line in two columns stays two bands', () => {
    const quads: BBox[] = [
      [72, 100, 290, 110],
      [310, 100, 528, 110],
      [72, 112, 290, 122],
      [310, 112, 528, 122],
    ];
    const bands = mergeQuadsPerLine(quads);
    expect(bands).toHaveLength(4);
    expect(bands.filter((b) => b[0] === 72)).toHaveLength(2);
    expect(bands.filter((b) => b[0] === 310)).toHaveLength(2);
    for (const band of bands) expect(band[2] - band[0]).toBe(218);
  });

  it('is independent of the order the quads arrive in', () => {
    const quads: BBox[] = [
      [178, 100, 260, 110],
      [72, 100, 150, 110],
      [153, 100, 175, 110],
    ];
    expect(mergeQuadsPerLine(quads)).toEqual([[72, 100, 260, 110]]);
  });

  it('drops empty quads and answers an empty list for none', () => {
    expect(mergeQuadsPerLine([])).toEqual([]);
    expect(mergeQuadsPerLine([[10, 10, 10, 20]])).toEqual([]);
  });
});
