'use client';

/**
 * reader/SplitView — F2.6. Source ‖ Guided, LINKED BY BLOCK ID.
 *
 * §18.3: "linking is by block, never by page or scroll ratio."
 *
 * That is not a preference. Source is a two-column PDF at some zoom; Guided is one reflowed column
 * whose paragraphs are a different height, whose figures are a different size, and which drops the
 * page furniture entirely. So:
 *
 *   - SCROLL RATIO is wrong because the two panes have unrelated total heights, and the error is
 *     worst exactly where the content is densest.
 *   - PAGE is wrong because Guided has no pages. `resnet`'s §3.1 begins two thirds down page 2's
 *     right-hand column; "page 2" points at the top of a column the reader is not in.
 *
 * The only quantity both panes agree on is the block id, which is what `data-block-id` carries in
 * both trees. So the link is: whichever block is topmost in the pane the user is scrolling, put the
 * SAME BLOCK at the top of the other pane.
 *
 * NO GEOMETRY IS MEASURED TO DECIDE "TOPMOST". `IntersectionObserver` reports which blocks are
 * visible; DOM order decides which of those is first. There is no `getBoundingClientRect`, no
 * `offsetWidth`, no percentage of a container — the v1 bug that made every stored highlight
 * unrecoverable started as exactly this kind of convenience. (`offsetTop` IS used, once, to move a
 * scroll container; that is a scroll position, it is never stored and never painted, and it is the
 * only way to scroll a nested pane without `scrollIntoView` dragging the whole page with it.)
 *
 * THE FEEDBACK LOOP IS THE HARD PART. Pane A scrolls → we scroll pane B → pane B's observer fires →
 * it asks to scroll pane A → the two panes fight and the document shivers. `syncingRef` names which
 * pane is currently being driven; that pane's reports are ignored until its scrolling settles.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

export type SplitPane = 'source' | 'guided';

export interface SplitViewProps {
  /** Rendered into the left pane. Must contain `[data-block-id]` elements to be linkable. */
  readonly source: ReactNode;
  /** Rendered into the right pane. `GuidedView` sets `data-block-id` on every block it renders. */
  readonly guided: ReactNode;
  /** Told which block is topmost, whichever pane the user drove. Drives the Inspector's "where am I". */
  readonly onActiveBlockChange?: (blockId: string, pane: SplitPane) => void;
  /** Turn linking off — for a user who wants to compare two different places in one paper. */
  readonly linked?: boolean;
  readonly className?: string;
}

/**
 * How long a programmatic scroll is allowed to keep generating observer callbacks.
 *
 * Long enough to cover an instant scroll plus the layout it triggers, short enough that a user who
 * takes over mid-flight is not ignored. Instant, not smooth: a smooth scroll runs for hundreds of
 * milliseconds during which the user's own gesture must be ignored, and being ignored feels broken.
 */
const SYNC_SETTLE_MS = 120;

/**
 * The first visible block, by DOM order.
 *
 * DOM order, not position, because the DOM order IS the reading order in both panes and asking the
 * layout engine for coordinates is the thing this file refuses to do. The `rootMargin` biases the
 * observer to the top third of the pane, so "visible" means "where the reader is looking" rather
 * than "somewhere on screen".
 */
function useTopmostVisibleBlock(
  containerRef: RefObject<HTMLElement>,
  enabled: boolean,
  onChange: (blockId: string) => void,
): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) return undefined;
    // happy-dom and the SSR pass have no IntersectionObserver. Degrade to "no linking" rather than
    // throwing on mount.
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const visible = new Set<Element>();
    let last: string | null = null;

    const report = (): void => {
      if (visible.size === 0) return;
      // One ordered walk of the pane. n is ~200 blocks and this runs on intersection change, not
      // per frame; an index map would need invalidating on every DOM change, which is more ways to
      // be wrong for no measurable gain. Indexed, not `for…of`: `apps/web/tsconfig.json` sets no
      // `target`, so `tsc` compiles at ES5 and rejects iterating a NodeList (TS2802).
      const elements = container.querySelectorAll('[data-block-id]');
      for (let index = 0; index < elements.length; index += 1) {
        const element = elements[index];
        if (element === undefined || !visible.has(element)) continue;
        const id = element.getAttribute('data-block-id');
        if (id === null || id === last) return;
        last = id;
        onChangeRef.current(id);
        return;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        report();
      },
      { root: container, rootMargin: '0px 0px -66% 0px', threshold: 0 },
    );

    const observeAll = (): void => {
      container.querySelectorAll('[data-block-id]').forEach((element) => {
        observer.observe(element);
      });
    };
    observeAll();

    // Both panes render asynchronously — pdf.js paints a page when its render task resolves, and
    // Guided's images settle later still. Without this the observer would only ever know about the
    // blocks that existed on mount.
    const mutations =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            observer.disconnect();
            visible.clear();
            observeAll();
          });
    mutations?.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations?.disconnect();
    };
  }, [containerRef, enabled]);
}

/**
 * Scroll `container` so the element carrying `blockId` sits at its top.
 *
 * `scrollIntoView` is deliberately avoided: it walks up to every scrollable ancestor, so in a page
 * that itself scrolls it moves the toolbar out of view as a side effect. Summing `offsetTop` up to
 * the container gives the position within THIS scroller and nothing else.
 */
function scrollBlockToTop(container: HTMLElement, blockId: string): boolean {
  // Block ids are `blk_` + base32, so escaping is belt-and-braces — but a selector built from data
  // is a selector that can be malformed, and `CSS` is absent in some test DOMs.
  const selector =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(blockId) : blockId;
  const target = container.querySelector<HTMLElement>(`[data-block-id="${selector}"]`);
  if (target === null) return false;

  let top = 0;
  let node: HTMLElement | null = target;
  while (node !== null && node !== container) {
    top += node.offsetTop;
    const parent: Element | null = node.offsetParent;
    node = parent instanceof HTMLElement ? parent : null;
    // `offsetParent` is null for `position: fixed` and for hidden elements; give up rather than
    // scroll to a number computed from half a chain.
    if (node === null) break;
  }

  container.scrollTo({ top: Math.max(0, top - 8), behavior: 'auto' });
  return true;
}

export function SplitView({
  source,
  guided,
  onActiveBlockChange,
  linked = true,
  className,
}: SplitViewProps) {
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const guidedRef = useRef<HTMLDivElement | null>(null);
  /** Which pane is currently being driven programmatically. Non-null means "ignore its reports". */
  const syncingRef = useRef<SplitPane | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );

  const drive = useCallback(
    (target: SplitPane, container: HTMLElement | null, blockId: string): void => {
      if (container === null) return;
      syncingRef.current = target;
      const moved = scrollBlockToTop(container, blockId);
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      if (!moved) {
        // The other pane does not render this block — a page number in Source has no Guided
        // counterpart. Release immediately: holding the lock would deafen the pane for no reason.
        syncingRef.current = null;
        return;
      }
      settleTimer.current = setTimeout(() => {
        syncingRef.current = null;
      }, SYNC_SETTLE_MS);
    },
    [],
  );

  const handle = useCallback(
    (pane: SplitPane, blockId: string): void => {
      // The pane we are currently scrolling is echoing our own work back at us. Drop it.
      if (syncingRef.current === pane) return;
      setActiveBlockId(blockId);
      onActiveBlockChange?.(blockId, pane);
      if (!linked) return;
      if (pane === 'source') drive('guided', guidedRef.current, blockId);
      else drive('source', sourceRef.current, blockId);
    },
    [drive, linked, onActiveBlockChange],
  );

  const onSourceTop = useCallback((blockId: string) => handle('source', blockId), [handle]);
  const onGuidedTop = useCallback((blockId: string) => handle('guided', blockId), [handle]);

  useTopmostVisibleBlock(sourceRef, true, onSourceTop);
  useTopmostVisibleBlock(guidedRef, true, onGuidedTop);

  return (
    <div className={`flex h-full min-h-0 w-full ${className ?? ''}`} data-split-root="true">
      <div
        ref={sourceRef}
        data-split-pane="source"
        aria-label="Source"
        role="region"
        className="min-w-0 flex-1 overflow-y-auto border-r border-gray-200 dark:border-gray-800"
        style={{ touchAction: 'pan-y pinch-zoom' }}
      >
        {source}
      </div>
      <div
        ref={guidedRef}
        data-split-pane="guided"
        aria-label="Guided"
        role="region"
        className="min-w-0 flex-1 overflow-y-auto"
        style={{ touchAction: 'pan-y' }}
      >
        {guided}
      </div>
      {/* The link is invisible when it works, which makes it impossible to tell from a bug when it
          does not. One live region, one block id, no geometry. */}
      <span className="sr-only" role="status" aria-live="polite">
        {activeBlockId === null ? '' : `Linked to block ${activeBlockId}`}
      </span>
    </div>
  );
}
