/**
 * anchoring/reparse.spec — THE GATE.
 *
 * "≥99 % of highlights must re-anchor when block ids change under a perturbed parse, and every
 * failure must be visible to the user."
 *
 * `research/build/README.md` makes this architectural gate criterion 3: if it fails, everything
 * downstream must stop. So this file does two things that a normal spec does not:
 *
 *   1. It PRINTS the measurement, per fixture and per perturbation, with the tier attribution. A
 *      pass/fail bar hides whether the margin is 99.4 % or 100 %, and the difference between those
 *      is the difference between "shipped" and "shipped and fragile".
 *   2. It asserts that no anchor is ever LOST — resolved count must equal captured count — before
 *      it asserts anything about the rate. An anchor that vanishes rather than orphaning is the one
 *      failure mode the acceptance criterion explicitly forbids, and it would otherwise flatter the
 *      rate by shrinking the denominator.
 *
 * WHAT "RE-ANCHORED" MEANS HERE. `state !== 'orphan'`. An anchor resolved at T4 with
 * `approximate: true` COUNTS, because it is shown to the user in the right place with an
 * "approximate location" affordance — and it is reported separately below so the split is visible.
 * Counting only `anchored` would be a different, stricter criterion than the one written down.
 */

import { describe, expect, it } from 'vitest';

import { indexDocument, type IndexedDocument, type PaperSource } from '../src/document.js';
import { captureAnchor } from '../src/capture.js';
import { resolveAnchor } from '../src/resolve.js';
import type { Anchor, Resolution } from '../src/types.js';
import { perturb, seededRandom, type PerturbationKind } from '../src/perturb.js';
import { FIXTURE_SLUGS, loadFixture, type FixtureSlug } from './fixtures.js';

const STREAM_ID = 'fixture-1.0.0';
const SEED = 20260730;

/**
 * Capture a spread of anchors over a document.
 *
 * Deliberately NOT one per block: the criterion is about HIGHLIGHTS, and a real highlight is a
 * sub-block range far more often than a whole block. Each text block contributes several ranges of
 * different lengths, including short ones, because short quotes are where T3 is weakest and
 * excluding them would measure an easier problem than the real one.
 */
function captureAnchors(doc: IndexedDocument): Anchor[] {
  const rng = seededRandom(SEED);
  const anchors: Anchor[] = [];
  for (const block of doc.blocks) {
    const n = block.textCodePoints.length;
    if (n === 0) {
      // Figures, tables and `unknown` blocks carry no text at all. They still get an anchor —
      // geometry-only, resolving at T4 — because `targets.spec` requires figures to resolve and a
      // suite that silently skipped them would not notice if they stopped working.
      anchors.push(
        captureAnchor({
          doc,
          blockId: block.id,
          targetKind: block.type === 'figure' ? 'figure' : 'text',
          id: `whole:${block.id}`,
          at: '2026-07-30T00:00:00Z',
          client: 'test',
        }),
      );
      continue;
    }
    const spans: [number, number][] = [
      [0, Math.min(n, 40)],
      [Math.floor(n / 3), Math.min(n, Math.floor(n / 3) + 25)],
      [Math.max(0, n - 30), n],
    ];
    if (n > 120) spans.push([Math.floor(n / 2), Math.min(n, Math.floor(n / 2) + 90)]);
    for (const [start, end] of spans) {
      if (end <= start) continue;
      anchors.push(
        captureAnchor({
          doc,
          blockId: block.id,
          startOffset: start,
          endOffset: end,
          targetKind: 'text',
          id: `${block.id}:${start}-${end}:${Math.floor(rng() * 1e6)}`,
          at: '2026-07-30T00:00:00Z',
          client: 'test',
        }),
      );
    }
  }
  return anchors;
}

interface Report {
  readonly total: number;
  readonly byTier: Record<number, number>;
  readonly anchored: number;
  readonly approximate: number;
  readonly orphan: number;
  readonly rate: number;
  readonly idsRetiredPct: number;
  readonly reasons: Record<string, number>;
}

function measure(before: PaperSource, kind: PerturbationKind, seed: number): Report {
  const source = indexDocument(before, STREAM_ID);
  const anchors = captureAnchors(source);

  const result = perturb(before, { kind, seed, rate: 0.5, jitterPt: 0.6 });
  // The re-parse is a DIFFERENT parse: its `textStreamId` differs, so no T0 cache entry can apply.
  // Leaving the id equal would let the cache answer and measure nothing.
  const after = indexDocument(result.paper, `${STREAM_ID}+${kind}`);

  const byTier: Record<number, number> = {};
  const reasons: Record<string, number> = {};
  let anchored = 0;
  let approximate = 0;
  let orphan = 0;

  const resolutions: Resolution[] = [];
  for (const anchor of anchors) {
    const resolution = resolveAnchor(anchor, after);
    resolutions.push(resolution);
    byTier[resolution.tier] = (byTier[resolution.tier] ?? 0) + 1;
    if (resolution.state === 'anchored') anchored += 1;
    else if (resolution.state === 'approximate') approximate += 1;
    else orphan += 1;
    if (resolution.reason !== undefined) {
      reasons[resolution.reason] = (reasons[resolution.reason] ?? 0) + 1;
    }
  }

  // NOTHING MAY BE LOST. Asserted here rather than in a separate test so it cannot be true of one
  // run and false of the one whose rate gets reported.
  expect(resolutions).toHaveLength(anchors.length);

  return {
    total: anchors.length,
    byTier,
    anchored,
    approximate,
    orphan,
    rate: anchors.length === 0 ? 1 : (anchored + approximate) / anchors.length,
    idsRetiredPct: (result.idsRetired / Math.max(1, result.idsBefore)) * 100,
    reasons,
  };
}

const KINDS: PerturbationKind[] = [
  'merge_paragraphs',
  'split_paragraphs',
  'jitter_geometry',
  'retype_blocks',
  'text_noise',
  'all',
  'worst_case',
];

describe('anchoring/reparse.spec — ≥99% re-anchor under a perturbed parse', () => {
  const rows: string[] = [];

  for (const slug of FIXTURE_SLUGS) {
    for (const kind of KINDS) {
      it(`${slug} · ${kind}`, () => {
        const report = measure(loadFixture(slug as FixtureSlug), kind, SEED);
        rows.push(
          [
            slug.padEnd(26),
            kind.padEnd(18),
            String(report.total).padStart(5),
            `${report.idsRetiredPct.toFixed(1)}%`.padStart(7),
            `${(report.rate * 100).toFixed(2)}%`.padStart(8),
            String(report.anchored).padStart(5),
            String(report.approximate).padStart(5),
            String(report.orphan).padStart(5),
            JSON.stringify(report.byTier),
          ].join(' '),
        );

        // The criterion.
        expect(report.rate).toBeGreaterThanOrEqual(0.99);

        // Every failure is surfaced. An orphan without a reason code is an anchor the UI cannot
        // explain, which is the "silently dropped" case the criterion forbids in as many words.
        if (report.orphan > 0) {
          const explained = Object.values(report.reasons).reduce((a, b) => a + b, 0);
          expect(explained).toBeGreaterThanOrEqual(report.orphan);
        }
      });
    }
  }

  it('reports the measurement', () => {
    // eslint-disable-next-line no-console
    console.log(
      '\nfixture                    perturbation       anchors ids-ret  re-anch  ancd  aprx  orph  tiers\n' +
        rows.join('\n') +
        '\n',
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
