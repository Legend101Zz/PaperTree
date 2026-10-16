'use client';

/**
 * board/components/BoardContext — what a card needs from the controller, without the cards knowing
 * the controller exists. `BoardView` provides it; every card reads it.
 */
import { createContext, useContext } from 'react';

import type { CardSources } from '../hooks/useCardSources';
import type { CanvasNode } from '@/lib/api/types';

/** The controller's card-facing half, plus what the cards' sources have read. */
export interface CanvasActions {
  readonly editingId: string | null;
  readonly setEditingId: (id: string | null) => void;
  readonly commitBody: (id: string, body: string) => void;
  readonly commitTitle: (id: string, title: string) => void;
  readonly commitSize: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  /** Open the reader on a cited passage and flash it (a numbered marker on an AI card). */
  readonly openCitation?: (nodeId: string, citationId: string, threadId?: string) => void;
  /** Thread and notebook reads behind the cards; absent until read, then empty if unavailable. */
  readonly sources?: CardSources;
  /** The pin a thread is being drawn from, so the pins it could land on light; null otherwise. */
  readonly linking?: LinkStart | null;
}

/** Where a thread being drawn started. */
export interface LinkStart {
  readonly nodeId: string;
  readonly kind: CanvasNode['kind'];
  readonly port: string;
}

const Context = createContext<CanvasActions | null>(null);

/** Gives every card on the board its actions. */
export const CanvasActionsProvider = Context.Provider;

/**
 * The board's actions, inside a card.
 *
 * @returns The actions `BoardView` provides.
 */
export function useCanvasActions(): CanvasActions {
  const value = useContext(Context);
  if (value === null)
    throw new Error('useCanvasActions() was called outside <CanvasActionsProvider>.');
  return value;
}
