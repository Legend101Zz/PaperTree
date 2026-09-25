/**
 * s4-overpaint — a highlight paints the text that was selected, not the block it sits in.
 *
 * THE DEFECT (ADR-002 §2 A(b), MEASURED by the judge's `anchor_probe.mts`, and seen live in the
 * baseline walk): every tier of the ladder returned the BLOCK polygon, and the parser merges
 * paragraphs, so a 60-character selection on a real YOLO or ResNet parse painted a median 17.3x /
 * 17.6x its own area (4.9x-54x). In the browser, selecting one sentence lit three paragraphs.
 *
 * THE BAR (slice-plan §S4): painted area / selected area <= 1.05 on real parses. Measured two ways,
 * because the paint has two sources (contracts.md §6, `src/paint.ts`):
 *
 *   1. STORED QUADS — a fresh user highlight on the same PDF. Its paint is the ShapeSelector it
 *      stored, so this is exact by construction; it is asserted anyway, since "by construction" is
 *      what the 17x defect was, too.
 *   2. THE LADDER — the same record WITHOUT a ShapeSelector (a legacy row, a citation minted before
 *      geometry), so the paint must come from the tier that confirmed the text. This is the path
 *      the judge measured at 17x, and the one the fix changes.
 *
 * "Selected" is `quadsForRange` over the block's spans for the selected range — the IR's own
 * glyph-line geometry for exactly the selected characters.
 *
 * REQUIRES the corpus and the workspace Python (`support/liveParse.ts`); skips loudly otherwise.
 */
import { describe, expect, it } from 'vitest';

import type { Polygon } from '@papertree/document-ir';

import { captureAnchor } from '../src/capture.js';
import { indexDocument, type IndexedDocument } from '../src/document.js';
import { quadsForRange } from '../src/lineband.js';
import { sourcePaint } from '../src/paint.js';
import { resolveAnchor } from '../src/resolve.js';
import type { Anchor } from '../src/types.js';
import { announceSkip, liveParse, liveParseUnavailable } from './support/liveParse.js';

const PAPERS = ['resnet-cvpr-2col', 'attention-is-all-you-need', 'bert-2col'] as const;
const BAR = 1.05;

const unavailable = liveParseUnavailable(PAPERS);
announceSkip('anchoring/s4-overpaint', unavailable);

function polygonArea(polygon: Polygon): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [x1, y1] = polygon[i] as [number, number];
    const [x2, y2] = polygon[(i + 1) % polygon.length] as [number, number];
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

const areaOf = (polygons: readonly Polygon[]): number =>
  polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0);

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

interface Ratios {
  readonly stored: number[];
  readonly ladder: number[];
}

/** The judge's selection rule: the 20 longest multi-line paragraphs, code points [10, 70). */
function measure(doc: IndexedDocument): Ratios {
  const paragraphs = [...doc.byId.values()]
    .filter((b) => b.type === 'paragraph' && b.textCodePoints.length > 400 && b.spans.length > 0)
    .toSorted((a, b) => b.textCodePoints.length - a.textCodePoints.length)
    .slice(0, 20);
  const stored: number[] = [];
  const ladder: number[] = [];
  for (const block of paragraphs) {
    const anchor = captureAnchor({
      doc,
      blockId: block.id,
      startOffset: 10,
      endOffset: 70,
      targetKind: 'text',
      provenanceClass: 'source',
      id: `op-${block.id}`,
      at: '2026-09-26T00:00:00Z',
      client: 'test',
      mode: 'source',
    });
    // No astral code points in these blocks' first 70 characters, so the offsets coincide.
    const selected = areaOf(quadsForRange(block.spans, 10, 70).polygons);

    const paint = sourcePaint(anchor, doc, resolveAnchor(anchor, doc));
    expect(paint?.source).toBe('stored');
    stored.push(areaOf(paint?.polygons ?? []) / selected);

    const withoutShape: Anchor = {
      ...anchor,
      selectors: anchor.selectors.filter((s) => s.type !== 'ShapeSelector'),
    };
    const fromLadder = sourcePaint(withoutShape, doc, resolveAnchor(withoutShape, doc));
    expect(fromLadder?.source).toBe('ladder');
    ladder.push(areaOf(fromLadder?.polygons ?? []) / selected);
  }
  return { stored, ladder };
}

describe.skipIf(unavailable !== null)('s4: paint covers the selection, not the block', () => {
  it.each(PAPERS)(
    '%s: painted / selected <= 1.05, from stored quads and from the ladder',
    (slug) => {
      const doc = indexDocument(liveParse(slug), 'api/test');
      const { stored, ladder } = measure(doc);
      // eslint-disable-next-line no-console
      console.log(
        `[s4-overpaint] ${slug}: n=${String(stored.length)} stored median ${median(stored).toFixed(3)} ` +
          `max ${Math.max(...stored).toFixed(3)}; ladder median ${median(ladder).toFixed(3)} ` +
          `max ${Math.max(...ladder).toFixed(3)}`,
      );
      expect(stored.length).toBeGreaterThanOrEqual(10);
      for (const ratio of [...stored, ...ladder]) expect(ratio).toBeLessThanOrEqual(BAR);
    },
  );
});
