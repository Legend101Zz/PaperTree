# settings

Per-browser reading settings. Today that is the colour scheme: **System** (follow the OS), **Daylight** or
**Lamp-lit** (DESIGN.md §2). The switch belongs in the reading-settings menu (Aa) in the header.

## Data flow

`ThemeSwitch` (UI) → `useTheme` (`localStorage["papertree.theme"]`) → `<html data-pt-theme="light|dark">` →
`@papertree/ui/styles.css` (the token blocks) and Tailwind's `dark:` variant. Nothing goes to the API: the
choice is per browser, like the reader's zoom and mode.

Before any bundle runs, `NO_FLASH_SCRIPT` (inlined in `app/layout.tsx`) applies the same rule, so a lamp-lit
reader never sees a daylight flash on load. Without JavaScript the stylesheet still follows
`prefers-color-scheme`.

## Key files

- `model/theme.ts`: the choices, `parseThemeChoice`, `resolveTheme`, `NO_FLASH_SCRIPT` (pure; tested in
  `test/theme.spec.tsx`).
- `hooks/useTheme.ts`: persistence, the OS listener for System, and painting `<html>`.
- `components/ThemeSwitch.tsx`: the segmented switch.
