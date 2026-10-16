import { describe, expect, it } from 'vitest';

import { toFlowNode } from './flow';
import {
  ROW_BAND,
  inPinsFor,
  linkTargets,
  nearestTarget,
  inReadingOrder,
  stepTarget,
} from './keyboardLink';
import { cardRow } from './test-data';

import type { CanvasNode } from '@/lib/api/types';

const card = (id: string, kind: CanvasNode['kind'], x: number, y: number) =>
  toFlowNode(cardRow(kind, { node_id: id, x, y, w: 200, h: 120 }), 'ppr_1');

// Frame 06's layout, roughly: two rows of cards, a frame, and a question card.
const BOARD = [
  card('e1', 'explanation', 436, 56),
  card('p1', 'excerpt', 72, 72),
  card('nb', 'notebook', 820, 60),
  card('p2', 'excerpt', 72, 276),
  card('q', 'question', 1120, 380),
  card('rnn', 'note', 820, 392),
  card('dg', 'diagram', 1032, 562),
  card('fr', 'group', 40, 40),
];

describe('the pins a keyboard thread can land on', () => {
  it('are every in-pin of the card, the pin of the same shape first', () => {
    expect(inPinsFor('answer_out', 'question')).toEqual(['question_in', 'evidence_in']);
    expect(inPinsFor('answer_out', 'explanation')).toEqual(['question_in', 'evidence_in']);
    expect(inPinsFor('claim_out', 'question')).toEqual(['evidence_in', 'question_in']);
    expect(inPinsFor('answer_out', 'excerpt')).toEqual(['evidence_in']);
    expect(inPinsFor('claim_out', 'group')).toEqual([]);
  });
});

describe('the cards a keyboard thread walks', () => {
  it('are in reading order: rows of card tops top to bottom, then left to right', () => {
    const order = inReadingOrder(BOARD).map((n) => n.id);
    expect(order).toEqual(['fr', 'p1', 'e1', 'nb', 'p2', 'rnn', 'q', 'dg']);
    // A card less than one band below the row's highest card reads in that row, by x.
    const row = [card('a', 'note', 500, 0), card('b', 'note', 100, ROW_BAND - 1)];
    expect(inReadingOrder(row).map((n) => n.id)).toEqual(['b', 'a']);
    const two = [card('a', 'note', 500, 0), card('b', 'note', 100, ROW_BAND)];
    expect(inReadingOrder(two).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('never include the source card or a frame, and visit a card once per pin it can land on', () => {
    const targets = linkTargets(BOARD, { nodeId: 'rnn', kind: 'note', port: 'claim_out' });
    expect(targets).toEqual([
      { id: 'p1', toPort: 'evidence_in' },
      { id: 'e1', toPort: 'evidence_in' },
      { id: 'e1', toPort: 'question_in' },
      { id: 'nb', toPort: 'evidence_in' },
      { id: 'p2', toPort: 'evidence_in' },
      // a claim can reach the question card's "question in" by keyboard too (S6b's pin choice)
      { id: 'q', toPort: 'evidence_in' },
      { id: 'q', toPort: 'question_in' },
      { id: 'dg', toPort: 'evidence_in' },
    ]);
    // A question card has no brass pin, so nothing can start from it (the hook says so).
    expect(linkTargets(BOARD, { nodeId: 'q', kind: 'question', port: 'claim_out' })).toEqual([]);
    const answers = linkTargets(BOARD, { nodeId: 'e1', kind: 'explanation', port: 'answer_out' });
    expect(answers.filter((t) => t.id === 'q').map((t) => t.toPort)).toEqual([
      'question_in',
      'evidence_in',
    ]);
  });

  it('start at the card nearest the source (centre to centre)', () => {
    const targets = linkTargets(BOARD, { nodeId: 'rnn', kind: 'note', port: 'claim_out' });
    expect(targets[nearestTarget(BOARD, targets, 'rnn')]!.id).toBe('dg'); // 272 px, the question 300
    const fromP2 = linkTargets(BOARD, { nodeId: 'p2', kind: 'excerpt', port: 'claim_out' });
    expect(fromP2[nearestTarget(BOARD, fromP2, 'p2')]!.id).toBe('p1');
    expect(nearestTarget(BOARD, [], 'p2')).toBe(-1);
  });
});

describe('the keys that move the highlight', () => {
  it('Tab, → and ↓ step forward; Shift+Tab, ← and ↑ step back; both wrap', () => {
    expect(stepTarget(0, 3, 'Tab', false)).toBe(1);
    expect(stepTarget(2, 3, 'ArrowRight', false)).toBe(0);
    expect(stepTarget(1, 3, 'ArrowDown', false)).toBe(2);
    expect(stepTarget(0, 3, 'Tab', true)).toBe(2);
    expect(stepTarget(0, 3, 'ArrowLeft', false)).toBe(2);
    expect(stepTarget(2, 3, 'ArrowUp', false)).toBe(1);
  });

  it('leave every other key alone', () => {
    for (const key of ['Enter', 'Escape', 'l', ' ', 'Shift'])
      expect(stepTarget(0, 3, key, false)).toBeNull();
    expect(stepTarget(0, 0, 'Tab', false)).toBeNull();
  });
});
