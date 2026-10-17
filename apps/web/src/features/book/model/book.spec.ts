/**
 * The opened book's words (#200): the bookplate's rules (never a name from the email), the meta
 * line, the figures line and the Figure 1 offer, the counts, the topic's source, the excerpt. The
 * figure lists are the real parses' (`test_book_api.py` holds the server to the same: Attention's
 * five labels with Figure 2 drawn as two regions; a3c's labels start at Figure 2).
 */
import { describe, expect, it } from 'vitest';

import {
  abstractExcerpt,
  arxivLink,
  bookplateOwner,
  canOpenBook,
  countsLine,
  figureOneOffer,
  figuresLine,
  metaLine,
  plateCaption,
  shelvedLine,
  summaryLine,
} from './book';

import type { BookFigure, BookPaper } from './types';
import type { Anchor } from '@papertree/anchoring';

const ANCHOR = { id: 'anc_1' } as unknown as Anchor;

function fig(label: string | null, page: number, extra: Partial<BookFigure> = {}): BookFigure {
  return {
    blockId: `blk_${label ?? 'x'}_${String(page)}`,
    pageIndex: page,
    label,
    captionText: label === null ? null : `${label}: caption`,
    assetUrl: 'https://api/x.png',
    anchor: ANCHOR,
    ...extra,
  };
}

/** Attention as `GET /figures` lists it: Figure 2 is two regions, one of them captioned. */
const ATTENTION_FIGURES = [
  fig('Figure 1', 2),
  fig('Figure 2', 3),
  fig(null, 3),
  fig('Figure 3', 12),
  fig('Figure 4', 13),
  fig('Figure 5', 14),
];

const BOOK: BookPaper = {
  id: 'ppr_att',
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  pageCount: 15,
  processing: 'complete',
  addedAt: '2026-10-15T09:00:00.000Z',
  year: 2017,
  arxivId: '1706.03762',
  highlightCount: 3,
  threadCount: 2,
  notebookCount: 1,
  hasSummary: true,
  reading: null,
  topic: {
    name: 'Transformers & attention',
    cloth: 'transformers',
    source: 'arxiv_category',
    sourceDetail: 'cs.CL',
  },
  plate: null,
};

describe('the bookplate', () => {
  it('names the library only with the name the person chose', () => {
    expect(bookplateOwner('Mrigesh', false)).toEqual({ kind: 'name', name: 'Mrigesh' });
    expect(bookplateOwner('  Mrigesh  ', true)).toEqual({ kind: 'name', name: 'Mrigesh' });
  });

  it('asks once when there is no name, and after Not now leaves the line out', () => {
    expect(bookplateOwner(null, false)).toEqual({ kind: 'ask' });
    expect(bookplateOwner('   ', false)).toEqual({ kind: 'ask' });
    expect(bookplateOwner(null, true)).toEqual({ kind: 'none' });
  });

  it('says when it was shelved', () => {
    expect(shelvedLine('2026-10-15T09:00:00.000Z')).toBe('PaperTree · shelved 15 Oct 2026');
    expect(shelvedLine('not a date')).toBe('PaperTree');
  });
});

describe('the right page', () => {
  it('prints the meta line from what the server knows, nothing guessed', () => {
    expect(metaLine(BOOK)).toBe('2017 · arXiv 1706.03762 · 15 pages');
    expect(metaLine({ ...BOOK, year: null, arxivId: null })).toBe('15 pages');
    expect(metaLine({ ...BOOK, year: null, arxivId: null, pageCount: 0 })).toBe('');
  });

  it('counts the figures found by their captions, not by their regions', () => {
    expect(figuresLine(ATTENTION_FIGURES)).toBe(
      '5 figures found · Figure 1 (p. 3), Figure 2 (p. 4)',
    );
    // The real parses' labels: ResNet has 7 figures and 3 are found, YOLO 6 and 5. The line says
    // what was found, never the paper's count.
    const resnet = [
      fig('Figure 1', 0),
      fig(null, 1),
      fig(null, 3),
      fig('Figure 5', 5),
      fig('Figure 6', 7),
    ];
    expect(figuresLine(resnet)).toBe('3 figures found · Figure 1 (p. 1), Figure 5 (p. 6)');
    const yolo = ['Figure 1', 'Figure 2', 'Figure 3', 'Figure 4', 'Figure 5'].map((l, i) =>
      fig(l, i),
    );
    expect(figuresLine([...yolo, fig(null, 7)])).toMatch(/^5 figures found · Figure 1 \(p\. 1\)/);
    expect(figuresLine([fig(null, 1), fig(null, 4)])).toBe('2 figures found, none with a caption');
    expect(figuresLine([fig('Figure 2', 6)])).toBe('1 figure found · Figure 2 (p. 7)');
    expect(figuresLine([])).toBeNull();
  });

  it('offers Figure 1 only when a caption-matched Figure 1 has a crop and an Anchor', () => {
    expect(figureOneOffer(ATTENTION_FIGURES)?.pageIndex).toBe(2);
    // a3c: the "Figure 1." caption is attached to no figure, so its labels start at 2.
    expect(figureOneOffer([fig(null, 0), fig('Figure 2', 6), fig('Figure 3', 7)])).toBeNull();
    // GPT-3 numbers its figures 1.1, 1.2: none of them is "Figure 1".
    expect(figureOneOffer([fig('Figure 1.1', 2), fig('Figure 1.2', 3)])).toBeNull();
    expect(figureOneOffer([fig('Figure 1', 2, { assetUrl: null })])).toBeNull();
    expect(figureOneOffer([fig('Figure 1', 2, { anchor: null })])).toBeNull();
  });

  it('counts the person’s work from the library row, leaving zeros out', () => {
    expect(countsLine(BOOK)).toBe('3 highlights · 2 explanation threads · 1 notebook page');
    expect(countsLine({ ...BOOK, highlightCount: 1, threadCount: 0, notebookCount: 2 })).toBe(
      '1 highlight · 2 notebook pages',
    );
    expect(countsLine({ ...BOOK, highlightCount: 0, threadCount: 0, notebookCount: 0 })).toBe(
      'No highlights, threads or notebook pages yet',
    );
  });

  it('quotes the abstract’s first whole sentences, hyphens joined', () => {
    const text =
      'The dominant sequence transduction models are based on complex recurrent or\n' +
      'convolutional neural networks that include an encoder and a decoder. The best\n' +
      'performing models also connect the encoder and decoder through an attention\n' +
      'mechanism. We propose a new simple network architecture, the Transformer, based\n' +
      'solely on attention mechanisms, dispensing with recurrence and convolutions\n' +
      'entirely. Experiments on two machine translation tasks show these models to be\n' +
      'superior in quality.';
    const excerpt = abstractExcerpt(text) ?? '';
    expect(excerpt.startsWith('The dominant sequence transduction models')).toBe(true);
    expect(excerpt.endsWith('dispensing with recurrence and convolutions entirely.')).toBe(true);
    expect(excerpt).not.toMatch(/\n/);
    expect(abstractExcerpt('We present a residual learn-\ning framework.')).toBe(
      'We present a residual learning framework.',
    );
    // A stop inside "e.g.", "Fig. 3" or "28.4" does not end the excerpt mid-sentence.
    const dotted = `${'x'.repeat(355)} as in e.g. the model of Fig. 3 at 28.4 BLEU. Then more.`;
    expect(abstractExcerpt(dotted)).toBe(dotted.slice(0, dotted.indexOf(' Then')));
    expect(abstractExcerpt(null)).toBeNull();
    expect(abstractExcerpt('   ')).toBeNull();
  });

  it('writes the arXiv link out and the plate’s caption as the frame does', () => {
    expect(arxivLink('1706.03762')).toEqual({
      href: 'https://arxiv.org/abs/1706.03762',
      label: 'arxiv.org/abs/1706.03762',
    });
    expect(arxivLink(null)).toBeNull();
    expect(
      plateCaption({
        label: 'Figure 1',
        pageIndex: 2,
        captionText: 'Figure 1: The Transformer - model archi-\ntecture.',
      }),
    ).toBe('Figure 1 (p. 3) · The Transformer - model architecture.');
    expect(plateCaption({ label: null, pageIndex: 0, captionText: null })).toBe('A figure (p. 1)');
  });

  it('says what the summary is, from the summary route, and claims nothing while it loads', () => {
    expect(summaryLine('ready')).toEqual({ button: 'Summary', line: 'Summary ready (cached)' });
    expect(summaryLine('partial').line).toBe(
      'Summary cached (partial: some points have no passage)',
    );
    expect(summaryLine('none')).toEqual({ button: 'Summarize', line: 'No summary yet' });
    expect(summaryLine('failed').button).toBe('Summarize');
    expect(summaryLine('running').line).toBe('A summary is being written');
    expect(summaryLine(null)).toEqual({ button: 'Summary', line: '' });
  });

  it('opens only a book whose parse is in, and never a sample', () => {
    expect(canOpenBook({ processing: 'complete' })).toBe(true);
    expect(canOpenBook({ processing: 'partial' })).toBe(true);
    for (const processing of ['pending', 'parsing', 'failed'] as const) {
      expect(canOpenBook({ processing })).toBe(false);
    }
    expect(canOpenBook({ processing: 'complete', isSample: true })).toBe(false);
  });
});
