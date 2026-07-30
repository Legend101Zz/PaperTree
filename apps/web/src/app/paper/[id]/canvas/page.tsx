'use client';

/**
 * The canvas route — STOOD DOWN by Epic 2, to be rebuilt by Epic 5.
 *
 * WHY THIS IS A PLACEHOLDER RATHER THAN THE v1 CANVAS.
 *
 * "No canvas" is an explicit Epic 2 non-goal, and `apps/web/src/components/canvas/**` is outside
 * this epic's file ownership — so the v1 components are NOT deleted. They are still in the tree,
 * untouched, and `tsconfig.json` excludes them from typecheck so Epic 5 finds them exactly as they
 * were. Only this route, which composes them, is stood down.
 *
 * It had to be, for three reasons that all landed at once:
 *
 *   1. `hooks/useCanvas.ts` is on Epic 2's mandatory deletion list AND is type-broken independently
 *      of anything this epic did — it calls `canvasApi.getBookCanvases`, `getCanvas`, `createNode`,
 *      `createBranch` and `runAIQuery`, none of which exist, and imports four types
 *      (`CreateNodeInput`, `UpdateNodeInput`, `AIQueryInput`, `BranchInput`) that `types/canvas.ts`
 *      does not export. 25 of the 29 type errors blocking `apps/web` were in that one file.
 *   2. `MermaidRenderer` imports `mermaid`, and Epic 2 is required to delete Mermaid rendering
 *      outright — "deleted, not restyled", "no fabricated diagrams".
 *   3. Removing `--filter=!papertree-web` from the root `build` and `lint` scripts is a named Epic 2
 *      deliverable (root `package.json`, `//epic-2-apps-web`), and it cannot be done while
 *      `apps/web` does not compile.
 *
 * The v1 canvas was already a dead end by the audit's own account — its "go to source" deep link
 * does not work (`canvas/page.tsx:115-123`) — and Epic 5 rebuilds it so that every source-backed
 * node keeps a live PaperIR reference. When it does, it should store an `Anchor` from
 * `@papertree/anchoring` rather than a bare `block_id`: that is what makes "open source" survive a
 * re-parse, and it is already built and measured.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { AuthGuard } from '@/components/auth/AuthGuard';

export default function CanvasPage() {
  const params = useParams();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  return (
    <AuthGuard>
      <div className="mx-auto max-w-prose p-8" role="status">
        <h1 className="text-lg font-medium">The canvas is being rebuilt</h1>
        <p className="mt-2 text-sm opacity-80">
          Epic 2 rebuilt the reader and stood this route down; Epic 5 rebuilds the canvas on top of
          it. The v1 components are still in the repository, untouched.
        </p>
        {typeof id === 'string' && id !== '' ? (
          <p className="mt-4 text-sm">
            <Link className="inline-flex min-h-[44px] items-center underline" href={`/paper/${id}/read`}>
              Read this paper instead
            </Link>
          </p>
        ) : null}
      </div>
    </AuthGuard>
  );
}
