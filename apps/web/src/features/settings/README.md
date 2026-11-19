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
- `model/page.ts`, `hooks/usePage.ts`, `components/PageSwitch.tsx` (#345): the paper's page, **Auto · Light · Sepia ·
  Dark**. Auto follows the room; an explicit page overrides it. `localStorage["papertree.page"]` → `usePage` (mounted
  by the reader's header) → `<html data-pt-page>`, which the page tokens in `@papertree/ui/styles.css` key on;
  `useResolvedPage` reads it back for components that only need to know (the figure mats). `NO_FLASH_SCRIPT` sets it
  before paint too. Tested in `test/page-colour.spec.tsx`.
