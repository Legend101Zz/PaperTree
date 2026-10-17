'use client';

/**
 * usePageLinks — where a notebook page's links go (S5c, #208; moved out of `NotebookView` by S5e,
 * #210, which the three layouts share): the exchange items Dive in stored, the place the question
 * came from, Back to the paper (aimed at that passage and at the dived thread, so the reader
 * reopens its explain panel), the "From your question" line, and the one stable `focusAnchor`
 * every marker, quote card and trace row uses to show a passage in the paper.
 */
import { formatPageLabel } from '@papertree/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';

import { dayAndTime, originPlace } from '../model/exchange';
import { itemForAnchor, readerHref } from '../model/links';
import { parseExchangeBody } from '../model/wire';

import type { Exchange } from './useExchange';
import type { NotebookPageView } from '../api/notebookApi';
import type { Item } from '../model/page';
import type { ExchangeBody } from '../model/wire';
import type { Anchor } from '@papertree/anchoring';

/** What `usePageLinks` returns. */
export interface PageLinks {
  /** Exchange item id → what Dive in stored in it. */
  readonly exchanges: ReadonlyMap<string, ExchangeBody | null>;
  readonly exchangeId: string | null;
  readonly exchangeBody: ExchangeBody | null;
  /** The paper's page and paragraph the question came from. */
  readonly place: { readonly page: number; readonly para: number | null } | null;
  readonly backHref: string;
  /** "From your question on p. 1 ¶1 · 15 Oct"; null when the question's place is unknown. */
  readonly source: {
    readonly href: string;
    readonly where: string;
    readonly day: string | null;
  } | null;
  /** Leave for the reader at the item that stores this Anchor; one identity for the page's life. */
  readonly focusAnchor: (anchor: Anchor) => void;
}

/**
 * The page's links.
 *
 * @param paperId - The paper.
 * @param pageId - The page.
 * @param view - The page as loaded (null while loading).
 * @param items - The page's items as edited now.
 * @param exchange - The stored thread behind the page (`useExchange`).
 * @returns The links.
 */
export function usePageLinks(
  paperId: string,
  pageId: string,
  view: NotebookPageView | null,
  items: readonly Item[],
  exchange: Exchange,
): PageLinks {
  const router = useRouter();
  const exchanges = useMemo(
    () =>
      new Map(
        (view?.items ?? [])
          .filter((i) => i.kind === 'exchange')
          .map((i) => [i.item_id, parseExchangeBody(i.body)] as const),
      ),
    [view],
  );
  const [exchangeId, exchangeBody] = [...exchanges][0] ?? [null, null];
  const origin = exchangeBody?.call.originAnchor ?? null;
  const place = origin === null ? null : originPlace(origin, exchange.layout);
  const at = exchangeId === null || place === null ? undefined : { pageId, itemId: exchangeId };
  const backHref = readerHref(paperId, at, view?.page.source_thread_id ?? null);
  // The question's own date; when the thread cannot be read the line says no date at all, rather
  // than labelling the Dive-in date as the question's.
  const asked = exchange.question?.created_at ?? null;
  const source =
    place === null
      ? null
      : {
          href: backHref,
          where: formatPageLabel(place.page, place.para),
          day: asked === null ? null : dayAndTime(asked).day,
        };
  const toReader = (anchor: Anchor): void => {
    const itemId = itemForAnchor(items, exchanges, anchor);
    router.push(readerHref(paperId, itemId === null ? undefined : { pageId, itemId }));
  };
  // One identity for the page's lifetime, so the memoised cards and slips do not re-render.
  const latestToReader = useRef(toReader);
  latestToReader.current = toReader;
  const focusAnchor = useCallback((anchor: Anchor) => latestToReader.current(anchor), []);
  return { exchanges, exchangeId, exchangeBody, place, backHref, source, focusAnchor };
}
