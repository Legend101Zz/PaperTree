/**
 * The paper's page colour: Light, Sepia or Dark, and "Auto", which follows the app's theme.
 *
 * The page is the paper itself (the PDF in Source, the sheet in Guided), separate from the room
 * around it (`theme.ts`). Owner decision F (#345): by default the page FOLLOWS the room (Daylight
 * gives a light page, Lamp-lit a dark one), and a choice in Aa overrides that. Pure, so the rules
 * are unit-tested without a DOM. The reader's hook applies the result to <html> as `data-pt-page`,
 * which `@papertree/ui/styles.css` reads for the page tokens, and `NO_FLASH_SCRIPT` (theme.ts)
 * applies the same rule before first paint so a dark reader never opens on a white page.
 */
import type { ResolvedTheme } from './theme';

/** What the person picked in Aa. `auto` follows the room. */
export type PageChoice = 'auto' | 'light' | 'sepia' | 'dark';

/** What is painted. */
export type ResolvedPage = 'light' | 'sepia' | 'dark';

/** The localStorage key for the override. Per browser, like the theme: not the API. */
export const PAGE_STORAGE_KEY = 'papertree.page';

/** The attribute on <html> that the stylesheet reads. */
export const PAGE_ATTRIBUTE = 'data-pt-page';

/** The choices in the order Aa lists them. */
export const PAGE_CHOICES: readonly { readonly value: PageChoice; readonly label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Reads a stored choice. Anything unknown (an old value, a hand-edited key, null) is `auto`.
 *
 * @param raw - The stored string, or null when nothing is stored or storage is unavailable.
 * @returns A valid choice.
 */
export function parsePageChoice(raw: string | null): PageChoice {
  return raw === 'light' || raw === 'sepia' || raw === 'dark' || raw === 'auto' ? raw : 'auto';
}

/**
 * Resolves a choice against the room.
 *
 * @param choice - The person's choice.
 * @param theme - The scheme being painted (what `data-pt-theme` says).
 * @returns The page to paint: `auto` is dark in the lamp-lit room and light in daylight.
 */
export function resolvePage(choice: PageChoice, theme: ResolvedTheme): ResolvedPage {
  if (choice === 'auto') return theme === 'dark' ? 'dark' : 'light';
  return choice;
}

/**
 * The part of the inline no-flash script that sets `data-pt-page`. It repeats `parsePageChoice` +
 * `resolvePage` in plain ES5 and reads the variable `c`, which `NO_FLASH_SCRIPT` has just set to
 * the resolved theme. Storage that throws leaves `auto`.
 */
export const PAGE_NO_FLASH_SNIPPET = `var p=null;try{p=localStorage.getItem('${PAGE_STORAGE_KEY}');}catch(e){}if(p!=='light'&&p!=='sepia'&&p!=='dark'){p=c==='dark'?'dark':'light';}document.documentElement.setAttribute('${PAGE_ATTRIBUTE}',p);`;
