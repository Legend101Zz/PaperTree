import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

import { sendToCanvas } from '@/components/canvas/sendToCanvas';
import { ExplainPanel, useExplainActions } from '@/components/explain';
import {
  ReaderActionsProvider,
  type FocusOptions,
  type ReaderActions,
} from '@/components/reader/actions';
import { useSummaryFromBook } from '@/features/book';
import { AskFromNotebook } from '@/features/notebook/components/AskFromNotebook';
import { useThreadFromNotebook } from '@/features/notebook/hooks/useThreadFromNotebook';
import { BoardBeside, useDragIn, type BoardBesideControl } from '@/features/split';

import { ImageToolProvider } from '../hooks/useImageTool';

import type { PaperRef } from '@/lib/paperSource';
import type { Anchor } from '@papertree/anchoring';
import type { ExplainToggle } from './ReaderHeader';

/**
 * The header's Explain toggle (#203), provided by the mount that owns the explain controller; null
 * for a sample paper, which has no server to ask.
 */
const ExplainToggleContext = createContext<ExplainToggle | null>(null);

/** The header reads the Explain toggle from here; null for a paper with no server. */
export function useExplainToggle(): ExplainToggle | null {
  return useContext(ExplainToggleContext);
}

/**
 * The `ReaderActions` mount (contracts.md §5) — S0's lines in this file.
 *
 * It decides which implementation fills each action; the callers (`SourcePane`'s toolbar, the
 * explain panel's chips in S6, the canvas in S7) reach them through `useReaderActions()`.
 * `openExplain` and `sendToCanvas` are owned by S6 and S7 and change behind these same lines.
 * `focusAnchor` is S4's: resolve → scroll → the citation flash, implemented by the workspace above.
 *
 * A component of its own because the workspace returns early (loading, error) and hooks may not
 * follow an early return.
 */
export function ReaderActionsMount({
  paper,
  onFocusAnchor,
  beside,
  visiblePages,
  onNotice,
  children,
}: {
  readonly paper: PaperRef;
  readonly onFocusAnchor: (anchor: Anchor, opts?: FocusOptions) => void;
  readonly beside: BoardBesideControl;
  readonly visiblePages: ReadonlySet<number>;
  readonly onNotice: (message: string) => void;
  readonly children: React.ReactNode;
}) {
  const paperId = paper.kind === 'api' ? paper.paperId : null;
  const explain = useExplainActions({ paperId });
  const { openExplain, askAbout, openPanel, closeExplain, summarize } = explain;
  const explainOpen = explain.state.open;
  // S5e: a dived page's Back to the paper (`?thread=`) reopens the panel on its thread.
  useThreadFromNotebook(paperId, explain.selectThread);
  // The opened book's Summary (#200): the panel opens on the summary, the cached one first.
  useSummaryFromBook(paperId, () => {
    openPanel();
    summarize();
  });
  // Explain and the board share the right-hand side (P4 decision 4): opening one closes the other.
  const boardOpen = beside.open;
  const closeBeside = beside.close;
  useEffect(() => {
    if (boardOpen) closeExplain();
  }, [boardOpen, closeExplain]);
  useEffect(() => {
    if (explainOpen) closeBeside();
  }, [explainOpen, closeBeside]);

  // A source "p. n" clicked on a card: the paper scrolls to the passage and flashes it; the board
  // stays put. A paper folded to a strip comes back first, and the flash waits for it to settle.
  const folded = beside.state.folded;
  const restore = beside.restore;
  const showInPaper = useCallback(
    (target: { readonly anchor: Anchor | null }) => {
      const anchor = target.anchor;
      if (anchor === null) return;
      if (folded === 'paper') {
        restore();
        setTimeout(() => onFocusAnchor(anchor, { flash: true }), 360);
      } else {
        onFocusAnchor(anchor, { flash: true });
      }
    },
    [folded, restore, onFocusAnchor],
  );
  // A selection dragged across the divider: the card lands at the drop point, and glows.
  const dragIn = useDragIn(paperId, beside.arriveAt, onNotice);

  const toggleRef = useRef<HTMLButtonElement>(null);
  const toggle = useMemo<ExplainToggle | null>(
    () =>
      paperId === null
        ? null
        : {
            open: explainOpen,
            ref: toggleRef,
            onToggle: (next) => (next ? openPanel() : closeExplain()),
          },
    [paperId, explainOpen, openPanel, closeExplain],
  );
  const actions = useMemo<ReaderActions>(
    () => ({
      openExplain,
      askAbout,
      sendToCanvas: (input) => sendToCanvas(paperId, input),
      focusAnchor: (anchor, opts) => onFocusAnchor(anchor, opts),
    }),
    [openExplain, askAbout, paperId, onFocusAnchor],
  );

  return (
    <ReaderActionsProvider value={actions}>
      <ExplainToggleContext.Provider value={toggle}>
        <ImageToolProvider>{children}</ImageToolProvider>
      </ExplainToggleContext.Provider>
      <ExplainPanel controller={explain} toggleRef={toggleRef} />
      {paperId !== null && beside.open ? (
        <BoardBeside
          paperId={paperId}
          split={beside}
          visiblePages={visiblePages}
          arrival={beside.arrival}
          onShowInPaper={showInPaper}
          dragIn={dragIn}
        />
      ) : null}
      {/* S5d: the notebook lasso's "Ask about this" arrives here as a new ask (`?ask=`). */}
      <AskFromNotebook paperId={paperId} controller={explain} />
    </ReaderActionsProvider>
  );
}
