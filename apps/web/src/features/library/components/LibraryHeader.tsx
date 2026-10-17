/**
 * LibraryHeader: the compact library header (#195, frame 01): the sprout and name, the central
 * search, Add papers, Aa (reading settings: the theme switch) and the account (its initial in a
 * circle, from the name the person gave their library once there is one, else the email; a menu
 * with the email and Sign out). Aa and the account are disclosure popovers: a
 * button with `aria-expanded`, closed by Esc (focus back on the button) or a press outside.
 */
'use client';

import { Button, SproutMark } from '@papertree/ui';
import Link from 'next/link';

import { TOUCH_TARGET } from '@/components/library/primitives';
import { ThemeSwitch, useTheme } from '@/features/settings';

import { useTouchTargets } from '../hooks/useTouchTargets';
import { AddPapers } from './AddPapers';
import { PopoverMenu } from './PopoverMenu';
import { SearchField, type SearchFieldProps } from './SearchField';

import type { ReactNode, RefObject } from 'react';

/** Props for `HeaderMenu`. */
interface HeaderMenuProps {
  /** The button's accessible name, also the panel's label. */
  readonly label: string;
  /** What the button shows ("Aa", "M"). */
  readonly face: string;
  readonly round?: boolean;
  /** 44 px on touch (useTouchTargets). */
  readonly touch: boolean;
  readonly children: ReactNode;
}

/** A header button that opens a small panel under it. */
function HeaderMenu({ label, face, round = false, touch, children }: HeaderMenuProps): ReactNode {
  const classes = [
    'pt-hmenu__button',
    round ? 'pt-hmenu__button--round' : '',
    touch ? TOUCH_TARGET : '',
  ];
  return (
    <PopoverMenu label={label} face={face} buttonClassName={classes.filter(Boolean).join(' ')}>
      {children}
    </PopoverMenu>
  );
}

/** Props for `LibraryHeader`. */
export interface LibraryHeaderProps {
  readonly search: SearchFieldProps;
  readonly searchRef: RefObject<HTMLInputElement>;
  readonly onFiles: (files: readonly File[]) => void;
  /** The signed-in email, or null while it is not known. */
  readonly email: string | null;
  /** The name the person gave their library (`display_name`, #200), or null/absent. */
  readonly name?: string | null;
  readonly signingOut: boolean;
  readonly onSignOut: () => void;
}

/**
 * The header.
 *
 * @example
 * <LibraryHeader search={…} searchRef={ref} onFiles={queue.enqueue} email="a@b" signingOut={false} onSignOut={out} />
 */
export function LibraryHeader({
  search,
  searchRef,
  onFiles,
  email,
  name = null,
  signingOut,
  onSignOut,
}: LibraryHeaderProps): ReactNode {
  const { choice, setChoice } = useTheme();
  const touch = useTouchTargets();
  // The account's initial: the library's name once the person gave one (the bookplate's
  // `PATCH /auth/me`, #200), else the email's first letter. Never a name made up from the email.
  const named = (name ?? '').trim();
  const initial = (named || (email ?? '?')).trim().charAt(0).toUpperCase() || '?';
  return (
    <header className="pt-libhead">
      <Link
        href="/dashboard"
        className={['pt-libhead__brand', touch ? TOUCH_TARGET : ''].filter(Boolean).join(' ')}
      >
        <SproutMark size={24} />
        <span>PaperTree</span>
      </Link>
      <SearchField ref={searchRef} {...search} />
      <div className="pt-libhead__actions">
        <AddPapers onFiles={onFiles} />
        <HeaderMenu label="Reading settings" face="Aa" touch={touch}>
          <ThemeSwitch value={choice} onChange={setChoice} />
        </HeaderMenu>
        <HeaderMenu
          label={`Account${email === null ? '' : `: ${email}`}`}
          face={initial}
          round
          touch={touch}
        >
          <p className="pt-hmenu__email">{email}</p>
          <Button
            variant="secondary"
            size={touch ? 'touch' : 'md'}
            className={touch ? TOUCH_TARGET : undefined}
            disabled={signingOut}
            onClick={onSignOut}
          >
            {signingOut ? 'Signing out' : 'Sign out'}
          </Button>
        </HeaderMenu>
      </div>
    </header>
  );
}
