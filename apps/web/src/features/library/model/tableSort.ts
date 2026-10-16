/**
 * library/model/tableSort — the Table view's columns and sort (#197, frame 01d). Every column
 * sorts; a value the server does not have (no year, no page count, never opened, no topic) sorts
 * last whichever way, and ties go by title then id, so equal rows never trade places when the
 * direction flips. Which columns are shown is stored per viewer (`parseHidden`).
 */
import {
  inChip,
  passesFilter,
  tableState,
  type StateChip,
  type TableFilter,
  type TablePaper,
  type TableStateKind,
} from './table';

/** The table's columns, in frame 01d's order. */
export type TableColumn =
  'title' | 'authors' | 'year' | 'topic' | 'pages' | 'state' | 'highlights' | 'opened';

/** Each column's header, and whether its numbers sit right (Pages, Highlights). */
export const TABLE_COLUMNS: readonly {
  readonly id: TableColumn;
  readonly label: string;
  readonly numeric?: boolean;
}[] = [
  { id: 'title', label: 'Title' },
  { id: 'authors', label: 'Authors' },
  { id: 'year', label: 'Year' },
  { id: 'topic', label: 'Topic' },
  { id: 'pages', label: 'Pages', numeric: true },
  { id: 'state', label: 'State' },
  { id: 'highlights', label: 'Highlights', numeric: true },
  { id: 'opened', label: 'Last opened' },
];

/** A sort: the column and its direction, as `aria-sort` names them. */
export interface TableSort {
  readonly column: TableColumn;
  readonly direction: 'ascending' | 'descending';
}

/** Frame 01d's order: "Sorted by topic, then title". */
export const DEFAULT_SORT: TableSort = { column: 'topic', direction: 'ascending' };

// The order of the State column: what you are reading first, what could not be read last.
const STATE_ORDER: Readonly<Record<TableStateKind, number>> = {
  'reading-now': 0,
  read: 1,
  'not-started': 2,
  queued: 3,
  parsing: 4,
  failed: 5,
};

type Key = string | number | null;

function sortKey(paper: TablePaper, column: TableColumn): Key {
  switch (column) {
    case 'title':
      return paper.title;
    case 'authors':
      return paper.authors[0]?.trim() || null;
    case 'year':
      return paper.year ?? null;
    case 'topic':
      return paper.topic?.name ?? null;
    case 'pages':
      return paper.pageCount > 0 ? paper.pageCount : null;
    case 'state':
      return STATE_ORDER[tableState(paper).kind];
    case 'highlights':
      return paper.highlightCount;
    default:
      return paper.reading?.opened_at ?? null;
  }
}

const compareText = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

/**
 * The comparator for a sort: by the column, nulls last in both directions, then by title and id.
 *
 * @param sort - The column and direction.
 * @returns A comparator for `Array.prototype.sort`.
 */
export function compareRows(sort: TableSort): (a: TablePaper, b: TablePaper) => number {
  const sign = sort.direction === 'ascending' ? 1 : -1;
  return (a, b) => {
    const ka = sortKey(a, sort.column);
    const kb = sortKey(b, sort.column);
    let order = 0;
    if (ka === null || kb === null) order = Number(ka === null) - Number(kb === null);
    else if (typeof ka === 'number' && typeof kb === 'number') order = sign * (ka - kb);
    else order = sign * compareText(String(ka), String(kb));
    return order || compareText(a.title, b.title) || a.id.localeCompare(b.id);
  };
}

// Counts and dates read best biggest or newest first; the rest start A–Z, oldest, fewest.
const STARTS_DESCENDING: ReadonlySet<TableColumn> = new Set(['highlights', 'opened']);

/**
 * A header click: the same column reverses, another starts in its natural direction.
 *
 * @param sort - The current sort.
 * @param column - The header clicked.
 * @returns The next sort.
 */
export function toggleSort(sort: TableSort, column: TableColumn): TableSort {
  if (sort.column === column) {
    return { column, direction: sort.direction === 'ascending' ? 'descending' : 'ascending' };
  }
  return { column, direction: STARTS_DESCENDING.has(column) ? 'descending' : 'ascending' };
}

const DIRECTION_WORDS: Readonly<Record<TableColumn, readonly [string, string]>> = {
  title: ['', 'Z–A'],
  authors: ['', 'Z–A'],
  topic: ['', 'Z–A'],
  year: ['oldest first', 'newest first'],
  pages: ['fewest first', 'most first'],
  state: ['reading now first', 'could not read first'],
  highlights: ['fewest first', 'most first'],
  opened: ['least recent first', 'most recent first'],
};

/**
 * "Sorted by topic, then title", "Sorted by year, newest first, then title".
 *
 * @param sort - The sort.
 * @returns The caption.
 */
export function sortCaption(sort: TableSort): string {
  const label = TABLE_COLUMNS.find((c) => c.id === sort.column)?.label.toLowerCase() ?? '';
  const words = DIRECTION_WORDS[sort.column][sort.direction === 'ascending' ? 0 : 1];
  const then = sort.column === 'title' ? '' : ', then title';
  return `Sorted by ${label}${words === '' ? '' : `, ${words}`}${then}`;
}

/**
 * The table's rows: the search's matches (the same `matchPapers` as the shelf), under the chip,
 * through the Filter menu, sorted.
 *
 * @param papers - Every paper.
 * @param view - The chip, the filter and the sort.
 * @param matches - The search's matches, or null when no search runs.
 * @returns The rows, in order.
 */
export function tableRows<P extends TablePaper>(
  papers: readonly P[],
  view: { readonly chip: StateChip; readonly filter: TableFilter; readonly sort: TableSort },
  matches: ReadonlySet<string> | null,
): P[] {
  return papers
    .filter((p) => (matches === null || matches.has(p.id)) && inChip(p, view.chip))
    .filter((p) => passesFilter(p, view.filter))
    .sort(compareRows(view.sort));
}

/**
 * The hidden columns stored for this viewer, checked: unknown names and the Title (always shown)
 * are dropped, so a stale or hand-edited value can never hide the row's name.
 *
 * @param raw - The stored JSON, or null.
 * @returns The hidden columns.
 */
export function parseHidden(raw: string | null): ReadonlySet<TableColumn> {
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(value)) return new Set();
  return new Set(
    TABLE_COLUMNS.map((c) => c.id).filter((id) => id !== 'title' && value.includes(id)),
  );
}
