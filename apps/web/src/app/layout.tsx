import type { Metadata } from 'next';

import './globals.css';
// THE PROVENANCE REGISTER LIVES IN THIS STYLESHEET, and until 2026-08-01 nothing imported it.
//
// `packages/ui/src/styles.css` defines ~200 `pt-*` rules — `pt-derived__marker`, `pt-derived__
// header`, `pt-equation`, `pt-figure`, `pt-table` — and `@papertree/ui`'s package.json even carries
// a note explaining why `sideEffects: ["*.css"]` is spelled that way rather than `false`, so a
// bundler could not drop this import. The import it was protecting did not exist.
//
// The consequence is precisely the failure the epic's hard rules are written to prevent: the `⊙`
// marker and the "our reading" label were in the DOM, and Guided content rendered in the SAME
// visual register as the paper. `reader/provenance.spec` passed throughout, because happy-dom
// asserts class names and DOM order and applies no stylesheet — every assertion was true and the
// product was still wrong. Found by opening the reader in a real browser (issue #42).
import '@papertree/ui/styles.css';
import { NO_FLASH_SCRIPT } from '@/features/settings';

import { FONT_VARIABLES } from './fonts';
import { Providers } from './providers';

// FONTS: the five Ex Libris faces through `next/font/local` (`./fonts.ts`), self-hosted from the
// `@fontsource/*` packages. S0 of the reader release removed `next/font/google` because it downloads
// at build and dev-compile time, so an offline build failed; local files keep that fixed (ADR-004
// §2.2). Each face publishes a `--pt-face-*` variable on <html> that the tokens read.
//
// THE NO-FLASH SCRIPT sets `data-pt-theme` from the stored choice (or the OS) before first paint, so
// a lamp-lit reader never sees a daylight flash; `suppressHydrationWarning` is for that attribute.

export const metadata: Metadata = {
  title: 'PaperTree - Research Paper Reader',
  description: 'Read research papers with AI-powered explanations',
};

/** The root layout: fonts on <html>, the no-flash theme script, and the app's providers. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={FONT_VARIABLES} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
