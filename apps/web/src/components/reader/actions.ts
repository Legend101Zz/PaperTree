'use client';

/**
 * reader/actions — the three things any part of the reader may ask the reader to do
 * (contracts.md §5, fixed in S0 so that no two slices edit the same file).
 *
 *   openExplain   S6 implements it (`components/explain/useExplainActions.ts`)
 *   sendToCanvas  S7 implements it (`components/canvas/sendToCanvas.ts`)
 *   focusAnchor   S4 implements it (resolve, scroll, 1.2 s flash)
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

export type SendToCanvasInput =
  | { kind: 'excerpt'; anchor: Anchor }
  | { kind: 'explanation'; messageId: string };

export type ReaderActions = {
  openExplain(input: { anchor: Anchor; quote: string }): void;
  sendToCanvas(input: SendToCanvasInput): Promise<void>;
  focusAnchor(anchor: Anchor, opts?: { flash?: boolean }): void;
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
