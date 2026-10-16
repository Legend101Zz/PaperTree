/**
 * The five faces of the Ex Libris design, one per voice (DESIGN.md §2 "Type"), self-hosted.
 *
 * `next/font/local` over the woff2 files the `@fontsource/*` packages ship (OFL 1.1, pinned by the
 * lockfile), not `next/font/google`: S0 of the reader release removed `next/font/google` because it
 * downloads at build and dev-compile time, so an offline build failed (ADR-004 §2.2). Each face
 * publishes a CSS variable that `@papertree/ui/styles.css` reads (`--pt-font-*`), so components
 * never name a family.
 */
import localFont from 'next/font/local';

// next/font needs literal arguments (its compiler reads them statically), so the paths are spelled out.

/** Libre Caslon Display: headlines at 28 px and up only. */
export const caslonDisplay = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/libre-caslon-display/files/libre-caslon-display-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
  ],
  variable: '--pt-face-display',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
});

/** Libre Caslon Text: the paper's own words (quotes, trace, Guided, index cards). */
export const caslonText = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/libre-caslon-text/files/libre-caslon-text-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/libre-caslon-text/files/libre-caslon-text-latin-400-italic.woff2',
      weight: '400',
      style: 'italic',
    },
    {
      path: '../../node_modules/@fontsource/libre-caslon-text/files/libre-caslon-text-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--pt-face-paper',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
});

/** Alegreya Sans: the AI's words and the interface. */
export const alegreyaSans = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-400-italic.woff2',
      weight: '400',
      style: 'italic',
    },
    {
      path: '../../node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--pt-face-ai',
  display: 'swap',
  fallback: ['Gill Sans', 'Trebuchet MS', 'sans-serif'],
});

/** Alegreya Sans SC: labels, set as real small caps from lowercase source text. */
export const alegreyaSansSc = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/alegreya-sans-sc/files/alegreya-sans-sc-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/alegreya-sans-sc/files/alegreya-sans-sc-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--pt-face-label',
  display: 'swap',
  fallback: ['sans-serif'],
});

/** Courier Prime: the person's own words, numbers and usage lines. */
export const courierPrime = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/courier-prime/files/courier-prime-latin-400-italic.woff2',
      weight: '400',
      style: 'italic',
    },
    {
      path: '../../node_modules/@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--pt-face-you',
  display: 'swap',
  fallback: ['Courier New', 'monospace'],
});

/** Every face's variable class, for `<html className>`. */
export const FONT_VARIABLES = [
  caslonDisplay,
  caslonText,
  alegreyaSans,
  alegreyaSansSc,
  courierPrime,
]
  .map((face) => face.variable)
  .join(' ');
