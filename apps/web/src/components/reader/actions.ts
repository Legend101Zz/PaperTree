'use client';

/**
 * reader/actions — the three things any part of the reader may ask the reader to do
 * (contracts.md §5, fixed in S0 so that no two slices edit the same file).
 *
 *   openExplain   S6 implements it (`features/explain/hooks/useExplainActions.ts`)
 *   sendToCanvas  S7 implements it (`components/canvas/sendToCanvas.ts`)
 *   focusAnchor   S4 implements it (resolve, scroll, the citation flash of DESIGN.md §6)
 *
 * `ReaderWorkspace` mounts `<ReaderActionsProvider>` and decides which implementation fills each
 * slot; `SourcePane`'s toolbar, the explain panel's source lines and the canvas's "open source"
 * call them through `useReaderActions()` without knowing who implements them. That indirection is
 * the point: the toolbar (S4), the panel (S6) and the canvas (S7) are three slices, and each one
 * changes only its own file.
 *
 * `useReaderActions()` THROWS outside a provider rather than returning no-ops. A default of
 * no-ops is how an unwired button ships — it renders, it clicks, and nothing happens (#58, #64).
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';

import type { Anchor } from '@papertree/anchoring';

export type SendToCanvasInput =
  /**
   * `toast`: what to say when it lands. Default: "Passage added to your board" with Open board.
   * `added`: "Added" with Show, which opens the board on that card (selection menu, Just send).
   * `none`: nothing, because the board is about to open (selection menu, Board beside).
   * `at`: where on the board the card lands (a passage dropped across the split view's divider, in
   * board units); the board's layout still keeps it as a tree root.
   */
  | {
      kind: 'excerpt';
      anchor: Anchor;
      toast?: 'added' | 'none';
      at?: { readonly x: number; readonly y: number };
      /**
       * Told what a drop (`at`) did: `added` (a new card at the drop point), `moved` (the passage
       * was already a root with no tree, and now sits at the drop point) or `existing` (it is on
       * the board with a tree under it, so the board pans to it instead).
       */
      onOutcome?: (outcome: 'added' | 'moved' | 'existing') => void;
    }
  | { kind: 'explanation'; messageId: string }
  /** A diagram answer's plate (#217): the card keeps the message id and draws the stored parts. */
  | { kind: 'diagram'; messageId: string; title: string };

export type ReaderActions = {
  openExplain(input: { anchor: Anchor; quote: string }): void;
  /**
   * The selection toolbar's Ask (#203): the panel opens on the passage, waiting for the reader's
   * own question. Optional: a reader without it draws no Ask button (never an inert one).
   */
  askAbout?(input: { anchor: Anchor; quote: string }): void;
  /** Resolves to the id of the card this send made (or found: the same passage twice is one card). */
  sendToCanvas(input: SendToCanvasInput): Promise<string | null | undefined>;
  /**
   * Resolve the anchor, scroll its passage into view if it is not, and flash it. `bottomInset` is
   * the px something covers at the bottom of the window (the phone's peek sheet, #205), so a passage
   * behind it counts as out of view.
   */
  focusAnchor(anchor: Anchor, opts?: FocusOptions): void;
};

/** What a `focusAnchor` call asks for besides the passage. */
export interface FocusOptions {
  readonly flash?: boolean;
  readonly bottomInset?: number;
}

const ReaderActionsContext = createContext<ReaderActions | null>(null);

export interface ReaderActionsProviderProps {
  readonly value: ReaderActions;
  readonly children?: ReactNode;
}

export function ReaderActionsProvider({ value, children }: ReaderActionsProviderProps) {
  return createElement(ReaderActionsContext.Provider, { value }, children);
}

export function useReaderActions(): ReaderActions {
  const actions = useContext(ReaderActionsContext);
  if (actions === null) {
    throw new Error(
      'useReaderActions() was called outside <ReaderActionsProvider>. ReaderWorkspace mounts the ' +
        'provider; a component rendered elsewhere must be given one, not a set of no-ops.',
    );
  }
  return actions;
}
