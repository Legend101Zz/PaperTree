/**
 * imageCard: what an image card says about itself, from its anchor and its caption (#348 item 5).
 */
import { describe, expect, it } from 'vitest';

import { buildImageAnchor } from '@/lib/imageAnchor';

import { describeFrom, imageCardOf } from './imageCard';
import { askAnchorFixture } from './imageFixtures';
import { whatTheAiWillRead } from './askPayload';
import { defaultUses } from './askPayload';
import { buildTree } from './tree';
import { node, resetClock } from './treeFixtures';

const CAPTION = 'Figure 4. Training on CIFAR-10. Dashed lines denote training error.';

describe('imageCardOf', () => {
  const anchor = askAnchorFixture(5);

  it('is "Fig. 4 · p. 6" with the caption, and the page it is cropped from', () => {
    const view = imageCardOf(anchor, CAPTION);
    expect(view?.source).toBe('Fig. 4 · p. 6');
    expect(view?.label).toBe('Figure 4');
    expect(view?.caption).toBe(CAPTION);
    expect(view?.at.page).toBe(5);
    expect(view?.at.box).toEqual([100, 120, 400, 300]);
  });

  it('alt text is the caption plus the first answer’s TL;DR', () => {
    const answer =
      '## TL;DR\nThe plain net gets worse as it gets deeper [b1].\n\n## How it works\nx';
    expect(imageCardOf(anchor, CAPTION, answer)?.alt).toBe(
      `${CAPTION} The plain net gets worse as it gets deeper.`,
    );
    expect(imageCardOf(anchor, CAPTION)?.alt).toBe(CAPTION);
  });

  it('a region has no caption: it is a selected area on its page, and its alt is that name', () => {
    const region = buildImageAnchor({
      doc: {
        pages: [],
        paperId: 'p',
        sourceHash: 'h',
        parserVersion: 'v',
        textStreamId: 't',
      } as never,
      page: 2,
      box: [10, 10, 100, 100],
      kind: 'figure_region',
      id: 'r',
      at: 'x',
      client: 't',
    });
    const view = imageCardOf(region, '');
    expect(view).toMatchObject({
      caption: null,
      label: 'Selected area',
      source: 'Selected area · p. 3',
    });
    expect(view?.alt).toBe('Selected area');
  });

  it('is null for a passage’s anchor and for none', () => {
    expect(imageCardOf(null, 'x')).toBeNull();
    expect(imageCardOf({ ...anchor, targetKind: 'text' }, 'x')).toBeNull();
  });
});

describe('describeFrom', () => {
  it('takes the TL;DR line, clipped, and nothing from nothing', () => {
    expect(describeFrom(null)).toBeNull();
    expect(describeFrom('')).toBeNull();
    expect(describeFrom(`## TL;DR\n${'word '.repeat(80)}`)?.endsWith('…')).toBe(true);
  });
});

describe('what the AI will read on an image root', () => {
  it('lists the picture itself and its caption, not a count of characters', () => {
    resetClock();
    const root = { ...node({ id: 'img', body: CAPTION }), source_anchor: askAnchorFixture(5) };
    const tree = buildTree([root]);
    const list = whatTheAiWillRead(tree, 'img', defaultUses());
    expect(list.items[0]).toMatchObject({ kind: 'passage', title: 'The picture' });
  });
});
