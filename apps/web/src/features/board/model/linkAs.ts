/**
 * board/model/linkAs — the "Link as" picker's rules (DESIGN.md §3.9, frame 06): the seven kinds
 * with their keys 1–7, which of them a pin pair takes, what Escape leaves, the header that names
 * both ends, where the picker sits, and how the arrow keys walk its 4 + 3 grid. Pure.
 */
import { anchorPageIndex } from './cards';
import { EDGE_KINDS, type PtNode } from './flow';
import { PIN_TABLE, pinRefusal, type PinEnd } from './pins';
import { threadInfo, threadKindOf, type Point } from './threads';

import type { ThreadKind } from '@papertree/ui';
import type { EdgeKind } from '@/lib/api/types';

/** One option in the picker. */
export interface KindChoice {
  readonly kind: EdgeKind;
  /** The design kind `ThreadSwatch` draws. */
  readonly design: ThreadKind;
  readonly label: string;
  /** The number key that chooses it, '1'–'7' in the design's order. */
  readonly key: string;
  readonly enabled: boolean;
  /** Why it is disabled, said on focus; null when enabled. */
  readonly why: string | null;
}

/** The kind Escape leaves on a new thread: the plain link ("7 = plain link", frame 06). */
export const PLAIN_LINK: EdgeKind = 'relates';

/**
 * Whether the server would take a thread between these pins: the same two checks as
 * `papertree_db.canvas.check_ports`. A missing pin is legal (every v0.1 thread has none).
 *
 * @param from The source card and its out-pin (or none).
 * @param to The target card and its in-pin (or none).
 * @returns True when the server would save it.
 */
export function portsHold(from: PinEnd, to: PinEnd): boolean {
  const out = PIN_TABLE[from.kind].out as readonly string[];
  const into = PIN_TABLE[to.kind].into as readonly string[];
  return (
    (from.port == null || out.includes(from.port)) && (to.port == null || into.includes(to.port))
  );
}

/**
 * The seven options for a pin pair. The server's table limits PINS, not kinds, so a pair it takes
 * takes all seven; a pair it refuses offers none, and each option says why.
 *
 * @param from The source card and its out-pin.
 * @param to The target card and its in-pin.
 * @returns The options in the design's order, keys 1–7.
 */
export function kindChoices(from: PinEnd, to: PinEnd): KindChoice[] {
  const enabled = portsHold(from, to);
  return EDGE_KINDS.map(({ kind }, i) => ({
    kind,
    design: threadKindOf(kind),
    label: threadInfo(kind).label,
    key: String(i + 1),
    enabled,
    why: enabled ? null : pinRefusal(),
  }));
}

/**
 * The kind a number key chooses.
 *
 * @param key The key pressed (`KeyboardEvent.key`).
 * @param choices The picker's options.
 * @returns The kind, or null for any other key and for a disabled kind.
 */
export function kindForKey(key: string, choices: readonly KindChoice[]): EdgeKind | null {
  const choice = choices.find((c) => c.key === key);
  return choice?.enabled === true ? choice.kind : null;
}

/**
 * What Escape does. On a NEW thread it keeps a plain link: the thread was drawn, it just has no
 * stronger claim (v0.1's Escape saved nothing; frame 06 and #213 change that on purpose). On a
 * change of kind, or a pair whose pins refuse even the plain link, it saves nothing.
 *
 * @param mode A new thread, or changing a saved thread's kind.
 * @param choices The picker's options, so a refused pair is never saved.
 * @returns The kind to save, or null for "save nothing".
 */
export function escapeKind(
  mode: 'new' | 'change',
  choices: readonly KindChoice[],
): EdgeKind | null {
  const plain = choices.find((c) => c.kind === PLAIN_LINK);
  return mode === 'new' && plain?.enabled === true ? PLAIN_LINK : null;
}

/**
 * What the board says once a thread is saved (the Undo toast's words).
 *
 * @param kind The kind it was saved as.
 * @returns E.g. "Linked as supports." or "Linked as a plain link."
 */
export function linkedSentence(kind: EdgeKind): string {
  return kind === PLAIN_LINK ? 'Linked as a plain link.' : `Linked as ${threadInfo(kind).label}.`;
}

/**
 * A sentence that ends in a card's name, without a second full stop after ‘…here.’.
 *
 * @param text The sentence so far.
 * @returns It, ended once.
 */
export function stop(text: string): string {
  return /[.!?…]’?$/.test(text) ? text : `${text}.`;
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * A card as one end of a thread, for the picker's header: a passage by its page tab
 * (`Passage p. 1`), any other card by its kind and first words (`Diagram ‘Scaled dot-product…’`).
 *
 * @param node The card.
 * @returns The short name.
 */
export function endName(node: PtNode): string {
  const row = node.data.node;
  const page = row.kind === 'excerpt' ? anchorPageIndex(row.source_anchor) : null;
  if (page !== null) return `Passage p. ${String(page + 1)}`;
  // `ariaLabel` is `nodeLabel`'s "Kind: first words" (a notebook card's carries its page title).
  const label = node.ariaLabel ?? row.kind;
  const colon = label.indexOf(': ');
  if (colon < 0) return label;
  return `${label.slice(0, colon)} ‘${clip(label.slice(colon + 2).replace(/…$/, ''), 32)}’`;
}

/** A width and height in px. */
export interface Size {
  readonly w: number;
  readonly h: number;
}

/**
 * Where the picker goes: centred on the thread's midpoint, kept `gutter` px inside the stage.
 *
 * @param mid The midpoint, in stage px.
 * @param size The picker's size.
 * @param stage The stage's size.
 * @param gutter The margin it keeps from every edge (16, the phone gutter).
 * @returns Its top-left corner in stage px.
 */
export function placePicker(mid: Point, size: Size, stage: Size, gutter = 16): Point {
  const fit = (centre: number, length: number, room: number): number =>
    Math.max(gutter, Math.min(centre - length / 2, room - length - gutter));
  return { x: fit(mid.x, size.w, stage.w), y: fit(mid.y, size.h, stage.h) };
}

/**
 * The option an arrow key moves to in a grid of `columns` (4 + 3 on a wide screen): left and
 * right step through the list, up and down move a row, and nothing wraps off the grid.
 *
 * @param index The focused option.
 * @param key The key pressed.
 * @param count How many options (7).
 * @param columns Options per row.
 * @returns The option to focus, or null when the key is not an arrow.
 */
export function gridMove(
  index: number,
  key: string,
  count: number,
  columns: number,
): number | null {
  const step: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columns,
    ArrowDown: columns,
  };
  const d = step[key];
  if (d === undefined) return null;
  const next = index + d;
  if (next >= 0 && next < count) return next;
  // Down from the long first row into the short second one lands on its last option.
  return key === 'ArrowDown' && index < columns ? count - 1 : index;
}
