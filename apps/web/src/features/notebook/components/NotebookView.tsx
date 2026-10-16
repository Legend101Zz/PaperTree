'use client';

/**
 * The notebook page screen (S5c, #208, frame 05): the header with Back to the paper, the floating
 * tool bar, the page on its desk, and the saving notices. Editing lives in `usePageEditing` (each
 * finished gesture is ONE S5b history command), saving in `useNotebookPage`.
 * Data flow: UI → history → API → SQLite.
 */
import { formatPageLabel } from '@papertree/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';

import { papersApi } from '@/lib/api/papers';

import { NotebookPage } from './NotebookPage';
import { NotebookToolbar } from './NotebookToolbar';
import { SaveNotice } from './SaveNotice';
import { useExchange } from '../hooks/useExchange';
import { useNotebookPage } from '../hooks/useNotebookPage';
import { usePageEditing } from '../hooks/usePageEditing';
import { usePageScale } from '../hooks/usePageScale';
import { dayAndTime, originPlace } from '../model/exchange';
import { itemForAnchor, readerHref } from '../model/links';
import { parseExchangeBody } from '../model/wire';

import './notebook.css';

import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

/** Props for `NotebookView`. */
export interface NotebookViewProps {
  readonly paperId: string;
  readonly pageId: string;
}

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
  const paperTitle = papers.data?.find((p) => p.paper_id === paperId)?.title ?? null;
  const editing = usePageEditing(model);
  const desk = useRef<HTMLDivElement>(null);
  const scale = usePageScale(desk);
  const router = useRouter();
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
  const backHref = readerHref(
    paperId,
    exchangeId === null || place === null ? undefined : { pageId, itemId: exchangeId },
  );
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
              onUndo={editing.undo}
              onRedo={editing.redo}
              canUndo={model.step.history.past.length > 0}
              canRedo={model.step.history.future.length > 0}
            />
            <NotebookPage
              page={page}
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
              onDelete={editing.remove}
              onFocusAnchor={focusAnchor}
            />
          </>
        )}
      </main>
      <SaveNotice
        status={model.save}
        unsaved={model.unsaved}
        onRetry={model.retry}
        onReload={() => window.location.reload()}
      />
    </div>
  );
}
