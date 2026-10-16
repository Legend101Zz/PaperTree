/**
 * TableCells: the Table view's richer cells (#197, frame 01d): the authors with the full list in a
 * popover, the topic with its cloth and source line, the "…" menu of a row, and the dash that says
 * a value is missing in words a screen reader hears ("unknown", "never").
 */
'use client';

import { MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { usePopover } from '../hooks/usePopover';
import { authorsShort } from '../model/catalogue';
import { clothFor } from '../model/shelf';
import { topicSource } from '../model/table';

import type { LibraryBook } from '../hooks/useLibrary';
import type { ReactNode } from 'react';

/**
 * "—" on the page, a word for a screen reader: a missing value, never an invented one.
 *
 * @example
 * <Dash words="never" />
 */
export function Dash({ words }: { readonly words: string }): ReactNode {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="pt-sr-only">{words}</span>
    </>
  );
}

/**
 * "Ashish Vaswani et al.", opening "Authors · full" with every name (frame 01d's popover). One or
 * two authors are printed whole, so there is nothing to open.
 *
 * @example
 * <AuthorsCell authors={book.authors} />
 */
export function AuthorsCell({
  authors,
  target = '',
}: {
  readonly authors: readonly string[];
  /** The touch-target class, on touch. */
  readonly target?: string;
}): ReactNode {
  const popover = usePopover();
  const short = authorsShort(authors);
  if (short === null) return <Dash words="no authors found" />;
  if (authors.length <= 2) return <span className="pt-trow__authors">{short}</span>;
  return (
    <div ref={popover.wrapper} className="pt-trow__pop">
      <button
        ref={popover.button}
        type="button"
        className={`pt-trow__authors pt-trow__authors--more ${target}`}
        aria-expanded={popover.open}
        aria-controls={popover.open ? popover.panelId : undefined}
        onClick={popover.toggle}
      >
        {short}
        <span className="pt-sr-only">{`, all ${String(authors.length)} authors`}</span>
      </button>
      {popover.open ? (
        <div id={popover.panelId} className="pt-trow__popover" role="group" aria-label="Authors">
          <span className="pt-trow__popover-head" aria-hidden="true">
            authors · full
          </span>
          <p>{authors.join(', ')}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The topic, its cloth and where it came from ("arXiv cs.CL · accepted"), or "Unshelved".
 *
 * @example
 * <TopicCell book={book} />
 */
export function TopicCell({ book }: { readonly book: LibraryBook }): ReactNode {
  const topic = book.topic ?? null;
  if (topic === null) return <span className="pt-trow__muted">Unshelved</span>;
  const source = topicSource(topic);
  return (
    <>
      <span className="pt-trow__topic">
        <span
          className="pt-trow__cloth"
          style={{ backgroundColor: `var(--pt-cloth-${clothFor(book)})` }}
          aria-hidden="true"
        />
        {topic.name}
      </span>
      {source === null ? null : <span className="pt-trow__sub">{source}</span>}
    </>
  );
}

/** Props for `RowMenu`. */
export interface RowMenuProps {
  readonly book: LibraryBook;
  /** Retry is offered only for a paper we could not read. */
  readonly onRetry: () => void;
  /** Remove is never offered for a sample paper. */
  readonly onRemove: () => void;
  readonly onShowOnShelf: (paperId: string) => void;
  /** The touch-target class, on touch. */
  readonly target?: string;
}

/**
 * A row's "…" menu: Open, Retry (could not read only), Remove (danger, confirmed in the row) and
 * Show on the shelf. Opens with focus on its first item.
 *
 * @example
 * <RowMenu book={book} onRetry={retry} onRemove={() => setConfirming(true)} onShowOnShelf={show} />
 */
export function RowMenu({
  book,
  onRetry,
  onRemove,
  onShowOnShelf,
  target = '',
}: RowMenuProps): ReactNode {
  const menu = usePopover();
  const { open, wrapper } = menu;
  useEffect(() => {
    if (open) wrapper.current?.querySelector<HTMLElement>('[data-row-menu-item]')?.focus();
  }, [open, wrapper]);
  // An item that takes the row away from the menu closes it without returning focus to "…".
  const then = (action: () => void) => () => {
    menu.setOpen(false);
    action();
  };
  return (
    <div ref={menu.wrapper} className="pt-trow__pop">
      <button
        ref={menu.button}
        type="button"
        className={`pt-trow__icon ${target}`}
        aria-label={`More actions for ${book.title}`}
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.panelId : undefined}
        onClick={menu.toggle}
      >
        <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {menu.open ? (
        <div id={menu.panelId} className="pt-trow__menu" role="group" aria-label={book.title}>
          <Link
            href={`/paper/${book.id}/read`}
            prefetch={false}
            className={target}
            data-row-menu-item=""
          >
            Open
          </Link>
          {book.processing === 'failed' ? (
            <button type="button" className={target} data-row-menu-item="" onClick={then(onRetry)}>
              Retry
            </button>
          ) : null}
          {book.isSample === true ? null : (
            <button
              type="button"
              className={`pt-trow__danger ${target}`}
              data-row-menu-item=""
              onClick={then(onRemove)}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            className={target}
            data-row-menu-item=""
            onClick={then(() => onShowOnShelf(book.id))}
          >
            Show on the shelf
          </button>
        </div>
      ) : null}
    </div>
  );
}
