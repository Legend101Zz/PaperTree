// apps/web/src/app/paper/[id]/canvas/page.tsx
'use client';

/**
 * The canvas route: one board per paper, made only by what the reader sends to it (S7).
 * `[id]` is the paper id, as on the reader route.
 */
import { useParams } from 'next/navigation';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { CanvasView } from '@/components/canvas/CanvasView';

export default function CanvasPage() {
  const params = useParams();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  return (
    <AuthGuard>
      {typeof id === 'string' && id.length > 0 ? (
        <CanvasView paperId={id} />
      ) : (
        <div className="pt-reader">
          <div className="pt-state" role="alert">
            <h1 className="pt-state__title">No paper was named</h1>
            <p className="pt-state__body">This link does not say which paper&apos;s canvas to open.</p>
            <a className="pt-btn pt-btn--primary" href="/dashboard">
              Back to your library
            </a>
          </div>
        </div>
      )}
    </AuthGuard>
  );
}
