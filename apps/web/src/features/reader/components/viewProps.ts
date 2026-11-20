import type { Anchor, IndexedDocument } from '@papertree/anchoring';
import type { DocumentRef } from '@/components/reader/documentHandle';
import type { FlashPaint } from '@/components/reader/HighlightOverlay';
import type { UseHighlights } from '@/components/reader/useHighlights';
import type { PendingSelection, SelectionCapture } from '@/components/reader/useSelectionCapture';
import type { ReadingPosition } from '@/components/reader/VirtualPageList';
import type { ZoomMode } from '@/components/reader/ZoomControl';
import type { BoardBesideControl } from '@/features/split';
import type { HighlightColor } from '@/lib/api/types';
import type { PaperRef } from '@/lib/paperSource';
import type { CardAt } from '../hooks/useHighlightActions';
import type { Failure } from '../model/failure';
import type { ReadingMode } from '../model/savedState';

/**
 * What the reader's view half is handed. The view is a thin shell: every region is one component,
 * and the shell knows nothing about any of their internals, so this is the one list of what the
 * workspace owns and the regions read.
 */
export interface ViewProps {
  readonly doc: IndexedDocument | null;
  readonly paper: PaperRef;
  /** 0-based page Guided is on, or the saved one (the header's counter). */
  readonly page: number | null;
  readonly mode: ReadingMode;
  readonly onModeChange: (mode: ReadingMode) => void;
  readonly zoom: number;
  readonly zoomMode: ZoomMode;
  readonly onZoomChange: (mode: ZoomMode) => void;
  readonly onViewportResize: (size: { readonly width: number; readonly height: number }) => void;
  readonly navigatorOpen: boolean;
  readonly onNavigatorToggle: () => void;
  readonly highlights: UseHighlights;
  readonly onCreateHighlight: (captured: SelectionCapture, color?: HighlightColor) => void;
  readonly onCreateNote: (captured: SelectionCapture, at: CardAt | null) => void;
  readonly onCreateAnchors: (anchors: readonly Anchor[], color?: HighlightColor) => void;
  readonly onNoteAnchors: (anchors: readonly Anchor[], at: CardAt | null) => void;
  readonly onOpenBoard: ((cardId: string | null) => void) | undefined;
  readonly onVisiblePages: (pages: readonly number[]) => void;
  readonly beside: BoardBesideControl;
  readonly onActivateHighlight: (highlightId: string, at: CardAt | null) => void;
  readonly activeHighlightId: string | null;
  readonly flash: FlashPaint | null;
  readonly guidedFlash: string | null;
  readonly followBlockId: string | null;
  readonly onShowSource: (blockIds: readonly string[]) => void;
  readonly documentRef: DocumentRef;
  readonly pdfFailure: Failure | null;
  readonly onRetryPdf: () => void;
  readonly stillReading: boolean;
  readonly onJumpToPage: (pageIndex: number) => void;
  /** The live text selection, or `null` when nothing is selected — #77's D6. */
  readonly selection: PendingSelection | null;
  readonly onSelectionChange: (selection: PendingSelection | null) => void;
  readonly initialPosition: ReadingPosition | null;
  readonly initialBlockId: string | null;
  readonly onSourcePosition: (position: ReadingPosition) => void;
  readonly onGuidedTop: (blockId: string) => void;
  readonly onFocusHighlight: (highlightId: string) => void;
  readonly narrow: boolean;
  readonly onNotice: (message: string) => void;
}
