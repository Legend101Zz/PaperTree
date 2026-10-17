'use client';

/**
 * The notebook route without a page (S5c, #208): `/paper/<paper id>/notebook` lists the pages the
 * person has made for this paper, or says how one starts.
 */
import { useParams } from 'next/navigation';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { NotebookPageList } from '@/features/notebook';

import type { ReactNode } from 'react';

/** The route: a signed-in reader's notebook pages for one paper. */
export default function NotebookListRoute(): ReactNode {
  const params = useParams();
  const raw = params?.['id'];
  const paperId = Array.isArray(raw) ? raw[0] : raw;
  return (
    <AuthGuard>
      {typeof paperId === 'string' && paperId.length > 0 ? (
        <NotebookPageList paperId={paperId} />
      ) : (
        <div className="pt-state" role="alert">
          <h1 className="pt-state__title">No paper was named</h1>
          <p className="pt-state__body">
            This link does not say which paper&apos;s notebook to open.
          </p>
        </div>
      )}
    </AuthGuard>
  );
}
