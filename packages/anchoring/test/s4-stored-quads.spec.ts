/**
 * s4-stored-quads — a re-parse changes a highlight's LINKS, never its PAINT (contracts.md §6).
 *
 * The scenario is a real re-parse: highlights captured on generation 1 (the committed fixture parse,
 * `papertree-fixture-scaffold 0.1.0`) are painted on generation 2 (the live worker parse,
 * `papertree-document-worker 1.0.0`) of the SAME PDF bytes. Block ids, segmentation and span
 * geometry all differ between the two; the PDF does not.
 *
 * THE ASSERTION: the Source paint on generation 2 is byte-identical to the paint on generation 1,
 * for every anchor. The motivation is MEASURED (the judge's `quads_invariance.mts`): the same text
 * re-derived on the second parse moves by a median 0.00 pt but up to 5.57 pt — so a spec that
 * re-derived geometry could not pass this, and the control below checks that it indeed does not.
 *
 * The server half — a generation-2 promotion keeps the stored anchor bytes and only the per-generation
 * resolution cache changes — is `services/api/python/tests/test_s4_highlights.py`.
 *
 * REQUIRES the corpus and the workspace Python (`support/liveParse.ts`); skips loudly otherwise.
 */
import { describe, expect, it } from 'vitest';

import { captureAnchor } from '../src/capture.js';
import { indexDocument } from '../src/document.js';
import { sourcePaint } from '../src/paint.js';
import { resolveAnchor } from '../src/resolve.js';
import type { Anchor } from '../src/types.js';
import { loadFixture } from './fixtures.js';
import { announceSkip, liveParse, liveParseUnavailable } from './support/liveParse.js';

const PAPERS = ['resnet-cvpr-2col', 'attention-is-all-you-need'] as const;

const unavailable = liveParseUnavailable(PAPERS);
announceSkip('anchoring/s4-stored-quads', unavailable);

describe.skipIf(unavailable !== null)('s4: a re-parse repaints highlights byte-identically', () => {
  it.each(PAPERS)('%s: paint on generation 2 equals paint on generation 1', (slug) => {
    const gen1 = indexDocument(loadFixture(slug), 'api/ppr_x/g1/0.1.0');
    const gen2 = indexDocument(liveParse(slug), 'api/ppr_x/g2/1.0.0');
    // The PDF did not change, which is the whole premise of the rule.
    expect(gen2.sourceHash).toBe(gen1.sourceHash);

    const anchors: Anchor[] = [];
    for (const block of gen1.blocks) {
      const n = block.textCodePoints.length;
      if (n < 60 || block.spans.length === 0) continue;
      anchors.push(
        captureAnchor({
          doc: gen1,
          blockId: block.id,
          startOffset: Math.floor(n / 3),
          endOffset: Math.floor(n / 3) + 40,
          targetKind: 'text',
          provenanceClass: 'source',
          id: `sq-${block.id}`,
          at: '2026-09-26T00:00:00Z',
          client: 'test',
          mode: 'source',
        }),
      );
    }
    expect(anchors.length).toBeGreaterThan(20);

    let linksChanged = 0;
    let rederivedDiffers = 0;
    for (const anchor of anchors) {
      const r1 = resolveAnchor(anchor, gen1);
      const r2 = resolveAnchor(anchor, gen2);
      const p1 = sourcePaint(anchor, gen1, r1);
      const p2 = sourcePaint(anchor, gen2, r2);
      expect(p1?.source).toBe('stored');
      // Byte-identical: the serialised paint, not a tolerance.
      expect(JSON.stringify(p2)).toBe(JSON.stringify(p1));
      if (r2.blockIds.join() !== r1.blockIds.join()) linksChanged += 1;
      // The control: what painting from the NEW parse's own geometry would have drawn.
      if (JSON.stringify(r2.polygons) !== JSON.stringify(p1?.polygons)) rederivedDiffers += 1;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[s4-stored-quads] ${slug}: ${String(anchors.length)} anchors, paint identical on both ` +
        `generations; links changed for ${String(linksChanged)}; re-derived geometry would differ ` +
        `for ${String(rederivedDiffers)}`,
    );
    // The two parses really do disagree — otherwise "identical paint" would be vacuous.
    expect(linksChanged).toBeGreaterThan(0);
    expect(rederivedDiffers).toBeGreaterThan(0);
  });
});
