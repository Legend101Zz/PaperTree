/**
 * The fourteen corpus papers as `GET /papers` rows, for library tests that need a real-sized shelf
 * (#196). Titles, first authors, page counts and years are the papers' own (the PDFs in
 * research/benchmarks/corpus and fresh/pdfs); nothing here is invented. A larger library repeats
 * them under new ids, as uploading the same PDFs again would.
 */
import type { LibraryPaper, ReadingProgress } from '@/lib/api/types';

const PAPERS: readonly (readonly [string, readonly string[], number, number | null, string])[] = [
  ['Attention Is All You Need', ['Ashish Vaswani', 'Noam Shazeer'], 15, 2017, 'cs.CL'],
  [
    'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness',
    ['Tri Dao', 'Daniel Y. Fu'],
    34,
    2022,
    'cs.LG',
  ],
  ['Denoising Diffusion Probabilistic Models', ['Jonathan Ho', 'Ajay Jain'], 25, 2020, 'cs.LG'],
  [
    'Deep Residual Learning for Image Recognition',
    ['Kaiming He', 'Xiangyu Zhang'],
    12,
    2015,
    'cs.CV',
  ],
  [
    'You Only Look Once: Unified, Real-Time Object Detection',
    ['Joseph Redmon', 'Santosh Divvala'],
    10,
    2015,
    'cs.CV',
  ],
  ['Mask R-CNN', ['Kaiming He', 'Georgia Gkioxari'], 12, 2017, 'cs.CV'],
  [
    'Adam: A Method for Stochastic Optimization',
    ['Diederik P. Kingma', 'Jimmy Lei Ba'],
    15,
    2014,
    'cs.LG',
  ],
  [
    'Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks',
    ['Nils Reimers', 'Iryna Gurevych'],
    11,
    2019,
    'cs.CL',
  ],
  [
    'SuperGLUE: A Stickier Benchmark for General-Purpose Language Understanding Systems',
    ['Alex Wang', 'Yada Pruksachatkun'],
    29,
    2019,
    'cs.CL',
  ],
  [
    'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    ['Jacob Devlin', 'Ming-Wei Chang'],
    16,
    2018,
    'cs.CL',
  ],
  ['Language Models are Few-Shot Learners', ['Tom B. Brown', 'Benjamin Mann'], 75, 2020, 'cs.CL'],
  [
    'Neural Ordinary Differential Equations',
    ['Ricky T. Q. Chen', 'Yulia Rubanova'],
    18,
    2018,
    'cs.LG',
  ],
  [
    'Asynchronous Methods for Deep Reinforcement Learning',
    ['Volodymyr Mnih', 'Adrià Puigdomènech Badia'],
    19,
    2016,
    'cs.LG',
  ],
  [
    'PDF-to-Tree: Parsing PDF Text Blocks into a Tree',
    ['Yue Zhang', 'Zhihao Zhang'],
    11,
    null,
    'cs.CL',
  ],
];

/** How many distinct corpus papers there are. */
export const CORPUS_SIZE = PAPERS.length;

/**
 * A reading place, as S2a's `GET /papers` carries it.
 *
 * @param lastPage - Zero-based page.
 * @param pageCount - Pages when the place was written.
 * @param openedAt - ISO-8601.
 * @returns The progress, in the reading state.
 */
export function readingAt(lastPage: number, pageCount: number, openedAt: string): ReadingProgress {
  return {
    last_page: lastPage,
    furthest_page: lastPage,
    page_count: pageCount,
    opened_at: openedAt,
    finished_at: null,
    state: 'reading',
  };
}

/**
 * `count` library rows from the corpus, in order, repeating it under new ids past fourteen.
 *
 * @param count - How many rows.
 * @returns Rows with ids `ppr_c<n>`, all ready, none opened.
 */
export function corpusRows(count: number): LibraryPaper[] {
  return Array.from({ length: count }, (_, n) => {
    const [title, authors, pages, year, category] = PAPERS[n % PAPERS.length]!;
    return {
      paper_id: `ppr_c${String(n)}`,
      title,
      authors: [...authors],
      original_filename: `${title}.pdf`,
      source_hash: `sha256:${String(n)}`,
      page_count: pages,
      processing: 'ready',
      job: null,
      generation: 1,
      parser_version: '1.0.0',
      highlight_count: 0,
      created_at: new Date(Date.UTC(2026, 9, 1) + n * 60_000).toISOString(),
      updated_at: '2026-10-15T10:00:00+00:00',
      reading: null,
      year,
      arxiv_id: null,
      arxiv_category: category,
      thread_count: 0,
      has_summary: false,
      topic: null,
      notebook_count: 0,
      plate: null,
    };
  });
}
