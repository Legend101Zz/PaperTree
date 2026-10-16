import { describe, expect, it } from 'vitest';

import {
  createHistory,
  HistoryError,
  execute,
  redo,
  removalCommands,
  undo,
  type NotebookState,
  type Step,
} from './history';
import { stroke, sticky } from './test-helpers';

const s1 = stroke('s1', [
  [0, 0],
  [1, 1],
]);
const s2 = stroke('s2', [
  [5, 5],
  [6, 6],
]);
const s3 = stroke('s3', [
  [9, 9],
  [9, 10],
]);
const empty: NotebookState = { strokes: [], items: [] };
const begin = (cap?: number): Step => ({ state: empty, history: createHistory(cap) });

describe('history', () => {
  it('undoes and redoes adds', () => {
    let s = execute(begin(), { type: 'add-strokes', strokes: [s1] });
    s = execute(s, { type: 'add-items', items: [sticky('i1', 0, 0)] });
    s = undo(s);
    expect(s.state.items).toEqual([]);
    expect(s.state.strokes).toEqual([s1]);
    s = undo(s);
    expect(s.state).toEqual(empty);
    s = redo(redo(s));
    expect(s.state.strokes).toEqual([s1]);
    expect(s.state.items).toHaveLength(1);
  });

  it('restores removed strokes at their original paint position', () => {
    let s = execute(begin(), { type: 'add-strokes', strokes: [s1, s2, s3] });
    for (const c of removalCommands(s.state, ['s1', 's3'], [])) s = execute(s, c);
    expect(s.state.strokes.map((x) => x.id)).toEqual(['s2']);
    s = undo(s);
    expect(s.state.strokes.map((x) => x.id)).toEqual(['s1', 's2', 's3']);
  });

  it('moves strokes and items together and reverses exactly', () => {
    let s = execute(begin(), { type: 'add-strokes', strokes: [s1] });
    s = execute(s, { type: 'add-items', items: [sticky('i1', 10, 10)] });
    s = execute(s, { type: 'move', strokeIds: ['s1'], itemIds: ['i1'], dx: 5, dy: -3 });
    expect(s.state.strokes[0]!.points[1]).toEqual([6, -2, 0.5]);
    expect(s.state.items[0]).toMatchObject({ x: 15, y: 7 });
    s = undo(s);
    expect(s.state.strokes[0]!.points[1]).toEqual([1, 1, 0.5]);
    expect(s.state.items[0]).toMatchObject({ x: 10, y: 10 });
  });

  it('edits text and undoes it', () => {
    let s = execute(begin(), { type: 'add-items', items: [sticky('i1', 0, 0)] });
    s = execute(s, { type: 'edit-text', itemId: 'i1', before: 'i1', after: 'new words' });
    expect(s.state.items[0]).toMatchObject({ text: 'new words' });
    expect(undo(s).state.items[0]).toMatchObject({ text: 'i1' });
  });

  it('drops the redo stack when a new command follows an undo', () => {
    let s = execute(begin(), { type: 'add-strokes', strokes: [s1] });
    s = undo(s);
    expect(s.history.future).toHaveLength(1);
    s = execute(s, { type: 'add-strokes', strokes: [s2] });
    expect(s.history.future).toHaveLength(0);
    expect(redo(s)).toBe(s);
    expect(s.state.strokes).toEqual([s2]);
  });

  it('caps the stack, forgetting the oldest, and no-ops at the ends', () => {
    let s = begin(2);
    for (const st of [s1, s2, s3]) s = execute(s, { type: 'add-strokes', strokes: [st] });
    expect(s.history.past).toHaveLength(2);
    s = undo(undo(s));
    expect(s.state.strokes.map((x) => x.id)).toEqual(['s1']); // the first add is beyond the cap
    expect(undo(s)).toBe(s);
  });

  it('does not mutate the previous state', () => {
    const before = execute(begin(), { type: 'add-strokes', strokes: [s1] });
    execute(before, { type: 'move', strokeIds: ['s1'], itemIds: [], dx: 9, dy: 9 });
    expect(before.state.strokes[0]!.points[0]).toEqual([0, 0, 0.5]);
  });

  it('rejects a cap that would silently mean unlimited or nothing', () => {
    for (const bad of [0, -1, NaN, 1.5, Infinity])
      expect(() => createHistory(bad)).toThrow(HistoryError);
    expect(createHistory(1).cap).toBe(1);
  });

  it('refuses to add an id already on the page, so undo cannot remove two', () => {
    const s = execute(begin(), { type: 'add-strokes', strokes: [s1] });
    expect(() => execute(s, { type: 'add-strokes', strokes: [s1] })).toThrow(HistoryError);
    expect(() => execute(s, { type: 'add-strokes', strokes: [s2, s2] })).toThrow(HistoryError);
    const i = execute(begin(), { type: 'add-items', items: [sticky('i1', 0, 0)] });
    expect(() => execute(i, { type: 'add-items', items: [sticky('i1', 5, 5)] })).toThrow(
      HistoryError,
    );
    expect(s.state.strokes).toHaveLength(1);
  });

  it('records no command for a no-op', () => {
    let s = execute(begin(), { type: 'add-strokes', strokes: [s1] });
    s = execute(s, { type: 'add-items', items: [sticky('i1', 0, 0)] });
    const n = s.history.past.length;
    const noops = [
      { type: 'move', strokeIds: ['s1'], itemIds: [], dx: 0, dy: 0 },
      { type: 'move', strokeIds: [], itemIds: [], dx: 4, dy: 4 },
      { type: 'move', strokeIds: ['nope'], itemIds: [], dx: 4, dy: 4 },
      { type: 'edit-text', itemId: 'i1', before: 'a', after: 'a' },
      { type: 'edit-text', itemId: 'missing', before: 'a', after: 'b' },
      { type: 'add-strokes', strokes: [] },
    ] as const;
    for (const cmd of noops) expect(execute(s, cmd)).toBe(s);
    expect(s.history.past).toHaveLength(n);
  });

  it('undoes a move to the exact original numbers, even after many cycles', () => {
    let s = execute(begin(), { type: 'add-strokes', strokes: [stroke('f', [[0.1, 0.7]])] });
    s = execute(s, { type: 'add-items', items: [sticky('i1', 0.1, 0.7)] });
    for (let k = 0; k < 20; k++) {
      s = execute(s, { type: 'move', strokeIds: ['f'], itemIds: ['i1'], dx: 0.3, dy: 0.1 });
      s = undo(s);
    }
    expect(s.state.strokes[0]!.points[0]).toEqual([0.1, 0.7, 0.5]);
    expect(s.state.items[0]).toMatchObject({ x: 0.1, y: 0.7 });
  });
});
