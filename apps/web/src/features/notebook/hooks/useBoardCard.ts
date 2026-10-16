'use client';

/**
 * useBoardCard — the notebook page's card on the paper's board (S5c, #208, S6a's `notebook` kind).
 * Reads the board to find the card that points at this page; "Send page to board" creates it
 * through the board API. One page gets one card: the card's `node_id` is minted once per page
 * (the create is idempotent on it), a send already in flight is not sent again, nothing is sent
 * while the board is unknown, and a page already on the board is not sent at all. The card holds
 * the page id, never a copy of the page; its counts are the server's, computed on read.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { boardsApi } from '@/lib/api/boards';

import { newClientId } from '../api/notebookApi';

import type { CanvasNode } from '@/lib/api/types';

/** How a send went: `already` when the page was on the board before. */
export type SendResult = 'sent' | 'already' | 'failed';

/** What `useBoardCard` returns. */
export interface BoardCard {
  /** The card, null when the page is not on the board, undefined while the board is unknown. */
  readonly card: CanvasNode | null | undefined;
  /** True when the board could not be read (nothing can be sent until it can). */
  readonly unreadable: boolean;
  /** True while a send is in flight. */
  readonly sending: boolean;
  readonly send: () => Promise<SendResult>;
}

/** An index card's size on the board, in board units. */
const CARD = { w: 280, h: 180 } as const;

/**
 * The board's react-query key; the page invalidates it after edits so the card's counts follow.
 *
 * @param paperId - The paper whose board it is.
 * @returns The key.
 */
export function boardKey(paperId: string): readonly ['board', string] {
  return ['board', paperId];
}

/**
 * The page's board card and the send action.
 *
 * @param paperId - The paper whose board it is.
 * @param pageId - The page.
 * @param title - The page title, shown on the card.
 * @returns The card, its state and `send`.
 */
export function useBoardCard(paperId: string, pageId: string, title: string): BoardCard {
  const client = useQueryClient();
  const board = useQuery({ queryKey: boardKey(paperId), queryFn: () => boardsApi.get(paperId) });
  const nodeId = useMemo(() => newClientId('cn'), []);
  const flight = useRef<Promise<SendResult> | null>(null);
  const [sending, setSending] = useState(false);
  const card =
    board.data === undefined
      ? undefined
      : (board.data.nodes.find((n) => n.kind === 'notebook' && n.source_page_id === pageId) ??
        null);

  const create = async (): Promise<SendResult> => {
    const nodes = board.data?.nodes ?? [];
    // Below everything already on the board, so the new card never covers another.
    const y = nodes.reduce((max, n) => Math.max(max, n.y + n.h + 40), 0);
    try {
      await boardsApi.createNode(paperId, {
        node_id: nodeId,
        kind: 'notebook',
        x: 0,
        y,
        ...CARD,
        title,
        source_page_id: pageId,
      });
      await client.invalidateQueries({ queryKey: boardKey(paperId) });
      return 'sent';
    } catch {
      return 'failed';
    }
  };

  const send = (): Promise<SendResult> => {
    if (card !== null && card !== undefined) return Promise.resolve('already');
    if (card === undefined) return Promise.resolve('failed');
    if (flight.current === null) {
      setSending(true);
      flight.current = create().finally(() => {
        flight.current = null;
        setSending(false);
      });
    }
    return flight.current;
  };
  return { card, unreadable: board.isError, sending, send };
}
