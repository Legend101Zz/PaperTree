/**
 * Dive in's pure half (S5e, #210, DESIGN.md §6, frame 11): the page id an answer dives into, the
 * motion plan read from the motion tokens, the FLIP transform that carries a card of the explain
 * panel onto its place on the page, and the one-shot hand-off of the panel's card boxes across
 * the route change. No DOM here: the hooks measure and animate.
 */

/** The API's client-id shape (contracts.md §0). */
const CLIENT_ID = /^[a-z]{2,4}_[0-9A-Za-z-]{8,64}$/;

/**
 * The page an answer dives into: `np_` and the message id's own suffix. Message ids are global
 * keys, so every tab and every second press mints the same page id, and the server's create
 * (idempotent on `page_id`) answers with the page already there instead of seeding another.
 *
 * @param messageId - The assistant answer, e.g. `msg_01M508X9PCVH6CHJJDJEGDTC7V`.
 * @returns The page id, or null when the message id does not have the client-id shape.
 * @example
 * diveInPageId('msg_01M508X9PCVH6CHJJDJEGDTC7V'); // 'np_01M508X9PCVH6CHJJDJEGDTC7V'
 */
export function diveInPageId(messageId: string): string | null {
  const derived = `np_${messageId.slice(messageId.indexOf('_') + 1)}`;
  return CLIENT_ID.test(derived) ? derived : null;
}

/** The two motion tokens Dive in uses, in ms (`--pt-dur-quick`, `--pt-dur-open`). */
export interface MotionTokens {
  readonly quick: number;
  readonly open: number;
}

/** The phases of one Dive in, in ms; a phase that does not run is 0. */
export interface DiveMotion {
  /** The exchange's slips and trace cards lift in the panel (frame 11: 0 → 120). */
  readonly liftMs: number;
  /** The page slides in from the right carrying them (120 → 480). */
  readonly slideMs: number;
  /** Reduced motion: the page replaces the reader with one cross-fade; nothing travels. */
  readonly fadeMs: number;
}

/**
 * The motion plan: lift for `quick`, then slide for the rest of `open` (120 → 360 by the tokens);
 * with reduced motion, one `quick` cross-fade and no travel (DESIGN.md §6).
 *
 * @param tokens - The motion tokens.
 * @param reduced - `prefers-reduced-motion: reduce`.
 * @returns The phase durations.
 */
export function diveMotion(tokens: MotionTokens, reduced: boolean): DiveMotion {
  if (reduced) return { liftMs: 0, slideMs: 0, fadeMs: tokens.quick };
  return { liftMs: tokens.quick, slideMs: Math.max(0, tokens.open - tokens.quick), fadeMs: 0 };
}

/**
 * A CSS duration in ms.
 *
 * @param value - A computed custom property such as ` 120ms` or `0.48s`.
 * @param fallback - Used when the value is empty or not a duration (a stylesheet not loaded).
 * @returns The duration in ms.
 */
export function durationMs(value: string, fallback: number): number {
  const m = /^\s*(\d+(?:\.\d+)?)(ms|s)\s*$/.exec(value);
  if (m === null) return fallback;
  return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
}

/** A screen box in CSS px, as `getBoundingClientRect` gives it. */
export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A card that travels: `call`, `ai`, or `passage-<n>` (trace row n becomes quote card n). */
export interface DiveCard {
  readonly key: string;
  readonly box: ScreenBox;
}

/** One card's flight from the panel to the page. */
export interface DiveFlight {
  readonly key: string;
  readonly from: ScreenBox;
  readonly to: ScreenBox;
}

/**
 * Whether a box shows in the window at all.
 *
 * @param b - The box.
 * @param vw - The window's width.
 * @param vh - The window's height.
 * @returns True when some of it is on screen.
 */
export function onScreen(b: ScreenBox, vw: number, vh: number): boolean {
  return (
    b.width > 0 && b.height > 0 && b.x < vw && b.y < vh && b.x + b.width > 0 && b.y + b.height > 0
  );
}

/**
 * The cards that fly: a panel card and the page card with the same key, both on screen. A card
 * scrolled out of the panel, or below the fold of the page, rides in with the page instead.
 *
 * @param from - The panel's cards, measured before the route changed.
 * @param to - The page's cards, measured where they settle.
 * @param vw - The window's width.
 * @param vh - The window's height.
 * @returns One flight per pair, in the page's order.
 */
export function pairFlights(
  from: readonly DiveCard[],
  to: readonly DiveCard[],
  vw: number,
  vh: number,
): DiveFlight[] {
  const source = new Map(from.filter((c) => onScreen(c.box, vw, vh)).map((c) => [c.key, c.box]));
  return to.flatMap((c) => {
    const box = source.get(c.key);
    return box === undefined || !onScreen(c.box, vw, vh)
      ? []
      : [{ key: c.key, from: box, to: c.box }];
  });
}

/**
 * The first keyframe of one card's FLIP. The card sits inside the page's layer, which is scaled by
 * `scale` and slides in from `slideX` px to the right, so a screen distance is `1 / scale` layer
 * units and the slide is taken back out. Only its place moves: paper is not stretched, so a tall
 * answer in the panel arrives at the page's size (top-left corners are matched), and a quote card's
 * own `rotate` (its tilt) is left alone.
 *
 * @param f - The card's flight.
 * @param slideX - How far right of its place the page starts, in screen px.
 * @param scale - The page layer's scale (screen px per page unit).
 * @returns A `transform` value; the last keyframe is `none`.
 * @example
 * flipTransform({ key: 'ai', from: { x: 900, y: 100, width: 500, height: 600 },
 *   to: { x: 100, y: 300, width: 600, height: 140 } }, 300, 2); // 'translate(250px, -100px)'
 */
export function flipTransform(f: DiveFlight, slideX: number, scale: number): string {
  const s = scale > 0 ? scale : 1;
  const r = (n: number): string => String(Math.round(n * 1000) / 1000);
  return `translate(${r((f.from.x - f.to.x - slideX) / s)}px, ${r((f.from.y - f.to.y) / s)}px)`;
}

/** What a Dive in hands to the page it opens. */
export interface DiveHandoff {
  readonly pageId: string;
  readonly cards: readonly DiveCard[];
  /** When the panel was measured (`Date.now()`). */
  readonly at: number;
}

/** A one-slot hand-off: the panel puts, the page takes once. */
export interface HandoffSlot {
  readonly put: (h: DiveHandoff) => void;
  /** True when a fresh hand-off waits for this page (the page hides until it can slide in). */
  readonly waiting: (pageId: string, now: number) => boolean;
  /** The hand-off for this page, once; null when there is none or it went stale. */
  readonly take: (pageId: string, now: number) => DiveHandoff | null;
}

/**
 * A hand-off slot. A stale hand-off (an old Dive in whose page was never opened) never animates a
 * page opened later from a link.
 *
 * @param ttlMs - How long a hand-off stays fresh.
 * @returns The slot.
 */
export function createHandoffSlot(ttlMs: number): HandoffSlot {
  let held: DiveHandoff | null = null;
  const fresh = (pageId: string, now: number): boolean =>
    held !== null && held.pageId === pageId && now - held.at <= ttlMs;
  return {
    put: (h) => {
      held = h;
    },
    waiting: fresh,
    take: (pageId, now) => {
      const h = fresh(pageId, now) ? held : null;
      if (h !== null) held = null;
      return h;
    },
  };
}
