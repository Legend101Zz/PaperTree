'use client';

/**
 * useDiveIn — the explain panel's half of Dive in (S5e, #210, frame 11). One press creates the page
 * through S5a's Dive-in route under a page id DERIVED from the answer (`diveInPageId`), so a second
 * press, or another tab, gets the page already there; the exchange's slips and trace cards lift for
 * `--pt-dur-quick` meanwhile; then their screen boxes go into a one-shot hand-off and the route
 * changes. The page (`useDiveArrival`) takes the boxes and slides in carrying the cards. Page ids
 * are global keys on the server (S5a's `create_notebook_page` looks the id up per owner, then
 * inserts it), so a derived id another account already holds is answered 422 "page_id: already in
 * use"; then the answer dives into a fresh id instead of failing on every press.
 */
import { QueryClientContext } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useContext, useRef } from 'react';

import { ApiError } from '@/lib/api/types';

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

/** A reader still on screen this long after the route was asked for settles its lifted cards. */
export const LIFT_HOLD_MS = 1500;

/**
 * Creates (or finds) the answer's page: the derived id first, a fresh one only when another
 * account holds the derived id.
 *
 * @param paperId - The paper.
 * @param messageId - The answer.
 * @returns The page id that now holds the answer's page.
 */
async function createDived(paperId: string, messageId: string): Promise<string> {
  const derived = diveInPageId(messageId);
  // Never null for a server message id; a fresh id still opens a page, only not the same one.
  const first = derived ?? newClientId('np');
  try {
    await notebookApi.createPage(paperId, { page_id: first, from_message_id: messageId });
    return first;
  } catch (error) {
    const taken =
      error instanceof ApiError && error.status === 422 && error.detail.startsWith('page_id:');
    if (!taken || derived === null) throw error;
    const fresh = newClientId('np');
    await notebookApi.createPage(paperId, { page_id: fresh, from_message_id: messageId });
    return fresh;
  }
}

/** What `useDiveIn` returns. */
export interface DiveIn {
  /**
   * Opens the answer's page, creating it the first time; a press while one is under way joins it.
   * Rejects when the page could not be made, so the button can say so. Null for a sample paper,
   * which has no notebook: the footer then draws no Dive in.
   */
  readonly diveIn: ((messageId: string, exchange: HTMLElement | null) => Promise<void>) | null;
}

/**
 * Dive in from the explain panel.
 *
 * @param paperId - The paper the answer is about (null for a sample paper, which has no server).
 * @returns `diveIn`, or null for a sample paper.
 * @example
 * const { diveIn } = useDiveIn(paperId);
 * <Exchange {...props} {...(diveIn === null ? {} : { onDiveIn: diveIn })} />
 */
export function useDiveIn(paperId: string | null): DiveIn {
  const router = useRouter();
  // Optional, as the reader's: a panel mounted without a query client still dives.
  const client = useContext(QueryClientContext);
  const flights = useRef(new Map<string, Promise<void>>());

  const open = useCallback(
    async (messageId: string, exchange: HTMLElement | null): Promise<void> => {
      if (paperId === null) throw new Error('A sample paper has no notebook.');
      const motion = readMotion();
      if (motion.liftMs > 0) exchange?.setAttribute('data-dive', 'lift');
      let pageId: string;
      try {
        [pageId] = await Promise.all([createDived(paperId, messageId), wait(motion.liftMs)]);
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
      // The reader unmounts on the way; if it has not (a navigation that was refused), it settles.
      setTimeout(() => exchange?.removeAttribute('data-dive'), LIFT_HOLD_MS);
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
  return { diveIn: paperId === null ? null : diveIn };
}
