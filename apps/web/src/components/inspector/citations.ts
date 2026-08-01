/**
 * Citations as anchors — capture, resolve, and classify for measurement.
 *
 * THE ENTIRE TRUST MECHANISM IS IN THIS FILE, so it is worth being explicit about what it does and
 * does not claim.
 *
 * The epic: *"Citations must actually navigate. A chip that scrolls to and outlines the correct
 * polygon is the entire trust mechanism. ≥95% correct region, 100% correct page."*
 *
 * WHY AN ANCHOR AND NOT A BLOCK ID. A `block_id` is content-derived (DESIGN.md D13), so any repair
 * that changes a block's text retires its id. A citation stored as a bare id is therefore a link
 * that breaks on the next parser upgrade — silently, because the id simply stops resolving.
 * `@papertree/anchoring` already solved this and measured it at 100.00% across 21
 * fixture × perturbation combinations, so the correct move is to use it rather than to invent a
 * second, worse mechanism. `captureAnchor` emits six selectors; `resolveAnchor` walks T0-T6 and
 * NEVER returns null, never throws and never deletes — an unresolvable citation comes back as
 * `state: 'orphan'` with a reason, which is a thing the UI can show.
 *
 * WHY `provenanceClass: 'ai_generated'`. These anchors are created by an answer, not by a human
 * dragging over text. The anchoring package carries that distinction through to the overlay, and
 * §11.4 requires derived regions to be visually distinguishable from the reader's own highlights.
 * Passing `'source'` here would make an AI-authored region indistinguishable from a user's
 * highlight, which is the exact inversion the provenance register exists to prevent.
 *
 * WHAT `classifyTarget` IS FOR, AND WHY IT IS NOT COSMETIC. Epic 1 ships with equation extents
 * wrong (#55 — 0 of 17 matched at IoU 0.5 on neural-odes) and figure regions unresolved (#51).
 * A citation to an equation or a figure will therefore land badly through no fault of this code.
 * The epic says so directly: *"Measure per target type and report separately, or your one number
 * will hide it."* `classifyTarget` is what makes that possible, and the buckets are deliberately
 * coarse — the IR's block-type vocabulary is OPEN, so a closed mapping over it would be wrong and
 * `other` is a real bucket rather than a hole.
 */

import { captureAnchor, resolveAnchor } from '@papertree/anchoring';
import type { Anchor, IndexedDocument, Resolution } from '@papertree/anchoring';

import type { Citation, CitationTargetType } from './types';

/**
 * Block types that are their own citation target type.
 *
 * `inline_equation` maps to `equation` on purpose: #55 is about equation geometry generally, and
 * splitting the bucket would put four data points in one row and thirteen in another.
 */
const TARGET_TYPE_BY_BLOCK_TYPE: Readonly<Record<string, CitationTargetType>> = {
  paragraph: 'text',
  abstract: 'text',
  list: 'text',
  list_item: 'text',
  caption: 'text',
  footnote: 'text',
  citation: 'text',
  reference_entry: 'text',
  code: 'text',
  algorithm: 'text',
  title: 'heading',
  heading: 'heading',
  equation: 'equation',
  inline_equation: 'equation',
  figure: 'figure',
  diagram: 'figure',
  plot: 'figure',
  table: 'table',
  table_row: 'table',
  table_cell: 'table',
};

/**
 * Bucket a block for per-target-type reporting.
 *
 * Unknown types answer `other` rather than throwing or defaulting to `text`. The IR states that a
 * consumer meeting an unknown type must preserve it and ignore it, never drop it — and quietly
 * counting an unknown type as `text` would inflate the bucket that is expected to do well.
 */
export function classifyTarget(blockType: string): CitationTargetType {
  return TARGET_TYPE_BY_BLOCK_TYPE[blockType] ?? 'other';
}

export interface CaptureCitationInput {
  readonly doc: IndexedDocument;
  readonly blockId: string;
  readonly label: string;
  readonly id: string;
  readonly at: string;
  readonly client: string;
}

/**
 * Capture and immediately resolve one citation.
 *
 * Resolution happens here, once, rather than lazily on click. A chip that resolves on click can
 * render as available and then do nothing, and "the citation did nothing" is indistinguishable to
 * a reader from "the product is lying" — which is the trust failure the whole epic is about.
 * Resolving eagerly means the chip can render its own failure state honestly instead.
 *
 * Throws only if the block is absent from this parse, which `captureAnchor` reports directly. That
 * is a programming error (an answer cited a block that is not in the document it was answered
 * from), not a runtime condition, so it is not swallowed.
 */
export function captureCitation(input: CaptureCitationInput): Citation {
  const anchor: Anchor = captureAnchor({
    doc: input.doc,
    blockId: input.blockId,
    targetKind: 'citation',
    // Authored by the answer, not by the reader. See the header.
    provenanceClass: 'ai_generated',
    id: input.id,
    at: input.at,
    client: input.client,
    mode: 'source',
  });

  const resolution: Resolution = resolveAnchor(anchor, input.doc);
  const block = input.doc.byId.get(input.blockId);

  return {
    label: input.label,
    anchor,
    resolution,
    targetType: classifyTarget(block?.type ?? 'unknown'),
  };
}

/**
 * Is this citation navigable at all?
 *
 * `orphan` is the only state that is not. `approximate` IS navigable — it lands on a region the
 * resolver is less sure about, and Hypothesis's 2017 orphans-tab decision (which `resolveAnchor`
 * follows) is that showing an approximate location beats showing nothing. The UI distinguishes the
 * two; it does not hide either.
 */
export function isNavigable(citation: Citation): boolean {
  return citation.resolution.state !== 'orphan' && citation.resolution.pageIndex !== null;
}
