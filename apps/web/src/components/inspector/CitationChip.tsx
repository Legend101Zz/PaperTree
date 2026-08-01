/**
 * A citation chip — the click that has to land.
 *
 * The interaction contract here is inherited, not invented:
 *
 *   * **Pointer Events only.** `test/touch.spec.tsx` scans every `.tsx` under `src/components/**`
 *     and fails on `onMouseDown|onMouseUp|onMouseMove` and on `onMouseEnter|onMouseOver|
 *     onMouseLeave`. New files are not on its quarantine list, so this one must be clean.
 *   * **`onPointerUp` plus a guarded `onClick`.** `onPointerUp` never fires for Enter/Space, so a
 *     pointer-only handler is a keyboard-inoperable button. The `event.detail === 0` guard is how
 *     `SelectionToolbar`'s `ToolbarButton` distinguishes a synthetic keyboard click from the click
 *     that follows a real pointer sequence, and copying it keeps one behaviour rather than two.
 *   * **No hover-only affordance.** Same spec: a class that only appears on hover must have a
 *     `focus`/`aria-expanded`/`data-open` counterpart. This chip's state is carried in ARIA and in
 *     `data-*`, which is also what makes the navigation test able to see it.
 *
 * THE THREE STATES ARE THE POINT. A chip is rendered for every citation, including the ones that
 * did not resolve, because `resolveAnchor` never deletes and neither does this. An orphan chip
 * renders disabled and says why — an inert-looking chip that silently does nothing is the failure
 * this whole feature exists to prevent, and it is exactly what a `citations.filter(isNavigable)`
 * would produce.
 */

import type { ReactNode } from 'react';

import { isNavigable } from './citations';
import type { Citation } from './types';

export interface CitationChipProps {
  readonly citation: Citation;
  /**
   * Navigate to this citation. REQUIRED.
   *
   * Epic 2 shipped `onViewportResize` as optional, never supplied it, and fit-width silently
   * clamped to 25%; the fix was to make it required so the compiler catches it instead of a test
   * that has to remember. A citation chip with an optional handler is the same defect with a
   * worse blast radius.
   */
  readonly onNavigate: (citation: Citation) => void;
}

/** Why a chip cannot be clicked, phrased for a reader rather than for a log. */
function orphanReason(citation: Citation): string {
  const reason = citation.resolution.reason;
  if (reason === undefined) return 'This region could not be located in the current parse.';
  const PHRASING: Readonly<Record<string, string>> = {
    block_id_missing: 'The cited block is not present in this parse.',
    block_text_changed: 'The cited text changed since the answer was written.',
    quote_below_threshold: 'The cited text could not be matched confidently enough.',
    quote_too_short_no_context: 'The citation is too short to locate unambiguously.',
    no_geometric_overlap: 'No region on the page overlaps the cited area.',
    section_not_found: 'The cited section is not present in this parse.',
    page_out_of_range: 'The cited page is outside this document.',
    no_selectors: 'This citation carries no selectors and cannot be located.',
  };
  return PHRASING[reason] ?? 'This region could not be located in the current parse.';
}

export function CitationChip({ citation, onNavigate }: CitationChipProps): ReactNode {
  const navigable = isNavigable(citation);
  const approximate = citation.resolution.state === 'approximate';
  const page = citation.resolution.pageIndex;

  // The accessible name carries the destination, not just the label. A screen-reader user
  // otherwise hears "1, 2, 3" and has no way to tell a working citation from a broken one — which
  // `reader/a11y.spec` treats as a real failure rather than a nicety.
  const destination =
    page === null ? 'location unknown' : `page ${String(page + 1)}${approximate ? ', approximate' : ''}`;

  return (
    <button
      type="button"
      className="pt-citation-chip"
      // Read by qa/citation-nav.spec. Attributes rather than classes because a class is styling and
      // can be renamed by a designer; these are the contract.
      data-citation-chip={citation.label}
      data-target-type={citation.targetType}
      data-resolution-state={citation.resolution.state}
      data-page-index={page === null ? undefined : String(page)}
      disabled={!navigable}
      aria-label={`Citation ${citation.label}: ${destination}`}
      title={navigable ? `Go to ${destination}` : orphanReason(citation)}
      onPointerUp={() => {
        if (navigable) onNavigate(citation);
      }}
      onClick={(event) => {
        // Keyboard activation only — a real pointer click already fired onPointerUp above.
        if (event.detail === 0 && navigable) onNavigate(citation);
      }}
    >
      {citation.label}
      {approximate ? <span aria-hidden="true">~</span> : null}
    </button>
  );
}
