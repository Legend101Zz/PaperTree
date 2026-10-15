'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { pointerActivate } from '@/components/library/primitives';
import { useAuthStore } from '@/store/authStore';

/** Waits between automatic re-checks of an unverified session. After the last one, the reader decides. */
export const SESSION_RETRY_DELAYS_MS = [2000, 5000, 15000] as const;

/**
 * The "could not confirm your session" notice. It RETRIES for real: `checkAuth` is called again
 * after 2 s, 5 s and 15 s while the session stays unverified, the notice clears itself the moment
 * a check succeeds (the store flips `sessionUnverified`), and once the automatic tries are used up
 * a "Try again" button is the only thing left, so the words on screen are always true.
 */
export function SessionBanner() {
  const sessionUnverified = useAuthStore((state) => state.sessionUnverified);
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      await checkAuth();
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [checkAuth]);

  useEffect(() => {
    if (!sessionUnverified) {
      setAttempt(0);
      return undefined;
    }
    const delay = SESSION_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return undefined;
    const timer = setTimeout(() => {
      setAttempt((n) => n + 1);
      void runCheck();
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [sessionUnverified, attempt, runCheck]);

  if (!sessionUnverified) return null;
  const exhausted = attempt >= SESSION_RETRY_DELAYS_MS.length;

  return (
    <div
      role="status"
      className="pt-s3-alert pt-s3-alert--warn flex flex-wrap items-center gap-3"
      data-session-banner=""
    >
      <p className="min-w-0 flex-1">
        PaperTree could not confirm your session just now. You are still signed in.{' '}
        {exhausted ? 'It is still not confirmed.' : 'Checking again shortly.'}
      </p>
      <button
        type="button"
        className="pt-s3-btn pt-s3-btn--small"
        disabled={checking}
        {...pointerActivate<HTMLButtonElement>(() => {
          setAttempt(0);
          void runCheck();
        })}
      >
        {checking ? 'Checking' : 'Try again'}
      </button>
    </div>
  );
}
