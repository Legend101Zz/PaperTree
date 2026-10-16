/**
 * TableRow: one paper in the Table view (#197, frame 01d): its title (a link to the reader), the
 * shown columns, the State cell with Retry · Remove for a paper we could not read, and the row's
 * arrow and "…" menu. Remove is confirmed in a row of its own under it. Memoised: a search or a
 * poll re-renders only the rows whose paper changed.
 */
'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { memo, useRef } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { useBookActions } from '../hooks/useBookActions';
import { openedLabel, tableState } from '../model/table';
import { RemoveConfirm } from './RemoveConfirm';
import { AuthorsCell, Dash, RowMenu, TopicCell } from './TableCells';

import type { LibraryBook } from '../hooks/useLibrary';
import type { TableColumn } from '../model/tableSort';
import type { ReactNode } from 'react';

/** Props for `TableRow`. */
export interface TableRowProps {
  readonly book: LibraryBook;
  /** The shown columns after Title, in order. */
  readonly columns: readonly TableColumn[];
  readonly onRetry: (paperId: string) => Promise<unknown>;
  readonly onDelete: (paperId: string) => Promise<unknown>;
  readonly onShowOnShelf: (paperId: string) => void;
  /** 44 px targets on touch (`useTouchTargets`). */
  readonly touch?: boolean;
}

/** The State cell: the word, its glyph and its small line; Retry · Remove when we could not read. */
function StateCell({
  book,
  onRetry,
  onRemove,
  target,
}: {
  readonly book: LibraryBook;
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
          <button type="button" className={`pt-trow__link ${target}`} onClick={onRetry}>
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
 * <TableRow book={book} columns={['authors', 'year']} onRetry={retry} onDelete={remove} onShowOnShelf={show} />
 */
export const TableRow = memo(function TableRow({
  book,
  columns,
  onRetry,
  onDelete,
  onShowOnShelf,
  touch = false,
}: TableRowProps): ReactNode {
  const actions = useBookActions(book.id, onRetry, onDelete);
  const target = touch ? TOUCH_TARGET : '';
  const title = useRef<HTMLAnchorElement>(null);
  const href = `/paper/${book.id}/read`;
  const confirm = (): void => actions.setConfirming(true);
  const state = (
    <StateCell book={book} onRetry={actions.retry} onRemove={confirm} target={target} />
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
            {book.title}
          </Link>
        </th>
        {columns.map((column) => (
          <td key={column} className={`pt-trow__cell pt-trow__cell--${column}`}>
            {cell(column, book, state, target)}
          </td>
        ))}
        <td className="pt-trow__actions">
          {/* A second way in for a pointer; the title link is the keyboard's (one stop, not two). */}
          <Link href={href} prefetch={false} tabIndex={-1} className="pt-trow__icon pt-trow__open">
            <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" />
            <span className="pt-sr-only">{`Read ${book.title}`}</span>
          </Link>
          <RowMenu
            book={book}
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
