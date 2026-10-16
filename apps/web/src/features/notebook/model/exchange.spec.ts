/**
 * exchange.spec — the passage numbers of a dived page (#208). The answer, handles and locators are
 * the stored demo answer on "Attention Is All You Need" (thread thr_01M508X9PC9K9HKHSVB2J9W1A1):
 * it cites b1, b6, b7, b8, which are p. 1 ¶1, p. 2 ¶2, p. 2 ¶3, p. 2 ¶4 and are used 5, 1, 2 and 3
 * times; frame 05 draws exactly those numbers and counts.
 */
import { describe, expect, it } from 'vitest';

import {
  anchorQuote,
  handlesIn,
  layoutAnswer,
  modelLabel,
  originPlace,
  passageOfQuote,
  usageLine,
} from './exchange';

import type { Citation, RunSummary } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

function anchor(id: string, block: string, page: number, exact = 'words'): Anchor {
  return {
    id,
    selectors: [
      { type: 'BlockSelector', blockId: block, blockTextHash: 'sha256:x' },
      { type: 'PageSelector', index: page },
      { type: 'TextQuoteSelector', exact, prefix: '', suffix: '', exactNormalised: exact },
    ],
  } as unknown as Anchor;
}

function cite(
  marker: string,
  ordinal: number,
  block: string,
  page: number,
  para: number,
): Citation {
  return {
    citation_id: `cit_${marker}`,
    ordinal,
    marker,
    page_index: page,
    anchor: anchor(`a_${marker}`, block, page),
    supported: true,
    locator: {
      passage_key: `g1:${block}`,
      page_index: page,
      para_index: para,
      section_heading: null,
    },
  };
}

const CONTENT = [
  'The passage states the central proposal [b1].',
  'Encoder to decoder through attention [b1]. Batch sizes [b6]. Distance [b7], recurrent [b7].',
  'The whole model [b8]. Global dependencies [b8].',
  'Superior in quality [b1], 28.4 BLEU [b1]; twelve hours [b8]. Parsing [b1].',
  "This is my reading, not the paper's claim.",
].join('\n\n');

const MESSAGE = {
  content: CONTENT,
  generation: 1,
  citations: [
    cite('b1', 0, 'blk_a', 0, 1),
    cite('b6', 1, 'blk_b', 1, 2),
    cite('b7', 2, 'blk_c', 1, 3),
    cite('b8', 3, 'blk_d', 1, 4),
  ],
};

describe('layoutAnswer', () => {
  const layout = layoutAnswer(MESSAGE);

  it('numbers passages in order of first use, with frame 05 pages and counts', () => {
    expect(layout.passages.map((p) => [p.n, p.page, p.para, p.cited])).toEqual([
      [1, 1, 1, 5],
      [2, 2, 2, 1],
      [3, 2, 3, 2],
      [4, 2, 4, 3],
    ]);
    expect(Object.fromEntries(layout.numberOf)).toEqual({ b1: 1, b6: 2, b7: 3, b8: 4 });
  });

  it('splits paragraphs as the server does (blank lines, bare headings dropped)', () => {
    expect(layout.paragraphs).toHaveLength(5);
    expect(
      layoutAnswer({ ...MESSAGE, content: '# Title\n\nOne [b1].\n \nTwo.' }).paragraphs,
    ).toEqual(['One [b1].', 'Two.']);
  });

  it('numbers by first USE, not by ordinal, and keeps a never-mentioned citation last', () => {
    const swapped = layoutAnswer({ ...MESSAGE, content: 'First [b8]. Then [b1].' });
    expect(swapped.numberOf.get('b8')).toBe(1);
    expect(swapped.numberOf.get('b1')).toBe(2);
    expect(swapped.passages.map((p) => p.cited)).toEqual([1, 1, 0, 0]);
  });

  it('merges two handles on one block into one passage', () => {
    const twin = { ...cite('b9', 4, 'blk_a', 0, 1) };
    const merged = layoutAnswer({
      ...MESSAGE,
      citations: [...MESSAGE.citations, twin],
      content: 'A [b1]. B [b9].',
    });
    expect(merged.numberOf.get('b9')).toBe(1);
    expect(merged.passages[0]?.cited).toBe(2);
  });

  it('finds a quote card by the Anchor Dive in copied, else by its block', () => {
    expect(passageOfQuote(layout, anchor('a_b7', 'blk_c', 1))?.n).toBe(3);
    expect(passageOfQuote(layout, anchor('other', 'blk_d', 1))?.n).toBe(4);
    expect(passageOfQuote(layout, anchor('other', 'blk_zzz', 1))).toBeNull();
  });
});

describe('the exchange labels', () => {
  it('places the question on its page, with the paragraph of a passage on the same block', () => {
    const layout = layoutAnswer(MESSAGE);
    expect(originPlace(anchor('o', 'blk_a', 0), layout)).toEqual({ page: 1, para: 1 });
    expect(originPlace(anchor('o', 'blk_x', 3), layout)).toEqual({ page: 4, para: null });
    expect(originPlace(anchor('o', 'blk_a', 0), null)).toEqual({ page: 1, para: null });
  });

  it('collapses the quoted words and reads every handle', () => {
    expect(anchorQuote(anchor('o', 'b', 0, 'We propose\na new  model.'))).toBe(
      'We propose a new model.',
    );
    expect(handlesIn('x [b1, b8] y [b6]')).toEqual(['b1', 'b8', 'b6']);
  });

  it('always ends a usage line with "(estimate)" and drops a run that used nothing', () => {
    const run = { input_tokens: 6000, output_tokens: 776, cost_usd_est: 0.0027 } as RunSummary;
    expect(usageLine(run)).toBe('6,776 tokens · ≈ $0.0027 (estimate)');
    expect(usageLine({ ...run, cost_usd_est: null })).toBe('6,776 tokens (estimate)');
    expect(usageLine({ ...run, input_tokens: 0, output_tokens: 0 })).toBeNull();
  });

  it('shortens the model id for the slip', () => {
    expect(modelLabel('MiniMax-M3.1-Flash-Preview')).toBe('M3.1 Flash');
    expect(modelLabel(null)).toBe('the AI');
  });
});
