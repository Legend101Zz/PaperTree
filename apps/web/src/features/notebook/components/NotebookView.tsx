'use client';

/**
 * The notebook page screen (S5c, #208, frame 05): the header (Back to the paper, Send page to
 * board, Open board), the floating tool bar, the page on its desk, the side panel, and one toast.
 * Editing lives in `usePageEditing` (each finished gesture is ONE S5b history command), saving in
 * `useNotebookPage` and `usePageTemplate`, the board card in `useBoardCard`.
 * Data flow: UI → history → API → SQLite; the panel's numbers come back from the API.
 */
import { Button, Toast, formatPageLabel } from '@papertree/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, LayoutDashboard, Pin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';

import { papersApi } from '@/lib/api/papers';

import { NotebookPage } from './NotebookPage';
import { NotebookPanel } from './NotebookPanel';
import { NotebookToolbar } from './NotebookToolbar';
import { SaveNotice, unsavedPhrase } from './SaveNotice';
import { notebookApi, notebookKeys } from '../api/notebookApi';
import { useBoardCard } from '../hooks/useBoardCard';
import { useExchange } from '../hooks/useExchange';
import { useNotebookPage } from '../hooks/useNotebookPage';
import { usePageEditing } from '../hooks/usePageEditing';
import { usePageScale } from '../hooks/usePageScale';
import { usePageTemplate } from '../hooks/usePageTemplate';
import { dayAndTime, originPlace } from '../model/exchange';
import { boardHref, itemForAnchor, readerHref } from '../model/links';
import { parseExchangeBody } from '../model/wire';

import './notebook.css';

import type { SendResult } from '../hooks/useBoardCard';
import type { SaveStatus } from '../hooks/useItemSaver';
import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

/** Props for `NotebookView`. */
export interface NotebookViewProps {
  readonly paperId: string;
  readonly pageId: string;
}

const NO_MATCHES: ReadonlySet<string> = new Set();

const SENT: Readonly<Record<Exclude<SendResult, 'already'>, string>> = {
  sent: 'The page is on the board now, as one card.',
  failed: 'The page could not be sent to the board. Try again.',
};

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
  const template = usePageTemplate(page);
  const board = useBoardCard(paperId, pageId, page?.title ?? 'Notebook page');
  const desk = useRef<HTMLDivElement>(null);
  const scale = usePageScale(desk);
  const router = useRouter();
  const [matches, setMatches] = useState<ReadonlySet<string>>(NO_MATCHES);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
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
  const backHref = readerHref(paperId, at);
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
  // One card per page: a page already on the board opens the board instead of sending again.
  const send = (): void => {
    if (board.card !== null && board.card !== undefined) {
      router.push(boardHref(paperId));
      return;
    }
    void board.send().then((result) => {
      setSent(result);
      setDismissed(null);
    });
  };
  // The items and the template save separately and are reported as one: one conflict bar, one
  // count of what is not saved, one Try again that re-sends both.
  const saving: SaveStatus = {
    ...model.save,
    conflict: model.save.conflict || template.save.conflict,
    pageGone: model.save.pageGone || template.save.pageGone,
    failed: model.save.failed + (template.save.failed ? 1 : 0),
    failure: model.save.failure + template.save.failure,
  };
  const retry = (): void => {
    model.retry();
    template.retry();
  };

  const notice =
    sent === null
      ? null
      : {
          key: `sent-${sent}`,
          message: SENT[sent],
          action: { label: 'Open board', onAction: () => router.push(boardHref(paperId)) },
        };

  return (
    <div className="pt-nb">
      <header className="pt-nb__bar">
        <Link className="pt-nb__back" href={backHref}>
          <ArrowLeft size={20} aria-hidden />
          Back to the paper
          {paperTitle === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <cite className="pt-nb__paper">{paperTitle}</cite>
              {place === null ? null : <span className="pt-nb__where">p. {place.page}</span>}
            </>
          )}
        </Link>
        <span className="pt-nb__actions">
          <Button
            leadingIcon={<Pin size={18} />}
            onClick={send}
            disabled={page === null || board.sending || board.card === undefined}
          >
            Send page to board
          </Button>
          <Link className="pt-button pt-button--secondary pt-button--md" href={boardHref(paperId)}>
            <LayoutDashboard size={18} aria-hidden />
            Open board
          </Link>
        </span>
      </header>
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
            />
          </>
        )}
      </main>
      {page === null ? null : (
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
        />
      )}
      <SaveNotice
        status={saving}
        unsaved={unsavedPhrase(model.unsaved, template.unsaved)}
        unsavedText={model.unsavedText}
        onRetry={retry}
        onReload={() => window.location.reload()}
      />
      {notice === null || dismissed === notice.key ? null : (
        <Toast
          message={notice.message}
          action={notice.action}
          onDismiss={() => setDismissed(notice.key)}
        />
      )}
    </div>
  );
}
