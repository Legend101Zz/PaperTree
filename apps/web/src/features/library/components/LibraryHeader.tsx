/**
 * LibraryHeader: the compact library header (#195, frame 01): the sprout and name, the central
 * search, Add papers, Aa (reading settings: the theme switch) and the account (its initial in a
 * circle; a menu with the email and Sign out). Aa and the account are disclosure popovers: a
 * button with `aria-expanded`, closed by Esc (focus back on the button) or a press outside.
 */
'use client';

import { Button, SproutMark } from '@papertree/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

import { ThemeSwitch, useTheme } from '@/features/settings';

import { AddPapers } from './AddPapers';
import { SearchField, type SearchFieldProps } from './SearchField';

import type { ReactNode, RefObject } from 'react';

/** Props for `HeaderMenu`. */
interface HeaderMenuProps {
  /** The button's accessible name, also the panel's label. */
  readonly label: string;
  /** What the button shows ("Aa", "M"). */
  readonly face: string;
  readonly round?: boolean;
  readonly children: ReactNode;
}

/** A header button that opens a small panel under it. */
function HeaderMenu({ label, face, round = false, children }: HeaderMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = wrapper.current;
    if (!open || node === null) return undefined;
    const outside = (event: PointerEvent): void => {
      if (!node.contains(event.target as Node)) setOpen(false);
    };
    // Esc from the button or anything in the panel closes it and puts focus back on the button.
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    node.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      node.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={wrapper} className="pt-hmenu">
      <button
        ref={button}
        type="button"
        className={`pt-hmenu__button${round ? ' pt-hmenu__button--round' : ''}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">{face}</span>
      </button>
      {open ? (
        <div id={panelId} className="pt-hmenu__panel" role="group" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Props for `LibraryHeader`. */
export interface LibraryHeaderProps {
  readonly search: SearchFieldProps;
  readonly searchRef: RefObject<HTMLInputElement>;
  readonly onFiles: (files: readonly File[]) => void;
  /** The signed-in email, or null while it is not known. */
  readonly email: string | null;
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
  signingOut,
  onSignOut,
}: LibraryHeaderProps): ReactNode {
  const { choice, setChoice } = useTheme();
  // The account's initial; the email is all the account has until a display name is set (#192).
  const initial = (email ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <header className="pt-libhead">
      <Link href="/dashboard" className="pt-libhead__brand">
        <SproutMark size={24} />
        <span>PaperTree</span>
      </Link>
      <SearchField ref={searchRef} {...search} />
      <div className="pt-libhead__actions">
        <AddPapers onFiles={onFiles} />
        <HeaderMenu label="Reading settings" face="Aa">
          <ThemeSwitch value={choice} onChange={setChoice} />
        </HeaderMenu>
        <HeaderMenu label={`Account${email === null ? '' : `: ${email}`}`} face={initial} round>
          <p className="pt-hmenu__email">{email}</p>
          <Button variant="secondary" disabled={signingOut} onClick={onSignOut}>
            {signingOut ? 'Signing out' : 'Sign out'}
          </Button>
        </HeaderMenu>
      </div>
    </header>
  );
}
