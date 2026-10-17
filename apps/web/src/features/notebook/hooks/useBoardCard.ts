'use client';

/**
 * useBoardCard — the notebook page's card on the paper's board (S5c, #208, S6a's `notebook` kind).
 * Reads the board to find the card that points at this page; "Send page to board" creates it
 * through the board API. One page gets one card: the card's `node_id` is DERIVED from the page id
 * (`cardIdFor`), so a second tab, or a tab whose board is out of date, sends the same id and the
 * idempotent create answers with the card already there; a send in flight is not sent again,
 * nothing is sent while the board is unknown, and a page already on the board is not sent at all.
 * The card holds the page id, never a copy of the page; its counts are the server's, computed on
 * read.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { boardsApi } from '@/lib/api/boards';

import { newClientId } from '../api/notebookApi';

import type { BoardView } from '@/lib/api/boards';
import type { CanvasNode } from '@/lib/api/types';

/** How a send went. */
export type SendResult = 'sent' | 'failed';

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
 * The page's card on a board as read.
 *
 * @param board - The board, undefined while it is unknown.
 * @param pageId - The page.
 * @returns The card; null when the page is not on the board; undefined while the board is unknown.
 */
export function cardOn(
  board: BoardView | undefined,
  pageId: string,
): CanvasNode | null | undefined {
  if (board === undefined) return undefined;
  return board.nodes.find((n) => n.kind === 'notebook' && n.source_page_id === pageId) ?? null;
}

/**
 * The board as it is now, for placing a new card below everything on it. The board this page read
 * when it opened misses cards added since (another tab, the reader's Send to board), and a card
 * placed from it landed on top of them (found by the prototype flow, #218). The read refreshes the
 * page's cached board; if it fails, the board as last read is used (or none), so a passing network
 * fault never stops a send. Between this read and the create another tab's card can still land:
 * only placement on the server would close that window.
 *
 * @param client - The page's query client.
 * @param paperId - The paper whose board it is.
 * @returns The board now; else as last read; else undefined.
 */
export async function freshBoard(
  client: QueryClient,
  paperId: string,
): Promise<BoardView | undefined> {
  try {
    const now = await boardsApi.get(paperId);
    client.setQueryData(boardKey(paperId), now);
    return now;
  } catch {
    return client.getQueryData<BoardView>(boardKey(paperId));
  }
}

/** The API's client-id shape (contracts.md §0). */
const CLIENT_ID = /^[a-z]{2,4}_[0-9A-Za-z-]{8,64}$/;

/**
 * The `node_id` of a page's card: `cn_` and the page id's own suffix. Page ids are global keys, so
 * this one is too, and every tab mints the same one for the same page.
 *
 * @param pageId - The notebook page, e.g. `np_01J…`.
 * @returns The card id, or a fresh one when the page id does not have the client-id shape.
 * @example
 * cardIdFor('np_G9AYN750E5MG1NRBMGSQJ4N5JM'); // 'cn_G9AYN750E5MG1NRBMGSQJ4N5JM'
 */
export function cardIdFor(pageId: string): string {
  const derived = `cn_${pageId.slice(pageId.indexOf('_') + 1)}`;
  return CLIENT_ID.test(derived) ? derived : newClientId('cn');
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
  const nodeId = useRef(cardIdFor(pageId)).current;
  const flight = useRef<Promise<SendResult> | null>(null);
  const [sending, setSending] = useState(false);
  const card = cardOn(board.data, pageId);

  const create = async (): Promise<SendResult> => {
    try {
      // Below everything on the board now, so the new card never covers another (#218).
      const now = await freshBoard(client, paperId);
      const y = (now?.nodes ?? []).reduce((max, n) => Math.max(max, n.y + n.h + 40), 0);
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

  // The view opens the board for a page already on it, so this runs only while the card is null.
  const send = (): Promise<SendResult> => {
    if (card === undefined) return Promise.resolve('failed');
    if (card !== null) return Promise.resolve('sent');
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
