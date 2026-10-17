/**
 * book/model/types — what the book reads (#200). `BookPaper` is the subset of the library's row
 * the pulled-out and opened book prints (the library's `LibraryBook` satisfies it), and
 * `BookFigure` is one figure of `GET /papers/{id}/figures` in the web's camelCase.
 */
import type { ProcessingState } from '@/components/library/types';
import type { ReadingProgress } from '@/lib/api/types';
import type { Anchor } from '@papertree/anchoring';

/** The plate the person chose, as the library row carries it (`LibraryPaper.plate`). */
export interface BookPlate {
  /** Which figure of the figures list it is (a hint; the choice is stored as an Anchor). */
  readonly blockId: string;
  readonly pageIndex: number;
  /** "Figure 1" from its caption, or null. */
  readonly label: string | null;
  /** The caption as the paper has it, or null. */
  readonly captionText: string | null;
  /** The crop's signed URL. */
  readonly assetUrl: string;
}

/** The topic the book's pages name, with where it came from. */
export interface BookTopic {
  readonly name: string;
  readonly cloth: string | null;
  readonly source?: 'arxiv_category' | 'manual' | 'model';
  readonly sourceDetail?: string | null;
}

/** The library row's facts the book prints. */
export interface BookPaper {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  /** 0 when not counted yet. */
  readonly pageCount: number;
  readonly processing: ProcessingState;
  readonly isSample?: boolean;
  /** ISO-8601: when it was shelved. */
  readonly addedAt: string;
  readonly year: number | null;
  readonly highlightCount: number;
  readonly reading: ReadingProgress | null;
  readonly topic?: BookTopic | null;
  // Absent on a sample paper or an older server's row: read as none, never guessed.
  readonly arxivId?: string | null;
  readonly threadCount?: number;
  readonly notebookCount?: number;
  readonly hasSummary?: boolean;
  readonly plate?: BookPlate | null;
}

/** One figure the parser found (`PaperFigure` on the wire). */
export interface BookFigure {
  readonly blockId: string;
  readonly pageIndex: number;
  /** "Figure 1" when its caption starts so, else null. */
  readonly label: string | null;
  readonly captionText: string | null;
  /** The crop's signed URL, or null when none was rendered. */
  readonly assetUrl: string | null;
  /** The Anchor `PUT …/plate` takes back, or null when none could be minted. */
  readonly anchor: Anchor | null;
}
