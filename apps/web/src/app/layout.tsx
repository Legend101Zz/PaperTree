import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
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
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: 'PaperTree - Research Paper Reader',
    description: 'Read research papers with AI-powered explanations',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={inter.className}>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}