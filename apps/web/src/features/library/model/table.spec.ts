/**
 * The Table view's model (#197): the State cell from `processing` and `reading`, the chips' counts
 * (the five states partition any set of papers, as frame 01d's 24 = 3 + 10 + 9 + 2), the Filter
 * menu (an unknown value is in no range; a topic that has left is dropped), the source line, the
 * date, the "need a look" sentence and what an empty table says.
 */
import { describe, expect, it } from 'vitest';

import { libraryStats } from './shelf';
import {
  chipCounts,
  emptyWords,
  filterIsOn,
  filterSummary,
  inChip,
  lookSentence,
  NO_FILTER,
  openedLabel,
  passesFilter,
  readerHref,
  tableState,
  topicSource,
  UNSHELVED,
  withoutGoneTopic,
  type TablePaper,
} from './table';

import type { ReadingProgress } from '@/lib/api/types';

const reading = (state: 'reading' | 'finished', lastPage = 3): ReadingProgress => ({
  last_page: lastPage,
  furthest_page: lastPage,
  page_count: 15,
  opened_at: '2026-10-16T09:00:00Z',
  finished_at: state === 'finished' ? '2026-10-16T09:00:00Z' : null,
  state,
});

function paper(id: string, overrides: Partial<TablePaper> = {}): TablePaper {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    pageCount: 15,
    processing: 'complete',
    addedAt: '2026-10-01T00:00:00Z',
    highlightCount: 0,
    ...overrides,
  };
}

const LIBRARY: readonly TablePaper[] = [
  paper('a', { reading: reading('reading') }),
  paper('b', { reading: reading('finished', 14) }),
  paper('c'),
  paper('d', { processing: 'partial' }),
  paper('e', { processing: 'pending' }),
  paper('f', { processing: 'parsing', reading: reading('reading') }),
  paper('g', { processing: 'failed', pageCount: 0 }),
  // A place in a paper whose page count nobody knows: the stats line cannot count it as reading.
  paper('h', { pageCount: 0, reading: { ...reading('reading'), page_count: null } }),
];

describe('the State cell', () => {
  it('says where you are, or what we are doing', () => {
    expect(LIBRARY.map((p) => [p.id, tableState(p).label, tableState(p).detail])).toEqual([
      ['a', 'Reading now', 'p. 4 of 15'],
      ['b', 'Read', null],
      ['c', 'Not started', null],
      // Our partial reading, said so it cannot read as the person's progress.
      ['d', 'Not started', 'Some parts unreadable'],
      ['e', 'Queued', 'Readable in Source mode now'],
      // Processing wins over reading, as on the spine (kraft, not a ribbon).
      ['f', 'Reading', 'Readable in Source mode now'],
      ['g', 'Could not read', null],
      ['h', 'Opened', null],
    ]);
    expect(tableState(LIBRARY[7] as TablePaper).kind).toBe('not-started');
  });

  it('opens a paper at its reader in every state', () => {
    expect(readerHref('ppr_1')).toBe('/paper/ppr_1/read');
  });
});

describe('the chips', () => {
  it('count from data, the four states and "need a look" adding up to All', () => {
    const counts = chipCounts(LIBRARY);
    expect(counts).toEqual({ all: 8, 'reading-now': 1, read: 1, 'not-started': 3, look: 3 });
    expect(counts['reading-now'] + counts.read + counts['not-started'] + counts.look).toBe(8);
  });

  it('agree with the stats line: reading now and need a look, a place without a page count too', () => {
    const stats = libraryStats(LIBRARY);
    const counts = chipCounts(LIBRARY);
    expect([counts['reading-now'], counts.look]).toEqual([stats.readingNow, stats.needALook]);
  });

  it('a paper still being read is in "need a look" and in none of the reading chips', () => {
    const f = LIBRARY[5] as TablePaper;
    expect(['reading-now', 'read', 'not-started'].some((c) => inChip(f, c as 'read'))).toBe(false);
    expect(inChip(f, 'look')).toBe(true);
  });
});

describe('the Filter menu', () => {
  const vision = { id: 't1', name: 'Vision & detection', cloth: 'vision' as const };
  const papers = [
    paper('2015', { year: 2015, topic: vision, pageCount: 12 }),
    paper('2017', { year: 2017, pageCount: 34 }),
    paper('none', { year: null, pageCount: 0 }),
  ];
  const kept = (filter: Parameters<typeof passesFilter>[1]) =>
    papers.filter((p) => passesFilter(p, filter)).map((p) => p.id);

  it('keeps everything with no filter', () => {
    expect(kept(NO_FILTER)).toEqual(['2015', '2017', 'none']);
  });

  it('a year range is inclusive, and a paper with no year is in no range', () => {
    expect(kept({ ...NO_FILTER, year: { from: 2015, to: 2016 } })).toEqual(['2015']);
    expect(kept({ ...NO_FILTER, year: { from: null, to: 2017 } })).toEqual(['2015', '2017']);
  });

  it('a pages range leaves out a paper whose pages were never counted', () => {
    expect(kept({ ...NO_FILTER, pages: { from: 10, to: null } })).toEqual(['2015', '2017']);
    expect(kept({ ...NO_FILTER, pages: { from: null, to: 20 } })).toEqual(['2015']);
  });

  it('filters by a topic, or by having none', () => {
    expect(kept({ ...NO_FILTER, topic: 't1' })).toEqual(['2015']);
    expect(kept({ ...NO_FILTER, topic: UNSHELVED })).toEqual(['2017', 'none']);
  });

  it('says what is on', () => {
    expect(filterSummary(NO_FILTER, null)).toBeNull();
    const on = { topic: 't1', year: { from: 2015, to: 2018 }, pages: { from: 10, to: null } };
    expect(filterSummary(on, 'Vision & detection')).toBe(
      'Vision & detection · 2015–2018 · from 10 pages',
    );
    expect(filterSummary({ ...NO_FILTER, topic: UNSHELVED }, null)).toBe('Unshelved');
  });

  it('knows when it is on', () => {
    expect(filterIsOn(NO_FILTER)).toBe(false);
    expect(filterIsOn({ ...NO_FILTER, pages: { from: null, to: 9 } })).toBe(true);
    expect(filterIsOn({ ...NO_FILTER, topic: UNSHELVED })).toBe(true);
  });

  it('drops a topic that has left the library, and keeps one that is still there', () => {
    const on = { ...NO_FILTER, topic: 't1', year: { from: 2015, to: null } };
    expect(withoutGoneTopic(on, new Set(['t1']), false)).toBe(on);
    expect(withoutGoneTopic(on, new Set(['t2']), true)).toEqual({ ...on, topic: null });
    const unshelved = { ...NO_FILTER, topic: UNSHELVED };
    expect(withoutGoneTopic(unshelved, new Set(), true)).toBe(unshelved);
    expect(withoutGoneTopic(unshelved, new Set(['t1']), false)).toEqual(NO_FILTER);
    expect(withoutGoneTopic(NO_FILTER, new Set(), false)).toBe(NO_FILTER);
  });
});

describe('the words around the cells', () => {
  it('says where a topic came from, without inventing a source', () => {
    const base = { id: 't', name: 'T', cloth: null };
    expect(topicSource({ ...base, source: 'arxiv_category', sourceDetail: 'cs.CL' })).toBe(
      'arXiv cs.CL · accepted',
    );
    expect(topicSource({ ...base, source: 'manual', sourceDetail: null })).toBe('chosen by you');
    expect(topicSource({ ...base, source: 'model', sourceDetail: 'MiniMax-M3' })).toBe(
      'suggested by the AI (MiniMax-M3) · accepted',
    );
    expect(topicSource({ ...base, source: 'model', sourceDetail: null })).toBe(
      'suggested by the AI · accepted',
    );
    expect(topicSource(base)).toBeNull();
    expect(topicSource(null)).toBeNull();
    // The opened book's sentence, from the same rule (#200).
    const arxiv = { ...base, source: 'arxiv_category' as const, sourceDetail: 'cs.CL' };
    expect(topicSource(arxiv, 'book')).toBe('suggested from arXiv cs.CL · you accepted');
    expect(topicSource({ ...base, source: 'model', sourceDetail: 'MiniMax-M3' }, 'book')).toBe(
      'suggested by the AI (MiniMax-M3) · you accepted',
    );
    expect(topicSource({ ...base, source: 'manual' }, 'book')).toBe('chosen by you');
  });

  it('prints the last-opened date as the frame does, with the year only when it is not this one', () => {
    const now = new Date(2026, 9, 17);
    expect(openedLabel(new Date(2026, 9, 16, 10).toISOString(), now)).toBe('16 Oct');
    expect(openedLabel(new Date(2025, 8, 3, 10).toISOString(), now)).toBe('3 Sep 2025');
    expect(openedLabel(null, now)).toBeNull();
    expect(openedLabel('not a date', now)).toBeNull();
  });

  it('names up to three papers that need a look, then counts them', () => {
    const lora = paper('l', { title: 'LoRA: Low-Rank Adaptation', processing: 'parsing' });
    const glue = paper('s', { title: 'SuperGLUE: A Stickier Benchmark', processing: 'failed' });
    expect(lookSentence([lora, glue, paper('x')])).toBe(
      'LoRA is still being read; SuperGLUE could not be read.',
    );
    const many = [
      lora,
      glue,
      paper('q', { processing: 'pending' }),
      paper('r', { processing: 'failed' }),
    ];
    expect(lookSentence(many)).toBe('2 are still to be read; 2 could not be read.');
    expect(lookSentence([paper('x')])).toBeNull();
  });

  it('says what emptied the table: the chip, the search, the filter or both', () => {
    const none = { search: false, filter: false };
    expect(emptyWords('read', 4, none)).toBe('Nothing here is Read yet.');
    expect(emptyWords('reading-now', 2, { search: true, filter: false })).toBe(
      'Nothing here is being read now.',
    );
    expect(emptyWords('all', 0, { search: true, filter: false })).toBe(
      'No papers match the search. Clear it to see them all.',
    );
    expect(emptyWords('read', 0, { search: false, filter: true })).toBe(
      'No papers pass the filter. Clear the filter to see them all.',
    );
    expect(emptyWords('all', 0, { search: true, filter: true })).toBe(
      'No papers match the search and the filter. Clear them to see them all.',
    );
  });
});
