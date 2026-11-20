/**
 * createBody: the first request of a thread. An image thread's anchor is the picture's, its
 * question is left to the server when none was typed, and the words selected with the picture go as
 * `with_text_anchor`; the other two kinds are unchanged.
 */
import { describe, expect, it } from 'vitest';

import { createBodyFor } from './createBody';

import type { Anchor } from '@papertree/anchoring';
import type { ExplainRequest } from './state';

const IMAGE = { id: 'img' } as unknown as Anchor;
const TEXT = { id: 'txt' } as unknown as Anchor;

describe('createBodyFor', () => {
  it('a figure: kind image, its anchor, the level, and no question when none was typed', () => {
    const request: ExplainRequest = {
      anchor: IMAGE,
      quote: '',
      image: { label: 'Figure 2', caption: 'Figure 2. A block.' },
    };
    expect(createBodyFor(request, undefined, 'familiar')).toEqual({
      kind: 'image',
      anchor: IMAGE,
      level: 'familiar',
    });
  });

  it('a typed question rides with it', () => {
    const request: ExplainRequest = {
      anchor: IMAGE,
      quote: '',
      image: { label: 'x', caption: null },
    };
    expect(createBodyFor(request, 'Why is the deeper net worse?', 'new')).toEqual({
      kind: 'image',
      anchor: IMAGE,
      question: 'Why is the deeper net worse?',
      level: 'new',
    });
  });

  it('a figure with a paragraph selected beside it sends with_text_anchor', () => {
    const request: ExplainRequest = {
      anchor: IMAGE,
      quote: 'the paragraph',
      image: {
        label: 'Figure 2',
        caption: null,
        withText: { anchor: TEXT, quote: 'the paragraph' },
      },
    };
    expect(createBodyFor(request, undefined, 'familiar')).toEqual({
      kind: 'image',
      anchor: IMAGE,
      level: 'familiar',
      with_text_anchor: TEXT,
    });
  });

  it('a passage is an explain, and no passage is a free ask', () => {
    expect(createBodyFor({ anchor: TEXT, quote: 'q' }, undefined, 'familiar')).toEqual({
      kind: 'explain',
      anchor: TEXT,
      level: 'familiar',
    });
    expect(createBodyFor(null, 'Why?', 'familiar')).toEqual({
      kind: 'ask',
      question: 'Why?',
      level: 'familiar',
    });
  });
});
