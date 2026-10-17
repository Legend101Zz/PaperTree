/**
 * The book feature (#200): a book taken out of the shelf and opened (frames 02a, 02). Its public
 * surface: the shelf's hook, the reader's two hooks for the book's links, and the view model.
 */
export { useBookOnShelf, type BookOnShelf } from './hooks/useBookOnShelf';
export { bookReaderHref, useFocusFromBook, useSummaryFromBook } from './hooks/useFromBook';
export { canOpenBook } from './model/book';
export type { BookFigure, BookPaper, BookPlate } from './model/types';
