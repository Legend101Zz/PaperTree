/**
 * What the reader shell may ask the document pane to do — the seam #64 is about.
 *
 * BOTH MEMBERS ARE REQUIRED, AND THAT IS THE FIX.
 *
 * The shape this replaces was `{ scrollToBlock?: (blockId: string) => void }`, declared at
 * `ReaderWorkspace.tsx:144` and called at `:150` and `:162`. Nothing ever assigned it —
 * `DocumentSlot` did not forward the ref and `SourcePane` kept its `listRef` private — so both
 * call sites were silent no-ops in Source and Split modes for two epics. The optional `?.` is what
 * made it silent: nothing threw, nothing logged, the click did nothing.
 *
 * `EPIC-03-grounded-ai.md` §1 records that four of Epic 2's five unreachable-feature defects
 * involved an optional prop, and that the fifth — `onViewportResize`, declared, never supplied,
 * fit-width silently clamping to 25% — was fixed by MAKING IT REQUIRED so the compiler catches it.
 * This is that fix applied to the fifth instance. A pane that mounts without supplying both methods
 * is now a type error, not a dead click.
 *
 * `MutableRefObject<DocumentHandle | null>` and not `{ scrollToBlock?: … }`: the NULL is a real
 * state — Guided mode mounts no document pane at all — while a mounted pane must supply the whole
 * handle. Those are different facts and the old shape conflated them, which is why "not mounted"
 * and "never wired" were indistinguishable at every call site.
 */
import type { MutableRefObject } from 'react';

export interface DocumentHandle {
  /**
   * Scroll the block into view. The pane resolves `blockId` to a `(pageIndex, bbox)` itself —
   * `doc.byId` is in ITS scope, not the shell's, and `VirtualPageList`'s handle takes the pair.
   *
   * A `blockId` the document does not carry is a no-op rather than a throw: a stale citation from
   * a previous parse is a real, expected condition (`AGENTS.md` §4 — block ids are content-derived
   * and any edit retires them), and the anchoring ladder, not this, is what recovers from it.
   */
  scrollToBlock(blockId: string): void;

  /**
   * Scroll to the top of a page. What an anchor that could not be placed gets instead of a
   * precise location.
   *
   * A SEPARATE METHOD, not a `` `page:${n}` `` string through `scrollToBlock` — that sentinel was
   * the old call at `ReaderWorkspace.tsx:162`, and no block id would ever have matched it. A
   * string parsed by convention is a second contract nobody declared (#64, step 3).
   */
  scrollToPage(pageIndex: number): void;
}

export type DocumentRef = MutableRefObject<DocumentHandle | null>;

/** What the shell wants done once a document pane exists to do it. */
export type PendingScroll =
  | { readonly kind: 'block'; readonly blockId: string }
  | { readonly kind: 'page'; readonly pageIndex: number };

/**
 * Run a scroll request against a handle.
 *
 * Extracted so the shell's "do it now" path and its "do it once the pane mounts" path cannot
 * drift — the Guided-mode case switches modes first, and the pane does not exist until the next
 * commit, so there are necessarily two call sites for one behaviour.
 */
export function applyScroll(handle: DocumentHandle, request: PendingScroll): void {
  if (request.kind === 'block') handle.scrollToBlock(request.blockId);
  else handle.scrollToPage(request.pageIndex);
}
