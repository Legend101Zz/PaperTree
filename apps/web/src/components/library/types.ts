/**
 * library/types — the library's view model.
 *
 * WHY A THIRD PAPER-SHAPED TYPE IS NOT SLOP.
 *
 * `apps/web/src/types/index.ts` already declares `Paper`. It has seven fields — id, user_id, title,
 * filename, created_at, page_count, has_book_content — and NOT ONE of them can say whether the
 * parse finished, is running, half-succeeded, or blew up. That is not an omission in the type; it
 * is a faithful record of a product where upload blocks the HTTP request and the user learns the
 * outcome by whether the page eventually renders (`dashboard/PaperList.tsx:32-46`). §18.4 makes
 * processing state FIRST-CLASS, so the library needs a type that can hold it.
 *
 * The rule the repo actually cares about (README anti-slop rule 3) is that two types must not
 * silently compete for the same job. So: `LibraryPaper` is the LIBRARY VIEW MODEL and nothing else
 * — it is never persisted, never posted, never returned by the API. `libraryPaperFromApi` is the
 * one bridge, and it takes a STRUCTURAL row rather than importing `@/types` so that deleting the
 * v1 type file (which Epic 2 is chartered to do) cannot break this module.
 *
 * PROCESSING STATE VS `Paper.status`. PaperIR's `status` is `"complete" | "partial"` — two values,
 * because an IR document only exists once the parser has produced one. `pending`, `parsing` and
 * `failed` are states of the JOB, which has no IR yet. Mapping is therefore one-directional and
 * lossy on purpose: IR `status` fills in the last two states, the job queue owns the first three.
 */

/**
 * §18.4: `pending | parsing | partial | complete | failed`.
 *
 * Ordered by progress, not alphabetically, because the UI reads it as a pipeline.
 */
export type ProcessingState = 'pending' | 'parsing' | 'partial' | 'complete' | 'failed';

/** Audio is a separate long job with its own failure mode; it is NOT a facet of parsing. */
export type AudioState = 'none' | 'queued' | 'generating' | 'ready' | 'failed';

export interface LibraryPaper {
  readonly id: string;
  readonly title: string;
  /** Ordered as printed. Empty is legal — front matter is not always parsed (see the fixtures). */
  readonly authors: readonly string[];
  /** Pages in the SOURCE PDF, which is not the same as pages in the IR while parsing or partial. */
  readonly pageCount: number;
  /** Pages whose IR exists. `<= pageCount`; equals it only when `processing === 'complete'`. */
  readonly pagesParsed: number;
  /** 0..1. Reading position, not parse progress — the two are routinely different. */
  readonly readingProgress: number;
  readonly processing: ProcessingState;
  /**
   * `Paper.partial_reason`. OPERATOR-FACING FREE TEXT, rendered verbatim and never parsed —
   * `neural-odes` sets it to a 90-word paragraph citing a README. Anything that tried to pull page
   * numbers out of it would be reading prose written for a human debugging the parser.
   */
  readonly partialReason?: string;
  /** The pipeline step that failed, when `processing === 'failed'`. Retry resumes FROM here. */
  readonly failedStep?: string;
  readonly audio: AudioState;
  readonly highlightCount: number;
  /** ISO-8601. */
  readonly addedAt: string;
  /** Sample papers are read-only and cannot be deleted; §19.8 requires three in an empty library. */
  readonly isSample?: boolean;
}

export const PROCESSING_LABEL: Record<ProcessingState, string> = {
  pending: 'Queued',
  parsing: 'Reading the paper',
  partial: 'Partly read',
  complete: 'Ready',
  failed: 'Could not read',
};

/**
 * The one sentence each state owes the reader. Not decoration: `parsing` and `partial` both mean
 * "you can read this NOW", and a badge that only says "Parsing" implies the opposite.
 */
export const PROCESSING_DETAIL: Record<ProcessingState, string> = {
  pending: 'Waiting for a parser slot. The PDF is already readable in Source mode.',
  parsing: 'Pages are filling in. The PDF is readable in Source mode right now.',
  partial: 'Some pages need a closer look. Reading continues everywhere else.',
  complete: 'Guided mode, audio and questions are available.',
  failed: 'Parsing stopped. The original PDF is still readable in Source mode.',
};

export const AUDIO_LABEL: Record<AudioState, string> = {
  none: 'No audio',
  queued: 'Audio queued',
  generating: 'Making audio',
  ready: 'Audio ready',
  failed: 'Audio failed',
};

/**
 * Guided mode, audio and questions are gated on the IR; SOURCE MODE NEVER IS.
 *
 * §19.8: "The paper is readable in Source mode immediately — parsing only gates Guided/audio/
 * questions." Every gate in this group calls THIS function, so there is exactly one place where the
 * rule can be got wrong, and it cannot accidentally start returning true for source reading.
 */
export function derivedFeaturesReady(state: ProcessingState): boolean {
  return state === 'complete' || state === 'partial';
}

/** The v1 API row, structurally. Not imported from `@/types` — see the header. */
export interface ApiPaperRow {
  readonly id: string;
  readonly title: string;
  readonly created_at: string;
  readonly page_count?: number | null;
}

/**
 * Bridge a v1 API row into the library view model.
 *
 * Everything the row cannot express is supplied by the caller. The default is `pending`, not
 * `complete`: a row that has never been told about a job is a paper nobody has parsed yet, and
 * defaulting to `complete` would light up Guided mode over an IR that does not exist.
 */
export function libraryPaperFromApi(
  row: ApiPaperRow,
  extra: Partial<Omit<LibraryPaper, 'id' | 'title' | 'addedAt'>> = {},
): LibraryPaper {
  const pageCount = extra.pageCount ?? row.page_count ?? 0;
  const base: LibraryPaper = {
    id: row.id,
    title: row.title,
    authors: extra.authors ?? [],
    pageCount,
    pagesParsed: extra.pagesParsed ?? 0,
    readingProgress: extra.readingProgress ?? 0,
    processing: extra.processing ?? 'pending',
    audio: extra.audio ?? 'none',
    highlightCount: extra.highlightCount ?? 0,
    addedAt: row.created_at,
  };
  // Built by spreading rather than by assigning `undefined`, because `exactOptionalPropertyTypes`
  // draws a distinction between an absent key and a present `undefined` one and the schema means
  // the former.
  return {
    ...base,
    ...(extra.partialReason === undefined ? {} : { partialReason: extra.partialReason }),
    ...(extra.failedStep === undefined ? {} : { failedStep: extra.failedStep }),
    ...(extra.isSample === undefined ? {} : { isSample: extra.isSample }),
  };
}

/**
 * The row `services/api`'s `GET /papers` actually returns — #77's D4.
 *
 * IT IS NOT `ApiPaperRow`, and the difference is why a fully parsed paper rendered as an untitled
 * card reading "Authors not identified · 0 pages · Queued". Measured against the live service:
 *
 *   * there is **no** `title`, `authors`, `page_count` or `processing` field;
 *   * `metadata` is a **JSON STRING**, not an object — `typeof row.metadata === 'string'`;
 *   * the id key is `paper_id`, not `id`;
 *   * the real title is inside that string, at `metadata.title.value`.
 *
 * The consequence was not only cosmetic. With no title, the card's button had no accessible name,
 * and axe reported `button-name` at **critical** on `#paper-title-undefined`.
 */
export interface PaperRow {
  readonly paper_id: string;
  readonly created_at: string;
  /** `"complete" | "partial"`. A row exists only once the parser produced an IR. */
  readonly status?: string | null;
  readonly partial_reason?: string | null;
  /** JSON, as a string. See `parseMetadata`. */
  readonly metadata?: string | null;
}

/** One `MetadataField` — `{value, source_block_id, confidence}`. Only `value` is rendered. */
interface MetadataField {
  readonly value?: unknown;
}

interface PaperMetadata {
  readonly title?: MetadataField | null;
  readonly authors?: readonly MetadataField[] | null;
}

/**
 * `row.metadata` as an object, or `null` when it is absent or not parseable.
 *
 * Returns `null` rather than throwing: one malformed row must not take down the whole library, and
 * a card that falls back to its untitled state is a smaller failure than a blank page. Accepts an
 * already-parsed object too, so this keeps working the day the endpoint stops double-encoding.
 */
function parseMetadata(raw: unknown): PaperMetadata | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw as PaperMetadata;
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as PaperMetadata) : null;
  } catch {
    return null;
  }
}

function fieldText(field: MetadataField | null | undefined): string | null {
  const value = field?.value;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Bridge a `services/api` row into the library view model.
 *
 * `pageCount` stays **0**: the list endpoint returns no page count in any form, and deriving one
 * from `sections` would be a guess rendered as a fact. Filed rather than invented — see
 * `UX-WALK-77.md` §D4.
 *
 * The title falls back to the paper id rather than to an empty string. An untitled card is the
 * accessibility defect this function exists to close, so the fallback has to be something a screen
 * reader can announce and a human can tell apart from the next card.
 */
export function libraryPaperFromPaperRow(row: PaperRow): LibraryPaper {
  const metadata = parseMetadata(row.metadata);
  const authors = (metadata?.authors ?? [])
    .map(fieldText)
    .filter((name): name is string => name !== null);

  const processing: ProcessingState =
    row.status === 'complete' ? 'complete' : row.status === 'partial' ? 'partial' : 'pending';

  const base: LibraryPaper = {
    id: row.paper_id,
    title: fieldText(metadata?.title) ?? row.paper_id,
    authors,
    pageCount: 0,
    pagesParsed: 0,
    readingProgress: 0,
    processing,
    audio: 'none',
    highlightCount: 0,
    addedAt: row.created_at,
  };
  return {
    ...base,
    ...(row.partial_reason ? { partialReason: row.partial_reason } : {}),
  };
}

/**
 * The three sample papers §19.8 requires, so the product can be evaluated before committing a PDF.
 *
 * These are the repository's own golden fixtures, which is the point: they are the three documents
 * every anchoring test runs against, so a sample paper cannot drift away from something we parse
 * correctly. `neural-odes` is deliberately the PARTIAL one — an evaluator should meet the partial
 * banner on a sample rather than discover it for the first time on their own paper.
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
    audio: 'ready',
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
    audio: 'none',
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
    audio: 'none',
    highlightCount: 0,
    addedAt: '2018-06-19T00:00:00.000Z',
    isSample: true,
  },
];
