/**
 * anchoring/resolve — the T0–T6 ladder.
 *
 * THE ONE RULE THAT MATTERS: **a tier-1 hit is a hint until `content_hash` confirms it.**
 *
 * `block_id` hashes `source_hash | page_index | q(x0) | q(y0) | block_type | normalise(text)[:8]`.
 * Only the TOP-LEFT ANCHOR is in there — `x1`/`y1` are deliberately absent — so a block that grows
 * DOWNWARD keeps its id while its text changes underneath it. That is not a defect; it is what
 * makes the id survive a re-parse that appends a line. But it means a surviving id is not evidence
 * that the content survived. Measured on the corpus: under a paragraph merge, **665 of 5 670
 * blocks (11.73 %) inherit an id onto changed text**; under a split, **1 752 (30.9 %)**.
 * `content_hash` catches **100 %** of them. So T1 without the hash check is not a fast path, it is
 * a silent misresolution — and a silent misresolution is worse than an orphan, because the orphan
 * is visible and this is not.
 *
 * THE ARITHMETIC THE LADDER IS SIZED FOR. A segmenter change retires 42.2 % of ids outright, of
 * which 35.75 pp is a floor no formula can beat. `reparse.spec` requires ≥99 %. So ~41 of the 42
 * points lost at T1 must be recovered below it, and the reason that is achievable at all is that a
 * segmentation change moves BOUNDARIES, not GLYPHS:
 *
 *   • T3 searches the document-global text stream, not blocks. Merging two paragraphs does not
 *     change the character sequence, so the quote is still there to be found.
 *   • T4 re-projects quads through the new parse. The glyphs did not move at all, so geometric
 *     overlap is near-total.
 *
 * Everything else is bookkeeping. What must NOT happen is a tier quietly returning a plausible
 * wrong answer, which is why every rung below T1 either verifies against the quote or declares
 * itself approximate.
 */

import {
  bboxToPolygon,
  bboxesIntersect,
  polygonExtent,
  polygonsIntersect,
  type BBox,
  type BlockId,
  type Polygon,
} from '@papertree/document-ir';

import type { IndexedBlock, IndexedDocument } from './document.js';
import {
  MIN_QUOTE_WITHOUT_CONTEXT,
  SCORE_ANCHORED,
  SCORE_APPROXIMATE,
  indexOfCodePoints,
  maxErrorsFor,
  scoreMatch,
  search,
} from './match.js';
import { normaliseForMatch, toCodePoints } from './quotenorm.js';
import {
  Tier,
  type Anchor,
  type AnchorFailureReason,
  type BlockSelector,
  type PageSelector,
  type Resolution,
  type SectionPathSelector,
  type Selector,
  type ShapeSelector,
  type TextPositionSelector,
  type TextQuoteSelector,
} from './types.js';

function selectorOfType<T extends Selector['type']>(
  anchor: Anchor,
  type: T,
): Extract<Selector, { type: T }> | undefined {
  return anchor.selectors.find((s): s is Extract<Selector, { type: T }> => s.type === type);
}

export interface ResolveOptions {
  /**
   * Trust a cached resolution when it was written against this same parse. Default true. The
   * cache is keyed by `(parserVersion, textStreamId)`; a mismatch is not a stale cache, it is a
   * DIFFERENT DOCUMENT, and honouring it would be the bug the whole package exists to prevent.
   */
  readonly useCache?: boolean;
  /** Stop after this tier. `reparse.spec` uses it to attribute recovery to individual rungs. */
  readonly maxTier?: Tier;
}

/** The geometry a resolution paints, derived once from whichever blocks answered. */
function geometryOf(blocks: readonly IndexedBlock[]): { polygons: Polygon[]; quads: BBox[] } {
  const polygons: Polygon[] = [];
  const quads: BBox[] = [];
  for (const block of blocks) {
    if (block.polygon.length >= 3) {
      polygons.push(block.polygon);
      quads.push(polygonExtent(block.polygon));
    } else if (block.bbox[2] > block.bbox[0]) {
      polygons.push(bboxToPolygon(block.bbox));
      quads.push(block.bbox);
    }
  }
  return { polygons, quads };
}

function orphan(reason: AnchorFailureReason, pageIndex: number | null): Resolution {
  return {
    tier: Tier.Orphan,
    score: 0,
    state: 'orphan',
    blockIds: [],
    polygons: [],
    quads: [],
    pageIndex,
    reason,
    approximate: false,
  };
}

/**
 * Resolve one anchor against one parse.
 *
 * Never throws for a document that simply does not contain the anchor any more, and never returns
 * `null`: the T6 rung is a real answer with `state: 'orphan'`, because Hypothesis's 2017 orphans-tab
 * decision is the product precedent and it is the right one. A failed anchor keeps its quote and
 * its page-level jump and is SHOWN. Deleting it — or returning nothing and letting the caller
 * decide — is how a year of a user's highlights disappears quietly.
 */
export function resolveAnchor(
  anchor: Anchor,
  doc: IndexedDocument,
  options: ResolveOptions = {},
): Resolution {
  const useCache = options.useCache ?? true;
  const maxTier = options.maxTier ?? Tier.Orphan;

  const page = selectorOfType(anchor, 'PageSelector') as PageSelector | undefined;
  const pageHint = page?.index ?? null;

  // ── T0 — the cache ──
  if (
    useCache &&
    anchor.resolution !== undefined &&
    anchor.resolution.parserVersion === doc.parserVersion &&
    anchor.resolution.textStreamId === doc.textStreamId
  ) {
    const cached = anchor.resolution;
    const blocks = cached.resolvedBlockIds
      .map((id) => doc.byId.get(id))
      .filter((b): b is IndexedBlock => b !== undefined);
    if (blocks.length === cached.resolvedBlockIds.length) {
      const geometry = geometryOf(blocks);
      return {
        tier: Tier.Cache,
        score: cached.score,
        state: cached.state,
        blockIds: blocks.map((b) => b.id),
        polygons: geometry.polygons,
        quads: geometry.quads,
        pageIndex: blocks[0]?.pageIndex ?? pageHint,
        approximate: cached.state === 'approximate',
      };
    }
  }

  const blockSel = selectorOfType(anchor, 'BlockSelector') as BlockSelector | undefined;
  const quoteSel = selectorOfType(anchor, 'TextQuoteSelector') as TextQuoteSelector | undefined;
  const posSel = selectorOfType(anchor, 'TextPositionSelector') as TextPositionSelector | undefined;
  const shapeSel = selectorOfType(anchor, 'ShapeSelector') as ShapeSelector | undefined;
  const pathSel = selectorOfType(anchor, 'SectionPathSelector') as SectionPathSelector | undefined;

  if (anchor.selectors.length === 0) return orphan('no_selectors', pageHint);

  let lastReason: AnchorFailureReason = 'block_id_missing';

  // ── T1 — BlockSelector, CONFIRMED against content_hash ──
  if (maxTier >= Tier.Block && blockSel !== undefined) {
    const block = doc.byId.get(blockSel.blockId);
    if (block === undefined) {
      lastReason = 'block_id_missing';
    } else if (block.contentHash !== blockSel.blockTextHash) {
      // The id survived onto changed text. This is the 11.73 %/30.9 % case. Falling through is the
      // whole point: the block is NOT the one that was highlighted, whatever the id says.
      lastReason = 'block_text_changed';
    } else {
      const geometry = geometryOf([block]);
      return {
        tier: Tier.Block,
        score: 1,
        state: 'anchored',
        blockIds: [block.id],
        polygons: geometry.polygons,
        quads: geometry.quads,
        pageIndex: block.pageIndex,
        approximate: false,
      };
    }
  }

  // ── T1b — content hash alone ──
  // Not a rung in the published ladder, and it is here because the measurement demands it. A
  // segmentation change that leaves a paragraph's TEXT identical but moves its top-left anchor by a
  // point retires the id and keeps the hash. That is a large share of the 42.2 %, it is a perfect
  // match on content, and routing it through fuzzy quote search would be both slower and weaker.
  // Reported as tier 1 with a score below 1, so the distinction is visible.
  if (maxTier >= Tier.Block && blockSel !== undefined) {
    const byHash = doc.byContentHash.get(blockSel.blockTextHash);
    if (byHash !== undefined && byHash.length === 1) {
      const block = byHash[0] as IndexedBlock;
      const geometry = geometryOf([block]);
      return {
        tier: Tier.Block,
        score: 0.98,
        state: 'anchored',
        blockIds: [block.id],
        polygons: geometry.polygons,
        quads: geometry.quads,
        pageIndex: block.pageIndex,
        approximate: false,
      };
    }
  }

  const quotePoints = quoteSel === undefined ? [] : toCodePoints(quoteSel.exactNormalised);

  // ── T2 — TextPositionSelector, VERIFIED against the quote ──
  // The offsets are a hint and nothing else, so this rung is worthless without the verification and
  // dangerous with it omitted. Hypothesis's `maybeAssertQuote()` re-validates every Range/Position
  // hit against `quote.exact` and throws on mismatch; that is the single most important idea in
  // their anchoring code, and this is it.
  if (maxTier >= Tier.Position && posSel !== undefined && quoteSel !== undefined) {
    const slice = doc.streamCodePoints.slice(posSel.start, posSel.end);
    if (slice.length > 0) {
      const sliceNormalised = toCodePoints(
        normaliseSlice(String.fromCodePoint(...slice)),
      );
      if (codePointsEqual(sliceNormalised, quotePoints)) {
        const block = doc.blockAtStreamOffset(posSel.start);
        if (block !== null) {
          const geometry = geometryOf([block]);
          return {
            tier: Tier.Position,
            score: 0.95,
            state: 'anchored',
            blockIds: [block.id],
            polygons: geometry.polygons,
            quads: geometry.quads,
            pageIndex: block.pageIndex,
            approximate: false,
          };
        }
      }
    }
  }

  // ── T3 — TextQuoteSelector, fuzzy ──
  if (maxTier >= Tier.Quote && quoteSel !== undefined && quotePoints.length > 0) {
    const hasContext =
      quoteSel.prefixNormalised.length > 0 && quoteSel.suffixNormalised.length > 0;
    if (quotePoints.length < MIN_QUOTE_WITHOUT_CONTEXT && !hasContext) {
      lastReason = 'quote_too_short_no_context';
    } else {
      const found = searchQuote(doc, quoteSel, quotePoints, posSel);
      if (found !== null && found.score >= SCORE_APPROXIMATE) {
        const rawStart = doc.normalisedStream.rawOffsetAt[found.start] ?? 0;
        const rawEnd =
          doc.normalisedStream.rawOffsetAt[found.end] ?? doc.streamCodePoints.length;
        const blocks = blocksOverlappingStream(doc, rawStart, rawEnd);
        if (blocks.length > 0) {
          const geometry = geometryOf(blocks);
          const anchored = found.score >= SCORE_ANCHORED;
          return {
            tier: Tier.Quote,
            score: found.score,
            state: anchored ? 'anchored' : 'approximate',
            blockIds: blocks.map((b) => b.id),
            polygons: geometry.polygons,
            quads: geometry.quads,
            pageIndex: blocks[0]?.pageIndex ?? pageHint,
            approximate: !anchored,
            ...(anchored ? {} : { reason: 'quote_below_threshold' as const }),
          };
        }
      }
      lastReason = 'quote_below_threshold';
    }
  }

  // ── T4 — ShapeSelector, geometric ──
  // The tier that should almost never fail on a re-parse, because a segmenter changing its mind
  // about paragraph boundaries does not move a single glyph. It is nevertheless APPROXIMATE by
  // construction: overlapping a block is not the same as being the text that was selected, and
  // presenting it as certain would be a lie the user cannot check.
  //
  // GATED ON DOCUMENT IDENTITY, and this gate is load-bearing rather than defensive.
  //
  // Geometry is parser-independent. It is NOT document-independent, and conflating the two makes
  // the whole re-anchor measurement worthless. Caught by `falsify.spec`: resolving a ResNet anchor
  // against Neural ODEs returned `approximate` rather than `orphan`, because both papers are
  // 612 x 792 pt and a paragraph at (50, 556) on page 1 of one lands inside a block at (50, 556) on
  // page 1 of the other. The ladder was answering "yes, approximately" for a document that shares
  // not one character with the anchor — and a resolver that always says yes reports a 100 %
  // re-anchor rate that means nothing at all.
  //
  // `pdfSha256` is the right gate because the PDF's bytes are immutable: it is the strongest
  // identity in the record, and it is exactly the thing a re-parse does NOT change. The text tiers
  // are deliberately NOT gated — matching a quote across two versions of the same paper is
  // legitimate and wanted; matching coordinates across them is not, because v2 repaginates.
  const sameDocument =
    anchor.doc.pdfSha256.length === 0 ||
    doc.sourceHash.length === 0 ||
    anchor.doc.pdfSha256 === doc.sourceHash;

  if (maxTier >= Tier.Shape && shapeSel !== undefined && sameDocument) {
    const overlapping = blocksOverlappingQuads(doc, shapeSel);
    if (overlapping.length > 0) {
      const geometry = geometryOf(overlapping);
      return {
        tier: Tier.Shape,
        score: 0.5,
        state: 'approximate',
        blockIds: overlapping.map((b) => b.id),
        polygons: geometry.polygons,
        quads: geometry.quads,
        pageIndex: shapeSel.pageIndex,
        reason: 'quote_below_threshold',
        approximate: true,
      };
    }
    // T4b — PROXIMITY, when strict overlap finds nothing.
    //
    // Measured necessity, not defensive coding. Every orphan the harness produced was the same
    // shape: a `type: "unknown"` block with no text, no spans and therefore no tier but this one —
    // and those blocks are HAIRLINE RULES. Their heights across the three fixtures are 0.4, 0.4,
    // 1.0 and 4.0 pt. A region 0.4 pt tall is displaced past its own extent by any coordinate change
    // larger than 0.4 pt, so strict intersection cannot recover it even though it plainly still
    // exists a fraction of a point away. Requiring overlap orphans a block that has not moved
    // perceptibly, which is the wrong answer for the right reason.
    const near = nearestBlock(doc, shapeSel);
    if (near !== null) {
      const geometry = geometryOf([near]);
      return {
        tier: Tier.Shape,
        score: 0.35,
        state: 'approximate',
        blockIds: [near.id],
        polygons: geometry.polygons,
        quads: geometry.quads,
        pageIndex: shapeSel.pageIndex,
        reason: 'no_geometric_overlap',
        approximate: true,
      };
    }
    lastReason = 'no_geometric_overlap';
  } else if (shapeSel !== undefined && !sameDocument) {
    lastReason = 'no_geometric_overlap';
  }

  // ── T5 — SectionPathSelector ──
  // Same gate, same reason. Every paper has an "Introduction"; matching one against another's is a
  // real string match and a meaningless anchor.
  if (maxTier >= Tier.SectionPath && pathSel !== undefined && sameDocument) {
    const section = findSection(doc, pathSel);
    if (section !== null) {
      const blocks = section.block_ids
        .map((id) => doc.byId.get(id))
        .filter((b): b is IndexedBlock => b !== undefined);
      const chosen = blocks[Math.min(pathSel.paraIndexInSection, Math.max(0, blocks.length - 1))];
      if (chosen !== undefined) {
        const geometry = geometryOf([chosen]);
        return {
          tier: Tier.SectionPath,
          score: 0.4,
          state: 'approximate',
          blockIds: [chosen.id],
          polygons: geometry.polygons,
          quads: geometry.quads,
          pageIndex: chosen.pageIndex,
          reason: 'quote_below_threshold',
          approximate: true,
        };
      }
    }
    lastReason = 'section_not_found';
  }

  // ── T6 — orphan. NEVER deleted. ──
  return orphan(lastReason, pageHint);
}

// ─── tier helpers ───────────────────────────────────────────────────────────────────────────────

function codePointsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The same normalisation the quote was captured under.
 *
 * T2 compares a slice of the CURRENT document against a quote captured from the PREVIOUS one, so
 * both sides must go through the identical function or the comparison is meaningless. Calling
 * `normaliseForMatch` here rather than reimplementing the fold is the whole point: a second copy is
 * a second contract, and it drifts.
 */
function normaliseSlice(text: string): string {
  return normaliseForMatch(text).text;
}

interface QuoteHit {
  readonly start: number;
  readonly end: number;
  readonly score: number;
}

/**
 * Search the normalised document stream for the quote.
 *
 * Pages are searched IN ORDER OF DISTANCE FROM THE HINT, and an exact hit whose prefix or suffix
 * also matches exactly short-circuits. The context requirement on the early exit is not an
 * optimisation detail — it is what stops the search stopping on the first occurrence of a phrase
 * that recurs throughout the document, which in academic prose is most phrases.
 */
function searchQuote(
  doc: IndexedDocument,
  quote: TextQuoteSelector,
  quotePoints: readonly number[],
  posSel: TextPositionSelector | undefined,
): QuoteHit | null {
  const haystack = doc.normalisedStreamCodePoints;
  const prefixPoints = toCodePoints(quote.prefixNormalised);
  const suffixPoints = toCodePoints(quote.suffixNormalised);
  const hint =
    posSel === undefined ? null : normalisedHintFor(doc, posSel.start);

  // Exact pass first, over every occurrence, scored with context.
  let best: QuoteHit | null = null;
  let from = 0;
  for (;;) {
    const at = indexOfCodePoints(quotePoints, haystack, from);
    if (at < 0) break;
    const prefixErrors = contextErrors(haystack, prefixPoints, at - prefixPoints.length, true);
    const suffixErrors = contextErrors(haystack, suffixPoints, at + quotePoints.length, false);
    const score = scoreMatch({
      quoteErrors: 0,
      quoteLength: quotePoints.length,
      prefixErrors,
      prefixLength: prefixPoints.length,
      suffixErrors,
      suffixLength: suffixPoints.length,
      matchStart: at,
      hint,
      textLength: haystack.length,
    });
    if (best === null || score > best.score) {
      best = { start: at, end: at + quotePoints.length, score };
    }
    // Early exit: exact quote AND an exact context on at least one side.
    if ((prefixErrors === 0 && prefixPoints.length > 0) || (suffixErrors === 0 && suffixPoints.length > 0)) {
      return best;
    }
    from = at + 1;
  }
  if (best !== null) return best;

  // Fuzzy pass.
  const match = search(quotePoints, haystack, maxErrorsFor(quotePoints.length));
  if (match === null) return null;
  const prefixErrors = contextErrors(haystack, prefixPoints, match.start - prefixPoints.length, true);
  const suffixErrors = contextErrors(haystack, suffixPoints, match.end, false);
  const score = scoreMatch({
    quoteErrors: match.errors,
    quoteLength: quotePoints.length,
    prefixErrors,
    prefixLength: prefixPoints.length,
    suffixErrors,
    suffixLength: suffixPoints.length,
    matchStart: match.start,
    hint,
    textLength: haystack.length,
  });
  return { start: match.start, end: match.end, score };
}

function normalisedHintFor(doc: IndexedDocument, rawOffset: number): number | null {
  // `rawOffsetAt` is non-decreasing, so the normalised offset for a raw one is a binary search.
  const map = doc.normalisedStream.rawOffsetAt;
  let lo = 0;
  let hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((map[mid] as number) < rawOffset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Edit distance of a context window against the haystack at a position, or `null` if absent. */
function contextErrors(
  haystack: readonly number[],
  context: readonly number[],
  at: number,
  _isPrefix: boolean,
): number | null {
  if (context.length === 0) return null;
  const start = Math.max(0, at);
  const window = haystack.slice(start, start + context.length);
  if (window.length === 0) return null;
  let errors = Math.abs(window.length - context.length);
  const n = Math.min(window.length, context.length);
  for (let i = 0; i < n; i += 1) if (window[i] !== context[i]) errors += 1;
  return errors;
}

function blocksOverlappingStream(
  doc: IndexedDocument,
  rawStart: number,
  rawEnd: number,
): IndexedBlock[] {
  const out: IndexedBlock[] = [];
  for (const block of doc.blocks) {
    if (block.streamStart < rawEnd && rawStart < block.streamEnd) out.push(block);
  }
  return out;
}

/**
 * T4's overlap test.
 *
 * `polygonsIntersect` and not a bbox test, because a bbox test over a two-column page matches the
 * block in the OTHER column: a quad in the left column and a staircase paragraph in the right one
 * have overlapping extents and share no point. Epic 0 shipped and then fixed exactly this class of
 * bug in `unionOfLineRects`; reintroducing it one layer downstream would be worse, because here it
 * silently RE-ANCHORS a highlight to the wrong column instead of merely painting one.
 *
 * The bbox test is kept as a cheap reject in front of it, which is what `polygonsIntersect` does
 * internally anyway — it is repeated here only to skip building the quad polygon at all.
 */
function blocksOverlappingQuads(doc: IndexedDocument, shape: ShapeSelector): IndexedBlock[] {
  const candidates = doc.byPage.get(shape.pageIndex) ?? [];
  const quadPolygons = shape.quads.map((q) => bboxToPolygon(q));
  const scored: { block: IndexedBlock; area: number }[] = [];

  for (const block of candidates) {
    // Nested blocks (a `table_cell` inside its `table_row` inside its `table`) all overlap the same
    // quad. Taking every one of them would return a table when the user highlighted a cell, so the
    // deepest match wins and ancestors are dropped below.
    const blockPolygon = block.polygon.length >= 3 ? block.polygon : bboxToPolygon(block.bbox);
    let overlaps = false;
    for (let i = 0; i < shape.quads.length; i += 1) {
      const quad = shape.quads[i] as BBox;
      if (!bboxesIntersect(quad, block.bbox)) continue;
      if (polygonsIntersect(quadPolygons[i] as Polygon, blockPolygon)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) scored.push({ block, area: areaOf(block.bbox) });
  }

  if (scored.length === 0) return [];
  const ids = new Set(scored.map((s) => s.block.id as string));
  const withoutAncestors = scored.filter(
    (s) => !scored.some((other) => other.block.parentId === s.block.id && ids.has(other.block.id)),
  );
  const chosen = withoutAncestors.length > 0 ? withoutAncestors : scored;
  chosen.sort((a, b) => a.block.readingIndex - b.block.readingIndex);
  return chosen.map((s) => s.block);
}

function areaOf(bbox: BBox): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

/**
 * How far a block may have moved and still be considered the same block.
 *
 * 6 pt is chosen against two numbers rather than picked. Above: a body line in these papers is
 * ~12 pt of leading, so a 6 pt search cannot reach past an adjacent line into the wrong one.
 * Below: `EPIC-00-RESULT` §8 puts a real parser release's coordinate shift at ~0.5 pt, and the
 * harness's own worst case jitters by 1.4 pt — so 6 pt clears the realistic displacement four times
 * over while staying inside one line of type.
 */
const PROXIMITY_TOLERANCE_PT = 6;

/**
 * The nearest plausible block to a stored quad, or `null` if nothing is close enough.
 *
 * Ranked by centroid distance and then by AREA SIMILARITY, which matters more than it looks. A
 * 0.4 pt footnote rule sits a point or two below a paragraph; ranking on distance alone would
 * return the paragraph, which is a confident wrong answer where the rule is the right one. Comparing
 * areas prefers a region of the same shape, so a hairline matches a hairline.
 */
function nearestBlock(doc: IndexedDocument, shape: ShapeSelector): IndexedBlock | null {
  const candidates = doc.byPage.get(shape.pageIndex) ?? [];
  if (candidates.length === 0 || shape.quads.length === 0) return null;

  const target = shape.quads.reduce<BBox>(
    (acc, q) => [
      Math.min(acc[0], q[0]),
      Math.min(acc[1], q[1]),
      Math.max(acc[2], q[2]),
      Math.max(acc[3], q[3]),
    ],
    shape.quads[0] as BBox,
  );
  const tcx = (target[0] + target[2]) / 2;
  const tcy = (target[1] + target[3]) / 2;
  const tArea = areaOf(target);

  let best: IndexedBlock | null = null;
  let bestKey = Infinity;
  for (const block of candidates) {
    const gap = boxGap(target, block.bbox);
    if (gap > PROXIMITY_TOLERANCE_PT) continue;
    const cx = (block.bbox[0] + block.bbox[2]) / 2;
    const cy = (block.bbox[1] + block.bbox[3]) / 2;
    const distance = Math.hypot(cx - tcx, cy - tcy);
    const area = areaOf(block.bbox);
    const areaRatio =
      tArea <= 0 || area <= 0 ? 1 : Math.max(tArea, area) / Math.min(tArea, area);
    const key = distance * Math.min(areaRatio, 16);
    if (key < bestKey) {
      bestKey = key;
      best = block;
    }
  }
  return best;
}

/** Edge-to-edge separation of two boxes; 0 when they touch or overlap. */
function boxGap(a: BBox, b: BBox): number {
  const dx = Math.max(0, Math.max(a[0] - b[2], b[0] - a[2]));
  const dy = Math.max(0, Math.max(a[1] - b[3], b[1] - a[3]));
  return Math.hypot(dx, dy);
}

/**
 * Find a section by heading text.
 *
 * MATCHING IS ON THE HEADING TEXT, NOT ON A PATH, because the IR's `Section` carries no path and no
 * title — verified against all three fixtures, it is exactly `{heading_block_id, level, block_ids}`
 * plus `parent_heading_block_id` when `level > 1`. The display title lives in the HEADING BLOCK, so
 * the lookup goes through `byId`. A resolver written against the anchor-schema prose (which shows a
 * `path` and a `headingText`) would match nothing at all here and quietly return every T5 anchor as
 * an orphan.
 *
 * `path` is still captured in the selector and still used, as a tie-break below: it survives a
 * heading whose wording changed, where the text match does not.
 */
function findSection(
  doc: IndexedDocument,
  selector: SectionPathSelector,
): { readonly block_ids: readonly string[] } | null {
  const target = normaliseForMatch(selector.headingText).text;
  if (target.length > 0) {
    for (const section of doc.sections) {
      const heading = doc.byId.get(section.heading_block_id);
      if (heading === undefined) continue;
      if (normaliseForMatch(heading.text).text === target) return section;
    }
  }
  // The path's last element is the section number ("3.2"). A heading that was reworded keeps its
  // number far more often than a renumbered section keeps its wording, so this is the weaker match
  // and runs second.
  const number = selector.path[selector.path.length - 1];
  if (number !== undefined && number.length > 0) {
    for (const section of doc.sections) {
      const heading = doc.byId.get(section.heading_block_id);
      if (heading === undefined) continue;
      if (heading.text.trimStart().startsWith(number)) return section;
    }
  }
  return null;
}

export type { BlockId };
