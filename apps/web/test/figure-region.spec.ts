/**
 * figure-region: one rule for what a figure is on its page (v0.3 check fixes, ResNet Figure 2).
 *
 * The parser reports ResNet's Figure 2 as a drawing box [129, 85, 204, 154] with its labels around
 * it as separate blocks ("F(x)" 11 pt to its left, an "x" 11 pt to its right, "x" on its top edge),
 * and "identity", "F(x) + x" and the caption "Figure 2. Residual learning: a building block." as
 * ONE paragraph (an L-shaped polygon: two narrow label lines over one wide caption line). The same
 * figure region, the box with its labels and never the caption line, is what the mat keeps, what
 * the float selects and what the crop is asked of.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { indexDocument, type PaperSource } from '@papertree/anchoring';
import type { BBox } from '@papertree/document-ir';

import { figureMats } from '@/components/reader/figureRegions';
import { floatsOnPage } from '@/features/reader/model/floats';

const doc = indexDocument(
  JSON.parse(
    readFileSync(`${process.cwd()}/test/fixtures/real-resnet-p1-2.ir.json`, 'utf8'),
  ) as PaperSource,
  'figure-region-spec',
);
const PAGE = 1;
const blocks = doc.byPage.get(PAGE) ?? [];

/** The figure's labels as the parser has them, IR points. */
const F_OF_X: BBox = [98.3, 106.8, 117.7, 122.8];
const X_RIGHT: BBox = [215.3, 111.8, 220.9, 121.1];
/** "identity" and "F(x) + x": the top bands of the label-and-caption paragraph. */
const IDENTITY: BBox = [106.9, 139.8, 143.3, 157.3];
/** The caption line of that paragraph, which is never part of the figure region. */
const CAPTION_LINE_TOP = 157.4;

const holds = (box: BBox, inner: BBox): boolean =>
  box[0] <= inner[0] && box[1] <= inner[1] && box[2] >= inner[2] && box[3] >= inner[3];

describe('ResNet Figure 2: the figure region holds its own labels, whole', () => {
  it('the mat keeps F(x), both x labels and the whole word "identity"', () => {
    const [mat] = figureMats(blocks);
    expect(mat).toBeDefined();
    const box = (mat as { box: BBox }).box;
    for (const label of [F_OF_X, X_RIGHT, IDENTITY]) expect(holds(box, label)).toBe(true);
  });

  it('the mat stops above the caption line that shares a block with the labels', () => {
    const [mat] = figureMats(blocks);
    const box = (mat as { box: BBox }).box;
    expect(box[3]).toBeLessThanOrEqual(CAPTION_LINE_TOP + 0.1);
    expect(mat?.gaps[2]).toBeLessThan(1);
  });

  it('the float selects the same region plus the caption line, and reads its number from it', () => {
    const [float] = floatsOnPage(doc, PAGE);
    expect(float).toBeDefined();
    for (const label of [F_OF_X, X_RIGHT, IDENTITY])
      expect(holds(float?.box as BBox, label)).toBe(true);
    expect(float?.caption).toBe('Figure 2. Residual learning: a building block.');
    expect(float?.label).toBe('Figure 2');
    // the caption line is inside the selection; the body text under it is not
    expect(float?.box[3]).toBeCloseTo(166.9, 0);
    expect(float?.box[0]).toBeLessThanOrEqual(86.7);
  });
});
