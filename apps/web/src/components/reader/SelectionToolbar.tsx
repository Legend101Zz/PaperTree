'use client';

/**
 * reader/SelectionToolbar — the four-item floating toolbar of wireframe §19.2.
 *
 *   ⟨ ✎  [marker] Ask  ⌗  ⇱ ⟩     highlight · ask · to canvas · copy
 *
 * POSITIONED FROM THE IR, NOT FROM A DOM RECT. `irExtent` is the selection's extent in IR points —
 * `PendingSelection.irExtent`, which `useSelectionCapture` derives from `quadsForRange`. Multiplying
 * it by `zoom * userUnit` gives the position inside the page's own scaled coordinate box, so the
 * toolbar moves with the page for free and stays put across a resize. Calling
 * `getBoundingClientRect()` on the selection here would work today and be wrong at the next zoom
 * step, which is precisely the v1 failure this epic is undoing.
 *
 * ABOVE THE SELECTION. Wireframe §19.5: on a tablet the toolbar appears above what is selected so
 * the thumb does not occlude it. It flips below only when the selection is too near the top of the
 * page for "above" to be on screen — which is a decision about the IR's y, not about the viewport.
 *
 * THE AI AFFORDANCE CARRIES THE RESERVED MARKER, and it is the SAME one — `DERIVED_MARKER`,
 * imported from `@papertree/ui`. It is never typed as a literal here, not even in this comment:
 * the marker means "this is AI, not the paper" everywhere in the product, and the whole value of a
 * reserved character is that there is exactly one place it comes from. A second copy in a second
 * file is how a reserved mark quietly stops being reserved, and `reader/provenance.spec` greps for
 * exactly that. Inventing a second AI glyph for the toolbar would be the same failure by another
 * route: the marker in the wireframe's "Ask" item IS that mark, deliberately.
 *
 * ASK IS A NON-GOAL FOR EPIC 2. It renders DISABLED, with a title saying so. A button that looks
 * live and does nothing is worse than one that says what it is waiting for.
 */

import type { ReactNode } from 'react';

import { DERIVED_MARKER } from '@papertree/ui';
import type { BBox } from '@papertree/document-ir';

/** Wireframe §19.5 — iPad targets are 44x44 pt minimum. Applied on every device, not just touch. */
const MIN_TARGET_CSS_PX = 44;
/** Gap between the toolbar and the selection, CSS px. Constant on screen, so it is not scaled. */
const GAP_CSS_PX = 10;
/** The toolbar's own height, used only to decide whether "above" fits. */
const TOOLBAR_HEIGHT_CSS_PX = 52;

export interface SelectionToolbarProps {
  /** The selection's extent in IR space. From `PendingSelection.irExtent` — never from the DOM. */
  readonly irExtent: BBox;
  readonly zoom: number;
  readonly userUnit?: number;
  readonly onHighlight: () => void;
  readonly onSendToCanvas: () => void;
  readonly onCopy: () => void;
  /** Epic 3 wires this. Until it does, the Ask button is disabled and says why. */
  readonly onAsk?: () => void;
  /**
   * The Inspector slot of §19.2. Epic 3 owns the panel itself; this is the mounting point, left
   * deliberately empty so that landing it is an addition rather than a rearrangement.
   */
  readonly inspectorSlot?: ReactNode;
  readonly className?: string;
}

interface ToolbarButtonProps {
  readonly glyph: string;
  readonly label: string;
  readonly onActivate?: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly marker?: boolean;
}

function ToolbarButton({
  glyph,
  label,
  onActivate,
  disabled = false,
  title,
  marker = false,
}: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-lg text-stone-800 transition-colors hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 disabled:cursor-not-allowed disabled:text-stone-400 disabled:hover:bg-transparent"
      style={{ touchAction: 'manipulation' }}
      // Pointer Events first (F2.7). `onClick` is kept ONLY for the keyboard: Enter and Space on a
      // <button> synthesise a click with `detail === 0` and never fire a pointer event, so without
      // it the toolbar would be mouse- and touch-only.
      onPointerUp={() => {
        if (!disabled) onActivate?.();
      }}
      onClick={(event) => {
        if (!disabled && event.detail === 0) onActivate?.();
      }}
    >
      <span aria-hidden="true" className={marker ? 'font-normal' : undefined}>
        {glyph}
      </span>
      {marker ? <span className="text-sm">Ask</span> : null}
    </button>
  );
}

export function SelectionToolbar({
  irExtent,
  zoom,
  userUnit = 1,
  onHighlight,
  onSendToCanvas,
  onCopy,
  onAsk,
  inspectorSlot,
  className,
}: SelectionToolbarProps): JSX.Element {
  const scale = zoom * userUnit;
  const centreX = ((irExtent[0] + irExtent[2]) / 2) * scale;
  const topY = irExtent[1] * scale;
  const bottomY = irExtent[3] * scale;

  // "Above" unless above would be off the top of the page. Decided from IR y x zoom, so it is the
  // same decision at every window size — no `window.innerHeight`, no scroll position.
  const above = topY >= TOOLBAR_HEIGHT_CSS_PX + GAP_CSS_PX;

  return (
    <div
      className={`pt-selection-toolbar absolute z-30 ${className ?? ''}`}
      data-placement={above ? 'above' : 'below'}
      style={{
        left: centreX,
        top: above ? topY - GAP_CSS_PX : bottomY + GAP_CSS_PX,
        transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        touchAction: 'manipulation',
      }}
      // A pointerdown inside the toolbar collapses the very selection the toolbar is acting on in
      // WebKit and Blink. Preventing the default keeps the selection alive long enough for the
      // pointerup handler to capture it — without this, every button is a no-op on the first tap.
      onPointerDown={(event) => event.preventDefault()}
    >
      <div
        role="toolbar"
        aria-label="Selection actions"
        aria-orientation="horizontal"
        className="flex items-center gap-1 rounded-xl border border-stone-200 bg-white/95 p-1 shadow-lg backdrop-blur"
      >
        <ToolbarButton glyph="✎" label="Highlight" onActivate={onHighlight} />
        <ToolbarButton
          glyph={DERIVED_MARKER}
          label="Ask about this selection"
          marker
          disabled={onAsk === undefined}
          onActivate={onAsk}
          title={
            onAsk === undefined
              ? 'Ask arrives in Epic 3 (Q&A with provenance). Epic 2 ships the anchoring it will cite.'
              : 'Ask about this selection'
          }
        />
        <ToolbarButton glyph="⌗" label="Send to canvas" onActivate={onSendToCanvas} />
        <ToolbarButton glyph="⇱" label="Copy" onActivate={onCopy} />
      </div>

      {/* §19.2's Inspector. Empty by design until Epic 3 fills it. */}
      <div data-slot="inspector" className="pt-selection-toolbar__inspector">
        {inspectorSlot}
      </div>
    </div>
  );
}
