/**
 * The shelf model (#195): grouping, spine widths with the cap and the unknown-pages default, short
 * titles, author lines, states, the cloth fallback and match counting (overflow included).
 */
import { describe, expect, it } from 'vitest';

import {
  SPINE_DEFAULT_WIDTH,
  SPINE_MAX_WIDTH,
  arrangeShelf,
  authorLine,
  clothFor,
  clothTakesLabel,
  foldForSearch,
  matchPapers,
  readingPage,
  shelfStep,
  spineHeight,
  spineName,
  spineState,
  spineTitle,
  spineWidth,
  type ShelfPaper,
} from './shelf';

import type { ReadingProgress } from '@/lib/api/types';

function paper(overrides: Partial<ShelfPaper> & { id: string }): ShelfPaper {
  return {
    title: 'A paper',
    authors: [],
    pageCount: 10,
    processing: 'complete',
    addedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function reading(overrides: Partial<ReadingProgress> = {}): ReadingProgress {
  return {
    last_page: 3,
    furthest_page: 3,
    page_count: 15,
    opened_at: '2026-10-10T00:00:00Z',
    finished_at: null,
    state: 'reading',
    ...overrides,
  };
}

describe('spine width', () => {
  it('follows the curve fitted to frame 01, to the pixel', () => {
    // Frame 01: U-Net 8 pp → 33, YOLO 10 → 35, Attention 15 → 39, BERT 16 → 40, A3C 19 → 42,
    // ViT 22 → 45, DDPM 25 → 47.
    const frame: [number, number][] = [
      [8, 33],
      [10, 35],
      [15, 39],
      [16, 40],
      [19, 42],
      [22, 45],
      [25, 47],
    ];
    for (const [pages, width] of frame) expect(spineWidth(pages)).toBe(width);
  });

  it('is capped at 48 px however long the paper is', () => {
    expect(spineWidth(34)).toBe(SPINE_MAX_WIDTH);
    expect(spineWidth(400)).toBe(48);
  });

  it('uses the default only while the page count is unknown', () => {
    expect(spineWidth(0)).toBe(SPINE_DEFAULT_WIDTH);
    expect(spineWidth(Number.NaN)).toBe(SPINE_DEFAULT_WIDTH);
    // A counted paper keeps its width through a Retry or re-parse (kraft wrap and all).
    expect(spineWidth(29)).toBe(48);
  });
});

describe('spine height', () => {
  it('is stable for an id and inside the frame range', () => {
    const ids = ['ppr_A', 'ppr_B', 'ppr_G9AYN750E5MG1NRBMGSQJ4N5JM', ''];
    for (const id of ids) {
      expect(spineHeight(id)).toBe(spineHeight(id));
      expect(spineHeight(id)).toBeGreaterThanOrEqual(262);
      expect(spineHeight(id)).toBeLessThanOrEqual(318);
    }
    expect(new Set(['a', 'b', 'c', 'd', 'e'].map(spineHeight)).size).toBeGreaterThan(1);
  });
});

describe('spine text', () => {
  it('prints the text before the first colon, trimmed, and never invents an acronym', () => {
    expect(spineTitle('You Only Look Once: Unified, Real-Time Object Detection')).toBe(
      'You Only Look Once',
    );
    expect(spineTitle('BERT: Pre-training of Deep Bidirectional Transformers')).toBe('BERT');
    expect(spineTitle('  Attention Is All You Need ')).toBe('Attention Is All You Need');
    expect(spineTitle('Denoising Diffusion Probabilistic Models')).toBe(
      'Denoising Diffusion Probabilistic Models',
    );
    expect(spineTitle(': a title that starts with a colon')).toBe(
      ': a title that starts with a colon',
    );
  });

  it('writes the author line from surnames', () => {
    expect(authorLine(['Tri Dao', 'Daniel Y. Fu', 'Stefano Ermon'])).toBe('Dao et al.');
    expect(authorLine(['Diederik P. Kingma', 'Jimmy Ba'])).toBe('Kingma and Ba');
    expect(authorLine(['Ashish Vaswani∗'])).toBe('Vaswani');
    expect(authorLine(['Ricky T. Q. Chen†', 'Yulia Rubanova', 'D. D.'])).toBe('Chen et al.');
    expect(authorLine([])).toBeNull();
    expect(authorLine(['  '])).toBeNull();
  });
});

describe('spine state', () => {
  it('maps processing and reading onto the four pictures', () => {
    expect(spineState(paper({ id: 'a', processing: 'failed' }))).toBe('failed');
    expect(spineState(paper({ id: 'a', processing: 'pending' }))).toBe('queued');
    expect(spineState(paper({ id: 'a', processing: 'parsing', reading: reading() }))).toBe(
      'parsing',
    );
    expect(spineState(paper({ id: 'a', reading: reading() }))).toBe('reading');
    expect(spineState(paper({ id: 'a', processing: 'partial', reading: reading() }))).toBe(
      'reading',
    );
    expect(spineState(paper({ id: 'a', reading: reading({ state: 'finished' }) }))).toBe('ready');
    expect(spineState(paper({ id: 'a', reading: null }))).toBe('ready');
    expect(spineState(paper({ id: 'a' }))).toBe('ready');
  });

  it('reads the page one-based, with the count the reading state was written against', () => {
    expect(readingPage(paper({ id: 'a', pageCount: 15, reading: reading() }))).toEqual({
      page: 4,
      of: 15,
    });
    expect(
      readingPage(paper({ id: 'a', pageCount: 12, reading: reading({ page_count: null }) })),
    ).toEqual({ page: 4, of: 12 });
    expect(readingPage(paper({ id: 'a', reading: reading({ state: 'finished' }) }))).toBeNull();
    expect(readingPage(paper({ id: 'a' }))).toBeNull();
  });

  it('names the spine with the full title, the authors, the year and the state', () => {
    const attention = paper({
      id: 'a',
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
      year: 2017,
      pageCount: 15,
      reading: reading(),
    });
    expect(spineName(attention)).toBe(
      'Attention Is All You Need, Vaswani et al., 2017, reading now, p. 4 of 15',
    );
    expect(spineName(paper({ id: 'b', title: 'Garbage', processing: 'failed' }))).toBe(
      'Garbage, could not read',
    );
    expect(spineName(paper({ id: 'c', title: 'LoRA', processing: 'parsing' }))).toBe(
      'LoRA, being read',
    );
    expect(spineName(paper({ id: 'd', title: 'Q', processing: 'pending' }))).toBe(
      'Q, waiting to be read',
    );
    expect(spineName(paper({ id: 'e', title: 'P', processing: 'partial' }))).toBe('P, partly read');
    expect(spineName(paper({ id: 'f', title: 'R', reading: reading({ state: 'finished' }) }))).toBe(
      'R, read',
    );
    expect(spineName(paper({ id: 'g', title: 'N', year: null }))).toBe('N, not started');
  });
});

describe('cloth', () => {
  it("takes the topic's cloth when there is one", () => {
    expect(
      clothFor(
        paper({
          id: 'a',
          arxivCategory: 'cs.CV',
          topic: { id: 't', name: 'T', cloth: 'language' },
        }),
      ),
    ).toBe('language');
  });

  it('falls back by arXiv category, stably, and to slate without one', () => {
    expect(clothFor(paper({ id: 'a', arxivCategory: 'cs.CL' }))).toBe('transformers');
    expect(clothFor(paper({ id: 'a', arxivCategory: 'cs.CV' }))).toBe('vision');
    expect(clothFor(paper({ id: 'a', arxivCategory: 'cs.LG' }))).toBe('generative');
    expect(clothFor(paper({ id: 'a', arxivCategory: 'q-bio.NC' }))).toBe(
      clothFor(paper({ id: 'b', arxivCategory: 'q-bio.NC' })),
    );
    expect(clothFor(paper({ id: 'a', arxivCategory: null }))).toBe('rl');
    expect(clothFor(paper({ id: 'a' }))).toBe('rl');
  });

  it('puts a paper label on the Language cloth only', () => {
    expect(clothTakesLabel('language')).toBe(true);
    expect(clothTakesLabel('vision')).toBe(false);
  });
});

describe('arrangements', () => {
  const papers = [
    paper({ id: 'c', title: 'Zeta', year: 2017, addedAt: '2026-10-03T00:00:00Z' }),
    paper({
      id: 'a',
      title: 'Alpha',
      year: 2015,
      addedAt: '2026-10-01T00:00:00Z',
      reading: reading({ opened_at: '2026-10-05T00:00:00Z' }),
    }),
    paper({
      id: 'b',
      title: 'Beta: a sequel',
      year: null,
      addedAt: '2026-10-02T00:00:00Z',
      reading: reading({ opened_at: '2026-10-09T00:00:00Z' }),
      topic: { id: 't1', name: 'Vision & detection', cloth: 'vision' },
    }),
  ];
  const shape = (groups: ReturnType<typeof arrangeShelf>) =>
    groups.map((g) => [g.label, g.papers.map((p) => p.id)]);

  it('topic: one row per topic, papers without one under Unshelved at the end, shelving order within', () => {
    expect(shape(arrangeShelf(papers, 'topic'))).toEqual([
      ['Vision & detection', ['b']],
      ['Unshelved', ['a', 'c']],
    ]);
  });

  it('topic with no topics at all: a single Unshelved row', () => {
    const plain = papers.map((p) => ({ ...p, topic: null }));
    expect(shape(arrangeShelf(plain, 'topic'))).toEqual([['Unshelved', ['a', 'b', 'c']]]);
  });

  it('year: oldest first, unknown last', () => {
    expect(shape(arrangeShelf(papers, 'year'))).toEqual([
      ['2015', ['a']],
      ['2017', ['c']],
      ['Year unknown', ['b']],
    ]);
  });

  it('title: one A–Z row by the printed title', () => {
    expect(shape(arrangeShelf(papers, 'title'))).toEqual([['A–Z', ['a', 'b', 'c']]]);
    expect(arrangeShelf([], 'title')).toEqual([]);
  });

  it('recently opened: most recent first, then the unopened ones', () => {
    expect(shape(arrangeShelf(papers, 'recent'))).toEqual([
      ['Recently opened', ['b', 'a']],
      ['Not opened yet', ['c']],
    ]);
  });

  it('does not depend on the input order', () => {
    const reversed = [...papers].reverse();
    for (const arrangement of ['topic', 'year', 'title', 'recent'] as const) {
      expect(shape(arrangeShelf(reversed, arrangement))).toEqual(
        shape(arrangeShelf(papers, arrangement)),
      );
    }
  });
});

describe('search', () => {
  const papers = [
    paper({ id: 'att', title: 'Attention Is All You Need', authors: ['Ashish Vaswani'] }),
    paper({ id: 'flash', title: 'FlashAttention', authors: ['Tri Dao'] }),
    paper({ id: 'yolo', title: 'You Only Look Once: Uniﬁed, Real-Time Object Detection' }),
    paper({
      id: 'gan',
      title: 'Generative Adversarial Nets',
      topic: { id: 't', name: 'Generative models', cloth: null },
    }),
  ];

  it('is null for a blank query', () => {
    expect(matchPapers(papers, '')).toBeNull();
    expect(matchPapers(papers, '   ')).toBeNull();
  });

  it('matches titles, authors and topics, case-insensitively', () => {
    expect(matchPapers(papers, 'atten')).toEqual(new Set(['att', 'flash']));
    expect(matchPapers(papers, 'VASWANI')).toEqual(new Set(['att']));
    expect(matchPapers(papers, 'models')).toEqual(new Set(['gan']));
  });

  it('needs every word, folds ligatures and accents', () => {
    expect(matchPapers(papers, 'attention dao')).toEqual(new Set(['flash']));
    expect(matchPapers(papers, 'unified')).toEqual(new Set(['yolo']));
    expect(foldForSearch('Schölkopf')).toBe('scholkopf');
  });

  it('counts from the data, so papers a row does not draw still count', () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      paper({ id: `p${String(i)}`, title: i % 10 === 0 ? `Attention ${String(i)}` : 'Other' }),
    );
    expect(matchPapers(many, 'atten')?.size).toBe(12);
  });
});

describe('shelf keyboard', () => {
  it('steps along the shelf without wrapping, and jumps with Home and End', () => {
    expect(shelfStep(0, 'ArrowRight', 3)).toBe(1);
    expect(shelfStep(2, 'ArrowRight', 3)).toBe(2);
    expect(shelfStep(0, 'ArrowLeft', 3)).toBe(0);
    expect(shelfStep(2, 'Home', 3)).toBe(0);
    expect(shelfStep(0, 'End', 3)).toBe(2);
    expect(shelfStep(1, 'Enter', 3)).toBeNull();
    expect(shelfStep(0, 'ArrowRight', 0)).toBeNull();
  });
});
