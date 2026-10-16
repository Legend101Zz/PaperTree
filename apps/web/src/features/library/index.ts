/**
 * The library feature (#195): the shelf, its header, catalogue card and uploads, and the data
 * layer behind them. Its public surface: the page, the shelf, and what the tests read.
 */
export { LibraryView } from './components/LibraryView';
export { Shelf, type ShelfProps } from './components/Shelf';
export { POLL_INTERVAL_MS, pollInterval, type LibraryBook } from './hooks/useLibrary';
export { matchPapers, type Arrangement, type ShelfPaper } from './model/shelf';
