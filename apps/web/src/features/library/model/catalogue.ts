/**
 * library/model/catalogue — the words a book's catalogue entry is made of (#195, #196): the state
 * line ("Reading now · p. 4 of 15", "Read", "Queued"…) and "Ashish Vaswani et al. · 2017 · 15
 * pages". Pure; the catalogue card and the face-out captions both print them.
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
 * shared by the card, the captions and the Table's Authors column (frame 01d).
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

/**
 * "Ashish Vaswani et al. · 2017 · 15 pages": only what the server knows. Full first names on
 * purpose (frame 01's card and 01c's captions), so not the spine's surname-only `authorLine`.
 *
 * @param book - The book.
 * @returns The line.
 */
export function metaLine(book: LibraryBook): string {
  const authors = authorsShort(book.authors);
  const pages = book.pageCount > 0 ? `${String(book.pageCount)} pages` : null;
  return [authors, book.year === null ? null : String(book.year), pages]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
