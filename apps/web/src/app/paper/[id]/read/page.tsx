// apps/web/src/app/paper/[id]/read/page.tsx
'use client';

/**
 * The reader route.
 *
 * This replaces a 519-line route that mounted TEN reader surfaces — `PDFViewer`, `BookViewer`,
 * `ReaderToolbar`, `SmartOutlinePanel`, `HighlightsPanel`, `HighlightPopup`, `PDFMinimap`,
 * `FigureViewer`, `InlineExplanation` and `ExplanationPanel` — three of which mounted independent
 * `<Document>` instances of the same PDF. Every one of them was imported by this file and by
 * nothing else, so they are deleted in the same commit. IA §18.1 calls that accumulation "not an
 * information architecture. It is an accumulation"; this route is the correction.
 *
 * IT ALSO REMOVES THE BUG THE EPIC EXISTS FOR. The old `handlePDFTextSelect`, at lines 228-233,
 * stored highlight geometry as
 *
 *     rects.map((r) => ({ x: r.x / window.innerWidth, y: r.y / window.innerHeight, … }))
 *
 * and `PDFViewer.tsx:145-154` then painted it as a percentage of the page element. Nothing in that
 * record — no page height, no PDF-space bbox, no character offset, no block id — permits
 * reconstruction, which is why every highlight the deployed product has ever stored is
 * unrecoverable, lands wrong on creation, moves on resize and differs per device. Capture now runs
 * through `captureAnchor` and painting through `HighlightOverlay`; neither measures the DOM.
 *
 * THE `[id]` SEGMENT IS A PAPER ID OR A FIXTURE SLUG, and this route no longer decides which by
 * consulting a list of three strings.
 *
 * It used to: `isFixtureSlug(id) ? <ReaderWorkspace/> : <NotParsedYet/>`. That branch is why a
 * paper uploaded through the product could never open, no matter what `loadPaper` did — and the
 * prediction in `lib/fixtures.ts` that "`lib/fixtures.ts` is the only file that then has to
 * change" missed it. `lib/paperSource.ts`'s header has the full account.
 *
 * An unknown id is now an API id. If it is not a real one the API answers 404 and the designed
 * not-found state is reached THROUGH that answer, rather than by a client-side allow-list that
 * cannot know what the server has.
 */

import { useParams } from 'next/navigation';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { FIXTURE_SLUGS, FIXTURE_TITLES } from '@/lib/fixtures';
import { resolvePaperRef } from '@/lib/paperSource';

import { ReaderWorkspace } from './ReaderWorkspace';

export default function ReaderPage() {
  const params = useParams();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  return (
    <AuthGuard>
      {typeof id === 'string' && id.length > 0 ? (
        <ReaderWorkspace paper={resolvePaperRef(id)} />
      ) : (
        <NotParsedYet id="" />
      )}
    </AuthGuard>
  );
}

/**
 * A designed state, not an error page.
 *
 * IA §19.8 requires every one of these to be designed rather than an afterthought, and the current
 * product has none of them. This one says what is actually true — ingestion is Epic 1's — and
 * offers the three papers that ARE available, instead of failing silently the way the v1 upload
 * path does (`PaperList.tsx:32-46` blocks the request and gives the user no feedback at all).
 */
function NotParsedYet({ id }: { id: string }) {
  return (
    <div className="mx-auto max-w-prose p-8" role="status">
      <h1 className="text-lg font-medium">This paper has not been parsed yet</h1>
      <p className="mt-2 text-sm opacity-80">
        Epic 2 builds against the three golden fixtures and does not wait for the parser. Ingesting
        an arbitrary upload is Epic 1&apos;s work.
      </p>
      {id === '' ? null : (
        <p className="mt-2 text-xs opacity-60">
          Requested: <code>{id}</code>
        </p>
      )}
      <ul className="mt-4 space-y-2 text-sm">
        {FIXTURE_SLUGS.map((slug) => (
          <li key={slug}>
            <a
              className="inline-flex min-h-[44px] items-center underline"
              href={`/paper/${slug}/read`}
            >
              {FIXTURE_TITLES[slug]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
