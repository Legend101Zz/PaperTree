/**
 * The Topics model (#198): which papers stand on a card, the card's stats from data, the source
 * line's wording, a pending offer in words, the cloth a new topic gets and the grid's arrow keys.
 */
import { describe, expect, it } from 'vitest';

import {
  CLOTHS,
  gridStep,
  nextCloth,
  offerLine,
  topicShelves,
  topicSourceLine,
  topicStats,
} from './topics';

import type { ShelfPaper, ShelfTopic } from './shelf';
import type { PaperTopic, Topic } from '@/lib/api/topics';
import type { ReadingProgress } from '@/lib/api/types';

const T: Topic = {
  topic_id: 'top_t',
  name: 'Transformers & attention',
  cloth: 'transformers',
  sort_order: 0,
  paper_count: 2,
  page_count: 31,
  categories: ['cs.CL'],
};
const V: Topic = { ...T, topic_id: 'top_v', name: 'Vision & detection', cloth: 'vision' };
const onT = (source: ShelfTopic['source'], sourceDetail: string | null = null): ShelfTopic => ({
  id: T.topic_id,
  name: T.name,
  cloth: T.cloth,
  source,
  sourceDetail,
});

function paper(id: string, overrides: Partial<ShelfPaper> = {}): ShelfPaper {
  return {
    id,
    title: `Paper ${id}`,
    authors: [],
    pageCount: 10,
    processing: 'complete',
    addedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const reading = (state: ReadingProgress['state']): ReadingProgress => ({
  last_page: 3,
  furthest_page: 9,
  page_count: 10,
  opened_at: '2026-10-10T00:00:00Z',
  finished_at: state === 'finished' ? '2026-10-11T00:00:00Z' : null,
  state,
});

describe('topicShelves', () => {
  it('puts each ACCEPTED paper on its topic in shelving order, keeps empty topics, in topic order', () => {
    const papers = [
      paper('b', { topic: onT('manual'), addedAt: '2026-10-03T00:00:00Z' }),
      paper('a', { topic: onT('arxiv_category', 'cs.CL'), addedAt: '2026-10-02T00:00:00Z' }),
      paper('c'), // unshelved: on no card
    ];
    const shelves = topicShelves([V, T], papers);
    expect(shelves.map((s) => [s.topic.name, s.papers.map((p) => p.id)])).toEqual([
      ['Vision & detection', []],
      ['Transformers & attention', ['a', 'b']],
    ]);
  });
});

describe('topicStats', () => {
  const words = (papers: ShelfPaper[]) =>
    topicStats(papers)
      .map((part) => (part.value === null ? part.noun : `${String(part.value)} ${part.noun}`))
      .join(' · ');

  it('counts papers, known pages and the most pressing state, from data', () => {
    const papers = [
      paper('a', { pageCount: 15, reading: reading('reading') }),
      paper('b', { pageCount: 16, reading: reading('finished') }),
      paper('c', { pageCount: 0, processing: 'failed' }),
    ];
    expect(words(papers)).toBe('3 papers · 31 pages · 1 reading now');
    expect(words(papers.slice(1))).toBe('2 papers · 16 pages · 1 could not read');
    expect(words([papers[1] as ShelfPaper])).toBe('1 paper · 16 pages · 1 read');
    expect(words([paper('d', { processing: 'parsing', pageCount: 0 })])).toBe(
      '1 paper · 1 being read',
    );
    expect(words([paper('e', { pageCount: 1 })])).toBe('1 paper · 1 page · not started');
  });

  it('says an empty topic is empty instead of "0 papers"', () => {
    expect(words([])).toBe('No papers yet');
  });

  it('never says "reading now" for a place in a paper still being read (it wears kraft)', () => {
    expect(words([paper('a', { processing: 'parsing', reading: reading('reading') })])).toBe(
      '1 paper · 10 pages · 1 being read',
    );
  });
});

describe('topicSourceLine', () => {
  it('names the arXiv categories the papers were suggested from, once', () => {
    const papers = [
      paper('a', { topic: onT('arxiv_category', 'cs.LG') }),
      paper('b', { topic: onT('arxiv_category', 'cs.CL') }),
      paper('c', { topic: onT('arxiv_category', 'cs.CL') }),
    ];
    expect(topicSourceLine(papers)).toBe('Suggested from arXiv cs.CL, cs.LG · you accepted');
  });

  it('counts the papers the person put there themselves', () => {
    const papers = [
      paper('a', { topic: onT('manual') }),
      paper('b', { topic: onT('arxiv_category', 'cs.CL') }),
    ];
    expect(topicSourceLine(papers)).toBe(
      'Suggested from arXiv cs.CL · you accepted · 1 chosen by you',
    );
    expect(topicSourceLine([papers[0] as ShelfPaper])).toBe('Chosen by you');
  });

  it('says the AI suggested it when it did, and never invents a source', () => {
    expect(topicSourceLine([paper('a', { topic: onT('model', 'minimax-m3') })])).toBe(
      'Suggested by the AI · you accepted',
    );
    expect(
      topicSourceLine([
        paper('a', { topic: onT('arxiv_category', 'cs.CV') }),
        paper('b', { topic: onT('model') }),
      ]),
    ).toBe('Suggested from arXiv cs.CV and by the AI · you accepted');
    expect(topicSourceLine([])).toBe('Made by you');
  });
});

describe('offerLine', () => {
  const offer = (overrides: Partial<PaperTopic>): PaperTopic => ({
    status: 'suggested',
    topic: { topic_id: V.topic_id, name: V.name, cloth: V.cloth },
    suggested_name: null,
    source: 'arxiv_category',
    source_detail: 'cs.CV',
    arxiv_category: 'cs.CV',
    ...overrides,
  });

  it('words an offer from its source, and a new name the AI proposed', () => {
    expect(offerLine(offer({}))).toBe('Suggested: Vision & detection · from arXiv cs.CV');
    expect(
      offerLine(
        offer({ topic: null, suggested_name: 'Robots', source: 'model', source_detail: 'm' }),
      ),
    ).toBe('Suggested: a new topic, “Robots” · by the AI');
  });

  it('has nothing to say without an offer, and remembers a no', () => {
    expect(offerLine(undefined)).toBeNull();
    expect(offerLine(offer({ status: 'none', topic: null, source: null }))).toBeNull();
    expect(offerLine(offer({ status: 'rejected', topic: null }))).toBe(
      'You said no to the suggestion',
    );
  });
});

describe('nextCloth', () => {
  it('starts a new topic in a cloth the person does not use yet, else the least used', () => {
    expect(nextCloth([])).toBe('transformers');
    expect(nextCloth([{ cloth: 'transformers' }, { cloth: null }])).toBe('vision');
    const all = CLOTHS.map((c) => ({ cloth: c.id }));
    expect(nextCloth([...all, { cloth: 'transformers' }])).toBe('vision');
  });
});

describe('gridStep', () => {
  it('walks a grid of three: along, by rows, never off its edges', () => {
    expect(gridStep(0, 'ArrowRight', 5, 3)).toBe(1);
    expect(gridStep(0, 'ArrowLeft', 5, 3)).toBe(0);
    expect(gridStep(1, 'ArrowDown', 5, 3)).toBe(4);
    expect(gridStep(2, 'ArrowDown', 5, 3)).toBe(2);
    expect(gridStep(4, 'ArrowUp', 5, 3)).toBe(1);
    expect(gridStep(3, 'Home', 5, 3)).toBe(0);
    expect(gridStep(0, 'End', 5, 3)).toBe(4);
    expect(gridStep(0, 'Enter', 5, 3)).toBeNull();
    expect(gridStep(0, 'ArrowDown', 0, 3)).toBeNull();
  });

  it('is a list on a phone (one column)', () => {
    expect(gridStep(1, 'ArrowDown', 3, 1)).toBe(2);
    expect(gridStep(1, 'ArrowUp', 3, 0)).toBe(0);
  });
});
