'use client';

/**
 * The notebook page screen (S5c, #208, frame 05): the header with Back to the paper, the floating
 * tool bar, the page on its desk, and the save toast. It owns the editing session (which note is
 * being typed in, the draft of a new one) and turns each finished gesture into ONE S5b history
 * command; `useNotebookPage` saves what a command touched. Data flow: UI → history → API → SQLite.
 */
import { Toast, formatPageLabel } from '@papertree/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { papersApi } from '@/lib/api/papers';

import { NotebookPage } from './NotebookPage';
import { NotebookToolbar } from './NotebookToolbar';
import { newClientId } from '../api/notebookApi';
import { useExchange } from '../hooks/useExchange';
import { useNotebookPage } from '../hooks/useNotebookPage';
import { usePageScale } from '../hooks/usePageScale';
import { dayAndTime, originPlace } from '../model/exchange';
import { placeNewItem } from '../model/layout';
import { itemForAnchor, readerHref } from '../model/links';
import { STICKY_COLOUR, parseExchangeBody } from '../model/wire';

import './notebook.css';

import type { StickyItem, TextItem } from '../model/page';
import type { Anchor } from '@papertree/anchoring';
import type { ReactNode } from 'react';

/** Props for `NotebookView`. */
export interface NotebookViewProps {
  readonly paperId: string;
  readonly pageId: string;
}

const NEW_SIZE = { text: { w: 288, h: 72 }, sticky: { w: 168, h: 144 } } as const;

/** True when a key event belongs to a field's own text editing (its own undo, its own arrows). */
function inField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.closest('textarea, input, [contenteditable]') !== null
  );
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
  const desk = useRef<HTMLDivElement>(null);
  const scale = usePageScale(desk);
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TextItem | StickyItem | null>(null);
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
  const backHref = readerHref(
    paperId,
    exchangeId === null || place === null ? undefined : { pageId, itemId: exchangeId },
  );
  const asked = exchange.question?.created_at ?? page?.created_at ?? null;

  const { undo, redo } = model;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || inField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') (e.shiftKey ? redo : undo)();
      else if (key === 'y') redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const focusAnchor = (anchor: Anchor): void => {
    const itemId = itemForAnchor(items, exchanges, anchor);
    router.push(readerHref(paperId, itemId === null ? undefined : { pageId, itemId }));
  };
  const startDraft = (kind: 'text' | 'sticky'): void => {
    const { w, h } = NEW_SIZE[kind];
    const at = placeNewItem(items, w, h);
    const id = newClientId('ni');
    const z = items.reduce((m, i) => Math.max(m, i.z), 0) + 1;
    const base = { id, ...at, w, h, z, text: '' };
    setDraft(kind === 'text' ? { ...base, kind } : { ...base, kind, color: STICKY_COLOUR });
    setEditingId(id);
  };
  const commit = (id: string, text: string): void => {
    setEditingId(null);
    if (draft !== null && draft.id === id) {
      setDraft(null);
      if (text.trim() !== '') model.run({ type: 'add-items', items: [{ ...draft, text }] });
    } else {
      const before = items.find((i) => i.id === id);
      if (before?.kind === 'text' || before?.kind === 'sticky') {
        model.run({ type: 'edit-text', itemId: id, before: before.text, after: text });
      }
    }
    // Back on the note, so the keyboard carries on from where the typing ended.
    requestAnimationFrame(() => {
      const holder = [...document.querySelectorAll<HTMLElement>('[data-item-id]')].find(
        (el) => el.dataset['itemId'] === id,
      );
      holder?.querySelector<HTMLElement>('[role="button"]')?.focus();
    });
  };
  const remove = (id: string): void => {
    const index = items.findIndex((i) => i.id === id);
    const value = items[index];
    if (value !== undefined) model.run({ type: 'remove-items', removed: [{ value, index }] });
  };

  const notice =
    model.save === 'conflict'
      ? {
          key: 'conflict',
          message:
            'This page changed somewhere else, so your last change was not saved. Reload to see the latest.',
          label: 'Reload',
          act: () => window.location.reload(),
        }
      : model.save === 'failed'
        ? {
            key: 'failed',
            message: 'Not saved yet. Your change is still on this page.',
            label: 'Try again',
            act: model.retry,
          }
        : null;

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
              onText={() => startDraft('text')}
              onSticky={() => startDraft('sticky')}
              onUndo={undo}
              onRedo={redo}
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
                place === null || asked === null
                  ? null
                  : {
                      href: backHref,
                      where: formatPageLabel(place.page, place.para),
                      day: dayAndTime(asked).day,
                    }
              }
              editingId={editingId}
              draft={draft}
              onEdit={setEditingId}
              onCommit={commit}
              onMove={(id, dx, dy) =>
                model.run({ type: 'move', strokeIds: [], itemIds: [id], dx, dy })
              }
              onDelete={remove}
              onFocusAnchor={focusAnchor}
            />
          </>
        )}
      </main>
      {notice === null || dismissed === notice.key ? null : (
        <Toast
          message={notice.message}
          duration={0}
          action={{ label: notice.label, onAction: notice.act }}
          onDismiss={() => setDismissed(notice.key)}
        />
      )}
    </div>
  );
}
