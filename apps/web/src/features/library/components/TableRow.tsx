/**
 * TableRow: one paper in the Table view (#197, frame 01d): its title (a link to the reader), the
 * shown columns, the State cell with Retry · Remove for a paper we could not read, and the row's
 * arrow and "…" menu. Remove is confirmed in a row of its own under it. While a Retry or Remove
 * runs, both Retry buttons say so and do nothing. Memoised: a search or a poll re-renders only the
 * rows whose paper changed (`useLibrary` keeps an unchanged paper's object across polls).
 */
'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { memo, useRef } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { useBookActions } from '../hooks/useBookActions';
import { openedLabel, readerHref, tableState } from '../model/table';
import { RemoveConfirm } from './RemoveConfirm';
import { AuthorsCell, Dash, RowMenu, TopicCell } from './TableCells';

import type { LibraryBook } from '../hooks/useLibrary';
import type { TableColumn } from '../model/tableSort';
import type { MouseEvent, ReactNode } from 'react';

/** Props for `TableRow`. */
export interface TableRowProps {
  readonly book: LibraryBook;
  /** The shown columns after Title, in order. */
  readonly columns: readonly TableColumn[];
  readonly onRetry: (paperId: string) => Promise<unknown>;
  readonly onDelete: (paperId: string) => Promise<unknown>;
  readonly onShowOnShelf: (paperId: string) => void;
  /** Opens the reader in this tab (the arrow's plain click). */
  readonly onRead: (paperId: string) => void;
  /** 44 px targets on touch (`useTouchTargets`). */
  readonly touch?: boolean;
}

/** The State cell: the word, its glyph and its small line; Retry · Remove when we could not read. */
function StateCell({
  book,
  busy,
  onRetry,
  onRemove,
  target,
}: {
  readonly book: LibraryBook;
  readonly busy: boolean;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
  readonly target: string;
}): ReactNode {
  const state = tableState(book);
  return (
    <>
      <span className="pt-trow__state" data-state={state.kind}>
        {state.kind === 'reading-now' || state.kind === 'parsing' ? (
          <span className={`pt-trow__glyph pt-trow__glyph--${state.kind}`} aria-hidden="true" />
        ) : null}
        {state.label}
      </span>
      {state.kind === 'failed' ? (
        <span className="pt-trow__sub">
          <button
            type="button"
            className={`pt-trow__link ${target}`}
            aria-disabled={busy || undefined}
            onClick={busy ? undefined : onRetry}
          >
            Retry<span className="pt-sr-only">{` reading ${book.title}`}</span>
          </button>
          {book.isSample === true ? null : (
            <>
              {' · '}
              <button
                type="button"
                className={`pt-trow__link pt-trow__danger ${target}`}
                onClick={onRemove}
              >
                Remove<span className="pt-sr-only">{` ${book.title}`}</span>
              </button>
            </>
          )}
        </span>
      ) : state.detail === null ? null : (
        <span className="pt-trow__sub">{state.detail}</span>
      )}
    </>
  );
}

function cell(column: TableColumn, book: LibraryBook, state: ReactNode, target: string): ReactNode {
  switch (column) {
    case 'authors':
      return <AuthorsCell authors={book.authors} target={target} />;
    case 'year':
      return book.year === null ? <Dash words="unknown" /> : book.year;
    case 'topic':
      return <TopicCell book={book} />;
    case 'pages':
      return book.pageCount > 0 ? book.pageCount : <Dash words="unknown" />;
    case 'state':
      return state;
    case 'highlights':
      return book.highlightCount > 0 ? book.highlightCount : <Dash words="none" />;
    default: {
      const opened = book.reading?.opened_at ?? null;
      const label = openedLabel(opened);
      return label === null ? <Dash words="never" /> : <time dateTime={opened ?? ''}>{label}</time>;
    }
  }
}

/**
 * One table row (and, while Remove is confirmed, the row under it).
 *
 * @example
 * <TableRow book={book} columns={['authors', 'year']} onRetry={retry} onDelete={remove}
 *   onShowOnShelf={show} onRead={read} />
 */
export const TableRow = memo(function TableRow({
  book,
  columns,
  onRetry,
  onDelete,
  onShowOnShelf,
  onRead,
  touch = false,
}: TableRowProps): ReactNode {
  const actions = useBookActions(book.id, onRetry, onDelete);
  const target = touch ? TOUCH_TARGET : '';
  const title = useRef<HTMLAnchorElement>(null);
  const href = readerHref(book.id);
  const confirm = (): void => actions.setConfirming(true);
  // A plain click stays in the app; a middle or modified click is the browser's (a new tab).
  const openHere = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    onRead(book.id);
  };
  const state = (
    <StateCell
      book={book}
      busy={actions.busy}
      onRetry={actions.retry}
      onRemove={confirm}
      target={target}
    />
  );
  return (
    <>
      <tr
        className="pt-trow"
        data-row-id={book.id}
        data-processing-state={book.processing}
        aria-busy={actions.busy || undefined}
      >
        <th scope="row" className="pt-trow__title">
          <Link ref={title} href={href} prefetch={false} className={target} data-row-title="">
            <span className="pt-trow__name">{book.title}</span>
          </Link>
        </th>
        {columns.map((column) => (
          <td key={column} className={`pt-trow__cell pt-trow__cell--${column}`}>
            {cell(column, book, state, target)}
          </td>
        ))}
        <td className="pt-trow__actions">
          {/* A second way in for a pointer; the title link is the keyboard's (one stop, not two).
              A plain link: a Next <Link> per row would watch 400 more elements for prefetch. */}
          <a href={href} tabIndex={-1} className="pt-trow__icon pt-trow__open" onClick={openHere}>
            <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
            <span className="pt-sr-only">{`Read ${book.title}`}</span>
          </a>
          <RowMenu
            book={book}
            busy={actions.busy}
            onRetry={actions.retry}
            onRemove={confirm}
            onShowOnShelf={onShowOnShelf}
            target={target}
          />
        </td>
      </tr>
      {actions.confirming || actions.error !== null ? (
        <tr className="pt-trow pt-trow--note">
          <td colSpan={columns.length + 2}>
            {actions.confirming ? (
              <RemoveConfirm
                title={book.title}
                busy={actions.busy}
                onConfirm={actions.remove}
                onKeep={() => {
                  title.current?.focus();
                  actions.setConfirming(false);
                }}
              />
            ) : null}
            {actions.error === null ? null : (
              <p role="alert" className="pt-catalogue__error">
                {actions.error}
              </p>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
});
