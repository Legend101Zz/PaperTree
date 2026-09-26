'use client';

/**
 * reader/SelectionToolbar — what a reader can do with a selection: Highlight, Ask, Send to canvas,
 * Copy.
 *
 * THE BASELINE DEFECT: IT WAS UNDER THE TEXT LAYER. The toolbar used to render inside the page's
 * overlay slot, a `pointer-events: none` box, so the toolbar inherited `pointer-events: none` and a
 * real mouse click on Highlight fell through to the text-layer span underneath — which collapsed
 * the selection and captured nothing (journey-baseline §B: `elementFromPoint` at the button's
 * centre was a `<span>`; only the keyboard path worked). It also sat inside `.papertree-page`,
 * whose `overflow: hidden` clipped it at the page edge.
 *
 * NOW IT IS ABOVE EVERYTHING, in one of two places:
 *
 *   `float` — in the scroller's FLOATING LAYER (`VirtualPageList.renderFloating`), a sibling of the
 *     pages stacked above all of them, at a position computed from the selection's IR extent and
 *     the page's arithmetic offset. It scrolls with the page for free and is never clipped.
 *   `sheet` — below 640 px, a bottom action bar PORTALLED to `document.body`: a phone's selection
 *     sits under the thumb, so the actions go where the thumb is, and never cover the text.
 *
 * `e2e/s4/toolbar-hit-test.spec.ts` asserts the fix the way the baseline found the bug: the element
 * at the Highlight button's centre IS the button.
 *
 * `onPointerDown` prevents the default on the whole bar: a pointerdown collapses the very
 * selection the toolbar acts on in WebKit and Blink. Buttons activate on `click` (mouse, touch and
 * keyboard alike), which fires after that prevented pointerdown with the selection still alive.
 *
 * THE ASK BUTTON CARRIES THE RESERVED AI MARKER — the same `DERIVED_MARKER` from `@papertree/ui`,
 * never typed as a literal: what Ask produces is model output, and the mark says so before the
 * reader presses it.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { DERIVED_MARKER } from '@papertree/ui';

export type ToolbarPlacement =
  | {
      readonly kind: 'float';
      /** Content coordinates (CSS px inside the scroller's content box) of the selection's extent. */
      readonly extent: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
      /** The content box's width, to keep the bar inside it. */
      readonly boundsWidth: number;
      /** Above the extent (a selection on one page), or below it (the end of one across pages). */
      readonly prefer?: 'above' | 'below';
    }
  | { readonly kind: 'sheet' };

export interface SelectionToolbarProps {
  readonly placement: ToolbarPlacement;
  readonly onHighlight: () => void;
  readonly onCopy: () => void;
  readonly onAsk?: () => void;
  readonly onSendToCanvas?: () => void;
  /**
   * Why Highlight cannot be used on this selection (the paper is still being read; the selection is
   * longer than one highlight may hold), or undefined. SHOWN in the bar, not only as a tooltip: a
   * disabled button with no visible reason is a dead end.
   */
  readonly highlightDisabledReason?: string;
}

const GAP = 8;
const EDGE = 8;

const NOTE_ID = 'pt-seltool-note';

function ToolbarButton({
  label,
  onActivate,
  disabled = false,
  title,
  describedBy,
  children,
  primary = false,
}: {
  readonly label: string;
  readonly onActivate?: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly describedBy?: string;
  readonly children: ReactNode;
  readonly primary?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`pt-btn${primary ? ' pt-btn--seltool-primary' : ''}`}
      aria-label={label}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      title={title ?? label}
      disabled={disabled || onActivate === undefined}
      onClick={() => {
        if (!disabled) onActivate?.();
      }}
    >
      {children}
    </button>
  );
}

function Buttons(props: SelectionToolbarProps): JSX.Element {
  const highlightDisabled = props.highlightDisabledReason !== undefined;
  return (
    <>
      <ToolbarButton
        label="Highlight"
        onActivate={props.onHighlight}
        disabled={highlightDisabled}
        {...(props.highlightDisabledReason === undefined
          ? {}
          : { title: props.highlightDisabledReason, describedBy: NOTE_ID })}
        primary
      >
        <span className="pt-seltool__dot" aria-hidden="true" />
        Highlight
      </ToolbarButton>
      <span className="pt-seltool__sep" aria-hidden="true" />
      <ToolbarButton label="Ask about this passage" onActivate={props.onAsk}>
        <span aria-hidden="true">{DERIVED_MARKER}</span>
        Ask
      </ToolbarButton>
      <ToolbarButton label="Send to canvas" onActivate={props.onSendToCanvas}>
        Canvas
      </ToolbarButton>
      <ToolbarButton label="Copy" onActivate={props.onCopy}>
        Copy
      </ToolbarButton>
      {props.highlightDisabledReason === undefined ? null : (
        <p id={NOTE_ID} className="pt-seltool__note">
          {props.highlightDisabledReason}
        </p>
      )}
    </>
  );
}

export function SelectionToolbar(props: SelectionToolbarProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // The bar's OWN box, so it can be kept inside the page column. This measures the toolbar, never
  // the selection: where the selection is comes from the IR.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    setSize((current) =>
      current !== null && current.width === next.width && current.height === next.height ? current : next,
    );
  }, [props.placement.kind, props.highlightDisabledReason]);

  const bar = (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection actions"
      aria-orientation="horizontal"
      className={[
        'pt-seltool',
        props.placement.kind === 'sheet' ? 'pt-seltool--sheet' : '',
        props.highlightDisabledReason === undefined ? '' : 'pt-seltool--noted',
      ]
        .filter(Boolean)
        .join(' ')}
      data-placement={props.placement.kind}
      style={props.placement.kind === 'float' ? floatStyle(props.placement, size) : undefined}
      // Preventing pointerdown also suppresses the compatibility mousedown, whose default action
      // is what would collapse the selection.
      onPointerDown={(event) => event.preventDefault()}
    >
      <Buttons {...props} />
    </div>
  );

  if (props.placement.kind === 'sheet') {
    if (typeof document === 'undefined') return null;
    return createPortal(bar, document.body);
  }
  return bar;
}

/** Above the selection, centred on it, kept inside the content column; below it if no room. */
function floatStyle(
  placement: Extract<ToolbarPlacement, { kind: 'float' }>,
  size: { width: number; height: number } | null,
): React.CSSProperties {
  const width = size?.width ?? 320;
  const height = size?.height ?? 48;
  const centre = (placement.extent.left + placement.extent.right) / 2;
  const maxLeft = Math.max(EDGE, placement.boundsWidth - width - EDGE);
  const left = Math.min(maxLeft, Math.max(EDGE, centre - width / 2));
  const above = placement.extent.top - GAP - height;
  const below = placement.extent.bottom + GAP;
  const top = placement.prefer === 'below' ? below : above >= EDGE ? above : below;
  return { left, top, visibility: size === null ? 'hidden' : 'visible' };
}
