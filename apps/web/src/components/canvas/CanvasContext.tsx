'use client';

import { createContext, useContext } from 'react';

import type { Citation } from '@/lib/api/types';

/** What a node needs from the controller, without the nodes knowing the controller exists. */
export interface CanvasActions {
  readonly editingId: string | null;
  readonly setEditingId: (id: string | null) => void;
  readonly commitBody: (id: string, body: string) => void;
  readonly commitTitle: (id: string, title: string) => void;
  readonly commitSize: (id: string, rect: { x: number; y: number; w: number; h: number }) => void;
  /** Citations by message id, for explanation cards; absent until read, then empty if unavailable. */
  readonly citations?: ReadonlyMap<string, readonly Citation[]>;
}

const Context = createContext<CanvasActions | null>(null);

export const CanvasActionsProvider = Context.Provider;

export function useCanvasActions(): CanvasActions {
  const value = useContext(Context);
  if (value === null) throw new Error('useCanvasActions() was called outside <CanvasActionsProvider>.');
  return value;
}
