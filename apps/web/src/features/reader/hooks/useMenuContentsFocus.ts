'use client';

/**
 * Contents chosen from the phone header's menu (#205 review): the menu closes under the press, so
 * focus would fall to `<body>`. It goes into the Contents panel as it opens instead, and back to
 * the menu button when the panel closes.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** The Contents panel's current tab (`components/reader/Navigator`, `Tabs` from `@papertree/ui`). */
const CONTENTS_TAB =
  '[role="tablist"][aria-label="Contents sections"] [role="tab"][aria-selected="true"]';

/**
 * Hands focus into Contents and back for a press that came from the menu.
 *
 * @param open - Whether the Contents panel is open (the workspace's state).
 * @param menuButton - The menu button focus returns to.
 * @returns Call it as Contents is pressed in the menu, before the panel opens.
 */
export function useMenuContentsFocus(
  open: boolean,
  menuButton: RefObject<HTMLButtonElement>,
): () => void {
  const fromMenu = useRef(false);
  useEffect(() => {
    if (!fromMenu.current) return;
    if (open) {
      // The panel mounted in this same commit (the workspace renders it beside the header).
      document.querySelector<HTMLElement>(CONTENTS_TAB)?.focus({ preventScroll: true });
      return;
    }
    fromMenu.current = false;
    menuButton.current?.focus({ preventScroll: true });
  }, [open, menuButton]);
  return useCallback(() => {
    fromMenu.current = true;
  }, []);
}
