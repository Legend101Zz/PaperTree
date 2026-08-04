/**
 * The session token, stored in EXACTLY ONE PLACE — #77's D2.
 *
 * There were two. This module wrote `localStorage["token"]`; `lib/papertree.ts` — the client the
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
 * These are therefore THIN DELEGATIONS to `lib/papertree.ts`, which owns the key. Keeping the
 * functions rather than rewriting their call sites means the delegation is the only thing anyone
 * has to trust, and a second key has to be introduced deliberately rather than by forgetting that
 * this file exists.
 */

import { clearSessionToken, getSessionToken, setSessionToken } from './papertree';

export const getToken = (): string | null => getSessionToken();

export const setToken = (token: string): void => {
  setSessionToken(token);
};

export const removeToken = (): void => {
  clearSessionToken();
};

export const isAuthenticated = (): boolean => getToken() !== null;
