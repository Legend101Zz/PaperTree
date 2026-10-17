'use client';

/**
 * The notebook page screen (S5c, #208, frame 05): the header (Back to the paper, Send page to
 * board, Open board), the floating tool bar, the page on its desk, the side panel, and one toast.
 * S5e (#210) lays it out by `useLayoutMode`: on a tablet (05b) the tools are a left rail and the
 * panel follows the full-bleed page down the desk; a page opened by Dive in slides in
 * (`useDiveArrival`).
 * Editing lives in `usePageEditing` (each finished gesture is ONE S5b history command), saving in
 * `useNotebookPage` and `usePageTemplate`, the board card in `useBoardCard`.
 * Data flow: UI → history → API → SQLite; the panel's numbers come back from the API.
 */
import { Toast, formatPageLabel } from '@papertree/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';

import { papersApi } from '@/lib/api/papers';

import { InkOptions, InkToolButtons } from './InkTools';
import { NotebookBar } from './NotebookBar';
import { NotebookPage } from './NotebookPage';
import { NotebookPanel } from './NotebookPanel';
import { NotebookToolbar } from './NotebookToolbar';
import { RailInkOptions } from './RailInkOptions';
import { PageSaveNotice } from './SaveNotice';
import { notebookApi, notebookKeys } from '../api/notebookApi';
import { useBoardCard } from '../hooks/useBoardCard';
import { useDiveArrival } from '../hooks/useDiveArrival';
import { useExchange } from '../hooks/useExchange';
import { inkInHand, useInkTools } from '../hooks/useInkTools';
import { useLasso } from '../hooks/useLasso';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { useNotebookPage } from '../hooks/useNotebookPage';
import { usePageEditing } from '../hooks/usePageEditing';
import { usePageScale } from '../hooks/usePageScale';
import { usePageTemplate } from '../hooks/usePageTemplate';
import { useSendPage } from '../hooks/useSendPage';
import { dayAndTime, originPlace } from '../model/exchange';
import { enabledActions, selectionName } from '../model/lasso';
import { boardHref, itemForAnchor, readerHref } from '../model/links';
import { parseExchangeBody } from '../model/wire';

import './notebook.css';

import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

/** Props for `NotebookView`. */
export interface NotebookViewProps {
  readonly paperId: string;
  readonly pageId: string;
}

const NO_MATCHES: ReadonlySet<string> = new Set();

/** Said when a stroke starts in the band the open answer opened (`model/inkPlace`). */
export const INK_FOLD_NOTE =
  'Ink can’t start beside the opened part of the answer: that space goes when the answer ' +
  'closes. Start above it or below it, or collapse the answer first.';

/** One notebook page, editable. */
export function NotebookView({ paperId, pageId }: NotebookViewProps): ReactNode {
  const model = useNotebookPage(paperId, pageId);
  const page = model.view?.page ?? null;
  const exchange = useExchange(
    paperId,
    page?.source_thread_id ?? null,
    page?.source_message_id ?? null,
  );
  const papers = useQuery({
    queryKey: ['papers'],
    queryFn: () => papersApi.list(),
    staleTime: 60_000,
  });
  const pages = useQuery({
    queryKey: notebookKeys.pages(paperId),
    queryFn: () => notebookApi.listPages(paperId),
  });
  const paperTitle = papers.data?.find((p) => p.paper_id === paperId)?.title ?? null;
  const editing = usePageEditing(model);
  const tools = useInkTools();
  const lasso = useLasso(paperId, model, tools.state.tool === 'lasso');
  const picked = lasso.selection?.picked ?? null;
  const template = usePageTemplate(page);
  const board = useBoardCard(paperId, pageId, page?.title ?? 'Notebook page');
  const { send, notice, dismiss } = useSendPage(paperId, board);
  const desk = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const mode = useLayoutMode();
  const scale = usePageScale(desk, mode === 'tablet' ? 0 : undefined);
  // Ready once the thread is read too: until then the cards have no numbers to fly to.
  const ready = page !== null && model.step !== null && !exchange.loading;
  const arriving = useDiveArrival(pageId, ready, scale, root);
  const router = useRouter();
  const [matches, setMatches] = useState<ReadonlySet<string>>(NO_MATCHES);
  const [foldNote, setFoldNote] = useState(0);
  const items = model.step?.state.items ?? [];

  const exchanges = useMemo(
    () =>
      new Map(
        (model.view?.items ?? [])
          .filter((i) => i.kind === 'exchange')
          .map((i) => [i.item_id, parseExchangeBody(i.body)] as const),
      ),
    [model.view],
  );
  const [exchangeId, exchangeBody] = [...exchanges][0] ?? [null, null];
  const origin = exchangeBody?.call.originAnchor ?? null;
  const place = origin === null ? null : originPlace(origin, exchange.layout);
  const at = exchangeId === null || place === null ? undefined : { pageId, itemId: exchangeId };
  // Back to the paper opens the reader's explain panel on the thread the page was dived from.
  const backHref = readerHref(paperId, at, page?.source_thread_id ?? null);
  // The question's own date; when the thread cannot be read the line says no date at all, rather
  // than labelling the Dive-in date as the question's.
  const asked = exchange.question?.created_at ?? null;

  const toReader = (anchor: Anchor): void => {
    const itemId = itemForAnchor(items, exchanges, anchor);
    router.push(readerHref(paperId, itemId === null ? undefined : { pageId, itemId }));
  };
  // One identity for the page's lifetime, so the memoised cards and slips do not re-render.
  const latestToReader = useRef(toReader);
  latestToReader.current = toReader;
  const focusAnchor = useCallback((anchor: Anchor) => latestToReader.current(anchor), []);

  // The side panel stands beside the page on a desktop; on a tablet the page is full-bleed (05b),
  // so the panel follows it down the desk instead of leaving the screen.
  const beside = mode === 'desktop';
  const panel =
    page === null ? null : (
      <NotebookPanel
        paperId={paperId}
        pageId={pageId}
        title={page.title}
        template={template.template ?? page.template}
        onTemplate={template.choose}
        counts={pages.data?.find((p) => p.page_id === pageId)?.counts ?? null}
        hasQuestion={exchangeId !== null}
        citations={exchange.answer?.coverage?.citations ?? null}
        passages={exchange.answer?.coverage?.passages ?? null}
        card={board.card}
        boardUnreadable={board.unreadable}
        sending={board.sending}
        items={items}
        onSend={send}
        onMatches={setMatches}
        inline={!beside}
      />
    );

  return (
    <div
      className="pt-nb"
      ref={root}
      data-layout={mode}
      data-dive={arriving ? 'arriving' : undefined}
    >
      <NotebookBar
        backHref={backHref}
        paperTitle={paperTitle}
        page={place?.page ?? null}
        boardHref={boardHref(paperId)}
        onSend={send}
        sendDisabled={page === null || board.sending || board.card === undefined}
        {...(mode === 'desktop' ? {} : { pageTitle: page?.title ?? null })}
      />
      <main className="pt-nb__desk" ref={desk} aria-label="Notebook page">
        {model.loadError !== null ? (
          <div className="pt-state" role="alert">
            <h1 className="pt-state__title">This page could not be opened</h1>
            <p className="pt-state__body">
              It may have been deleted, or the server is not answering.
            </p>
            <Link className="pt-btn pt-btn--primary" href={readerHref(paperId)}>
              Back to the paper
            </Link>
          </div>
        ) : page === null || model.step === null ? (
          <p className="pt-nb__loading" role="status">
            Opening the page…
          </p>
        ) : (
          <>
            <NotebookToolbar
              onText={() => editing.startDraft('text')}
              onSticky={() => editing.startDraft('sticky')}
              onShape={editing.addShape}
              onUndo={editing.undo}
              onRedo={editing.redo}
              canUndo={model.step.history.past.length > 0}
              canRedo={model.step.history.future.length > 0}
              orientation={mode === 'tablet' ? 'vertical' : 'horizontal'}
              inkTools={<InkToolButtons state={tools.state} onAction={tools.dispatch} />}
              inkOptions={
                mode === 'tablet' ? (
                  <RailInkOptions state={tools.state} onAction={tools.dispatch} />
                ) : (
                  <InkOptions state={tools.state} onAction={tools.dispatch} />
                )
              }
            />
            <NotebookPage
              page={page}
              template={template.template ?? page.template}
              items={items}
              strokes={model.step.state.strokes}
              exchanges={exchanges}
              exchange={exchange}
              scale={scale}
              source={
                place === null
                  ? null
                  : {
                      href: backHref,
                      where: formatPageLabel(place.page, place.para),
                      day: asked === null ? null : dayAndTime(asked).day,
                    }
              }
              editingId={editing.editingId}
              draft={editing.draft}
              onEdit={editing.edit}
              onCommit={editing.commit}
              onMove={editing.move}
              onResize={editing.resize}
              onDelete={editing.remove}
              onFocusAnchor={focusAnchor}
              matches={matches}
              ink={inkInHand(tools.state, {
                onStroke: editing.draw,
                onErase: editing.erase,
                onLasso: lasso.onLasso,
                penSeen: tools.penSeen,
                onRefused: () => setFoldNote((n) => n + 1),
              })}
              lasso={
                lasso.selection === null || picked === null
                  ? null
                  : {
                      path: lasso.selection.path,
                      name: selectionName(picked),
                      enabled: enabledActions(picked),
                      onAction: lasso.act,
                      onClose: lasso.close,
                    }
              }
            />
            {beside ? null : panel}
          </>
        )}
      </main>
      {beside ? panel : null}
      <PageSaveNotice model={model} template={template} />
      {lasso.notice !== null ? (
        <Toast
          key={lasso.notice.key}
          message={lasso.notice.message}
          {...(lasso.notice.action ? { action: lasso.notice.action } : {})}
          onDismiss={lasso.dismiss}
        />
      ) : foldNote > 0 ? (
        <Toast key={foldNote} message={INK_FOLD_NOTE} onDismiss={() => setFoldNote(0)} />
      ) : notice === null ? null : (
        <Toast message={notice.message} action={notice.action} onDismiss={dismiss} />
      )}
    </div>
  );
}
