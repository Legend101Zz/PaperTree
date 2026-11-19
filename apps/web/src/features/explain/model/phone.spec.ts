import { describe, expect, it } from 'vitest';

import { buildExchanges } from './exchange';
import { clipAnswer, pinnedExchange } from './phone';
import { originOf } from './threads';
import { GOLDEN, goldenMessages } from '../../../../test/fixtures/attention-thread';

import type { AnswerModel, AnswerParagraph } from './answer';

const golden = buildExchanges(goldenMessages(), originOf(GOLDEN.thread))[0]?.model as AnswerModel;

function para(index: number): AnswerParagraph {
  return { index, text: `p${String(index)}`, sources: [] };
}

describe('clipAnswer: the first paragraph, then "Read the whole answer" (frame 08b)', () => {
  it('shows only the golden answer’s first paragraph until it is expanded', () => {
    expect(golden.paragraphs).toHaveLength(5);
    const clipped = clipAnswer(golden, false);
    expect(clipped.clipped).toBe(true);
    expect(clipped.paragraphs.map((p) => p.index)).toEqual([0]);
    expect(clipped.paragraphs[0]?.text).toMatch(/central proposal/);
    expect(clipAnswer(golden, true)).toEqual({ paragraphs: golden.paragraphs, clipped: false });
  });

  it('never clips an answer of one paragraph (there is nothing to read on)', () => {
    expect(clipAnswer({ paragraphs: [para(0)] }, false).clipped).toBe(false);
    expect(clipAnswer({ paragraphs: [] }, false).clipped).toBe(false);
  });

  it('while streaming, the paragraphs after the first arrive behind the button', () => {
    const live = { paragraphs: [para(0), para(1)] };
    expect(clipAnswer(live, false).paragraphs.map((p) => p.index)).toEqual([0]);
    expect(clipAnswer({ paragraphs: [para(0)] }, false).clipped).toBe(false);
  });
});

describe('pinnedExchange: whose usage and actions the phone pins', () => {
  it('pins the last exchange once its answer is complete', () => {
    expect(pinnedExchange(['complete', 'complete'])).toBe(1);
    expect(pinnedExchange(['complete'])).toBe(0);
  });

  it('pins nothing while the last answer streams, failed, or has not started', () => {
    expect(pinnedExchange(['complete', 'streaming'])).toBe(-1);
    expect(pinnedExchange(['complete', 'error'])).toBe(-1);
    expect(pinnedExchange(['complete', 'partial'])).toBe(-1);
    expect(pinnedExchange(['complete', null])).toBe(-1);
    expect(pinnedExchange([])).toBe(-1);
  });
});
