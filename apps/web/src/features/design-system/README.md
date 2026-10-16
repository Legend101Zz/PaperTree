# design-system

The `/design-system` developer board (frame 10, issue #191): colour roles with measured contrast, relation
kinds, washes, type and the three voices, space, radius, elevation, motion, and every shared component of
`@papertree/ui` in its states. It is the visual baseline later slices compare against; check a new component on
`/design-system` before it ships.

**Availability.** On in `next dev` and tests. A production build answers 404 unless
`NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM=on` (`model/guard.ts`, enforced in `app/design-system/page.tsx`). The flag is inlined when the app is built, so
it must be set at **build time**; the page is `force-dynamic`, so a production build without it answers a real
HTTP 404 (a prerendered `notFound()` would be served with 200).

## Data flow

Nothing leaves the browser and there is no API call. `@papertree/ui/styles.css` custom properties
→ `hooks/useSchemeColours.ts` (flips `<html data-pt-theme>` for one synchronous pass to read both schemes,
then restores it) → `model/contrast.ts` (WCAG ratio) → tables. Lengths, durations and curves come through
`useTokenText`. Components are the real exports of `@papertree/ui`, never copies of their markup.

## Key files

- `components/DesignSystemBoard.tsx`: the page, with the theme switch from `features/settings`.
- `components/ColourRoles.tsx`, `FurnitureTypeVoices.tsx`, `SpacingMotion.tsx`: the token sections.
- `components/ControlStates.tsx`, `ReaderStates.tsx`: the components in their states.
- `model/roles.ts`: token names to list (no values); `model/contrast.ts`: pure maths; `model/guard.ts`.

## Forced states

Hover and focus are held still with `data-state="hover|focus"` on a `Button` or `TextField` (the stylesheet
answers it like `:hover` and `:focus-visible`). Pressed (`:active`), a marker's real lit echo and SegmentedControl
focus cannot be held still and are not shown. Elevation fills and the lamp-lit stepping show when you switch the
scheme; the colour tables show both schemes at once.
