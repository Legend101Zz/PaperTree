/**
 * The Table view's sort (#197): every column sorts, a missing value sorts last whichever way, ties
 * go by title and keep their order when the direction flips, a second press reverses, the caption
 * says what is going on, and a stored column choice can never hide the Title.
 */
import { describe, expect, it } from 'vitest';

import { NO_FILTER, type TablePaper } from './table';
import {
  compareRows,
  DEFAULT_SORT,
  parseHidden,
  sortCaption,
  tablePool,
  tableRows,
  toggleSort,
  type TableColumn,
  type TableSort,
} from './tableSort';

function paper(id: string, overrides: Partial<TablePaper> = {}): TablePaper {
  return {
    id,
    title: id,
    authors: [],
    pageCount: 10,
    processing: 'complete',
    addedAt: '2026-10-01T00:00:00Z',
    highlightCount: 0,
    ...overrides,
  };
}

const ids = (papers: readonly TablePaper[], sort: TableSort) =>
  [...papers].sort(compareRows(sort)).map((p) => p.id);

const opened = (iso: string) => ({
  last_page: 0,
  furthest_page: 0,
  page_count: 10,
  opened_at: iso,
  finished_at: null,
  state: 'reading' as const,
});

describe('sorting', () => {
  const papers = [
    paper('Gamma', { year: 2017 }),
    paper('alpha', { year: null }),
    paper('Beta', { year: 2015 }),
    paper('Delta', { year: 2017 }),
  ];

  it('sorts by year both ways, with an unknown year last both ways', () => {
    expect(ids(papers, { column: 'year', direction: 'ascending' })).toEqual([
      'Beta',
      'Delta',
      'Gamma',
      'alpha',
    ]);
    expect(ids(papers, { column: 'year', direction: 'descending' })).toEqual([
      'Delta',
      'Gamma',
      'Beta',
      'alpha',
    ]);
  });

  it('is stable: equal years keep title order in both directions, whatever the input order', () => {
    const reversed = [...papers].reverse();
    for (const direction of ['ascending', 'descending'] as const) {
      const order = ids(reversed, { column: 'year', direction });
      expect(order.indexOf('Delta')).toBeLessThan(order.indexOf('Gamma'));
      expect(order).toEqual(ids(papers, { column: 'year', direction }));
    }
  });

  it('sorts titles case-blind and numbers as numbers', () => {
    const titled = [paper('b10'), paper('B2'), paper('a')];
    expect(ids(titled, { column: 'title', direction: 'ascending' })).toEqual(['a', 'B2', 'b10']);
  });

  it('puts unshelved papers, uncounted pages and never-opened papers last', () => {
    const topic = (name: string) => ({ id: name, name, cloth: null });
    const rows = [
      paper('u'),
      paper('v', { topic: topic('Vision'), pageCount: 0, reading: opened('2026-10-12T00:00:00Z') }),
      paper('t', {
        topic: topic('Transformers'),
        pageCount: 34,
        reading: opened('2026-10-16T00:00:00Z'),
      }),
    ];
    expect(ids(rows, DEFAULT_SORT)).toEqual(['t', 'v', 'u']);
    expect(ids(rows, { column: 'topic', direction: 'descending' })).toEqual(['v', 't', 'u']);
    expect(ids(rows, { column: 'pages', direction: 'descending' })).toEqual(['t', 'u', 'v']);
    expect(ids(rows, { column: 'opened', direction: 'descending' })).toEqual(['t', 'v', 'u']);
    expect(ids(rows, { column: 'opened', direction: 'ascending' })).toEqual(['v', 't', 'u']);
  });

  it("sorts authors by the first author's surname, as a catalogue does; no authors last", () => {
    const rows = [
      paper('attention', { authors: ['Ashish Vaswani∗', 'Noam Shazeer'] }),
      paper('resnet', { authors: ['Kaiming He'] }),
      paper('nobody'),
      paper('bert', { authors: ['Jacob Devlin'] }),
    ];
    expect(ids(rows, { column: 'authors', direction: 'ascending' })).toEqual([
      'bert',
      'resnet',
      'attention',
      'nobody',
    ]);
  });

  it('orders the State column from reading now to could not read', () => {
    const rows = [
      paper('failed', { processing: 'failed' }),
      paper('fresh'),
      paper('reading', { reading: opened('2026-10-16T00:00:00Z') }),
    ];
    expect(ids(rows, { column: 'state', direction: 'ascending' })).toEqual([
      'reading',
      'fresh',
      'failed',
    ]);
  });

  it('a second press reverses; another column starts in its natural direction', () => {
    const year = toggleSort(DEFAULT_SORT, 'year');
    expect(year).toEqual({ column: 'year', direction: 'ascending' });
    expect(toggleSort(year, 'year')).toEqual({ column: 'year', direction: 'descending' });
    expect(toggleSort(year, 'opened').direction).toBe('descending');
    expect(toggleSort(year, 'highlights').direction).toBe('descending');
  });

  it('captions the sort', () => {
    expect(sortCaption(DEFAULT_SORT)).toBe('Sorted by topic, then title');
    expect(sortCaption({ column: 'year', direction: 'descending' })).toBe(
      'Sorted by year, newest first, then title',
    );
    expect(sortCaption({ column: 'title', direction: 'descending' })).toBe('Sorted by title, Z–A');
  });
});

describe('the rows', () => {
  it('are the search matches through the filter (the pool), under the chip, sorted', () => {
    const rows = [
      paper('b', { year: 2016 }),
      paper('a', { year: 2015 }),
      paper('x', { processing: 'failed' }),
    ];
    const view = { chip: 'all' as const, sort: { ...DEFAULT_SORT, column: 'year' as TableColumn } };
    const all = tablePool(rows, NO_FILTER, null);
    expect(tableRows(all, view).map((p) => p.id)).toEqual(['a', 'b', 'x']);
    const matched = tablePool(rows, NO_FILTER, new Set(['b', 'x']));
    expect(matched.map((p) => p.id)).toEqual(['b', 'x']);
    expect(tableRows(matched, view).map((p) => p.id)).toEqual(['b', 'x']);
    expect(tableRows(all, { ...view, chip: 'look' }).map((p) => p.id)).toEqual(['x']);
    const from2016 = { ...NO_FILTER, year: { from: 2016, to: null } };
    expect(tableRows(tablePool(rows, from2016, null), view).map((p) => p.id)).toEqual(['b']);
  });
});

describe('the stored columns', () => {
  it('reads a list of hidden columns, never the Title, and survives a bad value', () => {
    expect([...parseHidden('["year","title","nonsense","opened"]')]).toEqual(['year', 'opened']);
    expect(parseHidden(null).size).toBe(0);
    expect(parseHidden('{not json').size).toBe(0);
    expect(parseHidden('{"year":true}').size).toBe(0);
  });
});
