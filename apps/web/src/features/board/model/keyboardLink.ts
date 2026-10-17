/**
 * board/model/keyboardLink — linking by keyboard (ADR-004 §2.8: xyflow has none, so it is ours):
 * which card and pin a thread from a pin can reach, the order Tab and the arrow keys walk them,
 * and which is highlighted first. Pure; `useKeyboardLink` drives it.
 *
 * THE ORDER: cards are walked in reading order — rows top to bottom (a row is every card whose top
 * is within `ROW_BAND` px of the row's highest), left to right within a row. A card with two open
 * pins that take the thread is visited once per pin, the pin of the same shape first, so a claim
 * can still reach a question card's "question in" (S6b's choice of pin, kept for the keyboard).
 * The walk STARTS at the card nearest the source (centre to centre), so the likeliest target is
 * one Enter away. Tab, → and ↓ step forward; Shift+Tab, ← and ↑ step back; both wrap.
 */
import { PIN_TABLE, canConnect } from './pins';

import type { PtNode } from './flow';
import type { CanvasNode, FromPort, ToPort } from '@/lib/api/types';

/** How tall a "row" of the board is for reading order: about one short card's top band. */
export const ROW_BAND = 96;

/** A card a thread can be linked to, and the in-pin it lands on (one target per pin). */
export interface LinkTarget {
  readonly id: string;
  readonly toPort: ToPort;
}

/**
 * The in-pins a thread from `fromPort` can land on, the pin of the same shape first (a brass
 * diamond, answer out, to an open diamond, question in; a brass circle to an open circle).
 *
 * @param fromPort The out-pin the thread leaves.
 * @param toKind The target card's kind.
 * @returns The card's in-pins in that order (empty when it offers none).
 */
export function inPinsFor(fromPort: FromPort, toKind: CanvasNode['kind']): ToPort[] {
  const same: ToPort = fromPort === 'answer_out' ? 'question_in' : 'evidence_in';
  return [...PIN_TABLE[toKind].into].sort((a, b) => Number(b === same) - Number(a === same));
}

const box = (n: PtNode) => ({
  x: n.position.x,
  y: n.position.y,
  w: n.width ?? n.data.node.w,
  h: n.height ?? n.data.node.h,
});

/**
 * The cards in reading order: a row starts at the highest card left and takes every card whose
 * top is less than `ROW_BAND` below it; rows run top to bottom, each left to right.
 *
 * @param nodes The cards.
 * @returns A new array in reading order.
 */
export function inReadingOrder(nodes: readonly PtNode[]): PtNode[] {
  const byTop = [...nodes].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  const rows: PtNode[][] = [];
  for (const n of byTop) {
    const row = rows.at(-1);
    if (row !== undefined && n.position.y - row[0]!.position.y < ROW_BAND) row.push(n);
    else rows.push([n]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.position.x - b.position.x));
}

/**
 * Every card and pin a thread from this pin can land on, in reading order.
 *
 * @param nodes The board's cards and frames.
 * @param from The source card and the out-pin the thread leaves.
 * @returns The targets, one per in-pin (never the source, never a frame).
 */
export function linkTargets(
  nodes: readonly PtNode[],
  from: { readonly nodeId: string; readonly kind: CanvasNode['kind']; readonly port: FromPort },
): LinkTarget[] {
  return inReadingOrder(nodes.filter((n) => n.id !== from.nodeId)).flatMap((n) =>
    inPinsFor(from.port, n.data.node.kind)
      .filter((toPort) => canConnect(from, { kind: n.data.node.kind, port: toPort }))
      .map((toPort) => ({ id: n.id, toPort })),
  );
}

/**
 * The target nearest the source, centre to centre (the first in reading order on a tie).
 *
 * @param nodes The board's cards.
 * @param targets The targets, in reading order.
 * @param sourceId The card the thread leaves.
 * @returns Its index in `targets`, or -1 when there are none.
 */
export function nearestTarget(
  nodes: readonly PtNode[],
  targets: readonly LinkTarget[],
  sourceId: string,
): number {
  const centre = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (n === undefined) return { x: 0, y: 0 };
    const b = box(n);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };
  const s = centre(sourceId);
  let best = -1;
  let bestD = Infinity;
  targets.forEach((t, i) => {
    const c = centre(t.id);
    const d = Math.hypot(c.x - s.x, c.y - s.y);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

/**
 * The target a key moves the highlight to.
 *
 * @param index The highlighted target.
 * @param count How many targets.
 * @param key The key pressed.
 * @param shift Whether Shift is held (Shift+Tab steps back).
 * @returns The new index, or null when the key does not move the highlight.
 */
export function stepTarget(
  index: number,
  count: number,
  key: string,
  shift: boolean,
): number | null {
  if (count === 0) return null;
  const back = key === 'ArrowLeft' || key === 'ArrowUp' || (key === 'Tab' && shift);
  const forward = key === 'ArrowRight' || key === 'ArrowDown' || (key === 'Tab' && !shift);
  if (!back && !forward) return null;
  return (index + (back ? count - 1 : 1)) % count;
}
