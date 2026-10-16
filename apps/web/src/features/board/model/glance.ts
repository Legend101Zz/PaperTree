/**
 * board/model/glance — the board at scale (#215): a big board keeps only the cards in view in the
 * page and, below a zoom where a card's words can no longer be read, draws every card as a glance
 * (its kind and its first words, large). Pure: `BoardView` asks it on zoom, the cards on render.
 */
import { anchorPageIndex } from './cards';

import type { PtNode } from './flow';
import type { NodeProps } from '@xyflow/react';

/**
 * Below this zoom a card is a glance: a 13 px body is under 6 px on screen there. Above
 * `FULL_ABOVE` it is drawn in full again; between the two it stays as it was, so a zoom that
 * hovers at the line does not redraw every card each frame.
 */
export const GLANCE_BELOW = 0.45;
export const FULL_ABOVE = 0.55;

/** From this many nodes a board is drawn for scale (`bigBoard`). */
export const BIG_BOARD = 150;

/**
 * Whether a board is drawn for scale: only the cards in view are in the page (xyflow's
 * `onlyRenderVisibleElements`) and glances below the switch. A smaller board keeps every card in
 * the page and in full at any zoom, so Tab reaches each one and v0.1's in-card targets hold
 * (W2UI #141: a button keeps 44 px on screen whatever the zoom). On a big board a card out of view
 * is reached by panning, or by Fit all, which shows the whole board again (as glances).
 *
 * @param nodes How many nodes the board holds.
 * @returns True from `BIG_BOARD` nodes.
 */
export function bigBoard(nodes: number): boolean {
  return nodes >= BIG_BOARD;
}

/**
 * Whether the cards are glances at this zoom.
 *
 * @param zoom The board's zoom.
 * @param was Whether they were glances before (the band between the two lines keeps it).
 * @param big Whether the board is drawn for scale (`bigBoard`); a smaller one never glances.
 * @returns True below `GLANCE_BELOW`, false above `FULL_ABOVE`, `was` between.
 */
export function glanceAt(zoom: number, was: boolean, big = true): boolean {
  if (!big) return false;
  if (zoom < GLANCE_BELOW) return true;
  if (zoom > FULL_ABOVE) return false;
  return was;
}

/**
 * The zoom the stylesheet's `--pt-cv-zoom` is given: inside the range the CSS reads (0.2 to 1) and
 * floored to a 0.05 step, so a wheel zoom rewrites it (and restyles every card under it) a few
 * times rather than every frame. Floored, so a target grown by `44px / zoom` is never smaller.
 *
 * @param zoom The board's zoom.
 * @returns The value to publish.
 */
export function publishedZoom(zoom: number): number {
  const clamped = Math.min(1, Math.max(0.2, zoom));
  return Math.floor(clamped * 20 + 1e-9) / 20;
}

/** What a glance shows: the kind's words and the card's first words, and whose words they are. */
export interface Glance {
  readonly kind: string;
  readonly words: string;
  readonly voice: 'paper' | 'ai' | 'you' | null;
}

const WORDS_MAX = 90;

const firstWords = (text: string): string => {
  const flat = text
    .replace(/\[b\d+(?:\s*,\s*b\d+)*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > WORDS_MAX ? `${flat.slice(0, WORDS_MAX).trimEnd()}…` : flat;
};

/**
 * A card's glance: its kind (a passage with its page) and its first words, the model's passage
 * handles left out.
 *
 * @param node The card's row.
 * @returns The glance; `words` is empty when the card has none.
 */
export function glanceOf(node: PtNode['data']['node']): Glance {
  const text = node.body.trim() === '' ? (node.title ?? '') : node.body;
  switch (node.kind) {
    case 'excerpt': {
      const page = anchorPageIndex(node.source_anchor);
      const kind = page === null ? 'Passage' : `Passage · p. ${String(page + 1)}`;
      return { kind, words: firstWords(node.body), voice: 'paper' };
    }
    case 'explanation':
      return { kind: 'AI explanation', words: firstWords(node.body), voice: 'ai' };
    case 'diagram':
      return { kind: 'Diagram', words: firstWords(node.title ?? ''), voice: 'ai' };
    case 'notebook':
      return { kind: 'Notebook page', words: firstWords(node.title ?? ''), voice: null };
    case 'question':
      return { kind: 'Question', words: firstWords(text), voice: 'you' };
    default:
      return {
        kind: node.kind === 'group' ? 'Frame' : 'Note',
        words: firstWords(text),
        voice: 'you',
      };
  }
}

/**
 * Whether a card must draw again: only when its row, its selection or its type changed. xyflow
 * also hands a card its position on every frame of its own drag, which no card draws from.
 *
 * @param before The props it last drew with.
 * @param after The new props.
 * @returns True when the two draw the same card (React.memo's "equal").
 */
export function sameCard(before: NodeProps<PtNode>, after: NodeProps<PtNode>): boolean {
  return (
    before.id === after.id &&
    before.data === after.data &&
    before.selected === after.selected &&
    before.type === after.type
  );
}
