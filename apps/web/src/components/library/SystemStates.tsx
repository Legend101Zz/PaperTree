'use client';

/**
 * library/SystemStates — every state in §19.8, designed rather than improvised.
 *
 * "Every state below is a designed screen, not an afterthought — the current product has none of
 * them." What the current product has instead is a `<Loader2 className="animate-spin" />` for every
 * one of these situations, which is why a failed parse, a queued parse and a partial parse are
 * indistinguishable to a user today.
 *
 * ONE RULE RUNS THROUGH ALL SIX AND IT IS THE ONLY ONE THAT MATTERS:
 *
 *     THE PAPER IS READABLE IN SOURCE MODE THE MOMENT IT IS UPLOADED.
 *
 * Parsing gates GUIDED MODE and QUESTIONS — our readings of the paper. It does not gate the
 * paper. Every state below therefore keeps a live path into Source mode, including `FailureState`:
 * the PDF arrived, the bytes are on disk, and the only thing that broke was our interpretation of
 * them. A "Processing…" screen that blocks reading would be the product telling a user their own
 * document is unavailable because our parser is slow.
 *
 * NOTHING HERE IS DERIVED CONTENT. These are statements about the SYSTEM, not readings of the
 * paper, so none of them goes through `DerivedBlock` and none carries the reserved marker. The one
 * place a page's own pixels appear — `UncertaintyState`'s crop — is source, shown as source.
 */

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Flag, RotateCcw, WifiOff } from 'lucide-react';
import { TOUCH_TARGET, pointerActivate } from './primitives';

export interface GatedAction {
  readonly id: string;
  readonly label: string;
}

const DEFAULT_GATED_ACTIONS: readonly GatedAction[] = [
  { id: 'guided', label: 'Guided mode' },
  { id: 'questions', label: 'Questions' },
];

/**
 * An action that is off, and says why.
 *
 * `aria-disabled` rather than `disabled`. A `disabled` button leaves the tab order entirely, so a
 * keyboard or screen-reader user never encounters it and never hears the reason — they just find
 * three fewer controls than the person next to them and conclude the feature does not exist. This
 * is the WCAG 2.2 guidance and it is the difference between "visibly disabled with the reason" and
 * "silently broken", which is exactly the distinction §19.8 draws for the offline state.
 */
function GatedActionButton({
  action,
  reasonId,
}: {
  readonly action: GatedAction;
  readonly reasonId: string;
}) {
  return (
    <button
      type="button"
      aria-disabled="true"
      aria-describedby={reasonId}
      data-gated="true"
      className={`${TOUCH_TARGET} inline-flex items-center justify-center rounded-lg border border-gray-300 px-3 text-sm text-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-gray-600 dark:text-gray-400`}
      {...pointerActivate<HTMLButtonElement>(() => {
        // Intentionally inert. The reason is already on screen and wired through
        // `aria-describedby`; firing something here would be the "silently broken" failure mode in
        // reverse — a control that looks off but does something.
      })}
    >
      {action.label}
    </button>
  );
}

/* ──────────────────────────── Uncertainty ──────────────────────────── */

export interface UncertaintyStateProps {
  readonly blockId: string;
  /** 0-indexed. Displayed 1-indexed, like every page number a reader sees. */
  readonly pageIndex: number;
  /** `Block.confidence`, 0..1. Shown as a percentage, not a word — "low" is not actionable. */
  readonly confidence: number;
  /** The page's own pixels for this region. THIS IS THE PAPER; it is what settles the question. */
  readonly cropSrc: string;
  readonly cropAlt: string;
  readonly onReport: (blockId: string) => void;
  /** The block's text, rendered normally. It stays selectable — see below. */
  readonly children: ReactNode;
}

/**
 * A low-confidence region: dotted underline, and a tap that shows the crop.
 *
 * DELIBERATE DEVIATION FROM "TAPPING THE BLOCK SHOWS…". The obvious implementation makes the block
 * itself the button. That breaks the reader's primary gesture: you cannot reliably select text
 * inside a `<button>`, and selecting text is how a highlight gets made. A block-level button would
 * trade the epic's core interaction for a diagnostic one.
 *
 * So the block stays inert and selectable, and a real 44×44 button sits beside it. It is a
 * `aria-expanded` disclosure, so it announces its own state, and the panel it opens is adjacent in
 * the DOM rather than a floating tooltip — tooltips are hover artefacts and there is no hover on a
 * phone.
 */
export function UncertaintyState({
  blockId,
  pageIndex,
  confidence,
  cropSrc,
  cropAlt,
  onReport,
  children,
}: UncertaintyStateProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);

  return (
    <div data-state="uncertainty" data-block-id={blockId} className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div
          data-uncertain="true"
          className="min-w-0 flex-1 [text-decoration-line:underline] [text-decoration-style:dotted] [text-underline-offset:3px] decoration-amber-500"
        >
          {children}
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`We're unsure of this region on page ${String(pageIndex + 1)}`}
          className={`${TOUCH_TARGET} inline-flex shrink-0 items-center justify-center rounded-md border border-amber-400 text-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:text-amber-200`}
          {...pointerActivate<HTMLButtonElement>(() => {
            setOpen((prev) => !prev);
          })}
        >
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div
        id={panelId}
        hidden={!open}
        className="rounded-lg border border-amber-300 p-3 dark:border-amber-800"
      >
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
          We&rsquo;re unsure of this region
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Page {pageIndex + 1} · we are {pct}% confident we read this correctly.
        </p>
        {/* The crop is the evidence, and it is the paper. No transcription, no marker, no register:
            showing our reading here would beg the exact question the panel is asking. */}
        <img
          src={cropSrc}
          alt={cropAlt}
          className="mt-2 max-w-full rounded border border-gray-200 dark:border-gray-700"
        />
        <button
          type="button"
          className={`${TOUCH_TARGET} mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-amber-400 px-3 text-sm text-amber-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:text-amber-100`}
          {...pointerActivate<HTMLButtonElement>(() => {
            onReport(blockId);
          })}
        >
          <Flag className="h-4 w-4" aria-hidden="true" />
          Report this region
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────── Failure ────────────────────────────── */

export interface FailureStateProps {
  /** The step that failed. Retry resumes FROM it. */
  readonly failedStep: string;
  /** Steps already banked. Named, because "we kept your work" is only credible if it is specific. */
  readonly completedSteps: readonly string[];
  readonly remainingSteps?: readonly string[];
  /** Operator-facing detail, if any. Rendered verbatim, like `partial_reason`. */
  readonly detail?: string;
  readonly onRetryFrom: (step: string) => void;
  /** Source mode still works. It always does. */
  readonly onOpenSource?: () => void;
}

/**
 * A failed step, with a retry that RESUMES.
 *
 * The label names the step, and the completed steps are listed above it, because "Retry" on its own
 * is read as "start the four minutes again" — and a user who believes that will not press it. The
 * resume semantics have to be visible in the button, not documented in a changelog.
 */
export function FailureState({
  failedStep,
  completedSteps,
  remainingSteps,
  detail,
  onRetryFrom,
  onOpenSource,
}: FailureStateProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-state="failed"
      className="flex flex-col gap-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950"
    >
      <p
        id={headingId}
        className="flex items-center gap-2 text-sm font-medium text-red-900 dark:text-red-100"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Stopped at: {failedStep}
      </p>

      {detail === undefined ? null : (
        <p className="text-sm text-red-900 dark:text-red-100" data-testid="failure-detail">
          {detail}
        </p>
      )}

      <ol className="list-none space-y-1 text-xs" data-testid="failure-steps">
        {completedSteps.map((step) => (
          <li key={step} className="flex items-center gap-2 text-green-800 dark:text-green-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{step}</span>
            <span className="sr-only">— done, and kept</span>
          </li>
        ))}
        <li className="flex items-center gap-2 font-medium text-red-800 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{failedStep}</span>
          <span className="sr-only">— failed</span>
        </li>
        {(remainingSteps ?? []).map((step) => (
          <li key={step} className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
            <span aria-hidden="true" className="inline-block h-3.5 w-3.5" />
            <span>{step}</span>
            <span className="sr-only">— not started</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${TOUCH_TARGET} inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700`}
          {...pointerActivate<HTMLButtonElement>(() => {
            onRetryFrom(failedStep);
          })}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Retry from {failedStep}
        </button>
        {onOpenSource === undefined ? null : (
          <button
            type="button"
            className={`${TOUCH_TARGET} inline-flex items-center justify-center rounded-lg border border-red-300 px-4 text-sm text-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 dark:border-red-800 dark:text-red-100`}
            {...pointerActivate<HTMLButtonElement>(() => {
              onOpenSource();
            })}
          >
            Read in Source mode
          </button>
        )}
      </div>

      <p className="text-xs text-red-800 dark:text-red-200">
        {completedSteps.length === 0
          ? 'Nothing finished before this, so retrying starts at the beginning.'
          : `${String(completedSteps.length)} earlier step${completedSteps.length === 1 ? '' : 's'} finished and will not be redone.`}
      </p>
    </section>
  );
}

/* ────────────────────────────── Offline ────────────────────────────── */

export interface OfflineStateProps {
  /** Why the AI actions are off. Shown, not swallowed. */
  readonly reason?: string;
  readonly disabledActions?: readonly GatedAction[];
  /** What still works offline: what is already on this device. */
  readonly availableSummary?: string;
  readonly onRetryConnection?: () => void;
}

/**
 * Offline.
 *
 * §19.8 asks for one specific thing and it is not a banner: "AI actions are visibly disabled with
 * the reason, not silently broken." The failure mode being ruled out is the one where the button
 * still looks pressable, the request fails, and the user concludes the feature is broken rather
 * than that they are on a train. So the actions render here, disabled, next to the reason —
 * rather than being removed, which would be the same silence by a different route.
 */
export function OfflineState({
  reason = 'You are offline. Answers need the network.',
  disabledActions = DEFAULT_GATED_ACTIONS,
  availableSummary = 'Papers already open on this device still work. Uploading and questions need the network.',
  onRetryConnection,
}: OfflineStateProps) {
  const reasonId = useId();
  const headingId = useId();

  return (
    <section
      role="status"
      aria-labelledby={headingId}
      data-state="offline"
      className="pt-s3-alert pt-s3-alert--warn flex flex-col gap-3"
    >
      <p id={headingId} className="flex items-center gap-2 text-sm font-medium">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        Offline
      </p>
      <p id={reasonId} className="text-sm text-gray-700 dark:text-gray-300">
        {reason}
      </p>
      <p className="text-sm text-gray-700 dark:text-gray-300">{availableSummary}</p>

      <div className="flex flex-wrap gap-2">
        {disabledActions.map((action) => (
          <GatedActionButton key={action.id} action={action} reasonId={reasonId} />
        ))}
        {onRetryConnection === undefined ? null : (
          <button
            type="button"
            className={`${TOUCH_TARGET} inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 text-sm text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-gray-600 dark:text-white`}
            {...pointerActivate<HTMLButtonElement>(() => {
              onRetryConnection();
            })}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    </section>
  );
}
