/**
 * anchoring/guided — the Guided projection, and cross-mode resolution.
 *
 * WHAT THIS EXISTS TO ANSWER. `anchoring/cross-mode.spec` requires that a highlight made in Source
 * either resolves in Guided **or explicitly reports that it is not available in this view**. Both
 * halves are real: Guided is a *reading* of the paper, not a copy of it, and a reading legitimately
 * leaves things out. A page number, a running footer and the arXiv stamp down the margin have no
 * place in reflowed prose. The failure mode this file exists to prevent is a highlight on one of
 * them vanishing in silence.
 *
 * WHY THE PROJECTION LIVES HERE AND NOT IN `GuidedView.tsx`. It used to live there, and the
 * resolver would have had to re-derive it. Two implementations of "what counts as a paragraph"
 * drift, and when they drift the symptom is a highlight that the UI puts in the wrong place — the
 * exact class of bug this whole package exists to make impossible. `GuidedView` now renders FROM
 * this projection, so "where does this anchor land in Guided" and "what does Guided draw" are
 * answers to the same function.
 *
 * THE OFFSET PROBLEM, WHICH IS THE REAL WORK. Guided text is not the block's text. `reflow` removes
 * line breaks, repairs the typesetter's hyphens, and `joinContinuedBlocks` welds a paragraph that
 * runs across a column break back into one. So code-point offset 40 in `Block.text` is NOT offset
 * 40 in the paragraph the reader sees. Every function here that produces text also produces the map
 * back, and `locateInGuided` uses it. Without that, cross-mode "resolution" would mean "we found
 * the right paragraph and guessed at the position", which is not what the criterion asks for.
 *
 * CODE POINTS, NOT UTF-16 CODE UNITS. `Anchor.offsetUnit` is `'unicode'` and the rest of this
 * package counts code points; this file does too. The version of these functions that lived in
 * `apps/web` used `String.charAt`, which is code units — identical on the BMP, wrong the moment a
 * paper contains an astral character, and the fixtures are full of mathematics.
 */

import type { IndexedBlock, IndexedDocument } from './document.js';
import { resolveAnchor } from './resolve.js';
import type { Anchor, Resolution } from './types.js';

// ─── reflow ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A cased letter, in any script. Caseless scripts (CJK, Arabic, Hebrew) answer `false`, which is the
 * conservative answer: they do not hyphenate at line breaks, so the hyphen is kept.
 */
function isLetter(ch: string): boolean {
  return ch.length > 0 && ch.toLowerCase() !== ch.toUpperCase();
}

/** A lowercase letter — the signal that the next line CONTINUES a word rather than starting one. */
function isLowercaseLetter(ch: string): boolean {
  return isLetter(ch) && ch === ch.toLowerCase();
}

function isWhitespace(ch: string): boolean {
  // U+00A0 is in the set: PDF text layers emit it, and beside a line break it is redundant
  // whitespace like any other. Written as an escape so it cannot be mistaken for a plain space.
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === '\f' ||
    ch === '\v' ||
    ch === '\u00a0'
  );
}

function isNewline(ch: string): boolean {
  return ch === '\n' || ch === '\r';
}

/**
 * Reflowed text, plus the map back to where each character came from.
 *
 * `sourceOffsets[i]` is the code-point index in the INPUT that produced output code point `i`. It is
 * non-decreasing, which is what lets `offsetToGuided` binary-search it. Characters the reflow
 * INVENTS — the single space that replaces a line break — carry the offset of the whitespace run
 * they stand for, so a highlight that starts at a line break still lands somewhere truthful.
 */
export interface ReflowResult {
  readonly text: string;
  readonly sourceOffsets: readonly number[];
}

/**
 * Reflow one block's text into a single paragraph, recording where every character came from.
 *
 * The rule, and it is a rule with a known false positive:
 *
 *   - `letter` + `-\n` + `lowercase letter`  →  join and DROP the hyphen. The typesetter's soft
 *     hyphen: `"transduc-\ntion"` → `"transduction"`.
 *   - every other `-\n`                      →  join and KEEP the hyphen. `"2015-\n2016"` stays a
 *     range; `"Kaiming-\nHe"` stays a name (the capital is the signal); a trailing `"-\n"` at the
 *     end of a block keeps its hyphen because there is no evidence either way.
 *   - every remaining newline                →  a single space.
 *
 * THE FALSE POSITIVE IS REAL AND KNOWINGLY ACCEPTED. `resnet` contains `"d/high-\nlevel"`, a genuine
 * compound broken AT its own hyphen; this returns `"highlevel"`. Telling the two apart needs a
 * lexicon, and a lexicon that is wrong about a technical term is worse than a rule that is wrong
 * predictably: the paper itself is one click away in Source, which is the whole reason Guided is
 * allowed to be an interpretation at all.
 *
 * `\r\n` is NOT pre-normalised with a `replace`, because that would shift every offset after it and
 * silently break the map this function exists to produce. Carriage returns are consumed as
 * whitespace by the scan instead.
 */
export function reflowWithMap(text: string): ReflowResult {
  const src = Array.from(text);
  const out: string[] = [];
  const map: number[] = [];
  let i = 0;

  /** Drop trailing spaces/tabs already written, which a line break makes redundant. */
  const trimEndInline = (): void => {
    while (out.length > 0) {
      const last = out[out.length - 1];
      if (last !== ' ' && last !== '\t') break;
      out.pop();
      map.pop();
    }
  };

  while (i < src.length) {
    const ch = src[i] as string;
    if (!isNewline(ch)) {
      out.push(ch);
      map.push(i);
      i += 1;
      continue;
    }

    // A line break. Consume it together with the whitespace on both sides, so a blank line or a
    // trailing space never becomes a double space in the reading.
    trimEndInline();
    const breakAt = i;
    let j = i;
    while (j < src.length && isWhitespace(src[j] as string)) j += 1;
    const next = j < src.length ? (src[j] as string) : '';
    i = j;

    if (out.length > 0 && out[out.length - 1] === '-') {
      const beforeHyphen = out.length >= 2 ? (out[out.length - 2] as string) : '';
      if (isLetter(beforeHyphen) && isLowercaseLetter(next)) {
        // The typesetter's hyphen. It exists only because of the line break that is going away.
        out.pop();
        map.pop();
      }
      // Either way the two halves are joined with NO space: a kept hyphen is part of the word
      // ("2015-2016", "Kaiming-He"), and a space would break it as surely as the newline did.
      continue;
    }

    if (out.length > 0) {
      out.push(' ');
      map.push(breakAt);
    }
  }

  // `.trim()` on the string would desynchronise the map, so the ends are trimmed in lockstep.
  let start = 0;
  let end = out.length;
  while (start < end && isWhitespace(out[start] as string)) start += 1;
  while (end > start && isWhitespace(out[end - 1] as string)) end -= 1;

  return { text: out.slice(start, end).join(''), sourceOffsets: map.slice(start, end) };
}

/** Reflow one block's text into a single paragraph. */
export function reflow(text: string): string {
  return reflowWithMap(text).text;
}

/**
 * One source block's contribution to a joined paragraph.
 *
 * `sourceOffsets[k]` is the code-point offset in THAT BLOCK's own text which produced paragraph code
 * point `outStart + k`.
 */
export interface JoinedSegment {
  readonly blockIndex: number;
  readonly outStart: number;
  readonly outEnd: number;
  readonly sourceOffsets: readonly number[];
}

export interface JoinResult {
  readonly text: string;
  readonly segments: readonly JoinedSegment[];
}

/**
 * Join consecutive blocks of ONE continued paragraph, repairing a hyphen that straddles the seam.
 *
 * `reflow` cannot fix this alone, and the fixture set contains the exact case that proves it.
 * `resnet`'s block `blk_4hiq3kzukt6azk4x` ENDS with the four characters `high-` — no newline, the
 * block simply stops — and the word finishes as `way networks` at the start of the block it
 * continues into, because the paragraph runs on into the next column. Reflowing each block
 * separately and joining with a space produces `high- way networks`, which is not what the page
 * says. De-hyphenation is a DOCUMENT-level operation wherever a paragraph is continued.
 */
export function joinContinuedBlocksWithMap(texts: readonly string[]): JoinResult {
  const out: string[] = [];
  /** Parallel to `out`: which input block each code point came from, and at what offset. -1 = none. */
  const owner: number[] = [];
  const ownerOffset: number[] = [];

  texts.forEach((text, blockIndex) => {
    const piece = reflowWithMap(text);
    if (piece.text === '') return;
    const cps = Array.from(piece.text);

    if (out.length > 0) {
      const last = out[out.length - 1] as string;
      if (last === '-') {
        const beforeHyphen = out.length >= 2 ? (out[out.length - 2] as string) : '';
        if (isLetter(beforeHyphen) && isLowercaseLetter(cps[0] ?? '')) {
          out.pop();
          owner.pop();
          ownerOffset.pop();
        }
        // A hyphen that is part of the word joins with no space, exactly as `reflow` does.
      } else {
        // The seam space belongs to no block: it is punctuation the join invented.
        out.push(' ');
        owner.push(-1);
        ownerOffset.push(-1);
      }
    }

    cps.forEach((cp, k) => {
      out.push(cp);
      owner.push(blockIndex);
      ownerOffset.push(piece.sourceOffsets[k] as number);
    });
  });

  const segments: JoinedSegment[] = [];
  for (let index = 0; index < texts.length; index += 1) {
    let outStart = -1;
    let outEnd = -1;
    const offsets: number[] = [];
    for (let k = 0; k < owner.length; k += 1) {
      if (owner[k] !== index) continue;
      if (outStart === -1) outStart = k;
      outEnd = k + 1;
      offsets.push(ownerOffset[k] as number);
    }
    if (outStart === -1) continue;
    segments.push({ blockIndex: index, outStart, outEnd, sourceOffsets: offsets });
  }

  return { text: out.join(''), segments };
}

/** Join consecutive blocks of one continued paragraph. */
export function joinContinuedBlocks(texts: readonly string[]): string {
  return joinContinuedBlocksWithMap(texts).text;
}

/**
 * Reflow text that is laid out on purpose — an `algorithm` block's pseudocode, an address block.
 *
 * The SOFT hyphen repair still applies (a word broken across two lines is broken for the same
 * reason), but the newlines survive, because in pseudocode a line break carries meaning that a space
 * does not — `reflow` would silently turn twelve numbered steps into one sentence. A hyphen this
 * cannot prove is a typesetter's stays put, line break and all: at that point it is the paper's own
 * line, and the paper's own lines are what this variant exists to keep.
 */
export function reflowPreservingLines(text: string): readonly string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());

  const out: string[] = [];
  for (const line of lines) {
    const previous = out.length > 0 ? out[out.length - 1] : undefined;
    if (
      previous !== undefined &&
      previous.charAt(previous.length - 1) === '-' &&
      isLetter(previous.charAt(previous.length - 2)) &&
      isLowercaseLetter(line.charAt(0))
    ) {
      out[out.length - 1] = previous.slice(0, -1) + line;
      continue;
    }
    out.push(line);
  }
  return out;
}

// ─── the projection ─────────────────────────────────────────────────────────────────────────────

/**
 * Page furniture. Present in the IR, absent from the reading — and therefore the honest answer to
 * "does this Source highlight exist in Guided?" is **no**, with a reason.
 *
 * A page number, a running footer and the arXiv stamp down the margin are artefacts of the page, not
 * of the argument, and Guided has no pages. `annotation` is the arXiv stamp in `neural-odes`;
 * `margin_note` is the same thing in `attention` and `resnet`. `unknown` blocks are hairline rules
 * 0.4–4 pt tall carrying confidence 0.3 and no text at all.
 */
export const GUIDED_FURNITURE_TYPES: ReadonlySet<string> = new Set([
  'page_number',
  'footer',
  'header',
  'margin_note',
  'annotation',
  'unknown',
]);

/** Line-preserving types: pseudocode is laid out on purpose and `reflow` would flatten it. */
export const GUIDED_LINEWISE_TYPES: ReadonlySet<string> = new Set(['algorithm']);

/** Why a block is not a paragraph of its own in the reading. */
export type GuidedPlacement =
  /** Rendered as its own paragraph (or float) in the reading. */
  | { readonly kind: 'paragraph'; readonly paragraphId: string }
  /**
   * Rendered, but INSIDE another block's component — a `table_cell` inside its `TableView`, a
   * caption inside the `FigureView` that claims it. Still reachable, still carries a `data-block-id`,
   * so a highlight on it IS available in Guided; it just is not a paragraph.
   */
  | { readonly kind: 'owned'; readonly ownerId: string }
  /** Not in the reading at all. */
  | { readonly kind: 'absent'; readonly reason: 'furniture' | 'empty' };

export interface GuidedParagraph {
  /** The HEAD block's id. A continued paragraph is identified by the fragment that starts it. */
  readonly id: string;
  readonly type: string;
  /** Every block that contributed, in order. "Show source" must reach all of them. */
  readonly sourceIds: readonly string[];
  /** The reflowed reading. Empty for floats, which carry no text by design. */
  readonly text: string;
  readonly segments: readonly JoinedSegment[];
  /** Pseudocode keeps its lines; everything else is one flowed paragraph. */
  readonly lines?: readonly string[];
}

export interface GuidedProjection {
  readonly paragraphs: readonly GuidedParagraph[];
  readonly byParagraphId: ReadonlyMap<string, GuidedParagraph>;
  /** EVERY block id in the document → where it ended up. Total: no block is unclassified. */
  readonly placement: ReadonlyMap<string, GuidedPlacement>;
  readonly furnitureCount: number;
}

/**
 * A block is nested INSIDE CONTENT when its parent is not a heading.
 *
 * `parent_id` carries two different relations in the fixtures and conflating them loses blocks. A
 * paragraph's parent is its section HEADING (that is sectioning, and the paragraph is still
 * top-level prose); a `table_cell`'s parent is a `table_row`, a `table_row`'s is a `table`, and an
 * `inline_equation`'s is the paragraph whose text already contains it. Only the second kind is
 * rendered by its owner, and rendering them top-level would print every table cell twice.
 */
function contentParentOf(block: IndexedBlock, doc: IndexedDocument): string | null {
  if (block.parentId === null) return null;
  const parent = doc.byId.get(block.parentId);
  if (parent === undefined) return null;
  return parent.type === 'heading' ? null : parent.id;
}

/** caption block id → the float that claims it. Such a caption renders inside its float. */
function captionOwners(doc: IndexedDocument): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const block of doc.blocks) {
    const captionBlock = block.payload?.['caption_block'];
    if (typeof captionBlock === 'string' && captionBlock.length > 0) {
      owners.set(captionBlock, block.id);
    }
  }
  return owners;
}

/** A float carries no text by design — `figure`, `table` and `equation` have no `text` key at all. */
function isFloat(block: IndexedBlock): boolean {
  return block.type === 'figure' || block.type === 'table' || block.type === 'equation';
}

/**
 * Decide, once, what the reading contains and where every block of the document ended up.
 *
 * WHY THIS ITERATES `doc.blocks` AND NOT `doc.sections`. Front matter belongs to no section in ALL
 * THREE fixtures — 24 blocks in `attention`, 43 in `neural-odes`, 13 in `resnet`. Rebuilding the
 * document by concatenating `sections[].block_ids` silently drops the title, the authors and (in
 * `neural-odes`) the entire abstract. `doc.blocks` is already in reading order and contains
 * everything, which is why `indexDocument` computes that order instead of trusting `doc_order` — 64
 * of the set's 199 blocks do not carry `doc_order` at all.
 */
export function projectGuided(doc: IndexedDocument): GuidedProjection {
  const owners = captionOwners(doc);
  const placement = new Map<string, GuidedPlacement>();
  const paragraphs: GuidedParagraph[] = [];
  const byParagraphId = new Map<string, GuidedParagraph>();
  let furnitureCount = 0;

  // A CONTINUED PARAGRAPH IS ONE PARAGRAPH. Continuations are rendered by the FIRST fragment, which
  // owns the merged text; the tail fragments keep their own block ids in `sourceIds`, so "show
  // source" still reaches whichever column the reader means.
  const tails = new Set<string>();
  doc.continuedBy.forEach((to) => tails.add(to));

  for (const block of doc.blocks) {
    if (tails.has(block.id)) continue;

    const ownerId = owners.get(block.id) ?? contentParentOf(block, doc);
    if (ownerId !== null && ownerId !== undefined) {
      placement.set(block.id, { kind: 'owned', ownerId });
      continue;
    }

    if (GUIDED_FURNITURE_TYPES.has(block.type)) {
      placement.set(block.id, { kind: 'absent', reason: 'furniture' });
      furnitureCount += 1;
      continue;
    }

    if (!isFloat(block) && block.text.trim().length === 0) {
      placement.set(block.id, { kind: 'absent', reason: 'empty' });
      furnitureCount += 1;
      continue;
    }

    // Follow the continuation chain. `seen` is not defensive padding: a `continues_*` cycle would
    // otherwise hang the render, and a relation list is parser output, not something the schema
    // proves acyclic.
    const sourceIds: string[] = [block.id];
    const texts: string[] = [block.text];
    const seen = new Set<string>([block.id]);
    let cursor = doc.continuedBy.get(block.id);
    while (cursor !== undefined && !seen.has(cursor)) {
      const next = doc.byId.get(cursor);
      if (next === undefined) break;
      seen.add(cursor);
      sourceIds.push(next.id);
      texts.push(next.text);
      cursor = doc.continuedBy.get(cursor);
    }

    const joined = joinContinuedBlocksWithMap(texts);
    const paragraph: GuidedParagraph = {
      id: block.id,
      type: block.type,
      sourceIds,
      text: joined.text,
      segments: joined.segments,
      ...(GUIDED_LINEWISE_TYPES.has(block.type)
        ? { lines: reflowPreservingLines(block.text) }
        : {}),
    };
    paragraphs.push(paragraph);
    byParagraphId.set(paragraph.id, paragraph);
    for (const id of sourceIds) placement.set(id, { kind: 'paragraph', paragraphId: paragraph.id });
  }

  // Tails whose head was itself dropped never got a placement above. Classify them so the map is
  // TOTAL — an unclassified block would make `locateInGuided` answer `undefined`, and "we do not
  // know" is exactly the silent outcome the acceptance criterion forbids.
  for (const block of doc.blocks) {
    if (placement.has(block.id)) continue;
    if (GUIDED_FURNITURE_TYPES.has(block.type)) {
      placement.set(block.id, { kind: 'absent', reason: 'furniture' });
      furnitureCount += 1;
    } else {
      placement.set(block.id, { kind: 'absent', reason: 'empty' });
      furnitureCount += 1;
    }
  }

  return { paragraphs, byParagraphId, placement, furnitureCount };
}

/**
 * `projectGuided`, memoised per document.
 *
 * The projection is O(blocks) and the renderer needs it once per block — once for the render plan
 * and again inside every paragraph component — so recomputing it on each call is O(blocks²). A
 * `WeakMap` keyed by the `IndexedDocument` keeps it to one pass and lets the whole thing be
 * collected with the document it describes. `indexDocument` returns a fresh object per parse, so a
 * re-parse can never hit a stale entry.
 */
const PROJECTION_CACHE = new WeakMap<IndexedDocument, GuidedProjection>();

export function guidedProjectionFor(doc: IndexedDocument): GuidedProjection {
  const cached = PROJECTION_CACHE.get(doc);
  if (cached !== undefined) return cached;
  const fresh = projectGuided(doc);
  PROJECTION_CACHE.set(doc, fresh);
  return fresh;
}

// ─── cross-mode resolution ──────────────────────────────────────────────────────────────────────

export type CrossModeState = 'resolved' | 'unavailable';

/**
 * Why an anchor captured in one mode cannot be shown in the other. EVERY value reaches the user:
 * `cross-mode.spec` requires the report to be explicit, and a reason code that is only ever logged
 * does not satisfy that any more than a silent drop does.
 */
export type CrossModeReason =
  | 'orphan_in_source'
  | 'page_furniture_not_in_reading'
  | 'empty_block_not_in_reading'
  | 'block_not_in_document';

export interface CrossModeResolution {
  readonly state: CrossModeState;
  readonly targetMode: 'source' | 'guided';
  /** The underlying same-mode resolution, so the caller can still see tier/score/geometry. */
  readonly resolution: Resolution;
  readonly blockIds: readonly string[];
  /** Set when `state === 'resolved'` and the target mode is Guided. */
  readonly paragraphId?: string;
  /** Code-point offsets into `GuidedParagraph.text`. Absent for a float, which has no text. */
  readonly startOffset?: number;
  readonly endOffset?: number;
  /** Set when the block renders inside another block's component (a table cell, a claimed caption). */
  readonly ownerBlockId?: string;
  readonly reason?: CrossModeReason;
  /**
   * ALWAYS present, ALWAYS user-facing. This is the "explicitly reports 'not available in this
   * view'" half of the acceptance criterion, and it is a string rather than a code so that the
   * failure cannot be rendered as a blank space by a caller who forgot to map the enum.
   */
  readonly message: string;
}

const UNAVAILABLE_MESSAGE: Record<CrossModeReason, string> = {
  orphan_in_source:
    'This highlight could not be found in the paper, so it cannot be shown in the reading either.',
  page_furniture_not_in_reading:
    'Not available in this view — this is page furniture (a page number, running footer or margin stamp), which the reading leaves out. Switch to Source to see it.',
  empty_block_not_in_reading:
    'Not available in this view — the highlighted region has no text to reflow. Switch to Source to see it.',
  block_not_in_document:
    'Not available in this view — the highlighted block is not part of this document.',
};

/** First index `k` with `offsets[k] >= target`; `offsets` is non-decreasing. */
function lowerBound(offsets: readonly number[], target: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid] as number) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Map a code-point offset in one block's own text to an offset in the Guided paragraph that renders
 * it. Returns `undefined` when the block contributes no characters (a float, or text reflowed away).
 */
export function offsetToGuided(
  paragraph: GuidedParagraph,
  blockId: string,
  offsetInBlock: number,
  sourceIds: readonly string[],
): number | undefined {
  const blockIndex = sourceIds.indexOf(blockId);
  if (blockIndex === -1) return undefined;
  const segment = paragraph.segments.find((s) => s.blockIndex === blockIndex);
  if (segment === undefined) return undefined;
  const k = lowerBound(segment.sourceOffsets, offsetInBlock);
  return segment.outStart + Math.min(k, segment.sourceOffsets.length);
}

/**
 * Resolve an anchor into the OTHER representation.
 *
 * `anchoring/cross-mode.spec`: "A highlight made in Source resolves in Guided, or explicitly reports
 * 'not available in this view'." Both outcomes are returned as a `CrossModeResolution` carrying a
 * human-readable `message`; there is no path that returns nothing.
 *
 * Note the ladder still runs FIRST, in Source. That is deliberate: an anchor whose block id died in
 * a re-parse must be recovered by the quote and geometry tiers before we can ask which paragraph it
 * belongs to. Cross-mode is a projection of a resolution, not a substitute for one.
 */
export function resolveCrossMode(
  anchor: Anchor,
  doc: IndexedDocument,
  targetMode: 'source' | 'guided',
  projection?: GuidedProjection,
): CrossModeResolution {
  const resolution = resolveAnchor(anchor, doc);

  if (resolution.state === 'orphan') {
    return {
      state: 'unavailable',
      targetMode,
      resolution,
      blockIds: resolution.blockIds,
      reason: 'orphan_in_source',
      message: UNAVAILABLE_MESSAGE.orphan_in_source,
    };
  }

  if (targetMode === 'source') {
    // Going the other way. A Guided paragraph is always backed by real source blocks — that is what
    // `derived_from` guarantees and what `DerivedBlock` refuses to render without — so a resolution
    // that named blocks can always be shown in Source. Geometry may be absent (the anchor was
    // captured over reflowed prose, which has none), and the caller paints by block instead.
    return {
      state: 'resolved',
      targetMode,
      resolution,
      blockIds: resolution.blockIds,
      message:
        resolution.polygons.length > 0
          ? 'Shown on the page.'
          : 'Shown on the page, located by block — this highlight was made over the reading, which has no page geometry.',
    };
  }

  const view = projection ?? projectGuided(doc);
  const primary = resolution.blockIds[0];
  if (primary === undefined) {
    return {
      state: 'unavailable',
      targetMode,
      resolution,
      blockIds: resolution.blockIds,
      reason: 'block_not_in_document',
      message: UNAVAILABLE_MESSAGE.block_not_in_document,
    };
  }

  // Walk up through owners: a table cell is shown inside its table, which IS in the reading.
  let cursor: string | undefined = primary;
  let ownerBlockId: string | undefined;
  const guard = new Set<string>();
  while (cursor !== undefined && !guard.has(cursor)) {
    guard.add(cursor);
    const placement = view.placement.get(cursor);
    if (placement === undefined) {
      return {
        state: 'unavailable',
        targetMode,
        resolution,
        blockIds: resolution.blockIds,
        reason: 'block_not_in_document',
        message: UNAVAILABLE_MESSAGE.block_not_in_document,
      };
    }
    if (placement.kind === 'absent') {
      const reason =
        placement.reason === 'furniture'
          ? 'page_furniture_not_in_reading'
          : 'empty_block_not_in_reading';
      return {
        state: 'unavailable',
        targetMode,
        resolution,
        blockIds: resolution.blockIds,
        reason,
        message: UNAVAILABLE_MESSAGE[reason],
      };
    }
    if (placement.kind === 'owned') {
      ownerBlockId = placement.ownerId;
      cursor = placement.ownerId;
      continue;
    }

    const paragraph = view.byParagraphId.get(placement.paragraphId);
    if (paragraph === undefined) break;

    // Offsets, when the anchor carries them and the block still contributes text.
    const blockSelector = anchor.selectors.find((s) => s.type === 'BlockSelector');
    let startOffset: number | undefined;
    let endOffset: number | undefined;
    if (
      blockSelector !== undefined &&
      'startOffset' in blockSelector &&
      blockSelector.startOffset !== undefined &&
      blockSelector.endOffset !== undefined
    ) {
      startOffset = offsetToGuided(
        paragraph,
        primary,
        blockSelector.startOffset,
        paragraph.sourceIds,
      );
      endOffset = offsetToGuided(paragraph, primary, blockSelector.endOffset, paragraph.sourceIds);
    }

    return {
      state: 'resolved',
      targetMode,
      resolution,
      blockIds: resolution.blockIds,
      paragraphId: paragraph.id,
      ...(startOffset !== undefined ? { startOffset } : {}),
      ...(endOffset !== undefined ? { endOffset } : {}),
      ...(ownerBlockId !== undefined ? { ownerBlockId } : {}),
      message:
        ownerBlockId === undefined
          ? 'Shown in the reading.'
          : 'Shown in the reading, inside the block that contains it.',
    };
  }

  return {
    state: 'unavailable',
    targetMode,
    resolution,
    blockIds: resolution.blockIds,
    reason: 'block_not_in_document',
    message: UNAVAILABLE_MESSAGE.block_not_in_document,
  };
}
