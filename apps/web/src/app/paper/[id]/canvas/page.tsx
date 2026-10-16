// apps/web/src/app/paper/[id]/canvas/page.tsx
/**
 * The v0.1 canvas route, kept so bookmarks and old links still work: it sends the reader on to the
 * paper's board (`/paper/<id>/board`, #214) with the same query string. The board is the one route
 * that draws; this one only redirects (a server component, so it happens before any paint).
 */
import { redirect } from 'next/navigation';

/** What Next hands the route: the paper id and the query string. */
interface CanvasRedirectProps {
  readonly params: { readonly id: string };
  readonly searchParams: Readonly<Record<string, string | readonly string[] | undefined>>;
}

/**
 * Redirects `/paper/<id>/canvas[?…]` to `/paper/<id>/board[?…]`.
 *
 * @returns Never: `redirect` throws Next's redirect signal.
 */
export default function CanvasRedirect({ params, searchParams }: CanvasRedirectProps): never {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const one of typeof value === 'string' ? [value] : (value ?? [])) query.append(key, one);
  }
  const rest = query.toString();
  redirect(`/paper/${encodeURIComponent(params.id)}/board${rest === '' ? '' : `?${rest}`}`);
}
