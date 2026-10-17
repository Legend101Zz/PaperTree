/**
 * #215: the command stack — record / undo / redo over mixed steps, the cap, the inverse of every
 * kind (a batch last step first), forgetting the steps about a card changed elsewhere, the replay
 * stopping at the first refused write, the keys, and the names.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  EMPTY_HISTORY,
  HISTORY_CAP,
  forget,
  historyKey,
  invert,
  itemsPhrase,
  record,
  replay,
  settle,
  take,
  type BoardCommand,
  type History,
  type ReplayIo,
} from './history';
import { cardRow } from './test-data';

const move = (id: string, from: number, to: number, label = `move of ${id}`): BoardCommand => ({
  type: 'patch',
  label,
  cards: [{ id, before: { x: from, y: 0 }, after: { x: to, y: 0 } }],
});
const NOTE = cardRow('note', { node_id: 'cn_n', body: 'Next: read 3.2' });
const EDGE = {
  edge_id: 'ce_1',
  board_id: 'brd_1',
  from_node_id: 'cn_a',
  to_node_id: 'cn_b',
  kind: 'supports' as const,
  label: null,
  from_port: null,
  to_port: null,
  created_at: '',
};

/** Undo (or redo) the way the board does: take, replay, settle. */
function run(history: History, side: 'undo' | 'redo'): [History, BoardCommand | undefined] {
  const taken = take(history, side);
  if (taken === null) return [history, undefined];
  return [settle(taken.rest, taken.command, side), taken.command];
}

describe('the command stack', () => {
  it('undoes newest first, redoes in order, and a new step clears what could be redone', () => {
    let h = EMPTY_HISTORY;
    h = record(h, move('a', 0, 10));
    h = record(h, move('b', 0, 20));
    let got: BoardCommand | undefined;
    [h, got] = run(h, 'undo');
    expect(got?.label).toBe('move of b');
    [h, got] = run(h, 'undo');
    expect(got?.label).toBe('move of a');
    expect(take(h, 'undo')).toBeNull();
    [h, got] = run(h, 'redo');
    expect(got?.label).toBe('move of a');
    expect(h.past.map((c) => c.label)).toEqual(['move of a']);
    expect(h.future.map((c) => c.label)).toEqual(['move of b']);
    h = record(h, move('c', 0, 5));
    expect(h.future).toEqual([]);
    expect(h.past.map((c) => c.label)).toEqual(['move of a', 'move of c']);
  });

  it('keeps the newest HISTORY_CAP steps and forgets the oldest', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i <= HISTORY_CAP; i += 1) h = record(h, move(`n${String(i)}`, 0, i));
    expect(HISTORY_CAP).toBe(100);
    expect(h.past).toHaveLength(100);
    expect(h.past[0]?.label).toBe('move of n1');
    expect(h.past.at(-1)?.label).toBe(`move of n${String(HISTORY_CAP)}`);
  });

  it('a step taken but not settled (its replay failed) is gone from both stacks', () => {
    const h = record(EMPTY_HISTORY, move('a', 0, 10));
    const taken = take(h, 'undo');
    expect(taken?.rest).toEqual(EMPTY_HISTORY);
  });

  it('forgets every step whose replay would write over a card changed somewhere else', () => {
    let h = record(EMPTY_HISTORY, move('a', 0, 10));
    h = record(h, { type: 'add', label: 'new note', nodes: [NOTE], edges: [], members: [] });
    h = record(h, { type: 'batch', label: 'framing', steps: [move('cn_n', 1, 2)] });
    h = record(h, move('b', 0, 10));
    // Its move would PATCH it, and undoing its add would DELETE it: both go.
    expect(forget(h, 'cn_n').past.map((c) => c.label)).toEqual(['move of a', 'move of b']);
  });

  it('keeps a delete restorable: bringing a card back overwrites nothing (review S1)', () => {
    const frame = cardRow('group', { node_id: 'cn_g', title: 'Why' });
    const del: BoardCommand = {
      type: 'remove',
      label: 'delete of “Why”',
      key: 'toast-1',
      nodes: [frame, NOTE],
      edges: [],
      members: [
        { id: 'cn_m', groupId: 'cn_g' },
        { id: 'cn_k', groupId: 'cn_g' },
      ],
    };
    const h = forget(forget(record(EMPTY_HISTORY, del), 'cn_n'), 'cn_m');
    // The deleted note's own 409 keeps the step; a member changed elsewhere is not rejoined.
    expect(h.past).toEqual([{ ...del, members: [{ id: 'cn_k', groupId: 'cn_g' }] }]);
    expect(h.past[0]?.key).toBe('toast-1');
    // Undone, its redo would DELETE the card again, over the other change: that goes.
    expect(forget({ past: [], future: [del] }, 'cn_n').future).toEqual([]);
  });
});

describe('the inverse of a step', () => {
  it('swaps a patch and a thread change, and turns add into remove and back', () => {
    expect(invert(move('a', 0, 10))).toEqual(move('a', 10, 0));
    const thread: BoardCommand = {
      type: 'thread',
      label: 'kind',
      id: 'ce_1',
      before: { kind: 'supports' },
      after: { kind: 'contradicts' },
    };
    expect(invert(thread)).toMatchObject({
      before: { kind: 'contradicts' },
      after: { kind: 'supports' },
    });
    const add: BoardCommand = {
      type: 'add',
      label: 'new',
      nodes: [NOTE],
      edges: [EDGE],
      members: [],
    };
    expect(invert(add)).toEqual({ ...add, type: 'remove' });
    expect(invert(invert(add))).toEqual(add);
  });

  it('inverts a batch last step first, so a frame’s cards leave before the frame goes', () => {
    const frame = cardRow('group', { node_id: 'cn_g', title: 'Why' });
    const batch: BoardCommand = {
      type: 'batch',
      label: 'framing of 2 cards',
      steps: [
        { type: 'add', label: 'f', nodes: [frame], edges: [], members: [] },
        {
          type: 'patch',
          label: 'f',
          cards: [{ id: 'cn_a', before: { group_id: null }, after: { group_id: 'cn_g' } }],
        },
      ],
    };
    const back = invert(batch);
    expect(back.type === 'batch' && back.steps.map((s) => s.type)).toEqual(['patch', 'remove']);
  });
});

describe('replay', () => {
  function io(results: Partial<Record<keyof ReplayIo, boolean>> = {}): ReplayIo {
    return {
      patchCards: vi.fn(async () => results.patchCards ?? true),
      patchThread: vi.fn(async () => results.patchThread ?? true),
      restore: vi.fn(async () => results.restore ?? true),
      remove: vi.fn(async () => results.remove ?? true),
    };
  }

  it('sends a patch’s after-fields, and undo (the inverse) its before-fields', async () => {
    const writes = io();
    await replay(invert(move('a', 0, 10)), writes);
    expect(writes.patchCards).toHaveBeenCalledWith([{ id: 'a', fields: { x: 0, y: 0 } }]);
  });

  it('stops a batch at the first refused write and says it failed', async () => {
    const writes = io({ restore: false });
    const batch: BoardCommand = {
      type: 'batch',
      label: 'b',
      steps: [{ type: 'add', label: 'f', nodes: [NOTE], edges: [], members: [] }, move('a', 0, 1)],
    };
    expect(await replay(batch, writes)).toBe(false);
    expect(writes.patchCards).not.toHaveBeenCalled();
  });
});

describe('the keys and the names', () => {
  const press = (key: string, mods: Partial<Record<'meta' | 'ctrl' | 'shift' | 'alt', boolean>>) =>
    historyKey({
      key,
      metaKey: mods.meta === true,
      ctrlKey: mods.ctrl === true,
      shiftKey: mods.shift === true,
      altKey: mods.alt === true,
    });

  it('Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z and Ctrl+Y redo, nothing else is a history key', () => {
    expect(press('z', { meta: true })).toBe('undo');
    expect(press('z', { ctrl: true })).toBe('undo');
    expect(press('Z', { meta: true, shift: true })).toBe('redo');
    expect(press('Z', { ctrl: true, shift: true })).toBe('redo');
    expect(press('y', { ctrl: true })).toBe('redo');
    expect(press('y', { meta: true })).toBeNull();
    expect(press('z', {})).toBeNull();
    expect(press('z', { ctrl: true, alt: true })).toBeNull();
    expect(press('Delete', { ctrl: true })).toBeNull();
  });

  it('names one card by its words and several by their counts', () => {
    expect(itemsPhrase([NOTE])).toBe('“Next: read 3.2”');
    expect(itemsPhrase([NOTE, NOTE, NOTE])).toBe('3 cards');
    const frame = cardRow('group', { title: 'Why' });
    expect(itemsPhrase([frame, NOTE, NOTE])).toBe('2 cards and a frame');
    expect(itemsPhrase([], 1)).toBe('a thread');
    expect(itemsPhrase([NOTE], 2)).toBe('a card and 2 threads');
  });
});
