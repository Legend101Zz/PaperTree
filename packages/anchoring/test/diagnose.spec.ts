/**
 * A diagnostic, not an acceptance test. It prints WHICH anchors fail and WHY, so that a change to
 * the ladder can be aimed rather than guessed at. `reparse.spec` owns the bar; this owns the
 * explanation of the residue.
 */

import { describe, expect, it } from 'vitest';

import { indexDocument } from '../src/document.js';
import { captureAnchor } from '../src/capture.js';
import { resolveAnchor } from '../src/resolve.js';
import { perturb, seededRandom } from '../src/perturb.js';
import { FIXTURE_SLUGS, loadFixture, type FixtureSlug } from './fixtures.js';

const STREAM_ID = 'fixture-1.0.0';
const SEED = 20260730;

describe('diagnose — what the residue actually is', () => {
  it('prints every non-anchored resolution under worst_case and jitter', () => {
    const lines: string[] = [];
    for (const slug of FIXTURE_SLUGS) {
      for (const kind of ['jitter_geometry', 'all', 'worst_case'] as const) {
        const before = loadFixture(slug as FixtureSlug);
        const source = indexDocument(before, STREAM_ID);
        const rng = seededRandom(SEED);
        const anchors = [];
        for (const block of source.blocks) {
          const n = block.textCodePoints.length;
          if (n === 0) {
            anchors.push(
              captureAnchor({
                doc: source,
                blockId: block.id,
                targetKind: block.type === 'figure' ? 'figure' : 'text',
                id: `whole:${block.id}`,
                at: 'x',
                client: 't',
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
          for (const [s, e] of spans) {
            if (e <= s) continue;
            anchors.push(
              captureAnchor({
                doc: source,
                blockId: block.id,
                startOffset: s,
                endOffset: e,
                targetKind: 'text',
                id: `${block.id}:${s}-${e}:${Math.floor(rng() * 1e6)}`,
                at: 'x',
                client: 't',
              }),
            );
          }
        }

        const result = perturb(before, { kind, seed: SEED, rate: 0.5, jitterPt: 0.6 });
        const after = indexDocument(result.paper, `${STREAM_ID}+${kind}`);

        for (const anchor of anchors) {
          const r = resolveAnchor(anchor, after);
          if (r.state === 'anchored') continue;
          const block = source.byId.get(
            (anchor.selectors.find((s) => s.type === 'BlockSelector') as { blockId: string }).blockId,
          );
          const quote = anchor.selectors.find((s) => s.type === 'TextQuoteSelector') as
            | { exactNormalised: string }
            | undefined;
          lines.push(
            `${slug.slice(0, 12).padEnd(12)} ${kind.padEnd(15)} ${r.state.padEnd(11)} tier=${r.tier} ` +
              `reason=${(r.reason ?? '-').padEnd(24)} type=${(block?.type ?? '?').padEnd(14)} ` +
              `qlen=${String(quote?.exactNormalised.length ?? 0).padStart(4)} ` +
              `q=${JSON.stringify((quote?.exactNormalised ?? '').slice(0, 46))}`,
          );
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\nNON-ANCHORED RESOLUTIONS (${lines.length})\n` + lines.join('\n') + '\n');
    expect(lines.length).toBeGreaterThanOrEqual(0);
  });
});
