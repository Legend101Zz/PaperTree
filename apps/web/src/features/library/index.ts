/**
 * The library feature (#195): the shelf, its catalogue card and the data layer behind them. Its
 * public surface.
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
export {
  ARRANGEMENTS,
  arrangeShelf,
  matchPapers,
  type Arrangement,
  type ShelfPaper,
} from './model/shelf';
