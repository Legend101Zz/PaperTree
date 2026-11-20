/**
 * book/model/motion — taking a book off the shelf and opening it, as Web Animations keyframes
 * (v0.3 R4 prototype, DESIGN.md §6, ADR-004 §2.10: CSS 3D + WAAPI, no library). Pure, so the
 * timings and the reduced path are tested without a browser. The durations mirror the `--pt-dur-*`
 * and `--pt-ease-*` tokens: a script cannot read a custom property's time.
 *
 * One click, one sequence of 880 ms (the five phases the owner approved):
 *
 *   slide out        120   the spine lifts out of its row
 *   turn             160   it turns to face you
 *   travel and grow  220   it flies to the middle of the screen, growing to page size
 *   cover swings     280   the cover opens on its hinge, the spread appears under it
 *   settle           100   the opened book comes to rest
 *
 *   put back         420   the reverse, quicker: the cover closes, the book flies to its slot
 *   reduced motion   120   one cross-fade each way, nothing moves
 *   read             120   the book cross-fades into the reader
 */

/** The five phases, in ms. */
export const SLIDE_MS = 120;
export const TURN_MS = 160;
export const TRAVEL_MS = 220;
export const SWING_MS = 280;
export const SETTLE_MS = 100;
/** Their sum: the whole take-out-and-open. */
export const TAKE_OUT_MS = SLIDE_MS + TURN_MS + TRAVEL_MS + SWING_MS + SETTLE_MS;
/** The reverse, which is quicker: nobody waits to put a book away. */
export const PUT_BACK_MS = 420;
export const QUICK_MS = 120;

/** `--pt-ease-lift` and `--pt-ease-out`. */
export const EASE_LIFT = 'cubic-bezier(0.3, 0, 0.2, 1)';
export const EASE_OUT = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

/** How far the spine lifts before it turns, and how much it grows doing so (px, factor). */
const LIFT_PX = 22;
const LIFT_SCALE = 1.04;
/** The depth the turn and the swing are drawn at. */
const PERSPECTIVE = 'perspective(2600px)';

/** A rectangle, as `getBoundingClientRect` gives it. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** One animation to run: its keyframes and timing. */
export interface Motion {
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;
}

/** What moves when a book comes off the shelf or goes back: each is its own element. */
export interface BookMotion {
  /** The spine's cloth, lifting and turning away (null when nothing flies). */
  readonly slab: Motion | null;
  /** The cover, flying to the page and swinging open (null when nothing flies). */
  readonly cover: Motion | null;
  /** The two pages, appearing under the cover. */
  readonly spread: Motion;
  /** The veil over the library. */
  readonly veil: Motion;
}

/** The phase boundaries as fractions of the whole, for the take-out. */
const OUT = {
  slide: SLIDE_MS / TAKE_OUT_MS,
  turn: (SLIDE_MS + TURN_MS) / TAKE_OUT_MS,
  travel: (SLIDE_MS + TURN_MS + TRAVEL_MS) / TAKE_OUT_MS,
  swing: (SLIDE_MS + TURN_MS + TRAVEL_MS + SWING_MS) / TAKE_OUT_MS,
} as const;

/** The put-back's boundaries as fractions of its 420 ms: close 180, fly 185, turn away 55. */
const BACK = { closed: 180 / PUT_BACK_MS, flown: 365 / PUT_BACK_MS } as const;

/**
 * Where the spine is, as the cover's start: the spine's centre mapped onto the cover's hinge edge
 * (the cover turns about its left edge), at the spine's height.
 *
 * @param spine - The spine's box on the shelf.
 * @param page - The cover's resting box (the right page).
 * @returns The `translate() scale()` that puts the cover's left edge on the spine.
 */
function atSpine(spine: Box, page: Box): string {
  const dx = spine.left + spine.width / 2 - page.left;
  const dy = spine.top + spine.height / 2 - (page.top + page.height / 2);
  const s = page.height > 0 ? spine.height / page.height : 1;
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)})`;
}

/**
 * A cover pose. Every keyframe has this one shape, so the browser interpolates each part.
 *
 * @param place - The `translate() scale()` that puts the cover somewhere.
 * @param turn - How far it is turned about its hinge, in degrees (0 faces you).
 * @returns The `transform` value.
 */
function pose(place: string, turn: number): string {
  return `${place} ${PERSPECTIVE} rotateY(${String(turn)}deg)`;
}

/**
 * The cross-fade of reduced motion, and of a book whose spine cannot be measured.
 *
 * @param reverse - Fade out (putting the book back) rather than in.
 * @returns The spread and the veil fading; nothing flies.
 */
function crossFade(reverse: boolean): BookMotion {
  const keyframes: Keyframe[] = reverse
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [{ opacity: 0 }, { opacity: 1 }];
  const options: KeyframeAnimationOptions = {
    duration: QUICK_MS,
    easing: 'linear',
    fill: reverse ? 'forwards' : 'backwards',
  };
  return { slab: null, cover: null, spread: { keyframes, options }, veil: { keyframes, options } };
}

/**
 * The take-out-and-open: slide out 120, turn 160, travel and grow 220, cover swings 280, settle
 * 100. The spread is hidden until the cover is across it, so the book opens to what is under it.
 *
 * @param spine - The spine's box on the shelf, or null when it cannot be measured (cross-fade).
 * @param page - The right page's resting box, where the cover lands.
 * @param reduced - `prefers-reduced-motion: reduce`.
 * @returns The motion of each part.
 */
export function takeOut(spine: Box | null, page: Box, reduced: boolean): BookMotion {
  if (reduced || spine === null) return crossFade(false);
  const start = atSpine(spine, page);
  const options = { duration: TAKE_OUT_MS, easing: 'linear', fill: 'both' } as const;
  const lifted = `translateY(-${String(LIFT_PX)}px) scale(${String(LIFT_SCALE)})`;
  return {
    slab: {
      keyframes: [
        { transform: 'none', opacity: 1, offset: 0, easing: EASE_LIFT },
        { transform: lifted, opacity: 1, offset: OUT.slide, easing: EASE_LIFT },
        { transform: `${lifted} ${PERSPECTIVE} rotateY(-90deg)`, opacity: 1, offset: OUT.turn },
        { transform: `${lifted} ${PERSPECTIVE} rotateY(-90deg)`, opacity: 0, offset: OUT.turn },
        { transform: `${lifted} ${PERSPECTIVE} rotateY(-90deg)`, opacity: 0, offset: 1 },
      ],
      options,
    },
    cover: {
      keyframes: [
        { transform: pose(start, 90), offset: 0 },
        { transform: pose(start, 90), offset: OUT.slide, easing: EASE_LIFT },
        { transform: pose(start, 0), offset: OUT.turn, easing: EASE_OUT },
        {
          transform: pose('translate(0px, 0px) scale(1)', 0),
          offset: OUT.travel,
          easing: EASE_LIFT,
        },
        { transform: pose('translate(0px, 0px) scale(1)', -180), offset: OUT.swing },
        { transform: pose('translate(0px, 0px) scale(1)', -180), offset: 1 },
      ],
      options,
    },
    spread: {
      keyframes: [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: OUT.travel },
        { opacity: 1, offset: OUT.travel + (OUT.swing - OUT.travel) * 0.5 },
        { opacity: 1, offset: 1 },
      ],
      options,
    },
    veil: {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      options: { duration: SLIDE_MS + TURN_MS, easing: 'linear', fill: 'backwards' },
    },
  };
}

/**
 * Putting the book back, in 420 ms: the cover closes, the book flies to its slot and turns edge-on,
 * and the spine takes its place. Esc, a click outside and "Put it back" all run this.
 *
 * @param spine - The spine's box on the shelf, or null when it cannot be measured (cross-fade).
 * @param page - The right page's resting box, where the cover starts.
 * @param reduced - `prefers-reduced-motion: reduce`.
 * @returns The motion of each part.
 */
export function putBack(spine: Box | null, page: Box, reduced: boolean): BookMotion {
  if (reduced || spine === null) return crossFade(true);
  const end = atSpine(spine, page);
  const options = { duration: PUT_BACK_MS, easing: 'linear', fill: 'forwards' } as const;
  const home = 'translate(0px, 0px) scale(1)';
  return {
    slab: {
      keyframes: [
        { opacity: 0, transform: 'none', offset: 0 },
        { opacity: 0, transform: 'none', offset: BACK.flown },
        { opacity: 1, transform: 'none', offset: 1 },
      ],
      options,
    },
    cover: {
      keyframes: [
        { transform: pose(home, -180), offset: 0, easing: EASE_LIFT },
        { transform: pose(home, 0), offset: BACK.closed, easing: EASE_LIFT },
        { transform: pose(end, 0), offset: BACK.flown, easing: EASE_LIFT },
        { transform: pose(end, 90), offset: 1 },
      ],
      options,
    },
    spread: {
      keyframes: [
        { opacity: 1, offset: 0 },
        { opacity: 0, offset: BACK.closed },
        { opacity: 0, offset: 1 },
      ],
      options,
    },
    veil: { keyframes: [{ opacity: 1 }, { opacity: 0 }], options },
  };
}

/** Read: the book cross-fades into the reader, both ways. */
export const TO_READER: Motion = {
  keyframes: [{ opacity: 1 }, { opacity: 0 }],
  options: { duration: QUICK_MS, easing: EASE_OUT, fill: 'forwards' },
};
