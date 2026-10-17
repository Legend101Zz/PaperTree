/** lasso.spec — what the lasso picked up, what each menu action needs, and its commands (#209). */
import { describe, expect, it } from 'vitest';

import { execute, createHistory, undo } from './history';
import {
  deleteCommand,
  enabledActions,
  lassoText,
  loopPath,
  picked,
  shown,
  stickyCommand,
} from './lasso';
import { askHref } from './links';
import { stroke } from './test-helpers';

import type { NotebookState } from './history';
import type { Item } from './page';
import type { Anchor } from '@papertree/anchoring';

const box = { w: 100, h: 40, z: 1 };
const note = (id: string, y: number, text: string): Item => ({
  kind: 'text',
  id,
  x: 0,
  y,
  ...box,
  text,
});
const STATE: NotebookState = {
  strokes: [stroke('s1', [[5, 5]])],
  items: [
    { kind: 'exchange', id: 'ex', exchangeId: 'ex', x: 0, y: 0, ...box },
    { kind: 'quote', id: 'q1', x: 0, y: 50, ...box, text: 'paper', anchor: {} as Anchor },
    note('n2', 200, 'second'),
    note('n1', 100, ' first '),
    { kind: 'sticky', id: 'st', x: 0, y: 300, ...box, text: 'sticky words', color: 'sticky' },
    { kind: 'shape', id: 'sh', x: 0, y: 400, ...box, shape: 'rect' },
  ],
};
const all = { strokeIds: ['s1'], itemIds: ['ex', 'q1', 'n2', 'n1', 'st', 'sh'] };

describe('picked', () => {
  it('takes the typed words in reading order, and never the exchange or a quote card', () => {
    const p = picked(STATE, all);
    expect(p.typed.map((i) => i.id)).toEqual(['n1', 'n2', 'st']);
    expect(p.deletable).toEqual(['n2', 'n1', 'st', 'sh']);
    expect(p.count).toBe(7);
    expect(lassoText(p.typed)).toBe('first\n\nsecond\n\nsticky words');
  });
});

describe('what each action needs', () => {
  it('offers everything for typed notes', () => {
    expect(enabledActions(picked(STATE, all))).toEqual({
      ask: true,
      sticky: true,
      board: true,
      copy: true,
      delete: true,
    });
  });

  it('offers only Delete for ink alone: handwriting is not read, sent or copied', () => {
    expect(enabledActions(picked(STATE, { strokeIds: ['s1'], itemIds: [] }))).toEqual({
      ask: false,
      sticky: false,
      board: false,
      copy: false,
      delete: true,
    });
  });

  it('offers nothing for the trace alone: the exchange and its quote cards stay', () => {
    const p = picked(STATE, { strokeIds: [], itemIds: ['ex', 'q1'] });
    expect(Object.values(enabledActions(p)).some(Boolean)).toBe(false);
  });

  it('makes a sticky from a typed note only, not from a sticky', () => {
    const p = picked(STATE, { strokeIds: [], itemIds: ['st'] });
    expect(enabledActions(p)).toMatchObject({ ask: true, sticky: false, copy: true });
  });
});

describe('the commands', () => {
  const step = { state: STATE, history: createHistory() };

  it('Make sticky takes the notes away and puts one sticky with their words in the first’s place', () => {
    const cmd = stickyCommand(STATE, picked(STATE, all), 'ni_new00001');
    const after = execute(step, cmd!);
    expect(after.state.items.map((i) => i.id)).toEqual(['ex', 'q1', 'st', 'sh', 'ni_new00001']);
    expect(after.state.items.at(-1)).toMatchObject({
      kind: 'sticky',
      x: 0,
      y: 100,
      text: 'first\n\nsecond',
    });
    expect(undo(after).state).toEqual(STATE);
  });

  it('Delete takes strokes and the person’s items as one undo step', () => {
    const after = execute(step, deleteCommand(STATE, picked(STATE, all))!);
    expect(after.state.strokes).toEqual([]);
    expect(after.state.items.map((i) => i.id)).toEqual(['ex', 'q1']);
    expect(after.history.past).toHaveLength(1);
    expect(undo(after).state).toEqual(STATE);
  });

  it('returns no command when there is nothing to do', () => {
    const none = picked(STATE, { strokeIds: [], itemIds: ['q1'] });
    expect(stickyCommand(STATE, none, 'x')).toBeNull();
    expect(deleteCommand(STATE, none)).toBeNull();
  });
});

describe('the page as shown', () => {
  it('moves what is below the open answer down, so a loop drawn on screen finds it', () => {
    const s = shown(STATE, { boundary: 150, extra: 60 });
    expect(s.items.find((i) => i.id === 'n1')?.y).toBe(100);
    expect(s.items.find((i) => i.id === 'n2')?.y).toBe(260);
    expect(shown(STATE, null)).toBe(STATE);
    expect(shown(STATE, { boundary: 0, extra: 0 })).toBe(STATE);
  });
});

describe('links and paths', () => {
  it('sends Ask about this to the reader with the hand-off’s key, or the words only as a fallback', () => {
    expect(askHref('ppr_1', { key: 'ak_1' })).toBe('/paper/ppr_1/read?ask=ak_1');
    expect(askHref('ppr_1', { text: 'how?' })).toBe('/paper/ppr_1/read?ask_text=how%3F');
  });

  it('closes the loop', () => {
    expect(
      loopPath([
        [0, 0],
        [10, 0],
        [5, 8],
      ]),
    ).toBe('M0.0,0.0 L10.0,0.0 L5.0,8.0 Z');
  });
});
