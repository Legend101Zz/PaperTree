/**
 * The browser's keepalive budget, shared by the page's two savers (S5d, #209): the items'
 * (`useItemSaver`) and the ink's (`useStrokeSaver`). Browsers cap the bodies of ALL keepalive
 * requests in flight in a document at 64 KiB together and refuse one past it ("Failed to fetch"),
 * so both savers draw from this one count, as the document does. Each saver also says what it would
 * still have to send if the page closed now (`owesOnLeave`), so `beforeunload` can warn when the two
 * together cannot go, not only when one write alone is too big; and both see one "being left" flag,
 * set by whichever `pagehide` listener runs first.
 */
import { KEEPALIVE_CAP } from '../model/leave';

let used = 0;
let leaving = false;
const debts = new Set<() => number>();

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

/**
 * What is left of the budget now: what a saver may still send with keepalive.
 *
 * @returns Bytes.
 */
export function keepaliveLeft(): number {
  return Math.max(0, KEEPALIVE_CAP - used);
}

/**
 * Registers what one saver would still have to send if the page closed now.
 *
 * @param bytes - Reads the body bytes the saver owes (unsaved writes, a note being typed).
 * @returns Unregisters it (on unmount).
 */
export function owesOnLeave(bytes: () => number): () => void {
  debts.add(bytes);
  return () => {
    debts.delete(bytes);
  };
}

/**
 * Whether closing the page now would lose work: what the savers owe together is more than the
 * keepalive budget can still carry, so something would go without keepalive and be cancelled.
 *
 * @returns True when `beforeunload` should warn.
 */
export function leavingWouldLose(): boolean {
  let owed = 0;
  for (const bytes of debts) owed += bytes();
  return owed > keepaliveLeft();
}

/**
 * Marks the page as being left (`pagehide`) or back (`pageshow`, or a saver mounting). While it is
 * being left, a saver sends only from its own `pagehide` flush, never from a last command's sync.
 *
 * @param value - True from `pagehide` on.
 */
export function setLeaving(value: boolean): void {
  leaving = value;
}

/**
 * Whether the page is being left (`setLeaving`).
 *
 * @returns True between `pagehide` and `pageshow`.
 */
export function isLeaving(): boolean {
  return leaving;
}
