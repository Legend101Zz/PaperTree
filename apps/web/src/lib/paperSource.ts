/**
 * Where the reader's document comes from — a fixture on disk, or the API.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE CLAIM THIS FILE TESTS, AND THE ANSWER
 *
 * `lib/fixtures.ts` opens with its own prediction:
 *
 *     "WHEN EPIC 1'S PARSER LANDS, only `loadPaper` changes: it fetches from the API instead of
 *      from `public/`, and everything downstream — which consumes an `IndexedDocument`, not a
 *      fixture — is untouched. That is the point of routing every consumer through
 *      `indexDocument`."
 *
 * #78 says to hold that to be true and that finding it false is worth more than the fix. **It is
 * half true, and the half that is false is the half that mattered.**
 *
 * TRUE: every consumer of the returned value is untouched. `ReaderWorkspace`, `SourcePane`,
 * `Navigator`, `GuidedView`, the Inspector and the overlay all take an `IndexedDocument` and none
 * of them changed by a character. Routing everything through `indexDocument` did exactly what it
 * was supposed to do, and that is the larger and more valuable half.
 *
 * FALSE: `loadPaper` was never the only fixture-specific seam. Two more sat beside it, and the
 * second is the one that would have made a "wired" API path unreachable:
 *
 *   1. `pdfUrlFor(slug)` -> `/fixtures/${slug}.pdf`. A sibling export of `loadPaper`, called from
 *      `ReaderWorkspace.tsx` and threaded to `PdfDocumentProvider`. Not downstream of
 *      `indexDocument` at all, so the promise never covered it.
 *
 *   2. `app/paper/[id]/read/page.tsx` rendered `ReaderWorkspace` only `if (isFixtureSlug(id))`.
 *      **The route itself hard-coded that exactly three papers exist.** `loadPaper` could have
 *      fetched from the API perfectly and no real `paper_id` would ever have reached it — the new
 *      code path would have been shipped, tested, and unreachable, which is #58 and #59 exactly.
 *
 * The lesson generalises: routing every consumer through one type protects the CONSUMERS, and says
 * nothing about the PRODUCERS beside it or the ROUTE above it. Both of the misses are one level
 * out from where the promise was looking.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * THE FIXTURE PATH SURVIVES, BEHIND A FLAG, and that is not sentimentality. The three committed
 * fixtures are what `citation-nav.spec`, `reparse.spec`, `stamp.spec` and `citation-scroll.spec`
 * measure against; they are the repo's best measurements and they do not depend on a running
 * service. Deleting the loader to "clean up" would destroy them (#78 §4, explicitly).
 */
import { indexDocument, type IndexedDocument, type PaperSource } from '@papertree/anchoring';

import { isFixtureSlug, pdfUrlFor, textStreamIdFor, type FixtureSlug } from './fixtures';
import { papersApi } from './papertree';

export type PaperRef =
  | { readonly kind: 'fixture'; readonly slug: FixtureSlug }
  | { readonly kind: 'api'; readonly paperId: string };

/**
 * Fixtures are ON by default.
 *
 * The default has to keep the three fixture slugs resolving, because the specs above are the
 * repo's strongest evidence and a default that broke them would be traded for nothing. Set
 * `NEXT_PUBLIC_PAPERTREE_FIXTURES=off` to force every id — including the three slugs — through the
 * API, which is what proves the API path is genuinely reachable rather than shadowed.
 */
export function fixturesEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_PAPERTREE_FIXTURES ?? 'on') !== 'off';
}

/**
 * A URL segment to a source. NEVER null for a non-empty id — that is the point.
 *
 * The old `isFixtureSlug(id) ? <ReaderWorkspace/> : <NotParsedYet/>` gate is what kept every real
 * paper out of the reader. An unknown id is now an API id, and the API answers 404 if it is not a
 * real one; the designed not-found state is reached by that 404 rather than by a client-side
 * allow-list of three strings.
 */
export function resolvePaperRef(id: string): PaperRef {
  if (fixturesEnabled() && isFixtureSlug(id)) return { kind: 'fixture', slug: id };
  return { kind: 'api', paperId: id };
}

export function paperRefKey(ref: PaperRef): string {
  return ref.kind === 'fixture' ? `fixture:${ref.slug}` : `api:${ref.paperId}`;
}

/** Memoised per ref — `indexDocument` walks every block and builds four indices. */
const cache = new Map<string, Promise<IndexedDocument>>();

export async function loadDocument(ref: PaperRef): Promise<IndexedDocument> {
  const key = paperRefKey(ref);
  const existing = cache.get(key);
  if (existing !== undefined) return existing;

  const promise = (async () => {
    if (ref.kind === 'fixture') {
      const response = await fetch(`/fixtures/${ref.slug}.paperir.json`);
      if (!response.ok) {
        throw new Error(
          `could not load fixture "${ref.slug}" (${String(response.status)}). ` +
            `Run \`pnpm --filter papertree-web prepare:assets\` to stage public/fixtures/.`,
        );
      }
      const paper = (await response.json()) as PaperSource;
      return indexDocument(paper, textStreamIdFor(paper));
    }

    // The API returns the same PaperIR document the fixture files hold — asserted key-for-key
    // against them by `services/api`'s `test_ir.py`, which is what makes this line a swap of the
    // TRANSPORT and not of the contract.
    const paper = await papersApi.ir(ref.paperId);
    return indexDocument(paper, textStreamIdFor(paper));
  })();

  cache.set(key, promise);
  return promise;
}

/**
 * What `PdfDocumentProvider` should open.
 *
 * A `string` for a fixture (a same-origin path under `public/`) and an `ArrayBuffer` for the API,
 * because the API needs an `Authorization` header and pdf.js cannot send one — see
 * `papertree.ts::papersApi.file` for why this is bytes rather than v1's token-in-the-query-string.
 */
export async function pdfSourceFor(ref: PaperRef): Promise<string | ArrayBuffer> {
  return ref.kind === 'fixture' ? pdfUrlFor(ref.slug) : papersApi.file(ref.paperId);
}

/** Drop the memo. Tests only. */
export function __clearDocumentCache(): void {
  cache.clear();
}
