/**
 * The reader feature's chrome (#203): the header, its page counter, where the selection toolbar
 * goes, when a press on a highlight opens its card, and what Contents lists. Its public surface.
 */
export {
  ReaderHeader,
  type ExplainToggle,
  type ReaderHeaderProps,
} from './components/ReaderHeader';
export { PageCounter, type PageCounterProps } from './components/PageCounter';
export {
  MARGIN_BAR_WIDTH,
  useSelectionToolbar,
  type SelectionToolbarMount,
  type ToolbarActions,
  type UseSelectionToolbarArgs,
} from './hooks/useSelectionToolbar';
export {
  useHighlightClick,
  type CardAt,
  type UseHighlightClickArgs,
} from './hooks/useHighlightClick';
export { CLICK_SLOP_PX, isHighlightClick, type Press } from './model/highlightClick';
export {
  frontMatterRows,
  headingDisplayTitle,
  isFragmentHeading,
  outsideLabel,
  type FrontMatterLeaf,
} from './model/contents';
export { counterPage, pageCounterLabel } from './model/pageCounter';
export {
  overlaps,
  placeToolbar,
  selectionLines,
  typeAreaOf,
  unionOf,
  type PageGeometry,
  type Placement,
  type PlacementInput,
  type Rect,
  type SelectionGeometry,
  type SelectionLines,
} from './model/toolbarPlacement';
