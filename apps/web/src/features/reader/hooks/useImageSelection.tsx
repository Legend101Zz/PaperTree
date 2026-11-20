'use client';

/**
 * reader/useImageSelection — picking a picture on Source, as `SourcePane` mounts it (v0.3 #348): the
 * pick and its gestures (`useImagePick`), what the menu does with it (`useImageActions`), the drag of
 * a picked picture to the board beside the paper, and each page's layer.
 *
 * While a picture is picked it is THE selection: the menu is placed by its rectangle and acts on it,
 * and the text selection's own Enter and Escape keys stand down (the picture's keys are in charge),
 * though the words themselves stay, because "a figure and a paragraph together" is asked with both.
 */
import { useCallback, useMemo, type DragEvent, type ReactNode } from 'react';

import { hitsItem, type PaintItem } from '@/components/reader/HighlightOverlay';
import { setDraggedPassage } from '@/features/split/model/passageDrag';
import { floatCardBody } from '@/lib/imageAnchor';

import { ImageLayer, type FrameDrag } from '../components/ImageLayer';
import { floatsOnPage } from '../model/floats';
import { pickGeometry, pickLabel } from '../model/imagePick';
import { anchorForPick, useImageActions, type UseImageActionsArgs } from './useImageActions';
import { useImagePick, type ImagePicking, type PageGeometry } from './useImagePick';

import type { IndexedDocument } from '@papertree/anchoring';
import type { SelectionActions } from '@/components/reader/SelectionItems';
import type { PendingSelection } from '@/components/reader/useSelectionCapture';
import type { SelectionGeometry } from '../model/toolbarPlacement';

/** What `useImageSelection` needs from the pane. */
export interface UseImageSelectionArgs extends Pick<
  UseImageActionsArgs,
  'onCreateAnchors' | 'onNoteAnchors' | 'onOpenBoard' | 'onNotice' | 'highlightDisabledReason'
> {
  readonly doc: IndexedDocument | null;
  readonly root: HTMLElement | null;
  readonly zoom: number;
  readonly pageOf: (pageIndex: number) => PageGeometry | null;
  /** The live text selection, which rides with a picture picked with Shift. */
  readonly textSelection: PendingSelection | null;
  readonly captureText: UseImageActionsArgs['captureText'];
  readonly clearText: () => void;
  /** The painted highlights: a click on one opens it rather than picking the float under it. */
  readonly items: readonly PaintItem[];
  readonly boardBeside: boolean;
  /** The page most in view, or -1. */
  readonly currentPage: () => number;
}

/** What the pane mounts. */
export interface ImageSelection {
  /** A picture is picked: the menu is the picture's. */
  readonly active: boolean;
  /** What the toolbar places itself by, or null. */
  readonly geometry: SelectionGeometry | null;
  /** The picture's menu actions, or null. */
  readonly actions: SelectionActions | null;
  /** The page's picking layer, for the overlay slot. */
  readonly layer: (pageIndex: number, userUnit: number) => ReactNode;
  readonly picking: ImagePicking;
}

/**
 * Picking pictures on Source.
 *
 * @param args The pane's parse, scroller, selection and callbacks.
 * @returns The state the pane draws and wires.
 */
export function useImageSelection(args: UseImageSelectionArgs): ImageSelection {
  const { doc, items, boardBeside } = args;
  const onHighlight = useCallback(
    (pageIndex: number, x: number, y: number): boolean =>
      items.some((item) => item.pageIndex === pageIndex && hitsItem(item, x, y)),
    [items],
  );
  const picking = useImagePick({
    doc,
    root: args.root,
    zoom: args.zoom,
    pageOf: args.pageOf,
    textSelected: args.textSelection !== null,
    clearText: args.clearText,
    onHighlight,
    currentPage: args.currentPage,
  });
  const { pick, clear } = picking;
  const actions = useImageActions({
    pick,
    doc,
    captureText: args.captureText,
    clear,
    root: args.root,
    onCreateAnchors: args.onCreateAnchors,
    ...(args.onNoteAnchors === undefined ? {} : { onNoteAnchors: args.onNoteAnchors }),
    ...(args.onOpenBoard === undefined ? {} : { onOpenBoard: args.onOpenBoard }),
    ...(args.onNotice === undefined ? {} : { onNotice: args.onNotice }),
    highlightDisabledReason: args.highlightDisabledReason,
  });

  // The chip is what is dragged across the divider; the board takes it as an image card.
  const drag = useMemo<FrameDrag | undefined>(() => {
    if (!boardBeside || pick === null || doc === null) return undefined;
    return {
      onDragStart: (event: DragEvent<HTMLElement>) => {
        setDraggedPassage({
          anchor: anchorForPick(doc, pick),
          // The caption is what the card will say (else its numbered name); a region has none.
          text: pick.float === null ? '' : floatCardBody(pick.float.caption, pick.float.label),
          image: true,
        });
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', pickLabel(pick));
      },
      onDragEnd: () => setDraggedPassage(null),
    };
  }, [boardBeside, pick, doc]);

  const layer = useCallback(
    (pageIndex: number, userUnit: number): ReactNode =>
      doc === null ? null : (
        <ImageLayer
          pageIndex={pageIndex}
          scale={args.zoom * userUnit}
          floats={floatsOnPage(doc, pageIndex)}
          picking={picking}
          {...(drag === undefined ? {} : { drag })}
        />
      ),
    [doc, args.zoom, picking, drag],
  );

  const geometry = useMemo(() => (pick === null ? null : pickGeometry(pick)), [pick]);
  return { active: pick !== null, geometry, actions, layer, picking };
}
