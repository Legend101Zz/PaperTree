'use client';

/**
 * useAskFromNotebook — the reader's half of the notebook lasso's "Ask about this" (S5d, #209). The
 * notebook stashes the typed words and links to `/paper/<id>/read?ask=<key>` (`model/askHandoff`).
 * This takes them ONCE: it drops the hand-off from the address bar (a reload or a later visit asks
 * nothing), starts a NEW ask (`startFresh`) whose question box holds the words as the explain
 * controller's draft (`setDraft`, S4d: sent or cleared, they are gone for good), and puts the
 * keyboard at the end of them. The ask API takes a passage of the paper (an Anchor) as context,
 * never notebook text, so the words travel as part of the person's question, which the person
 * finishes and sends; `noted` says when to explain that.
 */
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { askDraft, hasAsk, takeAsk, withoutAsk } from '../model/askHandoff';

import type { ExplainController } from '@/components/explain/useExplainActions';
import type { AskStorage } from '../model/askHandoff';

/** What the reader says once beside the panel. */
export const NOTEBOOK_ASK_NOTE =
  'Your notebook words are in the question box. The AI can only take passages of the paper as ' +
  'context, not notebook text, so add what you want to ask, then send it.';

/** What `useAskFromNotebook` returns. */
export interface AskFromNotebookState {
  /** The words were handed over and the note has not been dismissed. */
  readonly noted: boolean;
  readonly dismiss: () => void;
}

/**
 * This tab's `sessionStorage`, or null where reading it throws (blocked site data).
 *
 * @returns The store, or null.
 */
export function sessionStore(): AskStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Puts the keyboard at the end of the question box once the new ask has rendered it with the
 * words (the panel's own open focus runs first). Gives up after a few frames.
 *
 * @param frames - Frames left to wait.
 */
function focusQuestionEnd(frames = 20): void {
  const box = document.getElementById('pt-explain-question');
  if (!(box instanceof HTMLTextAreaElement) || box.value === '') {
    if (frames > 0) requestAnimationFrame(() => focusQuestionEnd(frames - 1));
    return;
  }
  box.focus({ preventScroll: true });
  box.setSelectionRange(box.value.length, box.value.length);
}

/**
 * Takes the hand-off out of the address bar, so a reload or a copied link asks nothing. Next's own
 * history state is kept (its back and forward need it) and nothing navigates; `useSearchParams`
 * may still show the old query, which the once-only guard below ignores.
 *
 * @param rest - The query to keep, without the `?`.
 */
function dropFromUrl(rest: string): void {
  const { pathname, hash } = window.location;
  window.history.replaceState(
    window.history.state,
    '',
    `${pathname}${rest === '' ? '' : `?${rest}`}${hash}`,
  );
}

/**
 * Takes the notebook's hand-off, once, into a new ask.
 *
 * @param paperId - The paper open in the reader (null for a fixture, which no server can answer).
 * @param controller - The explain controller (`startFresh`, `setDraft`).
 * @returns Whether to show the note, and how to dismiss it.
 */
export function useAskFromNotebook(
  paperId: string | null,
  controller: Pick<ExplainController, 'startFresh' | 'setDraft'>,
): AskFromNotebookState {
  const params = useSearchParams();
  const [noted, setNoted] = useState(false);
  const latest = useRef(controller);
  latest.current = controller;
  const done = useRef<string | null>(null);
  const query = params?.toString() ?? '';
  useEffect(() => {
    const here = new URLSearchParams(query);
    if (paperId === null || !hasAsk(here) || done.current === query) return;
    done.current = query;
    const words = takeAsk(here, sessionStore());
    dropFromUrl(withoutAsk(here));
    if (words === null) return; // taken already (a reload, another tab): nothing to ask
    latest.current.startFresh();
    latest.current.setDraft(askDraft(words));
    setNoted(true);
    focusQuestionEnd();
  }, [paperId, query]);
  return { noted, dismiss: () => setNoted(false) };
}
