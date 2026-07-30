/**
 * anchoring/falsify.spec — the test that tries to make `reparse.spec` a lie.
 *
 * `reparse.spec` reports 100 % re-anchor. A resolver that returned "found it, approximately" for
 * EVERY input would report 100 % too, and would be worthless. The rate is only meaningful if the
 * ladder can still say NO — so this file constructs cases where the correct answer is `orphan` and
 * fails if the resolver claims otherwise.
 *
 * This is the falsification condition for the whole anchoring design. If these tests pass, the
 * 100 % means the content really was re-found. If they fail, the 100 % means the resolver stopped
 * discriminating and the headline number should be discarded.
 */

import { describe, expect, it } from 'vitest';

import { captureAnchor } from '../src/capture.js';
import { indexDocument, type PaperSource } from '../src/document.js';
import { resolveAnchor } from '../src/resolve.js';
import { Tier } from '../src/types.js';
import { loadFixture } from './fixtures.js';

const STREAM_ID = 'fixture-1.0.0';

function anchorOverFirstParagraph(paper: PaperSource, streamId = STREAM_ID) {
  const doc = indexDocument(paper, streamId);
  const block = doc.blocks.find(
    (b) => b.type === 'paragraph' && b.textCodePoints.length > 200,
  );
  if (block === undefined) throw new Error('fixture has no long paragraph');
  return {
    doc,
    block,
    anchor: captureAnchor({
      doc,
      blockId: block.id,
      startOffset: 20,
      endOffset: 120,
      targetKind: 'text',
      id: 'falsify-1',
      at: '2026-07-30T00:00:00Z',
      client: 'test',
    }),
  };
}

describe('anchoring/falsify.spec — the resolver must still be able to say no', () => {
  it('orphans an anchor whose block and text were DELETED from the document', () => {
    const paper = loadFixture('resnet-cvpr-2col');
    const { block, anchor } = anchorOverFirstParagraph(paper);

    // Remove the block outright, and every reference to it. This is a re-parse that decided the
    // region was not text at all — the content is gone, and there is nothing correct to return.
    const without: PaperSource = {
      ...paper,
      blocks: paper.blocks.filter((b) => b.block_id !== block.id),
      pages: paper.pages.map((p) => ({
        ...p,
        ...(p.flows === undefined
          ? {}
          : {
              flows: Object.fromEntries(
                Object.entries(p.flows).map(([k, ids]) => [
                  k,
                  (ids as readonly string[]).filter((id) => id !== block.id),
                ]),
              ),
            }),
      })),
      sections: (paper.sections ?? []).map((s) => ({
        ...s,
        block_ids: s.block_ids.filter((id) => id !== block.id),
      })),
    };

    const resolution = resolveAnchor(anchor, indexDocument(without, 'deleted'));

    // It must NOT claim to have anchored. Approximate-via-geometry is tolerable — the region is
    // genuinely still on the page and a page-level jump is honest — but `anchored` would be a lie.
    expect(resolution.state).not.toBe('anchored');
    expect(resolution.approximate || resolution.state === 'orphan').toBe(true);
  });

  it('orphans an anchor into a document that shares no content with it', () => {
    // The strongest case: resolve an anchor captured from ResNet against Neural ODEs. Nothing
    // matches at any tier — different ids, different hashes, different text, different geometry.
    const { anchor } = anchorOverFirstParagraph(loadFixture('resnet-cvpr-2col'));
    const other = indexDocument(loadFixture('neural-odes-mathheavy'), 'other-paper');

    const resolution = resolveAnchor(anchor, other);

    expect(resolution.state).toBe('orphan');
    expect(resolution.tier).toBe(Tier.Orphan);
    expect(resolution.blockIds).toHaveLength(0);
    // The failure must carry a reason. An orphan the UI cannot explain is the "silently dropped"
    // case the acceptance criterion forbids in as many words.
    expect(resolution.reason).toBeDefined();
  });

  it('does NOT accept a tier-1 hit whose content_hash has changed', () => {
    // The measured hazard: 11.73 % of ids surviving a merge, and 30.9 % surviving a split, sit on
    // a block whose text has changed. The id alone would resolve them, wrongly and silently.
    const paper = loadFixture('attention-is-all-you-need');
    const { block, anchor } = anchorOverFirstParagraph(paper);

    // Same id, same geometry, completely different text — exactly what an id that hashes only the
    // top-left anchor permits.
    const rewritten: PaperSource = {
      ...paper,
      blocks: paper.blocks.map((b) => {
        if (b.block_id !== block.id) return b;
        // `spans` is OMITTED, not set to `undefined`: `exactOptionalPropertyTypes` is on, and the
        // two are different types. Dropping the spans is also the honest model of a re-parse that
        // re-read this region — it would not keep the old glyph runs.
        const { spans: _dropped, ...rest } = b;
        return {
          ...rest,
          text: 'Entirely different prose that shares nothing with what was highlighted here.',
          text_normalised:
            'entirely different prose that shares nothing with what was highlighted here.',
          content_hash: `sha256:${'0'.repeat(64)}`,
        };
      }),
    };

    const resolution = resolveAnchor(anchor, indexDocument(rewritten, 'rewritten'));

    // It may legitimately recover the ORIGINAL text elsewhere, or fall to geometry, or orphan —
    // but it must never return tier 1 against a hash that does not match.
    if (resolution.tier === Tier.Block) {
      expect(resolution.blockIds).not.toContain(block.id);
    }
  });

  it('rejects a T0 cache written against a different parse', () => {
    const paper = loadFixture('resnet-cvpr-2col');
    const { block, anchor } = anchorOverFirstParagraph(paper);
    const cached = {
      ...anchor,
      resolution: {
        tier: 1,
        score: 1,
        // A block id that exists, so a resolver that honoured the stale cache would happily
        // return it and look correct.
        resolvedBlockIds: [block.id],
        resolvedAt: '2026-07-30T00:00:00Z',
        parserVersion: 'some-other-version',
        textStreamId: 'some-other-stream',
        state: 'anchored' as const,
      },
    };
    const resolution = resolveAnchor(cached, indexDocument(paper, STREAM_ID));
    expect(resolution.tier).not.toBe(Tier.Cache);
  });

  it('refuses a short quote that carries no context', () => {
    const paper = loadFixture('neural-odes-mathheavy');
    const doc = indexDocument(paper, STREAM_ID);
    const block = doc.blocks.find((b) => b.textCodePoints.length > 50);
    if (block === undefined) throw new Error('no block');
    const anchor = captureAnchor({
      doc,
      blockId: block.id,
      startOffset: 0,
      endOffset: 4,
      targetKind: 'text',
      id: 'short',
      at: 'x',
      client: 't',
    });
    // Strip everything but the quote, and strip its context — a 4-character quote alone is a
    // coincidence generator, not an anchor, and T3 is superlinear on exactly this input.
    const stripped = {
      ...anchor,
      selectors: anchor.selectors
        .filter((s) => s.type === 'TextQuoteSelector')
        .map((s) => ({ ...s, prefix: '', suffix: '', prefixNormalised: '', suffixNormalised: '' })),
    };
    const resolution = resolveAnchor(stripped, doc);
    expect(resolution.state).toBe('orphan');
    expect(resolution.reason).toBe('quote_too_short_no_context');
  });
});
