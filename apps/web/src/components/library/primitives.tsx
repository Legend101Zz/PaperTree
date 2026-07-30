'use client';

/**
 * library/primitives — the activation contract and the three badges every library surface shares.
 *
 * WHY AN ACTIVATION HELPER RATHER THAN `onClick`.
 *
 * The epic's touch rule is "Pointer Events, never onMouseDown/onClick-only". Both halves matter and
 * they pull in opposite directions:
 *
 *   - `onClick` alone is the v1 pattern and it is what makes the current product feel like a
 *     desktop page someone shrank. It also swallows the ~300 ms tap delay story and gives no hook
 *     for pointer type, pressure or cancellation.
 *   - Pointer Events alone BREAK THE KEYBOARD. `pointerup` never fires for Enter or Space on a
 *     `<button>`; the browser synthesises a `click` with `detail === 0` instead. A component that
 *     listens only for `pointerup` is unoperable without a mouse or a finger.
 *
 * So every activation is BOTH, with the click path filtered to `detail === 0` so a pointer tap
 * cannot fire the handler twice. This is the same shape `packages/ui/src/provenance.tsx` uses for
 * its "show source" button; it lives here so the library does not re-derive it eight times.
 *
 * The `data-pt-down` bookkeeping restores something `click` gives for free and `pointerup` does
 * not: a target only activates if the press STARTED on it. Without it, pressing on one card and
 * releasing over another activates the second one — which on a phone, where a scroll gesture ends
 * wherever the finger lands, happens constantly.
 */

import type { CSSProperties, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Headphones, Highlighter, Loader2 } from 'lucide-react';
import { TOUCH_TARGET_MIN_PX, TOUCH_TARGET_STYLE } from '@papertree/ui';
import {
  AUDIO_LABEL,
  PROCESSING_DETAIL,
  PROCESSING_LABEL,
  type AudioState,
  type ProcessingState,
} from './types';

/**
 * The 44px floor comes from `@papertree/ui`, not from a second copy of the number.
 *
 * `packages/ui/src/primitives.tsx` argues the minimum must be an INLINE STYLE because that package
 * sits outside `apps/web/tailwind.config.ts`'s `content` globs and any `min-w-[44px]` written there
 * is purged to nothing. That specific hazard does not apply to this directory — `src/components/**`
 * IS globbed — but the conclusion is worth inheriting anyway: an inline minimum cannot be lost to a
 * stylesheet that failed to load, and it makes `test/touch.spec.tsx` read ONE thing across both
 * packages instead of a class list here and a style object there.
 *
 * So both are used, with different jobs. `TOUCH_TARGET` is the class a designer edits and is what
 * Tailwind sees; `TOUCH_TARGET_STYLE`, applied automatically by `pointerActivate`, is the
 * guarantee.
 */
export const TOUCH_TARGET_PX = TOUCH_TARGET_MIN_PX;

/** Literal on purpose: Tailwind extracts class names by scanning source text, not by evaluating it. */
export const TOUCH_TARGET = 'min-w-[44px] min-h-[44px]';

export interface ActivationProps<E extends HTMLElement> {
  readonly onPointerDown: (event: ReactPointerEvent<E>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<E>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<E>) => void;
  readonly onPointerLeave: (event: ReactPointerEvent<E>) => void;
  readonly onClick: (event: ReactMouseEvent<E>) => void;
  readonly style: CSSProperties;
}

/**
 * Wire a handler to pointer AND keyboard activation.
 *
 * The non-hook twin of `usePress` in `@papertree/ui`, which is private to that package. It has to
 * be a plain function rather than a hook because the library calls it inside `.map()` — one per
 * page thumbnail, one per card — and a hook there breaks the rules of hooks.
 *
 * The pointer id is remembered at `pointerdown` and checked at `pointerup`, and `pointerleave`
 * clears it: a press that began elsewhere and merely ENDED here must not activate. That is what a
 * native `<button>` does and what a bare `onPointerUp` does not, and on a phone — where a scroll
 * gesture ends wherever the thumb lands — the difference is a wrong paper opening several times a
 * session. It is kept in `dataset` rather than a ref because there is one call per rendered item
 * and a ref per item would mean a component per item.
 *
 * `touchAction: 'manipulation'` is set explicitly: it kills the double-tap-zoom delay on the target
 * while leaving pan and pinch alone, which is what a button wants and what a pannable page does not.
 */
export function pointerActivate<E extends HTMLElement>(
  handler: () => void,
  style?: CSSProperties,
): ActivationProps<E> {
  return {
    onPointerDown: (event) => {
      // `button !== 0` is a right- or middle-click; a context menu must not activate anything.
      // Touch and pen report 0 here, so this excludes nothing a finger can do.
      if (event.button !== 0) return;
      event.currentTarget.dataset['ptDown'] = String(event.pointerId);
    },
    onPointerUp: (event) => {
      const armed = event.currentTarget.dataset['ptDown'] === String(event.pointerId);
      delete event.currentTarget.dataset['ptDown'];
      if (armed) handler();
    },
    onPointerCancel: (event) => {
      delete event.currentTarget.dataset['ptDown'];
    },
    onPointerLeave: (event) => {
      delete event.currentTarget.dataset['ptDown'];
    },
    onClick: (event) => {
      // `detail === 0` is the browser's synthetic click from Enter/Space. A real tap or mouse click
      // has already been handled by `onPointerUp` and must not run twice.
      if (event.detail === 0) handler();
    },
    style: { ...TOUCH_TARGET_STYLE, touchAction: 'manipulation', ...style },
  };
}

const PROCESSING_TONE: Record<ProcessingState, string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  parsing: 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  partial: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  complete: 'bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100',
  failed: 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100',
};

export interface ProcessingBadgeProps {
  readonly state: ProcessingState;
  readonly pagesParsed?: number;
  readonly pageCount?: number;
}

/**
 * The processing badge.
 *
 * Non-interactive on purpose — it is a status, not a control, and giving it a tap target would
 * invent a destination that does not exist. The one-line explanation from `PROCESSING_DETAIL` is
 * carried in an `sr-only` span rather than a `title`, because `title` is a hover affordance and
 * there is no such thing as hovering on a phone.
 */
export function ProcessingBadge({ state, pagesParsed, pageCount }: ProcessingBadgeProps) {
  const showCount =
    state === 'parsing' && pagesParsed !== undefined && pageCount !== undefined && pageCount > 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${PROCESSING_TONE[state]}`}
      data-processing-state={state}
    >
      {state === 'parsing' ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
      ) : state === 'pending' ? (
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
      ) : state === 'complete' ? (
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      <span>
        {PROCESSING_LABEL[state]}
        {showCount ? ` ${String(pagesParsed)}/${String(pageCount)}` : ''}
      </span>
      <span className="sr-only">{`. ${PROCESSING_DETAIL[state]}`}</span>
    </span>
  );
}

export function AudioBadge({ state }: { readonly state: AudioState }) {
  if (state === 'none') return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400"
      data-audio-state={state}
    >
      <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{AUDIO_LABEL[state]}</span>
    </span>
  );
}

export function HighlightCountBadge({ count }: { readonly count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
      <Highlighter className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{count === 1 ? '1 highlight' : `${String(count)} highlights`}</span>
    </span>
  );
}

export interface ProgressMeterProps {
  /** 0..1, or omitted for an indeterminate meter. */
  readonly value?: number;
  readonly label: string;
  readonly className?: string;
}

/**
 * A determinate or indeterminate meter.
 *
 * `aria-valuenow` is OMITTED, not set to 0, when progress is unknown — that is the ARIA-sanctioned
 * way to say indeterminate, and a hard 0 tells a screen-reader user that nothing has happened.
 */
export function ProgressMeter({ value, label, className }: ProgressMeterProps) {
  const clamped = value === undefined ? undefined : Math.max(0, Math.min(1, value));
  const pct = clamped === undefined ? undefined : Math.round(clamped * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(pct === undefined ? {} : { 'aria-valuenow': pct, 'aria-valuetext': `${String(pct)}%` })}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700 ${className ?? ''}`}
    >
      <div
        className={`h-full rounded-full bg-blue-600 ${pct === undefined ? 'animate-pulse w-1/3' : ''}`}
        style={pct === undefined ? undefined : { width: `${String(pct)}%` }}
      />
    </div>
  );
}
