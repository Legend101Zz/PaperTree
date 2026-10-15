/**
 * The session token, stored in EXACTLY ONE PLACE — #77's D2.
 *
 * There were two. This module wrote `localStorage["token"]`; the v2 client — the one the
 * READER uses — reads `localStorage["papertree.session"]`. Both were live at once, so a user could
 * hold a perfectly valid session and still be told the paper could not be loaded.
 *
 * Measured in a real browser during the #77 walk: with a valid token under `"token"`,
 * `GET /auth/me` returned **200** while the reader rendered
 * `This paper could not be loaded — {"detail":"missing or invalid session token"}`. Copying the
 * identical string to `"papertree.session"` loaded the paper (773 blocks). Two keys, one session,
 * and no error anywhere that pointed at the cause.
 *
 * The split was deliberate once — v1 `apps/api` and v2 `services/api` were both live and signing
 * into one was not signing into the other. `apps/api` is now archived, so the reason is gone and
 * only the bug is left.
 *
 * These are therefore THIN DELEGATIONS to `lib/api/client.ts`, which owns the key. Keeping the
 * functions rather than rewriting their call sites means the delegation is the only thing anyone
 * has to trust, and a second key has to be introduced deliberately rather than by forgetting that
 * this file exists.
 */

import { clearSessionToken, getSessionToken, setSessionToken } from './api/client';

export const getToken = (): string | null => getSessionToken();

export const setToken = (token: string): void => {
  setSessionToken(token);
};

export const removeToken = (): void => {
  clearSessionToken();
};

export const isAuthenticated = (): boolean => getToken() !== null;

/** Where sign-in goes when there is no (valid) `?next=`. */
export const DEFAULT_AFTER_LOGIN = '/dashboard';

/**
 * The `?next=` target, or the default. SAME-ORIGIN RELATIVE PATHS ONLY (S3, no open redirect).
 *
 * Accepted: a string starting with exactly one `/`, with no backslash, no control character and no
 * scheme, that still resolves to the app's own origin after parsing (the check that catches the
 * browser quirks `//evil.example`, `/\evil.example` and `/%09/evil.example` rely on), and that is
 * not the login or register page itself (a loop). Everything else gives the default.
 */
export function safeNext(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw.length === 0 || raw.length > 2048) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_AFTER_LOGIN;
  // eslint-disable-next-line no-control-regex
  if (raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_AFTER_LOGIN;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (decoded.startsWith('//') || decoded.includes('\\')) return DEFAULT_AFTER_LOGIN;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return DEFAULT_AFTER_LOGIN;
  try {
    const base = 'http://papertree.invalid';
    const url = new URL(raw, base);
    if (url.origin !== base) return DEFAULT_AFTER_LOGIN;
    if (url.pathname.startsWith('/login') || url.pathname.startsWith('/register')) {
      return DEFAULT_AFTER_LOGIN;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}

/** `/login?next=<path>`, for a protected page that finds no session. */
export function loginUrlFor(pathWithSearch: string): string {
  const next = safeNext(pathWithSearch);
  return next === DEFAULT_AFTER_LOGIN && pathWithSearch !== DEFAULT_AFTER_LOGIN
    ? '/login'
    : `/login?next=${encodeURIComponent(next)}`;
}
