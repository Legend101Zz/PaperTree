/**
 * The library feature (#195): the shelf, its header, catalogue card and uploads, and the data
 * layer behind them. Its public surface.
 */
export { LibraryView } from './components/LibraryView';
export { Shelf, type ShelfProps } from './components/Shelf';
export {
  POLL_INTERVAL_MS,
  libraryBookFromWire,
  pollInterval,
  useLibrary,
  type LibraryBook,
} from './hooks/useLibrary';
export { CANCEL_COPY, useUploadQueue, type UploadQueue } from './hooks/useUploadQueue';
export {
  ARRANGEMENTS,
  arrangeShelf,
  libraryStats,
  matchPapers,
  type Arrangement,
  type ShelfPaper,
} from './model/shelf';
