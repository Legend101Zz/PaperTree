'use client';

/**
 * The explain panel (contracts.md §5; moved from `components/explain` and rebuilt for #202). A
 * right drawer from 768 px up, a bottom `Sheet` below it, mounted once by `ReaderWorkspace` with
 * the controller as one prop; it reaches the reader only through `useReaderActions()`. Its header
 * holds the thread menu (threads named by their asks), Summarize and Close; its body is the thread
 * as exchanges. Closed, it draws nothing: the reader header's Explain toggle (#203) is the entry for
 * a free question or the summary, and the panel hands focus back to it when it closes.
 */
import { Sheet, type SheetDetent } from '@papertree/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { useReaderActions } from '@/components/reader/actions';
import { useAuthStore } from '@/store/authStore';

import { useThreads } from '../hooks/useThreads';
import { ThreadMenu } from './ThreadMenu';
import { ThreadView } from './ThreadView';

import type { ExplainController } from '@/components/explain/useExplainActions';
import type { Citation } from '@/lib/api/types';
import type { PassageMarker } from '../model/exchange';

/** Props for `ExplainPanel`. */
export interface ExplainPanelProps {
  readonly controller: ExplainController;
  /**
   * The reader header's Explain toggle (#203): focus goes back to it when the panel closes, and Esc
   * on it closes the panel (a keyboard reader who opened the phone sheet from it is still there).
   */
  readonly toggleRef: RefObject<HTMLButtonElement>;
}

const DESKTOP = '(min-width: 768px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** The call slip's stamp: the signed-in account's initial ("Y" for you, when it is unknown). */
function useInitial(): string {
  const email = useAuthStore((s) => s.user?.email);
  return (email?.trim()[0] ?? 'Y').toUpperCase();
}

interface OpenPanelProps {
  readonly controller: ExplainController;
  readonly desktop: boolean;
  readonly detent: SheetDetent;
  readonly setDetent: (detent: SheetDetent) => void;
  readonly asideRef: React.RefObject<HTMLElement>;
}

/** The open panel. A component of its own so the thread reads run only while it is open. */
function OpenPanel({ controller, desktop, detent, setDetent, asideRef }: OpenPanelProps) {
  const actions = useReaderActions();
  const threads = useThreads(controller);
  const initial = useInitial();
  const { state } = controller;
  const busy = state.messages.some((m) => m.status === 'streaming');

  // On a phone the sheet covers the page: lower it so the flashed passage is in view.
  const onCite = useCallback(
    (citation: Citation) => {
      if (!desktop) setDetent('peek');
      actions.focusAnchor(citation.anchor, { flash: true });
    },
    [actions, desktop, setDetent],
  );
  const onShow = useCallback(
    (marker: PassageMarker) => {
      if (!desktop) setDetent('peek');
      const { n, page, para, notVerified } = marker;
      actions.focusAnchor(marker.citation.anchor, {
        flash: true,
        from: { n, page, para, notVerified },
      });
    },
    [actions, desktop, setDetent],
  );

  const inSummary = state.view === 'summary';
  // ONE button that swaps its words: the same element stays focused across the swap, so Esc
  // still closes the drawer from it (a remounted button would drop focus to <body>).
  const tools = (
    <div className="pt-explain__tools">
      {inSummary ? null : (
        <ThreadMenu
          threads={threads.threads}
          position={threads.position}
          onSelect={threads.select}
          onNewThread={controller.startFresh}
          disabled={busy}
        />
      )}
      <button
        type="button"
        className={`pt-btn pt-explain__summary-toggle${inSummary ? '' : ' pt-btn--outline'}`}
        disabled={!inSummary && controller.paperId === null}
        onClick={() => (inSummary ? controller.setView('thread') : controller.summarize())}
      >
        {inSummary ? 'Back to conversation' : 'Summarize paper'}
      </button>
    </div>
  );
  const body = (
    <ThreadView
      controller={controller}
      threads={threads}
      initial={initial}
      onShow={onShow}
      onCite={onCite}
    />
  );

  if (!desktop) {
    return (
      <Sheet
        open
        title="Explain"
        detent={detent}
        onDetentChange={setDetent}
        onDismiss={controller.closeExplain}
        className="pt-explain-sheet"
      >
        <div className="pt-explain__toolbar">{tools}</div>
        {body}
      </Sheet>
    );
  }
  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Explain"
      data-explain-panel="drawer"
      className="pt-explain"
    >
      <header className="pt-explain__header">
        <h2 className="pt-explain__title">Explain</h2>
        {tools}
        <button
          type="button"
          className="pt-explain__close"
          aria-label="Close explain panel"
          onClick={controller.closeExplain}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="pt-icon">
            <path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </header>
      {body}
    </aside>
  );
}

/** The explain panel: a drawer or a sheet while open, nothing while closed. */
export function ExplainPanel({ controller, toggleRef }: ExplainPanelProps): ReactNode {
  const desktop = useMediaQuery(DESKTOP);
  const [detent, setDetent] = useState<SheetDetent>('half');
  const asideRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const { state, closeExplain } = controller;

  // Closing hands focus back to the toggle; otherwise it falls to <body> and a keyboard reader
  // starts again from the top of the page.
  useEffect(() => {
    if (wasOpen.current && !state.open) toggleRef.current?.focus({ preventScroll: true });
    wasOpen.current = state.open;
  }, [state.open, toggleRef]);

  // Esc on the toggle closes the panel too. On a phone, Enter on the toggle opens the sheet and
  // leaves focus on the toggle, and the sheet hears Esc only from inside itself (review S1).
  useEffect(() => {
    if (!state.open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && event.target === toggleRef.current) closeExplain();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.open, toggleRef, closeExplain]);

  // A new ask opens at the readable height, not wherever the last one was left.
  useEffect(() => {
    if (state.open) setDetent('half');
  }, [state.open, state.epoch]);

  useEffect(() => {
    const aside = asideRef.current;
    if (!state.open || !desktop || aside === null) return undefined;
    // The drawer takes focus when it opens, or when a new ask comes from the page; never from a
    // control inside it (the thread menu keeps focus across a thread switch, review 2.1).
    if (!aside.contains(document.activeElement)) aside.focus({ preventScroll: true });
    // Esc inside the drawer closes it. Listened for on the document, after React's root, so a
    // control that handles its own Esc (the thread menu) stops it from closing the whole panel.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && aside.contains(event.target as Node)) closeExplain();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.open, state.epoch, desktop, closeExplain]);

  // The drawer must not sit on the paper it explains: while it is open on a wide screen the page
  // makes room (a rule in `@papertree/ui` keyed on this attribute).
  useEffect(() => {
    if (!state.open || !desktop) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-pt-explain', 'open');
    return () => root.removeAttribute('data-pt-explain');
  }, [state.open, desktop]);

  if (!state.open) return null;
  return (
    <OpenPanel
      controller={controller}
      desktop={desktop}
      detent={detent}
      setDetent={setDetent}
      asideRef={asideRef}
    />
  );
}
