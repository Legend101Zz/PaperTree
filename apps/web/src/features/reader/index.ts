/**
 * The reader feature's chrome (#203): the header, its page counter, where the selection toolbar
 * goes, when a press on a highlight opens its card, and what Contents lists. Its public surface.
 */
export {
  ReaderHeader,
  type BoardBesideToggle,
  type ExplainToggle,
  type ReaderHeaderProps,
} from './components/ReaderHeader';
export { PageCounter, type PageCounterProps } from './components/PageCounter';
export {
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
export {
  useImageSelection,
  type ImageSelection,
  type UseImageSelectionArgs,
} from './hooks/useImageSelection';
export { ImageToolProvider, useImageTool, type ImageTool } from './hooks/useImageTool';
export {
  defaultZoomMode,
  readSavedReaderState,
  writeSavedReaderState,
  type ReadingMode,
  type SavedReaderState,
} from './model/savedState';
export { initialBlockFor, topBlockAt } from './model/topBlock';
export { failureOf, type Failure } from './model/failure';
export { useMediaQuery } from './hooks/useMediaQuery';
export { usePaperSource, type PaperSource } from './hooks/usePaperSource';
export { useReadingPosition, type UseReadingPositionArgs } from './hooks/useReadingPosition';
export { useFocusAnchor } from './hooks/useFocusAnchor';
export { useFocusFromUrl } from './hooks/useFocusFromUrl';
export {
  useHighlightActions,
  type CardAt as HighlightCardAt,
  type OpenCard,
} from './hooks/useHighlightActions';
export { useNavigatorHighlights } from './hooks/useNavigatorHighlights';
