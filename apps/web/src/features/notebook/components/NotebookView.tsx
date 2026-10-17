'use client';

/**
 * The notebook page screen (S5c, #208, frame 05): the bar, the tool bar, the page on its desk, the
 * side panel and one toast, laid out by `useLayoutMode` (S5e, #210): the tablet's rail and inline
 * panel (05b), the phone's stack and bottom bar (08c); a page opened by Dive in slides in
 * (`useDiveArrival`). Editing is `usePageEditing` (one S5b history command per gesture), saving
 * `useNotebookPage` and `usePageTemplate`. Data flow: UI → history → API → SQLite.
 */
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { papersApi } from '@/lib/api/papers';

import { InkToolButtons } from './InkTools';
import { NotebookBar } from './NotebookBar';
import { NotebookPage } from './NotebookPage';
import { PageGone } from './NotebookPageList';
import { NotebookPanel } from './NotebookPanel';
import { NotebookToolbar } from './NotebookToolbar';
import { INK_FOLD_NOTE, PageToast } from './PageToast';
import { PHONE_BAR_SPACE, PhoneBar } from './PhoneBar';
import { PhoneStack } from './PhoneStack';
import { LayoutInkOptions } from './RailInkOptions';
import { PageSaveNotice } from './SaveNotice';
import { notebookApi, notebookKeys } from '../api/notebookApi';
import { useBoardCard } from '../hooks/useBoardCard';
import { useDiveArrival } from '../hooks/useDiveArrival';
import { useExchange } from '../hooks/useExchange';
import { useDeleteUndo } from '../hooks/useDeleteUndo';
import { inkInHand, useLayoutInkTools } from '../hooks/useInkTools';
import { useLasso } from '../hooks/useLasso';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { useNotebookPage } from '../hooks/useNotebookPage';
import { usePageEditing } from '../hooks/usePageEditing';
import { usePageLinks } from '../hooks/usePageLinks';
import { usePageScale } from '../hooks/usePageScale';
import { usePageTemplate } from '../hooks/usePageTemplate';
import { useSendPage } from '../hooks/useSendPage';
import { boardHref } from '../model/links';

import './notebook.css';

import type { CSSProperties, ReactNode } from 'react';

/** Props for `NotebookView`. */
export interface NotebookViewProps {
  readonly paperId: string;
  readonly pageId: string;
}

const NO_MATCHES: ReadonlySet<string> = new Set();

export { INK_FOLD_NOTE } from './PageToast';

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
  const mode = useLayoutMode();
  const tools = useLayoutInkTools(mode);
  const { tool } = tools.state;
  const lasso = useLasso(paperId, model, tool === 'lasso');
  const template = usePageTemplate(page);
  const board = useBoardCard(paperId, pageId, page?.title ?? 'Notebook page');
  const { send, notice, dismiss } = useSendPage(paperId, board);
  const desk = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const scale = usePageScale(desk, mode === 'desktop' ? undefined : 0);
  // The phone reads the page as a stack; a drawing tool in the hand shows the page to draw on.
  const stack = mode === 'phone' && tool === null;
  // Ready once the thread is read too: until then the cards have no numbers to fly to.
  const ready = page !== null && model.step !== null && !exchange.loading;
  const arriving = useDiveArrival(pageId, ready, stack ? 1 : scale, root);
  const [matches, setMatches] = useState<ReadonlySet<string>>(NO_MATCHES);
  const [foldNote, setFoldNote] = useState(0);
  const items = model.step?.state.items ?? [];
  // On the phone every delete says so with Undo: there is no keyboard and no Undo in view.
  const deletes = useDeleteUndo(mode === 'phone', items, model.step?.history.past.at(-1), editing);

  const { exchanges, exchangeId, exchangeBody, place, backHref, source, focusAnchor } =
    usePageLinks(paperId, pageId, model.view ?? null, items, exchange);

  // The side panel stands beside the page on a desktop; on a tablet the page is full-bleed (05b),
  // so the panel follows it down the desk instead of leaving the screen.
  const beside = mode === 'desktop';
  const panel =
    page === null || mode === 'phone' ? null : (
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
      // The phone bar's room, one number for the desk's padding and the toasts (PHONE_BAR_SPACE).
      style={{ '--pt-nb-bar-space': `${String(PHONE_BAR_SPACE)}px` } as CSSProperties}
    >
      <NotebookBar
        backHref={backHref}
        paperTitle={paperTitle}
        page={place?.page ?? null}
        boardHref={boardHref(paperId)}
        onSend={send}
        sendDisabled={page === null || board.sending || board.card === undefined}
        {...(mode === 'desktop' ? {} : { pageTitle: page?.title ?? null })}
        compact={mode === 'phone'}
      />
      <main className="pt-nb__desk" ref={desk} aria-label="Notebook page">
        {model.loadError !== null ? (
          <PageGone paperId={paperId} />
        ) : page === null || model.step === null ? (
          <p className="pt-nb__loading" role="status">
            Opening the page…
          </p>
        ) : stack ? (
          <PhoneStack
            title={page.title}
            template={template.template ?? page.template}
            body={exchangeBody}
            exchange={exchange}
            items={items}
            strokes={model.step.state.strokes}
            source={source}
            editingId={editing.editingId}
            draft={editing.draft}
            onEdit={editing.edit}
            onCommit={editing.commit}
            onDelete={deletes.remove}
            onFocusAnchor={focusAnchor}
          />
        ) : (
          <>
            {mode === 'phone' ? null : (
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
                  <LayoutInkOptions
                    rail={mode === 'tablet'}
                    state={tools.state}
                    onAction={tools.dispatch}
                  />
                }
              />
            )}
            <NotebookPage
              page={page}
              template={template.template ?? page.template}
              items={items}
              strokes={model.step.state.strokes}
              exchanges={exchanges}
              exchange={exchange}
              scale={scale}
              source={source}
              editingId={editing.editingId}
              draft={editing.draft}
              onEdit={editing.edit}
              onCommit={editing.commit}
              onMove={editing.move}
              onResize={editing.resize}
              onDelete={deletes.remove}
              onFocusAnchor={focusAnchor}
              matches={matches}
              ink={inkInHand(tools.state, {
                onStroke: editing.draw,
                onErase: editing.erase,
                onLasso: lasso.onLasso,
                penSeen: tools.penSeen,
                onRefused: () => setFoldNote((n) => n + 1),
              })}
              lasso={lasso.layer}
            />
            {beside ? null : panel}
          </>
        )}
        {mode === 'phone' && model.step !== null ? (
          // Inside the page's landmark, so the bar is part of the notebook, not loose on the screen.
          <PhoneBar
            tools={tools.state}
            onTool={tools.dispatch}
            onText={() => editing.startDraft('text')}
            onSticky={() => editing.startDraft('sticky')}
            onUndo={editing.undo}
            canUndo={model.step.history.past.length > 0}
          />
        ) : null}
      </main>
      {beside ? panel : null}
      <PageSaveNotice model={model} template={template} />
      <PageToast
        // Clear of the phone's bar (its line and its 56 px buttons).
        {...(mode === 'phone' ? { bottomInset: PHONE_BAR_SPACE } : {})}
        notices={[
          deletes.notice,
          lasso.notice === null ? null : { ...lasso.notice, onDismiss: lasso.dismiss },
          foldNote === 0
            ? null
            : { key: foldNote, message: INK_FOLD_NOTE, onDismiss: () => setFoldNote(0) },
          notice === null ? null : { ...notice, onDismiss: dismiss },
        ]}
      />
    </div>
  );
}
