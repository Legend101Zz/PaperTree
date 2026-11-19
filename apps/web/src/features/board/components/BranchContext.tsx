'use client';

/**
 * board/components/BranchContext — what the branching cards need of the board, without knowing the
 * controller: the tree, what is open, the answers streaming in, and every gesture a card offers
 * (focus its path, ask from it, Stop, Fold, open its source). `BoardView` provides it once; the
 * cards, the ask box, the span menu and the Outline read it.
 */
import { createContext, useContext } from 'react';

import type { AnswerStream } from '../hooks/useBoardAsk';
import type { CardReports } from '../hooks/useBoardTree';
import type { BoardUiControl } from '../hooks/useBoardUi';
import type { QuickAsk } from '../model/askPayload';
import type { BoardLayout } from '../model/layout';
import type { BoardTree } from '../model/tree';
import type { Draft } from '../model/ui';
import type { ParentSpan } from '@/lib/api/types';

/** The branching board, as a card sees it. */
export interface BranchActions {
  readonly tree: BoardTree;
  readonly layout: BoardLayout;
  readonly control: BoardUiControl;
  /** The ask box on the board (the one being written, or the Follow up stub). */
  readonly draft: Draft | null;
  readonly streams: ReadonlyMap<string, AnswerStream>;
  readonly reports: CardReports;
  readonly send: (draft: Draft) => Promise<boolean>;
  readonly quick: (parentId: string, span: ParentSpan, quick: QuickAsk) => Promise<boolean>;
  readonly keepNote: (parentId: string, span: ParentSpan) => Promise<void>;
  readonly retry: (nodeId: string) => Promise<boolean>;
  readonly stop: (nodeId: string) => void;
  readonly fold: (id: string, folded: boolean) => void;
  /** Opens the reader on a card's source and flashes it. */
  readonly openSource: (nodeId: string, citationId?: string, threadId?: string) => void;
  /** The stage the span menu sits in (its pane), for placing it inside. */
  readonly stage: { readonly current: HTMLElement | null };
}

const Context = createContext<BranchActions | null>(null);

/** Gives the branching cards the board's tree and gestures. */
export const BranchProvider = Context.Provider;

/**
 * The branching board, inside a card.
 *
 * @returns What `BoardView` provides.
 */
export function useBranch(): BranchActions {
  const value = useContext(Context);
  if (value === null) throw new Error('useBranch() was called outside <BranchProvider>.');
  return value;
}
