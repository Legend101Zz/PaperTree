/**
 * /design-system: the developer board of tokens and shared components (#191). On in `next dev`;
 * a production build answers 404 unless NEXT_PUBLIC_PAPERTREE_DESIGN_SYSTEM=on.
 */
import { notFound } from 'next/navigation';

import { DesignSystemBoard, designSystemEnabled } from '@/features/design-system';

import type { ReactNode } from 'react';

/**
 * Rendered per request, not prerendered: a prerendered `notFound()` is served as an HTML file with
 * HTTP 200, and the guard must answer a real 404.
 */
export const dynamic = 'force-dynamic';

/** The page: guard first, then the board. */
export default function DesignSystemPage(): ReactNode {
  if (!designSystemEnabled()) notFound();
  return <DesignSystemBoard />;
}
