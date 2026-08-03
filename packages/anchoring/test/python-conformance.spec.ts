/**
 * anchoring/python-conformance — the REAL resolver, over selectors minted by Python.
 *
 * THIS IS THE ONLY TEST THAT CAN FAIL THE WAY #72 ACTUALLY FAILS. Python could emit six perfectly
 * well-formed selectors that this ladder never reaches T1 or T2 on, and every assertion on the
 * Python side would still be green — it would have proved that Python can write JSON. So the
 * producer commits to a claim in `conformance/python-selector-vectors.json` (`expect`), and this
 * runs `resolveAnchor` — not a stub, not a re-implementation — and checks the claim.
 *
 * WHY SUBSETS RATHER THAN `maxTier`. `ResolveOptions.maxTier` truncates the BOTTOM of the ladder,
 * not the top: T1 still runs at `maxTier: Tier.Quote`, hits on a same-parse document, and every
 * lower rung goes unexercised. Removing selectors is the only way to make T2, T3, T4 and T5 each
 * answer, and each of them is a different Python-side derivation — the text stream's ORDER, the
 * normalisation, the geometry, the section walk. One assertion per derivation.
 *
 * Tier.Orphan is an EXPECTED value here, not a failure: a figure carries no text, so the `position`
 * and `quote` subsets must orphan on it. Asserting the orphan is what stops "some tier answered"
 * from passing for a document where nothing should have.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { indexDocument } from '../src/document.js';
import { MIN_QUOTE_WITHOUT_CONTEXT } from '../src/match.js';
import { resolveAnchor } from '../src/resolve.js';
import { Tier, type Anchor, type Selector } from '../src/types.js';
import { loadFixture, type FixtureSlug } from './fixtures.js';

interface Vector {
  readonly fixture: FixtureSlug;
  readonly blockType: string;
  readonly blockId: string;
  readonly expect: Readonly<Record<string, number>>;
  readonly anchor: Anchor;
}

interface VectorFile {
  readonly text_stream_id: string;
  readonly resolver_constants: { readonly MIN_QUOTE_WITHOUT_CONTEXT: number };
  readonly stream_sha256: Readonly<Record<string, string>>;
  readonly vectors: readonly Vector[];
}

const VECTORS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../conformance/python-selector-vectors.json', import.meta.url)),
    'utf8',
  ),
) as VectorFile;

/** Which selectors each subset keeps. `PageSelector` is in every one: it is the page-level fallback. */
const SUBSETS: Record<string, readonly Selector['type'][]> = {
  full: [
    'BlockSelector',
    'PageSelector',
    'TextPositionSelector',
    'TextQuoteSelector',
    'ShapeSelector',
    'SectionPathSelector',
  ],
  position: ['PageSelector', 'TextPositionSelector', 'TextQuoteSelector'],
  quote: ['PageSelector', 'TextQuoteSelector'],
  shape: ['PageSelector', 'ShapeSelector'],
  sectionPath: ['PageSelector', 'SectionPathSelector'],
};

function subsetOf(anchor: Anchor, keep: readonly Selector['type'][]): Anchor {
  const allowed = new Set<string>(keep);
  return { ...anchor, selectors: anchor.selectors.filter((s) => allowed.has(s.type)) };
}

const documents = new Map<string, ReturnType<typeof indexDocument>>();
function documentFor(slug: FixtureSlug): ReturnType<typeof indexDocument> {
  let doc = documents.get(slug);
  if (doc === undefined) {
    doc = indexDocument(loadFixture(slug), VECTORS.text_stream_id);
    documents.set(slug, doc);
  }
  return doc;
}

describe('anchoring/python-conformance — Python mints, the real ladder resolves', () => {
  it('the vectors are the shape the suite thinks they are', () => {
    expect(VECTORS.vectors.length).toBe(46);
    expect(new Set(VECTORS.vectors.map((v) => v.fixture)).size).toBe(3);
  });

  it('the short-quote gate the producer predicted against is still the resolver’s', () => {
    // `expect.quote` is 6 for a quote shorter than this with no context. If the constant moves, the
    // vectors are stale in a way that would otherwise surface as an unreadable tier mismatch.
    expect(VECTORS.resolver_constants.MIN_QUOTE_WITHOUT_CONTEXT).toBe(MIN_QUOTE_WITHOUT_CONTEXT);
  });

  it.each([...new Set(VECTORS.vectors.map((v) => v.fixture))])(
    '%s — the Python text stream is byte-identical to this one',
    (slug) => {
      // The single strongest cross-language assertion available: `Page.flows` walked one block
      // differently, or `resolvedText` read one block differently, and this digest moves. Without
      // it, an ordering drift shows up only as an anchor that lands a paragraph away, months later.
      const stream =
        documentFor(slug)
          .blocks.map((b) => b.text)
          .join('\n') + '\n';
      expect(`sha256:${createHash('sha256').update(stream, 'utf8').digest('hex')}`).toBe(
        VECTORS.stream_sha256[slug],
      );
    },
  );

  describe.each(Object.keys(SUBSETS))('selector subset: %s', (subset) => {
    const keep = SUBSETS[subset] as readonly Selector['type'][];

    it.each(VECTORS.vectors.map((v) => [`${v.fixture}/${v.blockType}`, v] as const))(
      '%s reaches the tier Python predicted',
      (_label, vector) => {
        const doc = documentFor(vector.fixture);
        const resolution = resolveAnchor(subsetOf(vector.anchor, keep), doc, { useCache: false });
        expect(resolution.tier).toBe(vector.expect[subset]);
        // A tier without the right block is a tier that answered about something else. Asserted on
        // the three tiers that claim to have IDENTIFIED the target rather than approximated it.
        if (resolution.tier === Tier.Block || resolution.tier === Tier.Position) {
          expect(resolution.blockIds).toContain(vector.blockId);
          expect(resolution.state).toBe('anchored');
        }
      },
    );
  });

  it('the document identity Python recorded is this document’s', () => {
    // T4 and T5 are gated on `pdfSha256 === doc.sourceHash` — `falsify.spec` records why. A Python
    // capture that got this field wrong would silently lose both geometric tiers.
    for (const vector of VECTORS.vectors) {
      const doc = documentFor(vector.fixture);
      expect(vector.anchor.doc.pdfSha256).toBe(doc.sourceHash);
      expect(vector.anchor.doc.parserVersion).toBe(doc.parserVersion);
      expect(vector.anchor.offsetUnit).toBe('unicode');
    }
  });
});
