/**
 * useTableView: the Table view's page state (#197): the state chip, the Filter menu, the sort and
 * the hidden columns. Held by the page, not the table, so it survives a switch to the Shelf and
 * back, and so "N need a look" in the title can open the table filtered. Only the hidden columns
 * are stored (per viewer, in this browser).
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { NO_FILTER, type StateChip, type TableFilter } from '../model/table';
import { DEFAULT_SORT, parseHidden, type TableColumn, type TableSort } from '../model/tableSort';

/** Where the hidden columns are kept: a JSON list of column ids. */
export const COLUMNS_KEY = 'papertree/library/table-columns';

/** The table's state and its setters. */
export interface TableViewState {
  readonly chip: StateChip;
  readonly setChip: (chip: StateChip) => void;
  readonly filter: TableFilter;
  readonly setFilter: (filter: TableFilter) => void;
  readonly sort: TableSort;
  readonly setSort: (sort: TableSort) => void;
  readonly hidden: ReadonlySet<TableColumn>;
  readonly setShown: (column: TableColumn, shown: boolean) => void;
}

// Storage can be missing or throw (private windows, blocked site data): the table works without it.
function readHidden(): ReadonlySet<TableColumn> {
  try {
    return parseHidden(window.localStorage.getItem(COLUMNS_KEY));
  } catch {
    return new Set();
  }
}

/**
 * The Table view's state.
 *
 * @returns The chip, filter, sort and columns, with setters.
 */
export function useTableView(): TableViewState {
  const [chip, setChip] = useState<StateChip>('all');
  const [filter, setFilter] = useState<TableFilter>(NO_FILTER);
  const [sort, setSort] = useState<TableSort>(DEFAULT_SORT);
  const [hidden, setHidden] = useState<ReadonlySet<TableColumn>>(new Set());
  // After mount: the server render has no storage, and both renders must agree.
  useEffect(() => setHidden(readHidden()), []);
  const setShown = useCallback((column: TableColumn, shown: boolean) => {
    setHidden((was) => {
      const next = new Set(was);
      if (shown) next.delete(column);
      else if (column !== 'title') next.add(column);
      try {
        window.localStorage.setItem(COLUMNS_KEY, JSON.stringify([...next]));
      } catch {
        // Not stored: the choice holds for this visit only.
      }
      return next;
    });
  }, []);
  return { chip, setChip, filter, setFilter, sort, setSort, hidden, setShown };
}
