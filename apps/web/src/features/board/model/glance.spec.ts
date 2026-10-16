/**
 * #215: the board at scale — the low-zoom switch and its band, which boards render only what is in
 * view, the zoom the stylesheet is given, a card's glance, and when a memoised card draws again.
 */
import { describe, expect, it } from 'vitest';

import { toFlowNode, type PtNode } from './flow';
import {
  FULL_ABOVE,
  GLANCE_BELOW,
  BIG_BOARD,
  bigBoard,
  glanceAt,
  glanceOf,
  publishedZoom,
  sameCard,
} from './glance';
import { cardRow, citation } from './test-data';

import type { NodeProps } from '@xyflow/react';

describe('the low-zoom switch', () => {
  it('turns cards to glances below 45 %, back above 55 %, and keeps them as they were between', () => {
    expect([GLANCE_BELOW, FULL_ABOVE]).toEqual([0.45, 0.55]);
    expect(glanceAt(0.2, false)).toBe(true);
    expect(glanceAt(0.449, false)).toBe(true);
    expect(glanceAt(0.5, true)).toBe(true);
    expect(glanceAt(0.5, false)).toBe(false);
    expect(glanceAt(0.551, true)).toBe(false);
    expect(glanceAt(1, true)).toBe(false);
    // A wheel zoom that hovers across 50 % never flips the board back and forth.
    let glance = glanceAt(0.4, false);
    for (const zoom of [0.46, 0.5, 0.47, 0.54, 0.49]) glance = glanceAt(zoom, glance);
    expect(glance).toBe(true);
  });

  it('draws for scale from 150 cards on, and a smaller board never glances', () => {
    expect(BIG_BOARD).toBe(150);
    expect(bigBoard(149)).toBe(false);
    expect(bigBoard(150)).toBe(true);
    expect(bigBoard(500)).toBe(true);
    expect(glanceAt(0.2, false, false)).toBe(false);
    expect(glanceAt(0.2, true, false)).toBe(false);
    expect(glanceAt(0.2, false, true)).toBe(true);
  });

  it('gives the stylesheet the zoom in 0.05 steps, floored, inside 20–100 %', () => {
    expect(publishedZoom(0.1)).toBe(0.2);
    expect(publishedZoom(0.2)).toBe(0.2);
    expect(publishedZoom(0.237)).toBe(0.2);
    expect(publishedZoom(0.25)).toBe(0.25);
    expect(publishedZoom(0.89)).toBe(0.85);
    expect(publishedZoom(1)).toBe(1);
    expect(publishedZoom(1.8)).toBe(1);
  });
});

describe('a glance', () => {
  it('is the kind (a passage with its page) and the first words, in their voice', () => {
    const passage = cardRow('excerpt', {
      body: 'Deeper neural networks are more difficult to train.',
      source_anchor: citation('b1', 2, 1).anchor,
    });
    expect(glanceOf(passage)).toEqual({
      kind: 'Passage · p. 3',
      words: 'Deeper neural networks are more difficult to train.',
      voice: 'paper',
    });
    const answer = cardRow('explanation', { body: 'Residual learning eases training [b1, b6].' });
    expect(glanceOf(answer)).toEqual({
      kind: 'AI explanation',
      words: 'Residual learning eases training .',
      voice: 'ai',
    });
    expect(glanceOf(cardRow('note', { body: 'Next: read 3.2' }))).toMatchObject({
      kind: 'Note',
      voice: 'you',
    });
    expect(glanceOf(cardRow('notebook', { title: 'Central proposal' }))).toEqual({
      kind: 'Notebook page',
      words: 'Central proposal',
      voice: null,
    });
  });

  it('cuts long words at 90 characters', () => {
    const words = glanceOf(cardRow('note', { body: 'word '.repeat(40) })).words;
    expect(words.endsWith('…')).toBe(true);
    expect(words.length).toBeLessThanOrEqual(91);
  });
});

describe('when a memoised card draws again', () => {
  const node = toFlowNode(cardRow('note', { body: 'b' }), 'ppr_1');
  const props = (extra: Partial<NodeProps<PtNode>> = {}) =>
    ({
      ...node,
      selected: false,
      dragging: false,
      positionAbsoluteX: 0,
      ...extra,
    }) as NodeProps<PtNode>;

  it('not for a move of its own drag, nor for dragging; yes for its row or its selection', () => {
    const before = props();
    expect(sameCard(before, props({ positionAbsoluteX: 240, dragging: true }))).toBe(true);
    expect(sameCard(before, props({ selected: true }))).toBe(false);
    expect(sameCard(before, props({ data: { ...node.data } }))).toBe(false);
  });
});
