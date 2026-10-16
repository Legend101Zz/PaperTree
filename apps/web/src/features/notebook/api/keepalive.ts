/**
 * The browser's keepalive budget, shared by the page's two savers (S5d, #209): the items'
 * (`useItemSaver`) and the ink's (`useStrokeSaver`). Browsers cap the bodies of ALL keepalive
 * requests in flight in a document at 64 KiB together and refuse one past it ("Failed to fetch"),
 * so both savers draw from this one count, as the document does.
 */
import { KEEPALIVE_CAP } from '../model/leave';

let used = 0;

/**
 * Reserves room for one keepalive request body.
 *
 * @param bytes - The body's size.
 * @returns True when it fits (release it when the request settles); false: send it without.
 */
export function reserveKeepalive(bytes: number): boolean {
  if (used + bytes > KEEPALIVE_CAP) return false;
  used += bytes;
  return true;
}

/**
 * Gives back what `reserveKeepalive` took, once the request has settled.
 *
 * @param bytes - The body's size, as reserved.
 */
export function releaseKeepalive(bytes: number): void {
  used = Math.max(0, used - bytes);
}
