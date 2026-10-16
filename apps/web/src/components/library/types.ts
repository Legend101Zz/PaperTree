/**
 * library/types — the library's view model.
 *
 * `LibraryPaper` here is the VIEW MODEL the cards render; it is never posted and never persisted.
 * The wire shape is `ApiLibraryPaper` (`lib/api/types.ts::LibraryPaper`, contracts.md §2.2) and
 * `libraryPaperFromWire` is the one bridge. The pre-S1 bridges (`libraryPaperFromApi`,
 * `libraryPaperFromPaperRow`) are gone: they read a row shape the server no longer sends, which is
 * why every card used to say "Queued", carry a `ppr_` id for a title and count "0 pages" (#141).
 *
 * The five states keep their names from §18.4 and map one to one onto the server's `processing`:
 *
 *     queued -> pending     reading -> parsing     ready -> complete     partial     failed
 *
 * Source mode is readable in every state, so no state ever hides the Open action (§19.8).
 */
import { fixturesEnabled } from '@/lib/paperSource';
import type { LibraryPaper as ApiLibraryPaper, Processing } from '@/lib/api/types';

export type ProcessingState = 'pending' | 'parsing' | 'partial' | 'complete' | 'failed';

export interface LibraryPaper {
  readonly id: string;
  readonly title: string;
  /** Ordered as printed. Empty is legal. */
  readonly authors: readonly string[];
  /** Pages in the source PDF; 0 when the server could not count them. */
  readonly pageCount: number;
  /** Pages whose IR exists. Only meaningful for the fixture samples. */
  readonly pagesParsed: number;
  /** 0..1. Reading position, not parse progress. */
  readonly readingProgress: number;
  readonly processing: ProcessingState;
  /** Operator-facing free text for `partial`, rendered verbatim. */
  readonly partialReason?: string;
  /** The pipeline step that failed, when `processing === 'failed'`. */
  readonly failedStep?: string;
  /** A sentence saying why a parse failed. Never a raw error code. */
  readonly failureReason?: string;
  /** While `parsing`: which of the three steps is running, and how many there are. */
  readonly step?: { readonly n: number; readonly of: number; readonly name: string };
  readonly highlightCount: number;
  /** ISO-8601. */
  readonly addedAt: string;
  /** Sample papers are read-only and cannot be deleted. Shown only when fixtures are on. */
  readonly isSample?: boolean;
}

export const PROCESSING_LABEL: Record<ProcessingState, string> = {
  pending: 'Queued',
  parsing: 'Reading',
  partial: 'Partly read',
  complete: 'Ready',
  failed: 'Could not read',
};

/** The one sentence each state owes the reader. */
export const PROCESSING_DETAIL: Record<ProcessingState, string> = {
  pending: 'Waiting for its turn. The PDF is already readable in Source mode.',
  parsing: 'We are reading the paper. The PDF is readable in Source mode right now.',
  partial: 'Some parts of this paper could not be read. Everything else works.',
  complete: 'Guided mode and questions are available.',
  failed: 'We could not read this paper. Retry, or open the original PDF.',
};

/** Guided mode and questions are gated on the IR; SOURCE MODE NEVER IS. */
export function derivedFeaturesReady(state: ProcessingState): boolean {
  return state === 'complete' || state === 'partial';
}

/** True while the server is still working on the row: the only time the library polls. */
export function isNonTerminal(processing: Processing): boolean {
  return processing === 'queued' || processing === 'reading';
}

const STATE_FROM_WIRE: Record<Processing, ProcessingState> = {
  queued: 'pending',
  reading: 'parsing',
  ready: 'complete',
  partial: 'partial',
  failed: 'failed',
};

const STEP_WORDS: Record<string, string> = {
  parse: 'Reading the PDF',
  persist: 'Saving what was read',
  promote: 'Getting it ready',
};

/** `error_code` -> a sentence with a next action. Unknown codes get the general sentence. */
export function failureSentence(code: string | null | undefined): string {
  switch (code) {
    case 'pdf_unreadable':
      return 'This file could not be read as a PDF. It may be damaged, scanned without text or password protected. Retry, or upload a different copy.';
    case 'validation_failed':
      return 'We read the file but could not make sense of its structure. Retry, or upload a different copy.';
    case 'timeout':
      return 'Reading took too long and was stopped. Retry; very long papers can need a second try.';
    default:
      return 'Something went wrong while reading this paper. Retry, or upload it again.';
  }
}

function titleOf(paper: ApiLibraryPaper): string {
  const title = paper.title.trim();
  return title.length > 0 ? title : (paper.original_filename ?? 'Untitled paper');
}

/**
 * Bridge a `GET /papers` row into the view model. Total: every `processing` value maps, and a row
 * missing optional pieces still renders.
 */
export function libraryPaperFromWire(paper: ApiLibraryPaper): LibraryPaper {
  const processing = STATE_FROM_WIRE[paper.processing];
  const job = paper.job;
  const stepNumber =
    processing === 'parsing' && job !== null
      ? Math.min(Math.max(job.done + 1, 1), Math.max(job.total, 1))
      : null;
  const stepName =
    job?.step !== null && job?.step !== undefined
      ? (STEP_WORDS[job.step] ?? 'Reading')
      : 'Reading the PDF';

  const base: LibraryPaper = {
    id: paper.paper_id,
    title: titleOf(paper),
    authors: paper.authors,
    pageCount: paper.page_count ?? 0,
    pagesParsed: 0,
    readingProgress: 0,
    processing,
    highlightCount: paper.highlight_count,
    addedAt: paper.created_at,
  };
  return {
    ...base,
    ...(stepNumber !== null && job !== null
      ? { step: { n: stepNumber, of: Math.max(job.total, 1), name: stepName } }
      : {}),
    ...(processing === 'failed' ? { failureReason: failureSentence(job?.error_code) } : {}),
    ...(processing === 'partial'
      ? {
          partialReason:
            'Some parts of this paper could not be read. You can still read it in Source mode and use everything that was read.',
        }
      : {}),
  };
}

/**
 * The three sample papers, the repository's own golden fixtures.
 *
 * They are NOT part of the product: `visibleSamples()` returns them only when
 * `NEXT_PUBLIC_PAPERTREE_FIXTURES=on` (contracts.md §7, #137).
 */
export const SAMPLE_PAPERS: readonly LibraryPaper[] = [
  {
    id: 'attention-is-all-you-need',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
    pageCount: 4,
    pagesParsed: 4,
    readingProgress: 0,
    processing: 'complete',
    highlightCount: 0,
    addedAt: '2017-06-12T00:00:00.000Z',
    isSample: true,
  },
  {
    id: 'resnet-cvpr-2col',
    title: 'Deep Residual Learning for Image Recognition',
    authors: ['Kaiming He', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun'],
    pageCount: 3,
    pagesParsed: 3,
    readingProgress: 0,
    processing: 'complete',
    highlightCount: 0,
    addedAt: '2015-12-10T00:00:00.000Z',
    isSample: true,
  },
  {
    id: 'neural-odes-mathheavy',
    title: 'Neural Ordinary Differential Equations',
    authors: ['Ricky T. Q. Chen', 'Yulia Rubanova', 'Jesse Bettencourt', 'David Duvenaud'],
    pageCount: 18,
    pagesParsed: 3,
    readingProgress: 0,
    processing: 'partial',
    partialReason:
      'Golden fixture: only pages 0-2 of the 18-page source PDF are parsed. Reading continues on ' +
      'the pages that were read.',
    highlightCount: 0,
    addedAt: '2018-06-19T00:00:00.000Z',
    isSample: true,
  },
];

/** The samples to show: none unless fixtures are on. */
export function visibleSamples(): readonly LibraryPaper[] {
  return fixturesEnabled() ? SAMPLE_PAPERS : [];
}
