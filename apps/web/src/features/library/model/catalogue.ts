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
 * "Ashish Vaswani et al. · 2017 · 15 pages": only what the server knows. Full first names on
 * purpose (frame 01's card and 01c's captions), so not the spine's surname-only `authorLine`.
 *
 * @param book - The book.
 * @returns The line.
 */
export function metaLine(book: LibraryBook): string {
  const [first, second] = book.authors;
  const authors =
    first === undefined
      ? null
      : book.authors.length === 1
        ? first
        : book.authors.length === 2
          ? `${first} and ${second ?? ''}`
          : `${first} et al.`;
  const pages = book.pageCount > 0 ? `${String(book.pageCount)} pages` : null;
  return [authors, book.year === null ? null : String(book.year), pages]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
