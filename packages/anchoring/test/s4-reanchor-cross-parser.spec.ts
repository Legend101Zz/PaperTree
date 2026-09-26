/**
 * s4-reanchor-cross-parser — anchors captured on one PARSER survive onto another parser's parse of
 * the same PDF, and land on the text they were captured on.
 *
 * Ported from the architecture judge's `reparse_probe.mts` (ADR-002 §2 A(c), MEASURED): capture on
 * the committed fixture parse (`papertree-fixture-scaffold 0.1.0`), resolve against today's worker
 * parse (`papertree-document-worker 1.0.0`) of the SAME PDF. The judge measured 201 anchors, 0
 * orphans, and 199 of 201 resolving to blocks whose text contains the quote — the two misses were
 * T2 boundary cases (slice-plan §S4: "the 2 T2 boundary cases get fixed").
 *
 * `reparse.spec` measures the same ladder against SYNTHETIC perturbations of one parse. This file is
 * the one that uses a real second parser, which is the only kind of re-parse a user will meet.
 *
 * WHAT "RIGHT TEXT" MEANS. The judge's own check: the normalised quote's first 12 code points occur
 * in the concatenated normalised text of the blocks the ladder answered with. It is a CONTAINMENT
 * check on the answer, not a tier check, so a tier that returns a plausible neighbour fails it.
 *
 * REQUIRES the corpus and the workspace Python (see `support/liveParse.ts`); skips loudly otherwise.
 */
import { describe, expect, it } from 'vitest';

import { captureAnchor } from '../src/capture.js';
import { indexDocument } from '../src/document.js';
import { normaliseForMatch } from '../src/quotenorm.js';
import { resolveAnchor } from '../src/resolve.js';
import { loadFixture } from './fixtures.js';
import { announceSkip, liveParse, liveParseUnavailable } from './support/liveParse.js';

const PAPERS = ['resnet-cvpr-2col', 'attention-is-all-you-need'] as const;
const TYPES = new Set([
  'paragraph',
  'abstract',
  'heading',
  'caption',
  'list_item',
  'footnote',
  'reference_entry',
]);

const unavailable = liveParseUnavailable(PAPERS);
announceSkip('anchoring/s4-reanchor-cross-parser', unavailable);

const norm = (text: string): string => normaliseForMatch(text).text;

interface Tally {
  anchors: number;
  orphans: number;
  textChecked: number;
  textOk: number;
  byTier: Record<string, number>;
  wrong: { block: string; range: [number, number]; tier: number; quote: string; got: string }[];
}

function probe(slug: (typeof PAPERS)[number]): Tally {
  const fixture = indexDocument(loadFixture(slug), 'fixture/1');
  const live = indexDocument(liveParse(slug), 'api/1');
  const tally: Tally = { anchors: 0, orphans: 0, textChecked: 0, textOk: 0, byTier: {}, wrong: [] };

  for (const block of fixture.byId.values()) {
    const n = block.textCodePoints.length;
    if (n < 30 || !TYPES.has(block.type)) continue;
    // The judge's three selections per block: the whole block, a 40-cp middle slice, the 25-cp tail.
    const ranges: [number, number][] = [
      [0, n],
      [Math.floor(n / 3), Math.min(n, Math.floor(n / 3) + 40)],
      [Math.max(0, n - 25), n],
    ];
    for (const [start, end] of ranges) {
      const anchor = captureAnchor({
        doc: fixture,
        blockId: block.id,
        startOffset: start,
        endOffset: end,
        targetKind: 'text',
        provenanceClass: 'source',
        id: `x-${block.id}-${String(start)}`,
        at: '2026-09-25T00:00:00Z',
        client: 'probe',
        mode: 'source',
      });
      const resolution = resolveAnchor(anchor, live);
      tally.anchors += 1;
      const key = `${resolution.state}/T${String(resolution.tier)}`;
      tally.byTier[key] = (tally.byTier[key] ?? 0) + 1;
      if (resolution.state === 'orphan') {
        tally.orphans += 1;
        continue;
      }
      tally.textChecked += 1;
      const quote = norm(String.fromCodePoint(...block.textCodePoints.slice(start, end)));
      const got = norm(resolution.blockIds.map((id) => live.byId.get(id)?.text ?? '').join(' '));
      if (got.includes(quote.slice(0, Math.min(12, quote.length)))) {
        tally.textOk += 1;
      } else {
        tally.wrong.push({
          block: block.id,
          range: [start, end],
          tier: resolution.tier,
          quote: quote.slice(0, 60),
          got: got.slice(0, 120),
        });
      }
    }
  }
  return tally;
}

describe.skipIf(unavailable !== null)('s4: re-anchoring across a real parser change', () => {
  it('every anchor survives (0 orphans) and every one lands on text containing its quote', () => {
    const results = PAPERS.map((slug) => ({ slug, tally: probe(slug) }));
    for (const { slug, tally } of results) {
      // eslint-disable-next-line no-console
      console.log(
        `[s4-reanchor] ${slug}: ${String(tally.anchors)} anchors, ${String(tally.orphans)} orphans, ` +
          `text ${String(tally.textOk)}/${String(tally.textChecked)}, tiers ${JSON.stringify(tally.byTier)}` +
          (tally.wrong.length > 0 ? `\n  wrong: ${JSON.stringify(tally.wrong, null, 1)}` : ''),
      );
    }
    const total = results.reduce((sum, r) => sum + r.tally.anchors, 0);
    const orphans = results.reduce((sum, r) => sum + r.tally.orphans, 0);
    const wrong = results.flatMap((r) => r.tally.wrong);
    // The judge's baseline was 201 anchors on these two papers. The count is a property of the
    // committed fixtures and the selection rule, so a different number means the probe changed.
    expect(total).toBe(201);
    expect(orphans).toBe(0);
    expect(wrong).toEqual([]);
  });
});
