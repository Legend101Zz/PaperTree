'use client';

/**
 * The reader's Aa (#345): two settings in one small menu. PAGE is the paper itself, in Source and
 * Guided (Auto follows the room, or Light, Sepia, Dark); ROOM is the app around it (System,
 * Daylight, Lamp-lit: the same switch as the library's Aa). Auto is the default, so a person who
 * only ever picks the room gets the matching page, and a person who wants a dark paper in a bright
 * room picks it here. Both are remembered in this browser, not on the account.
 *
 * On the desktop bar it is the library's popover (a disclosure button; Esc closes it and puts
 * focus back, one level). On the phone it is the body only, inside `ReaderMenu`, which is already
 * a disclosure.
 */
import { PopoverMenu } from '@/features/library/components/PopoverMenu';
import { PageSwitch, ThemeSwitch, useTheme, type PageState } from '@/features/settings';

import type { ReactNode } from 'react';

import './readingSettings.css';

/** Props for `ReadingSettings`. */
export interface ReadingSettingsProps {
  /** The page colour, from `usePage`, which the header mounts so it outlives this menu. */
  readonly page: PageState;
  /** Just the two switches, for a menu that is already open (the phone's). */
  readonly inline?: boolean;
}

/** The two switches, each under a small-caps caption that says what it paints. */
function Settings({ page }: { readonly page: PageState }): ReactNode {
  const theme = useTheme();
  return (
    <>
      <section className="pt-aa__group">
        <p className="pt-aa__cap">
          <span className="pt-aa__name">Page</span> the paper itself
        </p>
        <PageSwitch value={page.choice} onChange={page.setChoice} />
        <p className="pt-aa__hint">Auto: the page follows the room.</p>
      </section>
      <section className="pt-aa__group">
        <p className="pt-aa__cap">
          <span className="pt-aa__name">Room</span> the app around it
        </p>
        <ThemeSwitch value={theme.choice} onChange={theme.setChoice} />
      </section>
    </>
  );
}

/**
 * The reading-settings menu.
 *
 * @example
 * <ReadingSettings page={usePage()} />
 */
export function ReadingSettings({ page, inline = false }: ReadingSettingsProps): ReactNode {
  if (inline) {
    return (
      <div className="pt-aa pt-aa--inline">
        <Settings page={page} />
      </div>
    );
  }
  return (
    <PopoverMenu
      label="Reading settings"
      face="Aa"
      buttonClassName="pt-toolbtn pt-aa__button"
      panelClassName="pt-aa"
    >
      <Settings page={page} />
    </PopoverMenu>
  );
}
