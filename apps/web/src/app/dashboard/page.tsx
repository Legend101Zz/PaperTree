'use client';

/**
 * The library route. Everything it does lives in `features/library`; this file only puts the
 * sign-in guard in front of it. (A Next page may export nothing but the page.)
 */
import { AuthGuard } from '@/components/auth/AuthGuard';
import { LibraryView } from '@/features/library';

export default function LibraryPage() {
  return (
    <AuthGuard>
      <LibraryView />
    </AuthGuard>
  );
}
