/**
 * Session state, against `services/api` — #77's D1.
 *
 * THE BUG THIS CLOSES. Both `login` and `register` read `response.access_token`. That is v1
 * `apps/api`'s field name. `services/api` returns `token` (`app.py`'s `Session` model), so
 * `setToken(undefined)` ran on every successful sign-in and the very next `getMe()` was
 * unauthenticated.
 *
 * Measured in a real browser during the #77 walk, with real typing:
 *
 *     POST /auth/register  ->  201 Created        the account IS created
 *     GET  /auth/me        ->  401 Unauthorized
 *                          ->  AuthGuard bounces to /login
 *
 *     POST /auth/login     ->  200 OK             the credentials ARE correct
 *     GET  /auth/me        ->  401 Unauthorized
 *                          ->  AuthGuard bounces to /login
 *
 * A registered user could never get in, no error was ever shown, and the account existed the whole
 * time.
 *
 * So this imports `authApi` from `@/lib/api/papers` — the client that talks to the service actually
 * listening on `NEXT_PUBLIC_PAPERTREE_API_URL`. (The v1 client it was confused with, `lib/api.ts`,
 * was deleted in S0; so was `lib/papertree.ts`, which `lib/api/*` replaced.)
 * `test/journey-wiring.spec.tsx` asserts the field names against a stub shaped like the real
 * response, so a rename on either side fails a test instead of silently signing nobody in.
 */

import { create } from "zustand";
import { authApi } from "@/lib/api/papers";
import { ApiError } from "@/lib/api/types";
import { setToken, removeToken, getToken } from "@/lib/auth";

/**
 * The signed-in user. It lived in `types/index.ts` with the v1 types, and this store was its only
 * live consumer, so it moved here when that file was deleted (S0, slice-plan §R R4).
 */
export interface User {
  id: string;
  email: string;
  /**
   * OPTIONAL because `services/api`'s `GET /auth/me` does not return one (#77).
   *
   * It was required while `apps/api` (v1) served this type. Making it optional is the honest
   * option: the alternative was filling it with `new Date()`, which would put a fabricated
   * account-creation time into application state that reads exactly like a real one. Nothing
   * renders it.
   */
  created_at?: string;
}

/**
 * `/auth/me` returns `{ user_id, email }`. `User` calls it `id`.
 *
 * Mapped in one place rather than at each call site, and `created_at` is left UNSET rather than
 * filled with a plausible-looking value: the endpoint does not return one, and inventing a
 * `new Date()` here would put a fabricated timestamp into application state. `User.created_at` is
 * optional for that reason, and nothing renders it.
 */
function toUser(me: { readonly user_id: string; readonly email: string }): User {
  return { id: me.user_id, email: me.email };
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  /** Revokes the server session (POST /auth/logout), then clears the local one. */
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  /**
   * True when the last `checkAuth` could not reach the server (network error or 5xx). The session
   * is KEPT in that case: only a 401 means it is invalid (frontend-map §1.3).
   */
  sessionUnverified: boolean;
  /** True after the user chose Sign out, so the guard sends them to a plain `/login`. */
  signedOutByUser: boolean;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  sessionUnverified: false,
  signedOutByUser: false,

  login: async (email: string, password: string) => {
    const session = await authApi.login(email, password);
    setToken(session.token);
    set({ user: toUser(session), isAuthenticated: true, isLoading: false, signedOutByUser: false });
  },

  register: async (email: string, password: string) => {
    const session = await authApi.register(email, password);
    setToken(session.token);
    set({ user: toUser(session), isAuthenticated: true, isLoading: false, signedOutByUser: false });
  },

  logout: async () => {
    // The server session is revoked FIRST, while the token can still authenticate the call. A
    // failure here (offline, 5xx) must not trap the user signed in, so the local session is cleared
    // either way; the call is attempted, not assumed.
    try {
      await authApi.logout();
    } catch {
      // Nothing useful to tell a person who asked to leave.
    } finally {
      removeToken();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        sessionUnverified: false,
        signedOutByUser: true,
      });
    }
  },

  checkAuth: async () => {
    const token = getToken();
    if (!token) {
      set({ isLoading: false, isAuthenticated: false, sessionUnverified: false });
      return;
    }

    try {
      const me = await authApi.me();
      set({ user: toUser(me), isAuthenticated: true, isLoading: false, sessionUnverified: false });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // The only answer that means "this session is not valid".
        removeToken();
        set({ user: null, isAuthenticated: false, isLoading: false, sessionUnverified: false });
        return;
      }
      // A network error or a 5xx says nothing about the session. Keep it; the page's own requests
      // will show their own errors, and a 401 on any of them signs out through the client policy.
      set({ isAuthenticated: true, isLoading: false, sessionUnverified: true });
    }
  },
}));
