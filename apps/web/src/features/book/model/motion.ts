/**
 * book/model/motion — the pull-out and the opening as Web Animations keyframes (#200, DESIGN.md §6,
 * ADR-004 §2.10: CSS 3D + WAAPI, no library). Pure, so the timings and the reduced path are tested
 * without a browser. The durations mirror the `--pt-dur-*` and `--pt-ease-*` tokens: a script
 * cannot read a custom property's time.
 *
 *   pull out   lift 120 -> turn 200 -> settle 80, the lift curve   reduced: cross-fade in 120
 *   open       the cover swings 480                                 reduced: one 120 cross-fade
 *   put back   the reverse lift, 200                                reduced: fade out 120
 *   read       cross-fade to the reader 120                         (the same both ways)
 */

/** DESIGN.md §6, in ms. */
export const PULL_LIFT_MS = 120;
export const PULL_TURN_MS = 200;
export const PULL_SETTLE_MS = 80;
export const OPEN_MS = 480;
export const PUT_BACK_MS = 200;
export const QUICK_MS = 120;

/** `--pt-ease-lift`. */
export const EASE_LIFT = 'cubic-bezier(0.3, 0, 0.2, 1)';
/** `--pt-ease-out`. */
export const EASE_OUT = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

/** The book's resting pose, turned a little towards the light (frame 02a). */
export const REST = 'perspective(1600px) rotateY(16deg) rotateZ(-1deg)';

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

/**
 * Where the book starts: the spine's box mapped onto the cover's, edge-on.
 *
 * @param spine - The spine's box on the shelf.
 * @param cover - The cover's resting box.
 * @returns The first keyframe's transform.
 */
function fromSpine(spine: Box, cover: Box): string {
  const dx = spine.left + spine.width / 2 - (cover.left + cover.width / 2);
  const dy = spine.top + spine.height / 2 - (cover.top + cover.height / 2);
  const s = cover.height > 0 ? spine.height / cover.height : 1;
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)}) perspective(1600px) rotateY(80deg)`;
}

/**
 * The pull-out: the spine lifts out of the row, turns face-out and settles.
 *
 * @param spine - The spine's box on the shelf, or null when it cannot be measured (lift in place).
 * @param cover - The pulled cover's resting box.
 * @param reduced - `prefers-reduced-motion: reduce`.
 * @returns The cover's animation.
 */
export function pullOut(spine: Box | null, cover: Box, reduced: boolean): Motion {
  if (reduced) {
    return {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      options: { duration: QUICK_MS, easing: 'linear', fill: 'backwards' },
    };
  }
  const total = PULL_LIFT_MS + PULL_TURN_MS + PULL_SETTLE_MS;
  const start = spine === null ? `translateY(24px) ${REST}` : fromSpine(spine, cover);
  return {
    keyframes: [
      { transform: start, offset: 0 },
      { transform: `translateY(-18px) ${start}`, offset: PULL_LIFT_MS / total },
      { transform: `translateY(-8px) ${REST}`, offset: (PULL_LIFT_MS + PULL_TURN_MS) / total },
      { transform: REST, offset: 1 },
    ],
    options: { duration: total, easing: EASE_LIFT, fill: 'backwards' },
  };
}

/**
 * The opening: the cover swings open on its hinge while the spread comes up under it.
 *
 * @param reduced - `prefers-reduced-motion: reduce`.
 * @returns The cover's swing (null under reduced motion: there is no cover to swing) and the
 *   spread's arrival.
 */
export function openBook(reduced: boolean): { cover: Motion | null; spread: Motion } {
  if (reduced) {
    return {
      cover: null,
      spread: {
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        options: { duration: QUICK_MS, easing: 'linear', fill: 'backwards' },
      },
    };
  }
  return {
    cover: {
      keyframes: [
        { transform: REST, opacity: 1 },
        { transform: 'perspective(1600px) rotateY(-150deg)', opacity: 0 },
      ],
      options: { duration: OPEN_MS, easing: EASE_LIFT, fill: 'forwards' },
    },
    spread: {
      keyframes: [
        { opacity: 0, transform: 'scale(0.96)' },
        { opacity: 1, transform: 'none' },
      ],
      options: { duration: OPEN_MS, easing: EASE_LIFT, fill: 'backwards' },
    },
  };
}

/**
 * Putting the book back: it drops towards its slot and fades; the shelf takes it in.
 *
 * @param reduced - `prefers-reduced-motion: reduce`.
 * @returns The book's (or the spread's) leaving.
 */
export function putBack(reduced: boolean): Motion {
  if (reduced) {
    return {
      keyframes: [{ opacity: 1 }, { opacity: 0 }],
      options: { duration: QUICK_MS, easing: 'linear', fill: 'forwards' },
    };
  }
  return {
    keyframes: [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateY(32px) scale(0.92)' },
    ],
    options: { duration: PUT_BACK_MS, easing: EASE_LIFT, fill: 'forwards' },
  };
}

/** Read: the book cross-fades into the reader, both ways. */
export const TO_READER: Motion = {
  keyframes: [{ opacity: 1 }, { opacity: 0 }],
  options: { duration: QUICK_MS, easing: EASE_OUT, fill: 'forwards' },
};
