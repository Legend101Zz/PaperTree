/**
 * Undo/redo for the notebook (S5b, #207): a pure, reducer-style stack of commands. S5c/S5d hold
 * a `NotebookState` and a `History` in a store and call `execute`, `undo` and `redo`; nothing here
 * touches React, the DOM or the network. Remove commands carry what they removed (with its index)
 * so undo restores paint order exactly.
 */

import type { Item } from './page';
import type { Stroke } from './stroke';

/** Everything on one page that history can change. Strokes and items are in paint order. */
export interface NotebookState {
  readonly strokes: readonly Stroke[];
  readonly items: readonly Item[];
}

/** An object together with where it sat in its list, so removal can be undone in place. */
export interface Placed<T> {
  readonly value: T;
  readonly index: number;
}

/** One undoable edit. Each carries enough to be inverted without looking at the state. */
export type Command =
  | { readonly type: 'add-strokes'; readonly strokes: readonly Stroke[] }
  | { readonly type: 'remove-strokes'; readonly removed: readonly Placed<Stroke>[] }
  | { readonly type: 'add-items'; readonly items: readonly Item[] }
  | { readonly type: 'remove-items'; readonly removed: readonly Placed<Item>[] }
  | {
      readonly type: 'move';
      readonly strokeIds: readonly string[];
      readonly itemIds: readonly string[];
      readonly dx: number;
      readonly dy: number;
      /**
       * The moved objects as they were, filled in by `execute` so undo restores the exact original
       * numbers instead of subtracting (x + dx - dx is not always x in floating point).
       */
      readonly before?: { readonly strokes: readonly Stroke[]; readonly items: readonly Item[] };
    }
  | {
      readonly type: 'edit-text';
      readonly itemId: string;
      readonly before: string;
      readonly after: string;
    }
  | {
      /** A shape's box changed from a resize handle or the keyboard (S5c, #208). */
      readonly type: 'resize';
      readonly itemId: string;
      readonly before: Box;
      readonly after: Box;
    }
  | {
      /**
       * Several commands as ONE undo step (S5d, #209: the lasso's Delete takes strokes and items,
       * Make sticky takes notes away and adds a sticky). Run in order, undone in reverse.
       */
      readonly type: 'batch';
      readonly commands: readonly Command[];
    };

/** An item's rectangle in page units. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The undo and redo stacks. The newest command is last in each. */
export interface History {
  readonly past: readonly Command[];
  readonly future: readonly Command[];
  /** Most commands kept; the oldest fall off. */
  readonly cap: number;
}

/** A state and the history that produced it. */
export interface Step {
  readonly state: NotebookState;
  readonly history: History;
}

/** Default number of undoable commands. */
export const DEFAULT_HISTORY_CAP = 200;

/** Thrown for an invalid history cap, or for adding an object whose id is already on the page. */
export class HistoryError extends Error {
  /**
   * Builds the error.
   *
   * @param message - What was wrong.
   */
  constructor(message: string) {
    super(message);
    this.name = 'HistoryError';
  }
}

/**
 * Keeps the newest `cap` commands.
 *
 * @param list - Commands, oldest first.
 * @param cap - Most to keep (at least 1).
 * @returns The list, or its newest `cap` entries.
 */
function trim(list: readonly Command[], cap: number): readonly Command[] {
  return list.length > cap ? list.slice(list.length - cap) : list;
}

/**
 * An empty history.
 *
 * @param cap - Most commands to remember; an integer of at least 1.
 * @returns A history with nothing to undo or redo.
 * @throws HistoryError when `cap` is not an integer of at least 1 (0 would silently mean unlimited).
 */
export function createHistory(cap = DEFAULT_HISTORY_CAP): History {
  if (!Number.isInteger(cap) || cap < 1)
    throw new HistoryError(`cap must be an integer >= 1, got ${cap}`);
  return { past: [], future: [], cap };
}

/**
 * Inserts each placed value at its recorded index, lowest index first so later ones land right.
 *
 * @param list - The list after removal.
 * @param removed - What was removed, with positions.
 * @returns A new list with the values back in place.
 */
function reinsert<T>(list: readonly T[], removed: readonly Placed<T>[]): T[] {
  const out = list.slice();
  for (const r of [...removed].sort((a, b) => a.index - b.index))
    out.splice(Math.min(r.index, out.length), 0, r.value);
  return out;
}

/**
 * Builds the `remove-*` commands for ids, recording positions.
 *
 * @param state - The current state.
 * @param strokeIds - Strokes to remove.
 * @param itemIds - Items to remove.
 * @returns Zero, one or two commands (empty when the ids match nothing).
 */
export function removalCommands(
  state: NotebookState,
  strokeIds: readonly string[],
  itemIds: readonly string[],
): Command[] {
  const out: Command[] = [];
  const sIds = new Set(strokeIds);
  const iIds = new Set(itemIds);
  const strokes = state.strokes.flatMap((value, index) =>
    sIds.has(value.id) ? [{ value, index }] : [],
  );
  const items = state.items.flatMap((value, index) =>
    iIds.has(value.id) ? [{ value, index }] : [],
  );
  if (strokes.length > 0) out.push({ type: 'remove-strokes', removed: strokes });
  if (items.length > 0) out.push({ type: 'remove-items', removed: items });
  return out;
}

function shiftStroke(s: Stroke, dx: number, dy: number): Stroke {
  return { ...s, points: s.points.map(([x, y, p]) => [x + dx, y + dy, p] as const) };
}

/**
 * Applies a command to a state.
 *
 * @param state - The state before.
 * @param cmd - The command.
 * @returns A new state; the input is never mutated.
 */
export function applyCommand(state: NotebookState, cmd: Command): NotebookState {
  switch (cmd.type) {
    case 'add-strokes':
      return { ...state, strokes: [...state.strokes, ...cmd.strokes] };
    case 'remove-strokes': {
      const ids = new Set(cmd.removed.map((r) => r.value.id));
      return { ...state, strokes: state.strokes.filter((s) => !ids.has(s.id)) };
    }
    case 'add-items':
      return { ...state, items: [...state.items, ...cmd.items] };
    case 'remove-items': {
      const ids = new Set(cmd.removed.map((r) => r.value.id));
      return { ...state, items: state.items.filter((i) => !ids.has(i.id)) };
    }
    case 'move': {
      const sIds = new Set(cmd.strokeIds);
      const iIds = new Set(cmd.itemIds);
      return {
        strokes: state.strokes.map((s) => (sIds.has(s.id) ? shiftStroke(s, cmd.dx, cmd.dy) : s)),
        items: state.items.map((i) =>
          iIds.has(i.id) ? { ...i, x: i.x + cmd.dx, y: i.y + cmd.dy } : i,
        ),
      };
    }
    case 'edit-text':
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === cmd.itemId && (i.kind === 'text' || i.kind === 'sticky' || i.kind === 'quote')
            ? { ...i, text: cmd.after }
            : i,
        ),
      };
    case 'resize':
      return {
        ...state,
        items: state.items.map((i) => (i.id === cmd.itemId ? { ...i, ...cmd.after } : i)),
      };
    case 'batch':
      return cmd.commands.reduce(applyCommand, state);
  }
}

/**
 * Applies the inverse of a command.
 *
 * @param state - The state after the command.
 * @param cmd - The command to take back.
 * @returns The state as it was before the command.
 */
function revertCommand(state: NotebookState, cmd: Command): NotebookState {
  switch (cmd.type) {
    case 'add-strokes': {
      const ids = new Set(cmd.strokes.map((s) => s.id));
      return { ...state, strokes: state.strokes.filter((s) => !ids.has(s.id)) };
    }
    case 'remove-strokes':
      return { ...state, strokes: reinsert(state.strokes, cmd.removed) };
    case 'add-items': {
      const ids = new Set(cmd.items.map((i) => i.id));
      return { ...state, items: state.items.filter((i) => !ids.has(i.id)) };
    }
    case 'remove-items':
      return { ...state, items: reinsert(state.items, cmd.removed) };
    case 'move': {
      if (!cmd.before) return applyCommand(state, { ...cmd, dx: -cmd.dx, dy: -cmd.dy });
      const sBack = new Map(cmd.before.strokes.map((x) => [x.id, x]));
      const iBack = new Map(cmd.before.items.map((x) => [x.id, x]));
      return {
        strokes: state.strokes.map((x) => sBack.get(x.id) ?? x),
        items: state.items.map((x) => iBack.get(x.id) ?? x),
      };
    }
    case 'edit-text':
      return applyCommand(state, { ...cmd, before: cmd.after, after: cmd.before });
    case 'resize':
      return applyCommand(state, { ...cmd, before: cmd.after, after: cmd.before });
    case 'batch':
      return cmd.commands.reduceRight(revertCommand, state);
  }
}

/**
 * Runs a new command. This clears the redo stack: redoing after a fresh edit would replay onto a
 * state it was never made against.
 *
 * @param step - The current state and history.
 * @param cmd - The command to run.
 * @returns The next state and history, with the oldest command dropped past the cap; the same
 *   step when the command would change nothing (move by zero, same text, nothing matched).
 * @throws HistoryError when an added stroke or item reuses an id already on the page.
 */
export function execute(step: Step, cmd: Command): Step {
  const prepared = prepare(step.state, cmd);
  if (!prepared) return step;
  const past = trim([...step.history.past, prepared], step.history.cap);
  return {
    state: applyCommand(step.state, prepared),
    history: { ...step.history, past, future: [] },
  };
}

/**
 * Checks a command against the state and fills in what undo needs.
 *
 * @param state - The state the command will run on.
 * @param cmd - The command as the caller built it.
 * @returns The command to record, or `null` when it would change nothing (no history entry).
 * @throws HistoryError when an added stroke or item reuses an id on the page or within the command.
 */
function prepare(state: NotebookState, cmd: Command): Command | null {
  switch (cmd.type) {
    case 'add-strokes':
    case 'add-items': {
      const added = cmd.type === 'add-strokes' ? cmd.strokes : cmd.items;
      const taken = new Set(
        (cmd.type === 'add-strokes' ? state.strokes : state.items).map((x) => x.id),
      );
      for (const x of added) {
        if (taken.has(x.id)) throw new HistoryError(`id ${x.id} is already on the page`);
        taken.add(x.id);
      }
      return added.length > 0 ? cmd : null;
    }
    case 'remove-strokes':
    case 'remove-items':
      return cmd.removed.length > 0 ? cmd : null;
    case 'move': {
      if (cmd.dx === 0 && cmd.dy === 0) return null;
      const sIds = new Set(cmd.strokeIds);
      const iIds = new Set(cmd.itemIds);
      const before = {
        strokes: state.strokes.filter((x) => sIds.has(x.id)),
        items: state.items.filter((x) => iIds.has(x.id)),
      };
      return before.strokes.length + before.items.length > 0 ? { ...cmd, before } : null;
    }
    case 'edit-text': {
      const item = state.items.find((i) => i.id === cmd.itemId);
      const editable =
        item && (item.kind === 'text' || item.kind === 'sticky' || item.kind === 'quote');
      return editable && cmd.before !== cmd.after ? cmd : null;
    }
    case 'resize': {
      const { before: b, after: a } = cmd;
      const same = b.x === a.x && b.y === a.y && b.w === a.w && b.h === a.h;
      const sized = a.w > 0 && a.h > 0;
      return !same && sized && state.items.some((i) => i.id === cmd.itemId) ? cmd : null;
    }
    case 'batch': {
      // Each part is prepared against the state the parts before it leave; empty parts drop out.
      const parts: Command[] = [];
      let at = state;
      for (const part of cmd.commands) {
        const ready = prepare(at, part);
        if (ready === null) continue;
        parts.push(ready);
        at = applyCommand(at, ready);
      }
      return parts.length > 0 ? { type: 'batch', commands: parts } : null;
    }
  }
}

/**
 * Takes back the newest command.
 *
 * @param step - The current state and history.
 * @returns The earlier step, or the same step when there is nothing to undo.
 */
export function undo(step: Step): Step {
  const cmd = step.history.past[step.history.past.length - 1];
  if (!cmd) return step;
  return {
    state: revertCommand(step.state, cmd),
    history: {
      ...step.history,
      past: step.history.past.slice(0, -1),
      future: [...step.history.future, cmd],
    },
  };
}

/**
 * Re-runs the most recently undone command.
 *
 * @param step - The current state and history.
 * @returns The later step, or the same step when there is nothing to redo.
 */
export function redo(step: Step): Step {
  const cmd = step.history.future[step.history.future.length - 1];
  if (!cmd) return step;
  return {
    state: applyCommand(step.state, cmd),
    history: {
      ...step.history,
      past: trim([...step.history.past, cmd], step.history.cap),
      future: step.history.future.slice(0, -1),
    },
  };
}
