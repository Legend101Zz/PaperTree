import { describe, expect, it } from 'vitest';

import { cardBoxes, frameBoxes, frameFor, regroup, regroupAround } from './frames';
import { toFlowNode } from './flow';
import { cardRow } from './test-data';

const frame = (id: string, x: number, y: number, w: number, h: number) => ({ id, x, y, w, h });
const card = (id: string, x: number, y: number, groupId: string | null = null) => ({
  id,
  groupId,
  x,
  y,
  w: 200,
  h: 100,
});

const BIG = frame('big', 0, 0, 1000, 800);
const SMALL = frame('small', 100, 100, 400, 300);

describe('frameFor: the frame a card is in (#214)', () => {
  it('is the smallest frame that holds the card’s centre', () => {
    expect(frameFor(card('a', 150, 150), [BIG, SMALL])).toBe('small');
    expect(frameFor(card('a', 600, 500), [BIG, SMALL])).toBe('big');
    expect(frameFor(card('a', 2000, 0), [BIG, SMALL])).toBeNull();
  });

  it('keeps a card in its own frame while that frame still holds it (no hopping when carried)', () => {
    expect(frameFor(card('a', 150, 150, 'big'), [BIG, SMALL])).toBe('big');
  });

  it('counts the centre, not the corner: a card half out is in while its middle is in', () => {
    expect(frameFor(card('a', -90, 10), [BIG])).toBe('big'); // centre x = 10
    expect(frameFor(card('a', -110, 10), [BIG])).toBeNull(); // centre x = -10
  });
});

describe('regroup: who joins, leaves or swaps after a move', () => {
  it('names only the cards whose frame changes', () => {
    const moved = [
      card('in', 150, 150),
      card('out', 2000, 0, 'big'),
      card('same', 600, 500, 'big'),
    ];
    expect(regroup(moved, [BIG, SMALL])).toEqual([
      { id: 'in', groupId: 'small' },
      { id: 'out', groupId: null },
    ]);
  });

  it('with no frames on the board, nothing changes for a card in none', () => {
    expect(regroup([card('a', 0, 0)], [])).toEqual([]);
  });
});

describe('regroupAround: a resized frame', () => {
  it('takes in the cards it now holds and lets go of its members it no longer holds', () => {
    const grown = frame('f', 0, 0, 900, 300);
    const cards = [card('member', 40, 40, 'f'), card('beside', 600, 40), card('far', 0, 900)];
    expect(regroupAround('f', cards, [grown])).toEqual([{ id: 'beside', groupId: 'f' }]);
    const shrunk = frame('f', 0, 0, 100, 100);
    expect(regroupAround('f', cards, [shrunk])).toEqual([{ id: 'member', groupId: null }]);
  });

  it('leaves cards of other frames alone, and an empty frame stays empty', () => {
    const other = frame('other', 0, 0, 300, 300);
    const resized = frame('f', 2000, 2000, 400, 300); // empty: nothing lies inside it
    const cards = [card('a', 40, 40), card('b', 40, 40, 'other')];
    expect(regroupAround('f', cards, [other, resized])).toEqual([]);
  });
});

describe('frameBoxes and cardBoxes: from the board’s nodes', () => {
  it('splits frames from cards and keeps each card’s frame', () => {
    const nodes = [
      toFlowNode(cardRow('group', { node_id: 'g', x: 0, y: 0, w: 400, h: 300 }), 'p'),
      toFlowNode(cardRow('note', { node_id: 'n', x: 10, y: 20, group_id: 'g' }), 'p'),
    ];
    expect(frameBoxes(nodes)).toEqual([{ id: 'g', x: 0, y: 0, w: 400, h: 300 }]);
    expect(cardBoxes(nodes)).toMatchObject([{ id: 'n', x: 10, y: 20, groupId: 'g' }]);
  });
});
