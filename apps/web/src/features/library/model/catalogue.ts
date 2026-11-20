/**
 * library/model/catalogue — the words a book's catalogue entry is made of (#195, #196): the state
 * line ("Reading now · p. 4 of 15", "Read", "Queued"…) and the authors as printed. Pure; the
 * opened book and the Table print them.
 */
import { PROCESSING_LABEL } from '@/components/library/types';

import { readingPage } from './shelf';

import type { LibraryBook } from '../hooks/useLibrary';

/**
 * The state line: "Reading now · p. 4 of 15", "Not started", "Read", or the processing state in
 * words while the paper is not ready ("Reading the PDF - step 1 of 3").
 *
 * @param book - The book.
 * @returns The line.
 */
export function cardStateLine(book: LibraryBook): string {
  if (book.processing === 'parsing' && book.step !== undefined) {
    return `${book.step.name} - step ${String(book.step.n)} of ${String(book.step.of)}`;
  }
  if (book.processing !== 'complete' && book.processing !== 'partial') {
    return PROCESSING_LABEL[book.processing];
  }
  const at = readingPage(book);
  if (at !== null) return `Reading now · p. ${String(at.page)} of ${String(at.of)}`;
  if (book.reading?.state === 'finished') return 'Read';
  return book.processing === 'partial' ? PROCESSING_LABEL.partial : 'Not started';
}

/**
 * "Ashish Vaswani et al.", "Diederik P. Kingma and Jimmy Ba", "Alex Wang": full names as printed,
 * for the Table's Authors column (frame 01d).
 *
 * @param authors - The authors, in order.
 * @returns The short line, or null when there are none.
 */
export function authorsShort(authors: readonly string[]): string | null {
  const [first, second] = authors;
  if (first === undefined) return null;
  if (authors.length === 1) return first;
  return authors.length === 2 ? `${first} and ${second ?? ''}` : `${first} et al.`;
}

/** The longest title the delete toast prints whole. */
const TOAST_TITLE_MAX = 60;

/**
 * What the delete toast says: "Deleted “Attention Is All You Need”, with your 3 highlights and 2
 * threads". The work that goes with the paper is named so the person knows what Undo holds; a
 * zero is left out, and a paper with none says only the first half.
 *
 * @param book - The deleted book.
 * @returns The sentence (no final stop: the toast has buttons after it).
 */
export function deletedMessage(
  book: Pick<LibraryBook, 'title' | 'highlightCount' | 'threadCount'>,
): string {
  const title = book.title.trim();
  const shown = title.length > TOAST_TITLE_MAX ? `${title.slice(0, TOAST_TITLE_MAX - 1)}…` : title;
  const counts = [
    book.highlightCount > 0
      ? `${String(book.highlightCount)} highlight${book.highlightCount === 1 ? '' : 's'}`
      : null,
    (book.threadCount ?? 0) > 0
      ? `${String(book.threadCount)} thread${book.threadCount === 1 ? '' : 's'}`
      : null,
  ].filter((part): part is string => part !== null);
  return `Deleted “${shown}”${counts.length === 0 ? '' : `, with your ${counts.join(' and ')}`}`;
}
