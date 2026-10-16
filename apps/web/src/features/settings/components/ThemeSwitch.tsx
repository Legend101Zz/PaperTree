/**
 * ThemeSwitch: System · Daylight · Lamp-lit, as a segmented switch (DESIGN.md §3 item 12).
 *
 * Lives in the reading-settings menu (Aa). It renders the choice it is given and reports changes;
 * `useTheme` owns persistence and painting, so the switch stays a plain controlled control.
 */
'use client';

import { SegmentedControl } from '@papertree/ui';

import { THEME_CHOICES, type ThemeChoice } from '../model/theme';

import type { ReactNode } from 'react';


/** Props for `ThemeSwitch`. */
export interface ThemeSwitchProps {
  /** The current choice. */
  readonly value: ThemeChoice;
  /** Called with the option the person picked. */
  readonly onChange: (next: ThemeChoice) => void;
}

/**
 * The colour-scheme switch.
 *
 * @example
 * const { choice, setChoice } = useTheme();
 * <ThemeSwitch value={choice} onChange={setChoice} />
 */
export function ThemeSwitch({ value, onChange }: ThemeSwitchProps): ReactNode {
  return (
    <SegmentedControl<ThemeChoice>
      label="Colour scheme"
      options={THEME_CHOICES}
      value={value}
      onChange={onChange}
    />
  );
}
