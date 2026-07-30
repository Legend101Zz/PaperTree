'use client';

/**
 * reader/ModeSwitch — Source │ Guided │ Split, as a MODE and not a route.
 *
 * §18.3: "A segmented control in the toolbar, not separate routes (today `/read` and `/canvas` are
 * separate pages and the canvas 'go to source' deep link is dead — `canvas/page.tsx:115-123`)."
 *
 * That dead link is the argument. When a view is a ROUTE, "go back to the source region" is a URL
 * that has to encode the region, be parsed on the other side, and survive a full remount — three
 * places to get it wrong, and v1 got it wrong. When a view is a MODE, the document, its scroll
 * position and its resolved anchors are the same objects before and after the switch, so "show me
 * this block in Source" is a state change and not a navigation. Every return path in §18.6 depends
 * on that, which is why this component owns no routing at all: it reports a mode, and the reader
 * page holds it (and persists it per paper, per §18.2's Document row).
 *
 * The keyboard contract, the roving tabindex and the 44px targets come from `SegmentedControl` in
 * `@papertree/ui`, whose own doc comment names ⟨Source│Guided│Split⟩ as the case it was built for.
 * This file is the reader's policy on top of it: which modes exist, and when they are reachable.
 */

import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { SegmentedControl } from '@papertree/ui';

export type ReadingMode = 'source' | 'guided' | 'split';

/**
 * Order is the trust order, and it is deliberate: the paper first, our reading second, both third.
 * A reader who lands on this control and does nothing is looking at the source.
 */
export const READING_MODES: readonly { readonly mode: ReadingMode; readonly label: string }[] = [
  { mode: 'source', label: 'Source' },
  { mode: 'guided', label: 'Guided' },
  { mode: 'split', label: 'Split' },
];

export interface ModeSwitchProps {
  readonly mode: ReadingMode;
  readonly onModeChange: (mode: ReadingMode) => void;
  /**
   * Guided and Split need blocks, and blocks need a parse. §19.8: parsing "only gates
   * Guided/audio/questions" — Source is readable immediately and throughout.
   */
  readonly guidedAvailable?: boolean;
  /** Shown as text when the gate is closed. §19.8 forbids an affordance that is silently inert. */
  readonly unavailableReason?: string;
  readonly className?: string;
}

export function ModeSwitch({
  mode,
  onModeChange,
  guidedAvailable = true,
  unavailableReason,
  className,
}: ModeSwitchProps): ReactNode {
  const options = useMemo(
    () =>
      READING_MODES.map(({ mode: value, label }) => ({
        value,
        label:
          value === 'source' || guidedAvailable ? (
            label
          ) : (
            // KNOWN LIMITATION: `SegmentedOption` has no `disabled` field, so the radio cannot carry
            // `aria-disabled` and a screen reader is told only by the status line below. The right
            // fix is a `disabled` flag on `SegmentedOption` in `@papertree/ui`; reimplementing the
            // whole control here to get one attribute would recreate exactly the duplication §18.1
            // is about. Filed as a note in the epic report rather than worked around silently.
            <span style={{ opacity: 0.45 }}>{label}</span>
          ),
      })),
    [guidedAvailable],
  );

  const change = useCallback(
    (value: ReadingMode): void => {
      // The gate is enforced HERE, not by hiding the option: a mode the reader cannot see is a mode
      // they will never discover exists.
      if (!guidedAvailable && value !== 'source') return;
      onModeChange(value);
    },
    [guidedAvailable, onModeChange],
  );

  return (
    <div className={className}>
      <SegmentedControl<ReadingMode>
        label="Reading mode"
        options={options}
        value={mode}
        onChange={change}
      />
      {guidedAvailable ? null : (
        <p role="status" className="mt-1 text-[11px] leading-4 text-gray-500">
          {unavailableReason ?? 'Guided and Split become available when parsing finishes.'}
        </p>
      )}
    </div>
  );
}
