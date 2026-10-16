/**
 * The production guard for the /design-system route. The board is a developer tool: on in
 * `next dev` and in tests, off in a production build unless the owner turns it on (#191).
 */

/** The environment variable that turns the board on in a production build. */
export const DESIGN_SYSTEM_FLAG = 'NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM';

/**
 * Whether /design-system may render.
 *
 * @param env Process environment (injectable for tests).
 * @returns `true` outside production, or in production when the flag is exactly `on`.
 * @example
 * if (!designSystemEnabled()) notFound();
 */
export function designSystemEnabled(
  env: Readonly<Record<string, string | undefined>> = {
    NODE_ENV: process.env.NODE_ENV,
    [DESIGN_SYSTEM_FLAG]: process.env.NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM,
  },
): boolean {
  return env.NODE_ENV !== 'production' || env[DESIGN_SYSTEM_FLAG] === 'on';
}
