/**
 * The colour scheme: the person's choice (System, Daylight, Lamp-lit) and what it resolves to.
 *
 * Pure, so the rules are unit-tested without a DOM. `useTheme` applies the result to <html> as
 * `data-pt-theme`, which `@papertree/ui/styles.css` and Tailwind's `dark:` variant both read, and
 * `NO_FLASH_SCRIPT` applies the same rule before first paint so a dark reader never sees a white
 * flash on load (#175).
 */

/** What the person picked in Aa. `system` follows the OS (`prefers-color-scheme`). */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** What is painted: daylight (`light`) or the lamp-lit study (`dark`). */
export type ResolvedTheme = 'light' | 'dark';

/** The localStorage key for the choice. Per browser, like the v0.1 reading-mode and zoom keys. */
export const THEME_STORAGE_KEY = 'papertree.theme';

/** The attribute on <html> that the stylesheet reads. */
export const THEME_ATTRIBUTE = 'data-pt-theme';

/** The choices in the order Aa lists them, with their labels from the design. */
export const THEME_CHOICES: readonly { readonly value: ThemeChoice; readonly label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Daylight' },
  { value: 'dark', label: 'Lamp-lit' },
];

/**
 * Reads a stored choice. Anything unknown (an old value, a hand-edited key, null) is `system`.
 *
 * @param raw - The stored string, or null when nothing is stored or storage is unavailable.
 * @returns A valid choice.
 */
export function parseThemeChoice(raw: string | null): ThemeChoice {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/**
 * Resolves a choice against the OS preference.
 *
 * @param choice - The person's choice.
 * @param prefersDark - Whether `(prefers-color-scheme: dark)` currently matches.
 * @returns The scheme to paint.
 */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}

/**
 * The inline script that sets `data-pt-theme` before the first paint. It repeats
 * `parseThemeChoice` + `resolveTheme` in plain ES5 because it runs before any bundle loads. Storage that
 * throws (private mode, blocked site data) still paints from the OS, so the tokens and Tailwind's `dark:`
 * never disagree;
 * `test/theme.spec.tsx` executes it and checks it agrees with the two functions above.
 */
export const NO_FLASH_SCRIPT = `(function(){var c=null;try{c=localStorage.getItem('${THEME_STORAGE_KEY}');}catch(e){}if(c!=='light'&&c!=='dark'){try{c=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}catch(e){c='light';}}document.documentElement.setAttribute('${THEME_ATTRIBUTE}',c);})();`;
