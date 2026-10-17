import { describe, expect, it } from 'vitest';

import { buildExchanges } from './exchange';
import { clipAnswer, pinnedExchange, runSides } from './phone';
import { originOf } from './threads';
import { GOLDEN, goldenMessages } from '../../../../test/fixtures/attention-thread';

import type { AnswerModel, AnswerParagraph } from './answer';

const golden = buildExchanges(goldenMessages(), originOf(GOLDEN.thread))[0]?.model as AnswerModel;

function para(index: number, cited = true): AnswerParagraph {
  return { index, text: `p${String(index)}`, markers: [], cited };
}

describe('clipAnswer: the first paragraph, then "Read the whole answer" (frame 08b)', () => {
  it('shows only the golden answer’s first paragraph until it is expanded', () => {
    expect(golden.body).toHaveLength(4);
    expect(golden.uncited).toHaveLength(1);
    const clipped = clipAnswer(golden, false);
    expect(clipped.clipped).toBe(true);
    expect(clipped.body.map((p) => p.index)).toEqual([0]);
    expect(clipped.body[0]?.text).toMatch(/central proposal/);
    expect(clipped.uncited).toEqual([]);
    expect(clipAnswer(golden, true)).toEqual({
      body: golden.body,
      uncited: golden.uncited,
      clipped: false,
    });
  });

  it('never clips an answer of one paragraph (there is nothing to read on)', () => {
    expect(clipAnswer({ body: [para(0)], uncited: [] }, false).clipped).toBe(false);
    expect(clipAnswer({ body: [], uncited: [para(0, false)] }, false).clipped).toBe(false);
    expect(clipAnswer({ body: [], uncited: [] }, false).clipped).toBe(false);
  });

  it('keeps the first paragraph whichever voice it is in', () => {
    // An uncited first paragraph inside the body stays first (under its "own reading" label).
    const mixed = clipAnswer({ body: [para(0, false), para(1)], uncited: [] }, false);
    expect(mixed.body.map((p) => p.index)).toEqual([0]);
    // No cited paragraph at all: the first of the AI's own reading.
    const own = clipAnswer({ body: [], uncited: [para(0, false), para(1, false)] }, false);
    expect(own).toMatchObject({ body: [], clipped: true });
    expect(own.uncited.map((p) => p.index)).toEqual([0]);
  });

  it('while streaming, the paragraphs after the first arrive behind the button', () => {
    const live = { body: [para(0), para(1)], uncited: [] };
    expect(clipAnswer(live, false).body.map((p) => p.index)).toEqual([0]);
    expect(clipAnswer({ body: [para(0)], uncited: [] }, false).clipped).toBe(false);
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

describe('runSides: where a marker in a run stops its tap area', () => {
  it('marks each neighbour of a run, and nothing for a marker on its own', () => {
    expect([0, 1].map((i) => runSides(i, 2))).toEqual(['next', 'prev']);
    expect([0, 1, 2].map((i) => runSides(i, 3))).toEqual(['next', 'prev next', 'prev']);
    expect(runSides(0, 1)).toBeNull();
  });
});
