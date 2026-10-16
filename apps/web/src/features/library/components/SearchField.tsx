/**
 * SearchField: the library header's central search (#195, frame 01, DESIGN.md §6). "/" anywhere
 * on the page focuses it (wired by LibraryView), Esc clears it, Enter takes down the first match,
 * and while it holds a query it says "2 of 24" inside the field.
 */
'use client';

import { Search } from 'lucide-react';
import { forwardRef, useId } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { useTouchTargets } from '../hooks/useTouchTargets';

import type { ReactNode } from 'react';

/** Props for `SearchField`. */
export interface SearchFieldProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** How many papers match, or null while the field is empty. */
  readonly matched: number | null;
  /** How many papers there are. */
  readonly total: number;
  /** Enter: take down the first match. */
  readonly onSubmit: () => void;
}

/**
 * The search field. Forwarded ref: the page focuses it on "/".
 *
 * @example
 * <SearchField ref={search} value={q} onChange={setQ} matched={2} total={24} onSubmit={takeFirst} />
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, matched, total, onSubmit },
  ref,
): ReactNode {
  const countId = useId();
  const target = useTouchTargets() ? ` ${TOUCH_TARGET}` : '';
  return (
    <div className="pt-search" role="search">
      <Search className="pt-search__icon" size={20} strokeWidth={1.5} aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        className={`pt-search__input${target}`}
        aria-label="Search the library"
        aria-describedby={countId}
        placeholder="Search titles, authors, topics"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault();
            onChange('');
          } else if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      {/* Always mounted, so the live region is there before its first change. */}
      <span id={countId} className="pt-search__count" role="status">
        {matched === null ? '' : `${String(matched)} of ${String(total)}`}
      </span>
      {matched === null ? (
        <kbd className="pt-kbd" aria-hidden="true">
          /
        </kbd>
      ) : (
        <button
          type="button"
          className={`pt-search__clear${target}`}
          aria-label="Clear the search"
          onClick={(event) => {
            // The button goes with the query; keep focus in the field rather than losing it.
            event.currentTarget.parentElement?.querySelector('input')?.focus();
            onChange('');
          }}
        >
          <kbd className="pt-kbd">Esc</kbd>
        </button>
      )}
    </div>
  );
});
