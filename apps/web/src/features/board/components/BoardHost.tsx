'use client';

/**
 * board/components/BoardHost — what the board needs from where it is shown, without knowing the
 * reader exists. On its own page the board is the whole window and its source links leave for the
 * reader; embedded beside the paper (the split view, #344) the host says which pages are on screen
 * (the faint amber edge), flashes a source in the paper while the board stays put, takes a passage
 * dragged across the divider, and closes the split when Escape has nothing left to close here.
 */
import { createContext, useContext } from 'react';

import type { Anchor } from '@papertree/anchoring';

/** A card the board should open on: centred (with its ask box) and glowing once. */
export interface BoardArrival {
  readonly cardId: string;
  /** Changes with every arrival, so the same card can arrive twice. */
  readonly nonce: number;
  /** False for a drop: the card lands where it was dropped and the view stays. */
  readonly centre: boolean;
}

/** A source link clicked on a card. */
export interface SourceTarget {
  readonly nodeId: string;
  /** What to flash in the paper: a passage card's anchor, or the cited passage's. */
  readonly anchor: Anchor | null;
  readonly citationId?: string;
}

/** A passage dragged from the paper over the board. */
export interface DragIn {
  /**
   * The passage in the air (its words size the footprint), or null when nothing is dragged. A
   * picture (`image`) is as tall as an image card, whatever its caption.
   */
  readonly current: () => { readonly text: string; readonly image?: boolean } | null;
  /** Dropped at this point of the board (board units). */
  readonly drop: (at: { readonly x: number; readonly y: number }) => void;
}

/** The board's surroundings. */
export interface BoardHost {
  /** True when the board sits beside the paper. */
  readonly beside: boolean;
  /** The 0-based pages on screen in the paper beside; empty when there is none. */
  readonly visiblePages: ReadonlySet<number>;
  readonly arrival: BoardArrival | null;
  readonly dragIn: DragIn | null;
  /** A source "p. n" was clicked. Beside: the paper flashes it. Full width: the reader opens beside. */
  readonly showInPaper: (target: SourceTarget) => void;
  /** A first branch grew in the pane: the board may take more room (#349). */
  readonly onBranched: () => void;
  /** Escape had nothing left to close in the board. */
  readonly onEscapeUnused: () => void;
  /** B: the other half of the split (Paper beside from a full board, Board beside from the reader). */
  readonly toggleSplit: () => void;
}

/** The host of a board that is not beside anything: the placeholder the provider-less board reads. */
export const NO_PAGES: ReadonlySet<number> = new Set();

const Context = createContext<BoardHost | null>(null);

/** Gives the board its surroundings. */
export const BoardHostProvider = Context.Provider;

/**
 * The board's host, or null on the board's own page (which builds the full-width one itself).
 *
 * @returns The host the split view provides, or null.
 */
export function useProvidedHost(): BoardHost | null {
  return useContext(Context);
}
