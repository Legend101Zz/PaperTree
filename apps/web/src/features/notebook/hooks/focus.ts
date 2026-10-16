/**
 * Moves the keyboard to a notebook item once it is on screen (S5c, #208): its own control (a
 * note's or shape's face, a card's first button), or the page title when there is no item, so focus
 * never falls back to `<body>`.
 */

/** The page title's id: the place focus goes when the page has nothing else to offer. */
export const PAGE_TITLE_ID = 'pt-nb-page-title';

/**
 * Focuses an item's control on the next frame (after React has drawn it).
 *
 * @param id - The item, or null for the page title.
 */
export function focusItem(id: string | null): void {
  requestAnimationFrame(() => {
    const holder =
      id === null
        ? undefined
        : [...document.querySelectorAll<HTMLElement>('[data-item-id]')].find(
            (el) => el.dataset['itemId'] === id,
          );
    const control = holder?.querySelector<HTMLElement>('[role="button"], button, a[href]');
    (control ?? document.getElementById(PAGE_TITLE_ID))?.focus();
  });
}
