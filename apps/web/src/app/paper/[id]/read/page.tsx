// apps/web/src/app/paper/[id]/read/page.tsx
'use client';

/**
 * The reader route.
 *
 * THE `[id]` SEGMENT IS A PAPER ID — or, only when `NEXT_PUBLIC_PAPERTREE_FIXTURES=on`, a
 * committed fixture's slug (`lib/paperSource.ts::resolvePaperRef`). The route does not keep a list
 * of which papers exist: an unknown id goes to the API, and the reader's designed "not in your
 * library" state is reached through the API's 404, not through a client-side allow-list.
 *
 * S4 removed the old `NotParsedYet` screen (slice-plan §R, R8): its copy said ingestion was "Epic
 * 1's work" and offered the three fixtures, which stopped being true when uploads started parsing.
 * A paper that is still being read now opens in the reader, which says so and retries on its own.
 */

import { useParams } from 'next/navigation';

import { AuthGuard } from '@/components/auth/AuthGuard';
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
        <div className="pt-reader">
          <div className="pt-state" role="alert">
            <h1 className="pt-state__title">No paper was named</h1>
            <p className="pt-state__body">This link does not say which paper to open.</p>
            <a className="pt-btn pt-btn--primary" href="/dashboard">
              Back to your library
            </a>
          </div>
        </div>
      )}
    </AuthGuard>
  );
}
