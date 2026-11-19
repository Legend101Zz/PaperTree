/**
 * PageSwitch: Auto · Light · Sepia · Dark, as a segmented switch, in the reader's Aa menu.
 *
 * Controlled, like `ThemeSwitch`: `usePage` owns persistence and painting.
 */
'use client';

import { SegmentedControl } from '@papertree/ui';

import { PAGE_CHOICES, type PageChoice } from '../model/page';

import type { ReactNode } from 'react';

/** Props for `PageSwitch`. */
export interface PageSwitchProps {
  /** The current choice. */
  readonly value: PageChoice;
  /** Called with the option the person picked. */
  readonly onChange: (next: PageChoice) => void;
}

/**
 * The page-colour switch. `Auto` is the default: the page follows the room.
 *
 * @example
 * const { choice, setChoice } = usePage();
 * <PageSwitch value={choice} onChange={setChoice} />
 */
export function PageSwitch({ value, onChange }: PageSwitchProps): ReactNode {
  return (
    <SegmentedControl<PageChoice>
      label="Page"
      options={PAGE_CHOICES}
      value={value}
      onChange={onChange}
    />
  );
}
