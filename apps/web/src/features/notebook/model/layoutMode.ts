/**
 * The notebook's three layouts and what each lets a person do (S5e, #210, frames 05, 05b, 08c).
 * Pure: `hooks/useLayoutMode` follows the window, the screen asks `allows` before it draws a tool.
 * The breakpoints are the explain panel's 768 (below it the panel is the phone sheet, so Dive in on
 * a phone lands on the phone notebook) and 1280 (frame 05's side panel needs the room).
 */

/** Phone below 768 px (08c), tablet 768–1279 px (05b at 1180), desktop from 1280 px (05). */
export type LayoutMode = 'phone' | 'tablet' | 'desktop';

/** The narrowest tablet layout, in CSS px. */
export const TABLET_MIN = 768;
/** The narrowest desktop layout, in CSS px. */
export const DESKTOP_MIN = 1280;

/** The media queries `useLayoutMode` listens to. */
export const LAYOUT_QUERIES = {
  tablet: `(min-width: ${String(TABLET_MIN)}px)`,
  desktop: `(min-width: ${String(DESKTOP_MIN)}px)`,
} as const;

/**
 * The layout for a window width.
 *
 * @param width - `window.innerWidth`, in CSS px.
 * @returns The layout mode.
 */
export function layoutModeFor(width: number): LayoutMode {
  if (width >= DESKTOP_MIN) return 'desktop';
  return width >= TABLET_MIN ? 'tablet' : 'phone';
}

/** Everything the notebook's tool bars offer, by name. */
export type NotebookAction =
  'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shapes' | 'text' | 'sticky' | 'templates';

/** What the phone offers without asking (08c): typing, stickies and the highlighter. */
const PHONE: ReadonlySet<NotebookAction> = new Set(['text', 'sticky', 'highlighter']);

/** The phone's honest line about what it leaves out (08c). */
export const PHONE_LEAVES_OUT = 'Lasso, shapes and templates: on a tablet or computer';

/**
 * Whether a layout lets a person use a tool. The tablet and the desktop allow everything; the phone
 * allows typed notes, stickies and the highlighter, the pen only once switched on ("Pen: off" is
 * its opt-in), and never the eraser, lasso, shapes or templates: its ink is view only.
 *
 * @param mode - The layout.
 * @param action - The tool or control.
 * @param penOn - Whether the phone's pen has been switched on.
 * @returns True when the control may be shown and used.
 * @example
 * allows('phone', 'pen', false); // false
 * allows('phone', 'pen', true); // true
 * allows('phone', 'eraser', true); // false
 */
export function allows(mode: LayoutMode, action: NotebookAction, penOn: boolean): boolean {
  if (mode !== 'phone') return true;
  return PHONE.has(action) || (action === 'pen' && penOn);
}
