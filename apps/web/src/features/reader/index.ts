/**
 * The reader feature's chrome (#203): the header, its page counter, where the selection toolbar
 * goes, and when a press on a highlight opens its card. Its public surface.
 */
export {
  ReaderHeader,
  type ExplainToggle,
  type ReaderHeaderProps,
} from './components/ReaderHeader';
export { PageCounter, type PageCounterProps } from './components/PageCounter';
export { CLICK_SLOP_PX, isHighlightClick, type Press } from './model/highlightClick';
export { counterPage, pageCounterLabel } from './model/pageCounter';
export {
  overlaps,
  placeToolbar,
  typeAreaOf,
  unionOf,
  type Placement,
  type PlacementInput,
  type Rect,
} from './model/toolbarPlacement';
