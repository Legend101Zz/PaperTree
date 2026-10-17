/**
 * TableView: the library as a ruled catalogue (#197, frame 01d). The state chips with their counts,
 * the Filter menu and the sort caption over a native `<table>` whose headers sort (aria-sort; a
 * second press reverses). The header's search filters the rows (the shelf's `matchPapers`), and
 * the chips count what the search and the Filter leave. With "need a look" on, the chips row says
 * why each of those papers needs one; an empty table says what emptied it. A topic filter whose
 * topic has left the library clears itself. Focus never falls to the page: after Retry it is on
 * the row's title, after Remove on the next row's (else the previous one's, else the Table tab).
 */
'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { emptyWords, filterIsOn, lookSentence, withoutGoneTopic } from '../model/table';
import { sortCaption, TABLE_COLUMNS, tablePool, tableRows, toggleSort } from '../model/tableSort';
import './table.css';
import { TableChips } from './TableChips';
import { FilterMenu } from './TableMenus';
import { TableRow } from './TableRow';

import type { LibraryBook } from '../hooks/useLibrary';
import type { TableViewState } from '../hooks/useTableView';
import type { ShelfTopic } from '../model/shelf';
import type { ReactNode } from 'react';

/** Props for `TableView`. */
export interface TableViewProps {
  /** Every paper in the library. */
  readonly books: readonly LibraryBook[];
  /** The header search's matches, or null when no search runs. */
  readonly matches: ReadonlySet<string> | null;
  readonly table: TableViewState;
  /** 44 px targets on touch. */
  readonly touch: boolean;
  readonly onRetry: (paperId: string) => Promise<unknown>;
  readonly onDelete: (paperId: string) => Promise<unknown>;
  readonly onShowOnShelf: (paperId: string) => void;
  /** Opens a paper in the reader. */
  readonly onRead: (paperId: string) => void;
}

/**
 * The Table view.
 *
 * @example
 * <TableView books={books} matches={matches} table={table} touch={false} onRetry={retry}
 *   onDelete={remove} onShowOnShelf={show} onRead={read} />
 */
export function TableView({
  books,
  matches,
  table,
  touch,
  onRetry,
  onDelete,
  onShowOnShelf,
  onRead,
}: TableViewProps): ReactNode {
  const captionId = useId();
  const { chip, filter, setFilter, sort, hidden } = table;
  const pool = useMemo(() => tablePool(books, filter, matches), [books, filter, matches]);
  const rows = useMemo(() => tableRows(pool, { chip, sort }), [pool, chip, sort]);
  const columns = useMemo(
    () => TABLE_COLUMNS.filter((c) => c.id !== 'title' && !hidden.has(c.id)).map((c) => c.id),
    [hidden],
  );
  const topics = useMemo(() => {
    const byId = new Map<string, ShelfTopic>();
    for (const book of books) if (book.topic) byId.set(book.topic.id, book.topic);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [books]);
  const unshelved = useMemo(() => books.some((b) => !b.topic), [books]);
  // Before paint: a filter on a topic with no papers left would hide every row, nameless.
  useLayoutEffect(() => {
    const kept = withoutGoneTopic(filter, new Set(topics.map((t) => t.id)), unshelved);
    if (kept !== filter) setFilter(kept);
  }, [filter, setFilter, topics, unshelved]);

  // Where focus goes once the next render has committed (the acted-on row may be gone by then).
  const [focusTo, setFocusTo] = useState<string | null>(null);
  const order = useRef<readonly string[]>([]);
  order.current = rows.map((row) => row.id);
  useLayoutEffect(() => {
    if (focusTo === null) return;
    const target =
      focusTo === ''
        ? null
        : document.querySelector<HTMLElement>(
            `[data-row-id="${CSS.escape(focusTo)}"] [data-row-title]`,
          );
    (target ?? document.querySelector<HTMLElement>('[data-view="table"]'))?.focus();
    setFocusTo(null);
  }, [focusTo, rows]);
  const retry = useCallback(
    async (paperId: string) => {
      await onRetry(paperId);
      setFocusTo(paperId);
    },
    [onRetry],
  );
  const remove = useCallback(
    async (paperId: string) => {
      const at = order.current.indexOf(paperId);
      const neighbour = order.current[at + 1] ?? order.current[at - 1] ?? '';
      await onDelete(paperId);
      setFocusTo(neighbour);
    },
    [onDelete],
  );

  const look = chip === 'look' ? lookSentence(pool) : null;
  const size = touch ? 'touch' : 'md';
  return (
    <section className="pt-libtable" aria-label="Your papers as a table">
      <div className="pt-libtable__bar">
        <TableChips counted={pool} chip={chip} onChip={table.setChip} touch={touch} />
        {look === null ? null : <p className="pt-libtable__why">{look}</p>}
        <div className="pt-libtable__tools">
          <FilterMenu
            filter={filter}
            onFilter={setFilter}
            topics={topics}
            unshelved={unshelved}
            size={size}
          />
          <p id={captionId} className="pt-libtable__sorted">
            {sortCaption(sort)}
          </p>
        </div>
      </div>
      <div className="pt-libtable__scroll">
        <table
          className="pt-libtable__grid"
          aria-label={chip === 'look' ? 'Papers that need a look' : 'Papers'}
          aria-describedby={captionId}
        >
          <thead>
            <tr>
              {TABLE_COLUMNS.filter((c) => c.id === 'title' || columns.includes(c.id)).map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={`pt-libtable__th pt-libtable__th--${c.id}`}
                  data-numeric={c.numeric === true || undefined}
                  aria-sort={sort.column === c.id ? sort.direction : undefined}
                >
                  <button
                    type="button"
                    className={touch ? TOUCH_TARGET : undefined}
                    onClick={() => table.setSort(toggleSort(sort, c.id))}
                  >
                    {c.label}
                    {sort.column === c.id ? (
                      <ChevronDown
                        size={14}
                        strokeWidth={1.5}
                        aria-hidden="true"
                        data-up={sort.direction === 'ascending' || undefined}
                      />
                    ) : null}
                  </button>
                </th>
              ))}
              <th scope="col" className="pt-libtable__th pt-libtable__th--actions">
                <span className="pt-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((book) => (
              <TableRow
                key={book.id}
                book={book}
                columns={columns}
                onRetry={retry}
                onDelete={remove}
                onShowOnShelf={onShowOnShelf}
                onRead={onRead}
                touch={touch}
              />
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="pt-libtable__none">
                  {emptyWords(chip, pool.length, {
                    search: matches !== null,
                    filter: filterIsOn(filter),
                  })}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
