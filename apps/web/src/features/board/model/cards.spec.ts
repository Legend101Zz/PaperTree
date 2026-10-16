import { describe, expect, it } from 'vitest';

import { anchorPageIndex, countsLine, coverageLine, explanationSource, miniature } from './cards';
import { cardName, nodeLabel, toFlowNode, withPageTitles } from './flow';
import { THREAD, cardRow, citation } from './test-data';

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
  it('prints the coverage the API computed', () => {
    expect(coverageLine(THREAD[1]!.coverage ?? null)).toBe('4 passages · 11 citations');
    expect(coverageLine(null)).toBeNull();
  });
});

describe('explanationSource', () => {
  it('numbers passages as the explain panel does: thread-wide, the follow-up’s b6 stays 2', () => {
    const second = explanationSource('thr_1', THREAD, 'msg_a2')!;
    expect(second.threadId).toBe('thr_1');
    for (const [key, n] of [
      ['g1:blk_b1', 1],
      ['g1:blk_b6', 2],
      ['g1:blk_b7', 3],
      ['g1:blk_b8', 4],
    ] as const)
      expect(second.numbers.byKey.get(key)).toBe(n);
    expect(second.answer.citations.map((c) => c.marker)).toEqual(['b6', 'b1']);
  });
  it('takes the ask just before the answer as the call slip', () => {
    expect(explanationSource('thr_1', THREAD, 'msg_a1')!.question).toBe('Explain this passage.');
    expect(explanationSource('thr_1', THREAD, 'msg_a2')!.question).toBe(
      'Why does dropping recurrence make training faster?',
    );
  });
  it('carries the coverage and run, and is null for a message the thread does not hold', () => {
    const first = explanationSource('thr_1', THREAD, 'msg_a1')!;
    expect(first.answer.coverage?.citations).toBe(11);
    expect(first.run?.input_tokens).toBe(6286);
    expect(explanationSource('thr_1', THREAD, 'msg_gone')).toBeNull();
  });
});

describe('card names', () => {
  it('names each kind and its first words, for the card and for a sentence', () => {
    expect(nodeLabel(cardRow('question', { body: 'Why faster?' }))).toBe('Question: Why faster?');
    expect(nodeLabel(cardRow('diagram', { title: 'Scaled dot-product' }))).toBe(
      'Diagram: Scaled dot-product',
    );
    expect(nodeLabel(cardRow('notebook'))).toBe('Notebook page');
    expect(cardName(cardRow('question'))).toBe('a question');
    expect(cardName(cardRow('diagram'))).toBe('a diagram');
  });
  it('names a notebook card by its page title once the page is read', () => {
    const nodes = [
      toFlowNode(cardRow('notebook', { node_id: 'n1', source_page_id: 'pg1' }), 'p'),
      toFlowNode(cardRow('note', { node_id: 'n2', body: 'x' }), 'p'),
    ];
    expect(withPageTitles(nodes, () => undefined)).toBe(nodes);
    const named = withPageTitles(nodes, (id) => (id === 'pg1' ? 'Dive in: attention' : undefined));
    expect(named.map((n) => n.ariaLabel)).toEqual(['Notebook page: Dive in: attention', 'Note: x']);
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
