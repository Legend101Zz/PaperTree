'use client';

/**
 * useDiveIn — the explain panel's half of Dive in (S5e, #210, frame 11). One press creates the page
 * through S5a's Dive-in route under a page id DERIVED from the answer (`diveInPageId`), so a second
 * press, or another tab, gets the page already there; the exchange's slips and trace cards lift for
 * `--pt-dur-quick` meanwhile; then their screen boxes go into a one-shot hand-off and the route
 * changes. The page (`useDiveArrival`) takes the boxes and slides in carrying the cards.
 */
import { QueryClientContext } from '@tanstack/react-query';
// The context `useRouter` reads: read directly, a panel outside the app router (a test, a sample)
// gets no Dive in instead of the invariant error `useRouter` throws.
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useCallback, useContext, useRef } from 'react';

import { newClientId, notebookApi, notebookKeys } from '../api/notebookApi';
import { createHandoffSlot, diveInPageId, diveMotion, durationMs } from '../model/diveIn';
import { notebookHref } from '../model/links';

import type { DiveCard, DiveMotion } from '../model/diveIn';

/** The hand-off between the panel and the page; ten seconds covers a slow page load. */
export const diveHandoff = createHandoffSlot(10_000);

/**
 * The motion plan from the live stylesheet (`--pt-dur-quick`, `--pt-dur-open`) and the person's
 * reduced-motion setting; the frame's 120 and 480 when the tokens cannot be read.
 *
 * @returns The phase durations.
 */
export function readMotion(): DiveMotion {
  const css = getComputedStyle(document.documentElement);
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return diveMotion(
    {
      quick: durationMs(css.getPropertyValue('--pt-dur-quick'), 120),
      open: durationMs(css.getPropertyValue('--pt-dur-open'), 480),
    },
    reduced,
  );
}

/**
 * The cards of an exchange that travel, measured where they are on screen now: the call slip, the
 * AI slip, and each numbered passage (a trace row in the panel, a quote card on the page).
 *
 * @param root - The panel's exchange, or the page.
 * @param passages - The selector of a numbered passage under `root`.
 * @param attr - The `data-*` attribute that holds its number.
 * @returns Each card's key, element and box.
 */
export function cardsIn(
  root: Element,
  passages: string,
  attr: string,
): (DiveCard & { readonly el: HTMLElement })[] {
  const one = (key: string, el: HTMLElement | null) =>
    el === null ? [] : [{ key, el, box: el.getBoundingClientRect() }];
  return [
    ...one('call', root.querySelector<HTMLElement>('.pt-call-slip')),
    ...one('ai', root.querySelector<HTMLElement>('.pt-ai-slip')),
    ...[...root.querySelectorAll<HTMLElement>(passages)].flatMap((el) =>
      one(`passage-${el.getAttribute(attr) ?? ''}`, el),
    ),
  ];
}

const wait = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((done) => setTimeout(done, ms));

/** What `useDiveIn` returns. */
export interface DiveIn {
  /**
   * Opens the answer's page, creating it the first time; a press while one is under way joins it.
   * Rejects when the page could not be made, so the button can say so. Null where there is no
   * notebook to open (a sample paper, no app router): the footer then draws no Dive in.
   */
  readonly diveIn: ((messageId: string, exchange: HTMLElement | null) => Promise<void>) | null;
}

/**
 * Dive in from the explain panel.
 *
 * @param paperId - The paper the answer is about (null for a sample paper, which has no server).
 * @returns `diveIn`, or null where nothing can be opened.
 * @example
 * const { diveIn } = useDiveIn(paperId);
 * <Exchange {...props} {...(diveIn === null ? {} : { onDiveIn: diveIn })} />
 */
export function useDiveIn(paperId: string | null): DiveIn {
  const router = useContext(AppRouterContext);
  // Optional, as the reader's: a panel mounted without a query client still dives.
  const client = useContext(QueryClientContext);
  const flights = useRef(new Map<string, Promise<void>>());

  const open = useCallback(
    async (messageId: string, exchange: HTMLElement | null): Promise<void> => {
      if (paperId === null || router === null) throw new Error('No notebook to open here.');
      // Never null for a server message id; a fresh id still opens a page, only not the same one.
      const pageId = diveInPageId(messageId) ?? newClientId('np');
      const motion = readMotion();
      if (motion.liftMs > 0) exchange?.setAttribute('data-dive', 'lift');
      try {
        await Promise.all([
          notebookApi.createPage(paperId, { page_id: pageId, from_message_id: messageId }),
          wait(motion.liftMs),
        ]);
      } catch (error) {
        exchange?.removeAttribute('data-dive');
        throw error;
      }
      const cards = exchange === null ? [] : cardsIn(exchange, '.pt-trace-row[data-n]', 'data-n');
      diveHandoff.put({
        pageId,
        cards: cards.map(({ key, box }) => ({ key, box })),
        at: Date.now(),
      });
      void client?.invalidateQueries({ queryKey: notebookKeys.pages(paperId) });
      router.push(notebookHref(paperId, pageId));
    },
    [paperId, router, client],
  );

  const diveIn = useCallback(
    (messageId: string, exchange: HTMLElement | null): Promise<void> => {
      const running = flights.current.get(messageId);
      if (running !== undefined) return running;
      const run = open(messageId, exchange).finally(() => flights.current.delete(messageId));
      flights.current.set(messageId, run);
      return run;
    },
    [open],
  );
  return { diveIn: paperId === null || router === null ? null : diveIn };
}
