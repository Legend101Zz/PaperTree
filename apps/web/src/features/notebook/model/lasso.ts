/**
 * The lasso and its menu (S5d, #209, frame 05): what a lasso picked up, what each of the menu's five
 * actions needs before it is offered, and the commands and words they carry. Pure.
 *
 * Handwriting is not readable by the model, so Ask about this, Make sticky, Send to board and Copy
 * take only the TYPED text inside the lasso (notes and stickies, the person's own words, in reading
 * order); ink is never sent anywhere. Delete takes the strokes and the person's own items (notes,
 * stickies, shapes); the exchange and its quote cards are the page's trace and stay.
 */
import { removalCommands } from './history';
import { strokesAsShown } from './inkPlace';
import { readingOrder } from './layout';
import { STICKY_COLOUR } from './wire';

import type { LassoSelection } from './hitTest';
import type { Command, NotebookState } from './history';
import type { ExchangeShift } from './layout';
import type { StickyItem, TextItem, Vec2 } from './page';

/** The menu's actions, in the frame's order. */
export type LassoAction = 'ask' | 'sticky' | 'board' | 'copy' | 'delete';

/** What a lasso picked up, sorted for the menu. */
export interface Picked {
  readonly strokeIds: readonly string[];
  /** Typed notes and stickies, in reading order. */
  readonly typed: readonly (TextItem | StickyItem)[];
  /** Items the person may delete from here: notes, stickies, shapes. */
  readonly deletable: readonly string[];
  /** How many things the lasso holds, for the menu's name. */
  readonly count: number;
}

/** Why an action is not offered, said beside it (`aria-describedby`). */
export const ACTION_NEEDS: Readonly<Record<LassoAction, string>> = {
  ask: 'Ask about this needs typed text in the lasso: the AI cannot read handwriting.',
  sticky: 'Make sticky needs a typed note in the lasso.',
  board: 'Send to board needs typed text in the lasso: ink is not sent.',
  copy: 'Copy needs typed text in the lasso: handwriting is not copied.',
  delete: 'Nothing in the lasso can be deleted: the exchange and its quote cards stay.',
};

/**
 * Sorts a selection by what the menu can do with it.
 *
 * @param state - The page.
 * @param selection - The ids `lassoSelect` returned.
 * @returns The strokes, the typed items and the deletable ids.
 */
export function picked(state: NotebookState, selection: LassoSelection): Picked {
  const ids = new Set(selection.itemIds);
  const items = state.items.filter((i) => ids.has(i.id));
  const typed = items
    .filter((i): i is TextItem | StickyItem => i.kind === 'text' || i.kind === 'sticky')
    .sort(readingOrder);
  return {
    strokeIds: selection.strokeIds,
    typed,
    deletable: items.filter((i) => i.kind !== 'exchange' && i.kind !== 'quote').map((i) => i.id),
    count: selection.strokeIds.length + items.length,
  };
}

/**
 * The typed words inside the lasso, one block per note.
 *
 * @param items - Typed notes and stickies, in reading order.
 * @returns Their texts, trimmed, joined by blank lines; '' when there are none.
 */
export function lassoText(items: readonly (TextItem | StickyItem)[]): string {
  return items
    .map((i) => i.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * What each action needs before it is offered.
 *
 * @param p - What the lasso picked up.
 * @returns Which actions are enabled.
 */
export function enabledActions(p: Picked): Readonly<Record<LassoAction, boolean>> {
  const text = lassoText(p.typed) !== '';
  return {
    ask: text,
    sticky: p.typed.some((i) => i.kind === 'text' && i.text.trim() !== ''),
    board: text,
    copy: text,
    delete: p.strokeIds.length + p.deletable.length > 0,
  };
}

/**
 * Make sticky as ONE undo step: the typed notes go, and a sticky with their words takes the place
 * of the first.
 *
 * @param state - The page.
 * @param p - What the lasso picked up.
 * @param id - The new sticky's id.
 * @returns The command, or null when the lasso holds no typed note.
 */
export function stickyCommand(state: NotebookState, p: Picked, id: string): Command | null {
  const notes = p.typed.filter((i): i is TextItem => i.kind === 'text' && i.text.trim() !== '');
  const first = notes[0];
  if (first === undefined) return null;
  const z = state.items.reduce((m, i) => Math.max(m, i.z), 0) + 1;
  const sticky: StickyItem = {
    kind: 'sticky',
    id,
    x: first.x,
    y: first.y,
    w: 168,
    h: 144,
    z,
    text: lassoText(notes),
    color: STICKY_COLOUR,
  };
  const removed = removalCommands(
    state,
    [],
    notes.map((n) => n.id),
  );
  return { type: 'batch', commands: [...removed, { type: 'add-items', items: [sticky] }] };
}

/**
 * Delete as ONE undo step: the strokes and the person's items inside the lasso.
 *
 * @param state - The page.
 * @param p - What the lasso picked up.
 * @returns The command, or null when nothing can be deleted.
 */
export function deleteCommand(state: NotebookState, p: Picked): Command | null {
  const commands = removalCommands(state, p.strokeIds, p.deletable);
  return commands.length === 0 ? null : { type: 'batch', commands };
}

/**
 * Where everything is SHOWN while the answer is open: what sits below the exchange is drawn lower by
 * `extra` (`exchangeShift`), and a lasso is drawn around what the person sees.
 *
 * @param state - The page as stored.
 * @param shift - The open answer's push, if any.
 * @returns The page as shown (the same object when nothing moves).
 */
export function shown(state: NotebookState, shift: ExchangeShift | null): NotebookState {
  if (shift === null || shift.extra <= 0) return state;
  const { boundary, extra } = shift;
  return {
    items: state.items.map((i) => (i.y >= boundary ? { ...i, y: i.y + extra } : i)),
    // Ink by the page's one rule: the layer a stroke starts in (`model/inkPlace`).
    strokes: strokesAsShown(state.strokes, shift),
  };
}

/**
 * A lasso loop as an SVG path.
 *
 * @param pts - The loop's points.
 * @returns A closed polyline `d`.
 */
export function loopPath(pts: readonly Vec2[]): string {
  return `M${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')} Z`;
}
