/**
 * imageAnchor: the wire shape of an image anchor is exactly the API's (`v03-IMAGE-SPEC.md`): Anchor
 * v1, `figure` or `figure_region`, one PageSelector, ONE ShapeSelector with one quad, no quote.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { indexDocument, resolveAnchor, type PaperSource } from '@papertree/anchoring';

import {
  buildImageAnchor,
  floatCardBody,
  imageAlt,
  imageBoxOf,
  isImageAnchor,
  longLabel,
  pictureNameOf,
  shortLabel,
} from '@/lib/imageAnchor';

const REAL = `${process.cwd()}/test/fixtures`;
const doc = indexDocument(
  JSON.parse(readFileSync(`${REAL}/real-resnet-p1-2.ir.json`, 'utf8')) as PaperSource,
  'image-anchor-spec',
);
const FIGURE = doc.byId.get('blk_3pzzcn4luvb5qmpc');
const BOX: [number, number, number, number] = [309, 224, 545, 347];
const BASE = { doc, page: 0, box: BOX, id: 'a-1', at: '2026-11-20T10:00:00.000Z', client: 't' };

describe('buildImageAnchor', () => {
  it('a whole float: figure, its block, its page and one quad, and no quoted text', () => {
    if (FIGURE === undefined) throw new Error('fixture');
    const anchor = buildImageAnchor({ ...BASE, kind: 'figure', block: FIGURE });
    expect(anchor.anchorVersion).toBe(1);
    expect(anchor.targetKind).toBe('figure');
    expect(anchor.selectors.map((s) => s.type)).toEqual([
      'BlockSelector',
      'PageSelector',
      'ShapeSelector',
    ]);
    const shape = anchor.selectors.find((s) => s.type === 'ShapeSelector');
    expect(shape).toMatchObject({ pageIndex: 0, quads: [BOX] });
    const block = anchor.selectors.find((s) => s.type === 'BlockSelector');
    expect(block).toMatchObject({ blockId: FIGURE.id, blockTextHash: FIGURE.contentHash });
    expect(anchor.doc).toMatchObject({ paperId: doc.paperId, pdfSha256: doc.sourceHash });
    expect(isImageAnchor(anchor)).toBe(true);
  });

  it('a free region: figure_region, a page and one quad, no block', () => {
    const anchor = buildImageAnchor({ ...BASE, kind: 'figure_region' });
    expect(anchor.targetKind).toBe('figure_region');
    expect(anchor.selectors.map((s) => s.type)).toEqual(['PageSelector', 'ShapeSelector']);
    expect(imageBoxOf(anchor)).toEqual({ page: 0, box: BOX });
  });

  it('is painted from its stored quad and resolves through the ladder with no text', () => {
    const anchor = buildImageAnchor({ ...BASE, kind: 'figure_region' });
    const resolution = resolveAnchor(anchor, doc);
    expect(resolution.state).not.toBe('orphan');
  });
});

describe('isImageAnchor and imageBoxOf', () => {
  const region = buildImageAnchor({ ...BASE, kind: 'figure_region' });

  it('is false for a text anchor, a quoted figure anchor, and a rectangle with no area', () => {
    expect(isImageAnchor(null)).toBe(false);
    expect(isImageAnchor({ ...region, targetKind: 'text' })).toBe(false);
    const quoted = {
      ...region,
      selectors: [
        ...region.selectors,
        {
          type: 'TextQuoteSelector' as const,
          exact: 'x',
          prefix: '',
          suffix: '',
          exactNormalised: 'x',
          prefixNormalised: '',
          suffixNormalised: '',
        },
      ],
    };
    expect(isImageAnchor(quoted)).toBe(false);
    const flat = buildImageAnchor({ ...BASE, box: [10, 10, 10, 90], kind: 'figure_region' });
    expect(isImageAnchor(flat)).toBe(false);
  });
});

describe('labels and alt text', () => {
  it('reads "Fig. 4", "Figure 4", "Table 2" and "Algorithm 1" from a caption', () => {
    expect(shortLabel('Figure 4. Training error')).toBe('Fig. 4');
    expect(shortLabel('Fig. 7: a plot')).toBe('Fig. 7');
    expect(shortLabel('Table 2. Results')).toBe('Table 2');
    expect(longLabel('Algorithm 1 Beam search')).toBe('Algorithm 1');
    expect(longLabel('Figure 4. Training error')).toBe('Figure 4');
    expect(shortLabel('The curves show')).toBeNull();
    expect(shortLabel(null)).toBeNull();
  });

  it('alt text is the caption plus a short description, or the name when there is no caption', () => {
    expect(imageAlt('Figure 1', 'Figure 1. Training error.', 'The deeper net is worse.')).toBe(
      'Figure 1. Training error. The deeper net is worse.',
    );
    expect(imageAlt('Figure 1', 'Figure 1. Training error.')).toBe('Figure 1. Training error.');
    expect(imageAlt('Selected area', null, null)).toBe('Selected area');
  });
});

describe('what a picked picture is called', () => {
  const figure = buildImageAnchor({ ...BASE, kind: 'figure' });
  const area = buildImageAnchor({ ...BASE, kind: 'figure_region' });

  it('a figure is named by its number, or plain "Figure" without one; an area is a "Selected area"', () => {
    expect(pictureNameOf(figure, 'Figure 2. Residual learning')).toEqual({
      thing: 'figure',
      label: 'Figure 2',
    });
    expect(pictureNameOf(figure, '')).toEqual({ thing: 'figure', label: 'Figure' });
    expect(pictureNameOf(area, '')).toEqual({ thing: 'area', label: 'Selected area' });
    expect(pictureNameOf(null, 'x')).toBeNull();
  });

  it('a float with no caption stores its numbered name as the card body, so the card knows its figure', () => {
    expect(floatCardBody('Figure 2. Residual learning', 'Figure 2')).toBe(
      'Figure 2. Residual learning',
    );
    expect(floatCardBody(null, 'Figure 2')).toBe('Figure 2');
    expect(floatCardBody(null, 'Figure')).toBe('');
  });
});
