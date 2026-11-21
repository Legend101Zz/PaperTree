'use client';

/**
 * reader/SelectionToolbar — the selection menu's shell (DESIGN.md §3 item 12, #203, P4 step 5):
 * its three placements, its measuring and its one tab stop. The items are `SelectionItems`:
 * Explain · Ask… · Send to board · Note · the five highlight colours.
 *
 * WHERE IT GOES is `features/reader/model/toolbarPlacement` (never over the lines being read):
 *
 *   `margin` — a column of buttons in the desk margin beside the selection, inside the scroller's
 *     floating layer (`VirtualPageList.renderFloating`), so it scrolls with the page and is never
 *     clipped by `.papertree-page`'s `overflow: hidden`.
 *   `docked` — a compact row (icons and short labels) across the top or bottom of the reader column,
 *     outside the scroller, when no margin is wide enough: a narrow window, and the split view.
 *   `sheet` — below 640 px, a bottom bar PORTALLED to `document.body`, where the thumb is.
 *
 * THE BASELINE DEFECT stays fixed: the bar is above the text layer, so the element at a button's
 * centre is that button (`e2e/s4/toolbar-hit-test.spec.ts`). `onPointerDown` prevents the default
 * on the whole bar, because a pointerdown collapses the very selection the bar acts on; buttons act
 * on `click`, which comes after with the selection still alive.
 */

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import './selectionToolbar.css';
import { SelectionItems, type SelectionActions } from './SelectionItems';
import { useRovingFocus } from './useRovingFocus';

import type { ReactNode } from 'react';

export type { SelectionActions, SendToBoardHow } from './SelectionItems';

/** Where the caller put the toolbar: beside the selection in a margin, docked, or the phone's bar. */
export type ToolbarPlacement =
  | { readonly kind: 'margin'; readonly left: number; readonly top: number }
  | { readonly kind: 'docked'; readonly edge: 'top' | 'bottom' }
  | { readonly kind: 'sheet' };

/** Props for `SelectionToolbar`: its placement and the actions it offers. */
export interface SelectionToolbarProps extends SelectionActions {
  readonly placement: ToolbarPlacement;
  /**
   * The bar's drawn size, on mount and whenever it changes (it fits its longest label, and a
   * Send to board choice opens inside it): the placement must use what is on screen, not a guess
   * (review B1).
   */
  readonly onMeasure?: (size: { readonly width: number; readonly height: number }) => void;
}

/**
 * The selection toolbar in its three forms. It positions nothing itself: the caller placed it.
 *
 * @param props - The placement, the actions, and why Highlight is unavailable (if it is).
 * @returns The toolbar, or a portal of it (the phone's bottom bar).
 */
export function SelectionToolbar(props: SelectionToolbarProps): ReactNode {
  const { placement, onMeasure } = props;
  const ref = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(ref);
  // Before paint (a layout effect), so a corrected placement is what the reader first sees; then
  // on every resize (a wrap, a font arriving, the column narrowing).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || onMeasure === undefined) return undefined;
    const report = (): void => onMeasure({ width: el.offsetWidth, height: el.offsetHeight });
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onMeasure, placement.kind]);
  const bar = (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection actions"
      aria-orientation={placement.kind === 'margin' ? 'vertical' : 'horizontal'}
      className={[
        'pt-seltool',
        `pt-seltool--${placement.kind}`,
        placement.kind === 'docked' ? `pt-seltool--${placement.edge}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-placement={placement.kind}
      style={placement.kind === 'margin' ? { left: placement.left, top: placement.top } : undefined}
      // Preventing pointerdown also suppresses the compatibility mousedown, whose default action
      // is what would collapse the selection.
      onPointerDown={(event) => event.preventDefault()}
      {...roving}
    >
      <SelectionItems {...props} compact={placement.kind === 'docked'} />
    </div>
  );

  if (placement.kind === 'sheet') {
    if (typeof document === 'undefined') return null;
    return createPortal(bar, document.body);
  }
  return bar;
}
