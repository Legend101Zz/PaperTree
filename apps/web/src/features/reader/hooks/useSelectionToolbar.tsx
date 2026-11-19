'use client';

/**
 * Where the selection toolbar is drawn (#203), out of `SourcePane`: the selection's lines (both pages
 * of one across a page break) and the page's type area in content px, the bar's MEASURED size, and
 * `placeToolbar`'s answer, mounted in the page margin (the scroller's floating layer), docked over
 * the column (a host outside the scroller), or as the phone's bottom bar.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { SelectionToolbar, type SelectionToolbarProps } from '@/components/reader/SelectionToolbar';

import { placeToolbar, selectionLines, typeAreaOf } from '../model/toolbarPlacement';

import type { IndexedDocument } from '@papertree/anchoring';
import type { PendingSelection } from '@/components/reader/useSelectionCapture';
import type { FloatingGeometry } from '@/components/reader/VirtualPageList';

/**
 * Sizes before the first measurement: the margin column fits "Send to board" and its chevron (the
 * prototype draws 190), one row docked. After the first paint the bar's own size is what counts.
 */
const FIRST_GUESS = { margin: { width: 190, height: 230 }, docked: 48 } as const;

/** The toolbar's actions: everything but where it goes and its measurement. */
export type ToolbarActions = Omit<SelectionToolbarProps, 'placement' | 'onMeasure'>;

interface Sizes {
  readonly margin: { readonly width: number; readonly height: number };
  readonly docked: number;
}

/** What `useSelectionToolbar` needs. */
export interface UseSelectionToolbarArgs {
  readonly selection: PendingSelection | null;
  readonly doc: IndexedDocument | null;
  /** Below 640 px the bar is the phone's bottom bar. */
  readonly narrow: boolean;
  /** A bottom sheet (Contents on a phone) is open: the bar waits under it. */
  readonly sheetOpen: boolean;
  /** The board is beside the paper (#344): the menu always docks. */
  readonly dockOnly?: boolean;
  readonly actions: ToolbarActions;
}

/** The three places the bar can be drawn; `SourcePane` mounts each where it belongs. */
export interface SelectionToolbarMount {
  /** For `VirtualPageList.renderFloating`: the margin bar, or a portal of the docked one. */
  readonly floating: (geometry: FloatingGeometry) => ReactNode;
  /** The dock's host, over the column and outside the scroller (so the docked bar stays put). */
  readonly dock: ReactNode;
  /** The phone's bottom bar, or null. */
  readonly sheet: ReactNode;
}

/**
 * The selection toolbar's placement and mounts.
 *
 * @param args - The selection, the parse, the layout flags and the actions.
 * @returns The floating renderer, the dock host and the phone bar.
 */
export function useSelectionToolbar(args: UseSelectionToolbarArgs): SelectionToolbarMount {
  const { selection, doc, narrow, sheetOpen, actions, dockOnly = false } = args;
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  const [sizes, setSizes] = useState<Sizes>(FIRST_GUESS);
  const measureMargin = useCallback(
    (size: { readonly width: number; readonly height: number }) =>
      setSizes((s) =>
        (s.margin.width === size.width && s.margin.height === size.height) ||
        size.width <= 0 ||
        size.height <= 0
          ? s
          : { ...s, margin: { width: size.width, height: size.height } },
      ),
    [],
  );
  const measureDocked = useCallback(
    (size: { readonly height: number }) =>
      setSizes((s) =>
        s.docked === size.height || size.height <= 0 ? s : { ...s, docked: size.height },
      ),
    [],
  );

  const floating = (geometry: FloatingGeometry): ReactNode => {
    if (narrow || selection === null) return null;
    const lines = selectionLines(selection, geometry, (page) =>
      typeAreaOf(doc?.byPage.get(page) ?? []),
    );
    if (lines === null) return null;
    const placed = placeToolbar({
      typeArea: lines.typeArea,
      selection: lines.lines,
      levelWith: lines.levelWith,
      toolbar: sizes.margin,
      dockHeight: sizes.docked,
      viewport: geometry.viewport,
      dockOnly,
    });
    if (placed.kind === 'margin') {
      return (
        <SelectionToolbar
          placement={{ kind: 'margin', left: placed.rect.left, top: placed.rect.top }}
          onMeasure={measureMargin}
          {...actions}
        />
      );
    }
    if (dockHost === null) return null;
    return createPortal(
      <SelectionToolbar
        placement={{ kind: 'docked', edge: placed.edge }}
        onMeasure={measureDocked}
        {...actions}
      />,
      dockHost,
    );
  };

  return {
    floating,
    dock: <div ref={setDockHost} className="pt-seltool-dock" data-seltool-dock="" />,
    sheet:
      narrow && selection !== null && !sheetOpen ? (
        <SelectionToolbar placement={{ kind: 'sheet' }} {...actions} />
      ) : null,
  };
}
