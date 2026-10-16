import { describe, expect, it } from 'vitest';

import {
  anchorPageIndex,
  countsLine,
  coverageLine,
  explanationSource,
  miniature,
  usageLine,
} from './cards';
import { THREAD, citation } from './test-data';

describe('the page tab comes from the stored anchor', () => {
  it('reads the PageSelector first, the ShapeSelector second, and nothing else', () => {
    const anchor = citation('b6', 1, 2).anchor;
    expect(anchorPageIndex(anchor)).toBe(1);
    const shapeOnly = {
      ...anchor,
      selectors: [{ type: 'ShapeSelector', pageIndex: 4 }],
    } as unknown as typeof anchor;
    expect(anchorPageIndex(shapeOnly)).toBe(4);
    expect(anchorPageIndex({ ...anchor, selectors: [] })).toBeNull();
    expect(anchorPageIndex(null)).toBeNull();
  });
});

describe('a notebook card counts from `counts`', () => {
  const zero = { quotes: 0, stickies: 0, text: 0, shapes: 0, strokes: 0 };
  it('names the non-zero parts in page order', () => {
    expect(countsLine({ ...zero, quotes: 4, stickies: 1 })).toBe('4 quotes · 1 sticky');
    expect(countsLine({ ...zero, quotes: 1, text: 2, strokes: 12 })).toBe(
      '1 quote · 2 typed notes · 12 ink strokes',
    );
  });
  it('says an empty page is empty, and invents nothing without counts', () => {
    expect(countsLine(zero)).toBe('Empty page');
    expect(countsLine(null)).toBeNull();
  });
});

describe('the explanation footer is the stored message, never made up', () => {
  const [, answer] = THREAD;
  it('prints the coverage the API computed', () => {
    expect(coverageLine(answer!.coverage ?? null)).toBe('4 passages · 11 citations');
    expect(coverageLine(null)).toBeNull();
  });
  it('prints usage as an estimate, always', () => {
    expect(usageLine(answer!.run)).toBe('6,776 tokens · ≈ $0.0027 (estimate)');
    expect(
      usageLine({ ...answer!.run!, cost_usd_est: null, input_tokens: 1, output_tokens: 0 }),
    ).toBe('1 token (estimate)');
    expect(
      usageLine({ ...answer!.run!, cost_usd_est: null, input_tokens: null, output_tokens: null }),
    ).toBeNull();
    expect(usageLine(null)).toBeNull();
  });
});

describe('explanationSource', () => {
  it('numbers passages thread-wide, so the second answer’s first passage is 2', () => {
    const second = explanationSource(THREAD, 'msg_a2')!;
    expect(second.numbers.get('g1:blk_b1')).toBe(1);
    expect(second.numbers.get('g1:blk_b6')).toBe(2);
    expect(second.numbers.get('g1:blk_b7')).toBe(3);
    expect(second.numbers.get('g1:blk_b8')).toBe(4);
    expect(second.citations.map((c) => c.marker)).toEqual(['b6', 'b1']);
  });
  it('takes the ask just before the answer as the call slip', () => {
    expect(explanationSource(THREAD, 'msg_a1')!.question).toBe('Explain this passage.');
    expect(explanationSource(THREAD, 'msg_a2')!.question).toBe(
      'Why does dropping recurrence make training faster?',
    );
  });
  it('carries the coverage and run, and is null for a message the thread does not hold', () => {
    const first = explanationSource(THREAD, 'msg_a1')!;
    expect(first.coverage?.citations).toBe(11);
    expect(first.run?.input_tokens).toBe(6286);
    expect(explanationSource(THREAD, 'msg_gone')).toBeNull();
  });
});

describe('miniature', () => {
  it('scales page units (960 wide) into the card and drops what falls below it', () => {
    const boxes = miniature(
      [
        { item_id: 'b', kind: 'sticky', x: 760, y: 360, w: 140, h: 140, z: 2 },
        { item_id: 'a', kind: 'exchange', x: 48, y: 48, w: 864, h: 300, z: 0 },
        { item_id: 'c', kind: 'quote', x: 48, y: 2000, w: 400, h: 80, z: 1 },
      ],
      200,
      96,
    );
    expect(boxes.map((b) => b.id)).toEqual(['a', 'b']);
    expect(boxes[0]).toMatchObject({ left: 10, top: 10, width: 180, height: 62.5 });
  });
});
