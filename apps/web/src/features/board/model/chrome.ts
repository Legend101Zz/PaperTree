/**
 * board/model/chrome — the words around the board (frame 06, 06b): the header's counts, the zoom
 * readout, the minimap's label, the way back to the paper, and what the toolbar's Thread does with
 * the selection. Pure, so the counts and the rules are tested without a board.
 */
import type { CanvasNode } from '@/lib/api/types';

/** How far the board zooms: out to 20 % (a whole wide board), in to 200 %. */
export const ZOOM_RANGE = { min: 0.2, max: 2 } as const;

/** What the header counts. */
export interface BoardCounts {
  readonly cards: number;
  readonly threads: number;
  readonly frames: number;
}

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? '' : 's'}`;

/**
 * The board's counts: cards (every kind but a frame), threads and frames.
 *
 * @param nodes The board's rows.
 * @param threads How many threads it has.
 * @returns The counts.
 */
export function boardCounts(
  nodes: readonly Pick<CanvasNode, 'kind'>[],
  threads: number,
): BoardCounts {
  const frames = nodes.filter((n) => n.kind === 'group').length;
  return { cards: nodes.length - frames, threads, frames };
}

/**
 * The header's count line. Cards are always said; threads and frames only once there are some.
 *
 * @param counts The board's counts.
 * @returns E.g. "11 cards · 7 threads · 2 frames", "0 cards", "1 card · 1 frame".
 */
export function countsLine(counts: BoardCounts): string {
  const parts = [plural(counts.cards, 'card')];
  if (counts.threads > 0) parts.push(plural(counts.threads, 'thread'));
  if (counts.frames > 0) parts.push(plural(counts.frames, 'frame'));
  return parts.join(' · ');
}

/**
 * The zoom readout, as frame 06 writes it.
 *
 * @param zoom The board's zoom (1 = 100 %).
 * @returns E.g. "100%", "45%".
 */
export function zoomReadout(zoom: number): string {
  return `${String(Math.round(zoom * 100))}%`;
}

/**
 * The minimap's caption.
 *
 * @param zoom The board's zoom.
 * @param empty True when nothing is on the board.
 * @returns "Map · 100%", or "Map · empty" (frame 06b).
 */
export function mapLabel(zoom: number, empty: boolean): string {
  return `Map · ${empty ? 'empty' : zoomReadout(zoom)}`;
}

/**
 * The reader's URL for the paper a board belongs to ("Back to the paper").
 *
 * @param paperId The paper.
 * @returns `/paper/<id>/read`.
 */
export function readerHref(paperId: string): string {
  return `/paper/${encodeURIComponent(paperId)}/read`;
}

/** What the toolbar's Thread does now, and the sentence that says so. */
export interface ThreadTool {
  /** `cancel` a thread being drawn, `link` the two selected cards, `walk` from the one, or `none`. */
  readonly action: 'cancel' | 'link' | 'walk' | 'none';
  readonly hint: string;
}

/**
 * The toolbar's Thread for a selection: two cards are linked first to second (v0.1's Link), one
 * card starts the keyboard walk from its brass pin (as L does), a thread being drawn is put away.
 *
 * @param selected How many cards are selected (frames left out).
 * @param drawing True while a thread is being drawn.
 * @returns The action and its tooltip.
 */
export function threadTool(selected: number, drawing: boolean): ThreadTool {
  if (drawing) return { action: 'cancel', hint: 'Put the thread away. Nothing is saved.' };
  if (selected === 1)
    return { action: 'walk', hint: 'Start a thread from the selected card, then pick its end.' };
  if (selected === 2)
    return { action: 'link', hint: 'Link the two selected cards, from the first to the second.' };
  return {
    action: 'none',
    hint: 'Select a card to start a thread from it (or press L on it), or two cards to link them.',
  };
}
