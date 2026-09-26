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
 * THE FIXTURE PATH SURVIVES, BEHIND A FLAG THAT IS OFF BY DEFAULT (contracts.md §7, S4). The
 * three committed fixtures are what `citation-nav.spec`, `reparse.spec`, `stamp.spec` and
 * `citation-scroll.spec` measure against, and the e2e smoke opens one — so the loader stays, and
 * `NEXT_PUBLIC_PAPERTREE_FIXTURES=on` turns it on in tests and demos. Everywhere else every id is a
 * real paper, which is what a user has.
 *
 * S4 ALSO FIXED N22 HERE. Every API document was indexed as `fixture/<ir_version>`, so every anchor
 * a user captured on a real upload claimed to come from a fixture. contracts.md §6 names the form:
 * `api/<paper_id>/g<generation>/<parser_version>` — the generation is what `PUT …/resolutions`
 * caches against, and the data layer now refuses any other form on a new highlight.
 */
import { indexDocument, type IndexedDocument, type PaperSource } from '@papertree/anchoring';

import { isFixtureSlug, pdfUrlFor, textStreamIdFor, type FixtureSlug } from './fixtures';
import { getSessionToken } from './api/client';
import { papersApi } from './api/papers';

export type PaperRef =
  | { readonly kind: 'fixture'; readonly slug: FixtureSlug }
  | { readonly kind: 'api'; readonly paperId: string };

/**
 * Fixtures are OFF unless `NEXT_PUBLIC_PAPERTREE_FIXTURES` is exactly `on` (contracts.md §7).
 *
 * Off, the three fixture slugs are ordinary ids and go to the API like any other — which is what
 * proves the API path is the one a user reaches. Library code that lists sample papers gates on
 * this same function (#137).
 */
export function fixturesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PAPERTREE_FIXTURES === 'on';
}

/**
 * A URL segment to a source. NEVER null for a non-empty id — that is the point.
 *
 * The old `isFixtureSlug(id) ? <ReaderWorkspace/> : <NotParsedYet/>` gate is what kept every real
 * paper out of the reader. An unknown id is an API id, and the API answers 404 if it is not a real
 * one; the designed not-found state is reached by that 404 rather than by a client-side allow-list.
 */
export function resolvePaperRef(id: string): PaperRef {
  if (fixturesEnabled() && isFixtureSlug(id)) return { kind: 'fixture', slug: id };
  return { kind: 'api', paperId: id };
}

export function paperRefKey(ref: PaperRef): string {
  return ref.kind === 'fixture' ? `fixture:${ref.slug}` : `api:${ref.paperId}`;
}

/** The paper id a `PaperRef` names: the `paper_id` for an API paper, the slug for a fixture. */
export function paperIdOf(ref: PaperRef): string {
  return ref.kind === 'api' ? ref.paperId : ref.slug;
}

/**
 * The reader-position key of contracts.md §5: `papertree/reader/<paper_id>`. A fixture has no
 * `paper_id` on any server, so its slug stands in (and cannot collide: slugs are not `ppr_` ids).
 */
export function readerStorageKey(ref: PaperRef): string {
  return `papertree/reader/${paperIdOf(ref)}`;
}

/**
 * contracts.md §6's `textStreamId` for an API document: `api/<paper_id>/g<generation>/<parser>`.
 * `/ir` carries the generation it served. Without one the id says so (`g?`), and the reader treats
 * the document as one it cannot write highlights against — rather than guessing a generation.
 */
export function apiTextStreamId(paper: PaperSource & { generation?: unknown }): string {
  const generation =
    typeof paper.generation === 'number' && Number.isInteger(paper.generation) && paper.generation >= 1
      ? `g${String(paper.generation)}`
      : 'g?';
  return `api/${paper.paper_id}/${generation}/${paper.parser?.version ?? 'unknown'}`;
}

/** The generation an API document was indexed from, or null (a fixture, or an IR without one). */
export function documentGeneration(doc: IndexedDocument): number | null {
  const match = /^api\/[^/]+\/g([1-9][0-9]*)\//.exec(doc.textStreamId);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * THE MEMOS BELONG TO ONE SESSION AND HOLD A FEW PAPERS (s4-review.md F8).
 *
 * A paper's indexed parse and its PDF bytes are memoised so a remount (React StrictMode's double
 * effect, the reader reopened from the library) neither re-downloads nor re-indexes. They are a
 * user's data in memory, so:
 *   - they are keyed to the session token: when it changes (sign-out, another account signs in in
 *     the same tab) every memo is dropped before anything is read from them;
 *   - they keep the `MEMO_PAPERS` most recently used papers, not every paper the tab ever opened.
 */
const MEMO_PAPERS = 2;
let memoSession: string | null | undefined;

function currentSession(): string | null {
  try {
    return getSessionToken();
  } catch {
    return null;
  }
}

/** Drop every memo when the signed-in session is not the one they were filled under. */
function scopeMemosToSession(): void {
  const session = currentSession();
  if (session === memoSession) return;
  cache.clear();
  bytes.clear();
  memoSession = session;
}

/** Most-recently-used first out of the map's insertion order; the oldest beyond the bound go. */
function remember<T>(memo: Map<string, T>, key: string, value: T): void {
  memo.delete(key);
  memo.set(key, value);
  while (memo.size > MEMO_PAPERS) {
    const oldest = memo.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
}

function recall<T>(memo: Map<string, T>, key: string): T | undefined {
  const value = memo.get(key);
  if (value !== undefined) remember(memo, key, value);
  return value;
}

/** Memoised per ref (see above) — `indexDocument` walks every block and builds four indices. */
const cache = new Map<string, Promise<IndexedDocument>>();

export async function loadDocument(ref: PaperRef): Promise<IndexedDocument> {
  scopeMemosToSession();
  const key = paperRefKey(ref);
  const existing = recall(cache, key);
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
    return indexDocument(paper, apiTextStreamId(paper));
  })();

  remember(cache, key, promise);
  // A failure is not memoised: "still reading" (409) and a dropped connection both clear on retry.
  promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

/**
 * What `PdfDocumentProvider` should open.
 *
 * A `string` for a fixture (a same-origin path under `public/`) and the bytes for the API, because
 * the API needs an `Authorization` header and pdf.js cannot send one — see
 * `api/papers.ts::papersApi.file` for why this is bytes rather than v1's token-in-the-query-string.
 * The provider hands pdf.js a COPY of these bytes on every open, because pdf.js transfers (and so
 * detaches) the buffer it is given — the defect that blanked an uploaded paper on a mode switch.
 */
export async function pdfSourceFor(ref: PaperRef): Promise<string | ArrayBuffer> {
  if (ref.kind === 'fixture') return pdfUrlFor(ref.slug);
  // Memoised like the document: a remount (React StrictMode's double effect in development, the
  // reader opened again from the library) must not download the PDF a second time. The bytes are
  // never handed to pdf.js themselves — the provider opens a copy — so one buffer serves them all.
  scopeMemosToSession();
  const key = paperRefKey(ref);
  const existing = recall(bytes, key);
  if (existing !== undefined) return existing;
  const promise = papersApi.file(ref.paperId);
  remember(bytes, key, promise);
  promise.catch(() => {
    if (bytes.get(key) === promise) bytes.delete(key);
  });
  return promise;
}

const bytes = new Map<string, Promise<ArrayBuffer>>();

/** Drop the memos. Tests only. */
export function __clearDocumentCache(): void {
  cache.clear();
  bytes.clear();
  memoSession = undefined;
}
