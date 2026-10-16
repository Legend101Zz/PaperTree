// apps/web/src/app/paper/[id]/board/layout.tsx
/**
 * The board route's page title ("Board · PaperTree", #214). The page itself is a client component,
 * which cannot export `metadata`, so the title lives on this pass-through layout.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Board · PaperTree' };

/** Renders the board page as it is; it exists for the title above. */
export default function BoardLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}
