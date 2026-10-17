/**
 * PopoverMenu: a button that opens a small panel under it (#195, #197): the header's Aa and account
 * menus, the Table's Columns and Filter. A plain `<button>`, because `Button` does not forward a ref
 * and Esc must put focus back on it; `usePopover` holds the closing rules.
 */
'use client';

import { usePopover } from '../hooks/usePopover';

import type { CSSProperties, ReactNode } from 'react';

/** Props for `PopoverMenu`. */
export interface PopoverMenuProps {
  /** The panel's name, and the button's unless `worded`. */
  readonly label: string;
  /** What the button shows: a face ("Aa", "M"), or its name in words with `worded`. */
  readonly face: ReactNode;
  /** The face is the button's name in words ("Columns"), so it is read, not hidden. */
  readonly worded?: boolean;
  readonly buttonClassName: string;
  readonly buttonStyle?: CSSProperties;
  /** Added to `pt-hmenu__panel`. */
  readonly panelClassName?: string;
  readonly children: ReactNode;
}

/**
 * A disclosure button and its panel.
 *
 * @example
 * <PopoverMenu label="Reading settings" face="Aa" buttonClassName="pt-hmenu__button"><ThemeSwitch /></PopoverMenu>
 */
export function PopoverMenu({
  label,
  face,
  worded = false,
  buttonClassName,
  buttonStyle,
  panelClassName,
  children,
}: PopoverMenuProps): ReactNode {
  const { open, toggle, wrapper, button, panelId } = usePopover();
  return (
    <div ref={wrapper} className="pt-hmenu">
      <button
        ref={button}
        type="button"
        className={buttonClassName}
        style={buttonStyle}
        aria-label={worded ? undefined : label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        {worded ? face : <span aria-hidden="true">{face}</span>}
      </button>
      {open ? (
        <div
          id={panelId}
          className={
            panelClassName === undefined ? 'pt-hmenu__panel' : `pt-hmenu__panel ${panelClassName}`
          }
          role="group"
          aria-label={label}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
