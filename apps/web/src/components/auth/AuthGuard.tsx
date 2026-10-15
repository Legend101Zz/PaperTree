'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { loginUrlFor } from '@/lib/auth';
import { useAuthStore } from '@/store/authStore';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Renders its children only for a signed-in user. Otherwise it sends the visitor to
 * `/login?next=<where they were>` so sign-in brings them back (S3). Checking the session is a
 * skeleton, never a blank page; a network error while checking keeps the session (authStore).
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, checkAuth, signedOutByUser } = useAuthStore();

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const here = `${pathname}${typeof window === 'undefined' ? '' : window.location.search}`;
      // After a deliberate Sign out there is nothing to come back to: a plain /login.
      router.replace(signedOutByUser ? '/login' : loginUrlFor(here));
    }
  }, [isLoading, isAuthenticated, router, pathname, signedOutByUser]);

  if (isLoading || !isAuthenticated) {
    return (
      <div
        className="pt-s3-page flex items-center justify-center"
        role="status"
        aria-label="Checking your session"
      >
        <div className="pt-s3-skeleton" style={{ width: 160, minHeight: 8, height: 8 }} />
      </div>
    );
  }

  return <>{children}</>;
}
