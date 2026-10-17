'use client';

/**
 * reader/SelectionToolbar — what a reader can do with a selection (DESIGN.md §3 item 12, #203):
 * Explain · Ask · Highlight with the five washes · Send to board · Copy, and "Explain with a
 * diagram" once the diagram slice provides it.
 *
 * WHERE IT GOES is `features/reader/model/toolbarPlacement` (never over the lines being read):
 *
 *   `margin` — a column of buttons in the page margin beside the selection, inside the scroller's
 *     floating layer (`VirtualPageList.renderFloating`), so it scrolls with the page and is never
 *     clipped by `.papertree-page`'s `overflow: hidden`.
 *   `docked` — a row across the top (or bottom) of the reader column, outside the scroller, when no
 *     margin is wide enough (frame 07a).
 *   `sheet` — below 640 px, a bottom bar PORTALLED to `document.body`, where the thumb is.
 *
 * THE BASELINE DEFECT stays fixed: the bar is above the text layer, so the element at a button's
 * centre is that button (`e2e/s4/toolbar-hit-test.spec.ts`). `onPointerDown` prevents the default
 * on the whole bar, because a pointerdown collapses the very selection the bar acts on; buttons act
 * on `click`, which comes after with the selection still alive.
 */

import { Copy, Highlighter, MessageSquare, Network, Pin, Type } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { HIGHLIGHT_COLORS } from './useHighlights';

import type { HighlightColor } from '@/lib/api/types';
import type { CSSProperties, ReactNode } from 'react';

/** Where the caller put the toolbar: beside the selection in a margin, docked, or the phone's bar. */
export type ToolbarPlacement =
  | { readonly kind: 'margin'; readonly left: number; readonly top: number }
  | { readonly kind: 'docked'; readonly edge: 'top' | 'bottom' }
  | { readonly kind: 'sheet' };

/** Props for `SelectionToolbar`: its placement and the actions it offers. */
export interface SelectionToolbarProps {
  readonly placement: ToolbarPlacement;
  /** Highlight in the last colour used, or in the wash pressed. */
  readonly onHighlight: (color?: HighlightColor) => void;
  readonly onCopy: () => void;
  /** Explain this passage now (the default question). */
  readonly onExplain?: () => void;
  /** Open the panel on this passage with the question box ready for the reader's own words. */
  readonly onAsk?: () => void;
  readonly onSendToBoard?: () => void;
  /** Drawn only when given: the diagram slice wires it (#217). No placeholder button before then. */
  readonly onExplainWithDiagram?: () => void;
  /**
   * Why Highlight cannot be used on this selection, or undefined. SHOWN in the bar, not only as a
   * tooltip: a disabled button with no visible reason is a dead end.
   */
  readonly highlightDisabledReason?: string;
  /**
   * The bar's drawn size, on mount and whenever it changes (a docked bar wraps in a narrow column):
   * the placement must use what is on screen, not a guess (review B1).
   */
  readonly onMeasure?: (size: { readonly width: number; readonly height: number }) => void;
}

const NOTE_ID = 'pt-seltool-note';
const ICON = 18;

function Item(props: {
  readonly label: string;
  readonly name?: string;
  readonly icon: ReactNode;
  readonly onActivate?: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly primary?: boolean;
}): ReactNode {
  const off = props.disabled === true || props.onActivate === undefined;
  return (
    <button
      type="button"
      className={`pt-toolbtn pt-seltool__item${props.primary === true ? ' pt-seltool__item--primary' : ''}`}
      aria-label={props.name ?? props.label}
      {...(props.describedBy === undefined ? {} : { 'aria-describedby': props.describedBy })}
      // Native `disabled` (v0.1's contract, `e2e/s4/selection-regressions`): the reason is in the
      // bar beside it, so nobody has to focus the button to learn it.
      disabled={off}
      onClick={() => {
        if (!off) props.onActivate?.();
      }}
    >
      <span className="pt-toolbtn__icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="pt-toolbtn__label">{props.label}</span>
    </button>
  );
}

function Washes(props: SelectionToolbarProps): ReactNode {
  const off = props.highlightDisabledReason !== undefined;
  return (
    <span className="pt-seltool__washes" role="group" aria-label="Highlight colour">
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="pt-seltool__wash"
          aria-label={`Highlight in ${color}`}
          disabled={off}
          style={
            {
              '--wash-fill': `var(--pt-hl-${color})`,
              '--wash-ink': `var(--pt-hl-${color}-ink)`,
            } as CSSProperties
          }
          onClick={() => {
            if (!off) props.onHighlight(color);
          }}
        />
      ))}
    </span>
  );
}

function Items(props: SelectionToolbarProps): ReactNode {
  const reason = props.highlightDisabledReason;
  return (
    <>
      {props.onExplain === undefined ? null : (
        <Item
          label="Explain"
          name="Explain this passage"
          icon={<MessageSquare size={ICON} strokeWidth={1.5} />}
          onActivate={props.onExplain}
          primary
        />
      )}
      {props.onAsk === undefined ? null : (
        <Item
          label="Ask"
          name="Ask about this passage"
          icon={<Type size={ICON} strokeWidth={1.5} />}
          onActivate={props.onAsk}
        />
      )}
      {props.onExplainWithDiagram === undefined ? null : (
        <Item
          label="Explain with a diagram"
          icon={<Network size={ICON} strokeWidth={1.5} />}
          onActivate={props.onExplainWithDiagram}
        />
      )}
      <Item
        label="Highlight"
        icon={<Highlighter size={ICON} strokeWidth={1.5} />}
        onActivate={() => props.onHighlight()}
        disabled={reason !== undefined}
        {...(reason === undefined ? {} : { describedBy: NOTE_ID })}
      />
      <Washes {...props} />
      {props.onSendToBoard === undefined ? null : (
        <Item
          label="Send to board"
          icon={<Pin size={ICON} strokeWidth={1.5} />}
          onActivate={props.onSendToBoard}
        />
      )}
      <Item label="Copy" icon={<Copy size={ICON} strokeWidth={1.5} />} onActivate={props.onCopy} />
      {reason === undefined ? null : (
        <p id={NOTE_ID} className="pt-seltool__note">
          {reason}
        </p>
      )}
    </>
  );
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
    >
      <Items {...props} />
    </div>
  );

  if (placement.kind === 'sheet') {
    if (typeof document === 'undefined') return null;
    return createPortal(bar, document.body);
  }
  return bar;
}
