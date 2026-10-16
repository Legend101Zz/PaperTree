'use client';

/**
 * useBoardCard — the notebook page's card on the paper's board (S5c, #208, S6a's `notebook` kind).
 * Reads the board to find the card that points at this page, and "Send page to board" creates it
 * through the board API. The card holds the page id, never a copy of the page, and its counts are
 * the server's, computed on read.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { boardsApi } from '@/lib/api/boards';

import { newClientId } from '../api/notebookApi';

import type { CanvasNode } from '@/lib/api/types';

/** How a send went: `already` when the page was on the board before. */
export type SendResult = 'sent' | 'already' | 'failed';

/** What `useBoardCard` returns. */
export interface BoardCard {
  /** The card, null when the page is not on the board, undefined while the board loads. */
  readonly card: CanvasNode | null | undefined;
  readonly send: () => Promise<SendResult>;
}

/** An index card's size on the board, in board units. */
const CARD = { w: 280, h: 180 } as const;

/**
 * The page's board card and the send action.
 *
 * @param paperId - The paper whose board it is.
 * @param pageId - The page.
 * @param title - The page title, shown on the card.
 * @returns The card and `send`.
 */
export function useBoardCard(paperId: string, pageId: string, title: string): BoardCard {
  const client = useQueryClient();
  const key = ['board', paperId] as const;
  const board = useQuery({ queryKey: key, queryFn: () => boardsApi.get(paperId) });
  const card =
    board.data === undefined
      ? undefined
      : (board.data.nodes.find((n) => n.kind === 'notebook' && n.source_page_id === pageId) ??
        null);

  const send = async (): Promise<SendResult> => {
    if (card !== null && card !== undefined) return 'already';
    const nodes = board.data?.nodes ?? [];
    // Below everything already on the board, so the new card never covers another.
    const y = nodes.reduce((max, n) => Math.max(max, n.y + n.h + 40), 0);
    try {
      await boardsApi.createNode(paperId, {
        node_id: newClientId('cn'),
        kind: 'notebook',
        x: 0,
        y,
        ...CARD,
        title,
        source_page_id: pageId,
      });
      await client.invalidateQueries({ queryKey: key });
      return 'sent';
    } catch {
      return 'failed';
    }
  };
  return { card, send };
}
