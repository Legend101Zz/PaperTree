'use client';

/**
 * reader/actions — the three things any part of the reader may ask the reader to do
 * (contracts.md §5, fixed in S0 so that no two slices edit the same file).
 *
 *   openExplain   S6 implements it (`components/explain/useExplainActions.ts`)
 *   sendToCanvas  S7 implements it (`components/canvas/sendToCanvas.ts`)
 *   focusAnchor   S4 implements it (resolve, scroll, the citation flash of DESIGN.md §6)
 *
 * `ReaderWorkspace` mounts `<ReaderActionsProvider>` and decides which implementation fills each
 * slot; `SourcePane`'s toolbar, the explain panel's citation chips and the canvas's "open source"
 * call them through `useReaderActions()` without knowing who implements them. That indirection is
 * the point: the toolbar (S4), the panel (S6) and the canvas (S7) are three slices, and each one
 * changes only its own file.
 *
 * `useReaderActions()` THROWS outside a provider rather than returning no-ops. A default of
 * no-ops is how an unwired button ships — it renders, it clicks, and nothing happens (#58, #64).
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';

import type { Anchor } from '@papertree/anchoring';

/**
 * The numbered marker a citation flash was started from (#202): the reader draws its margin tab
 * ("from marker 2 in the answer") beside the flashed passage.
 */
export interface FlashSource {
  readonly n: number;
  /** 1-based page and ¶, as the marker's tab shows them. */
  readonly page: number;
  readonly para: number | null;
  readonly notVerified: boolean;
  /** A diagram part's flash (#217): the tab says "from part C, Scale" instead of the marker. */
  readonly part?: { readonly letter: string; readonly label: string };
}

export type SendToCanvasInput =
  | { kind: 'excerpt'; anchor: Anchor }
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
  /**
   * The selection toolbar's "Explain with a diagram" (#217): a diagram thread on the passage.
   * Optional like `askAbout`: a reader without it draws no such button.
   */
  explainWithDiagram?(input: { anchor: Anchor; quote: string }): void;
  sendToCanvas(input: SendToCanvasInput): Promise<void>;
  focusAnchor(anchor: Anchor, opts?: { flash?: boolean; from?: FlashSource }): void;
};

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
