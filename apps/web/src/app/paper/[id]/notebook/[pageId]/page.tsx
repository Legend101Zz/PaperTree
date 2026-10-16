'use client';

/**
 * The notebook page route (S5c, #208): `/paper/<paper id>/notebook/<page id>`. The page itself is
 * `features/notebook`'s; this file only reads the two ids and requires a session.
 */
import { useParams } from 'next/navigation';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { NotebookView } from '@/features/notebook';

import type { ReactNode } from 'react';

function one(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The route: a signed-in reader's notebook page. */
export default function NotebookPageRoute(): ReactNode {
  const params = useParams();
  const paperId = one(params?.['id']);
  const pageId = one(params?.['pageId']);
  return (
    <AuthGuard>
      {paperId === null || pageId === null ? (
        <div className="pt-state" role="alert">
          <h1 className="pt-state__title">No page was named</h1>
          <p className="pt-state__body">This link does not say which notebook page to open.</p>
        </div>
      ) : (
        <NotebookView paperId={paperId} pageId={pageId} />
      )}
    </AuthGuard>
  );
}
