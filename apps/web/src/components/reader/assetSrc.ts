/**
 * reader/assetSrc — what an `<img src>` may be given, and nothing else.
 *
 * THREE KINDS OF `image.uri` REACH THE READER, and only two of them can be loaded:
 *
 *   `fixture://<slug>/<path>`  a committed fixture's crop, served from `/fixtures/<slug>/<path>`;
 *   `https://…` / `http://…`   what `/ir` sends once S1 rewrites crops to signed URLs (§2.3);
 *   `asset://…`                the worker's internal storage key. No browser can load it.
 *
 * The baseline fed `asset://…` straight into `<img>` (the reader asked the browser to load a
 * scheme that does not exist and drew a broken image). An `asset://` or any other unknown scheme
 * now resolves to `null`, and the caller draws a designed placeholder instead: the crop is the
 * paper, and a broken-image glyph in its place reads as the paper being damaged.
 *
 * It lives in `apps/web` rather than in the package because the base URL is a deployment fact.
 */

import { isFixtureUri, resolveFixtureUri } from '@papertree/ui';

const LOADABLE = /^(?:https?:\/\/|\/(?!\/))/i;

/** Resolve a PaperIR `image.uri` to something an `<img>` can load, or `null` when nothing can. */
export function assetSrc(uri: string): string | null {
  if (isFixtureUri(uri)) {
    try {
      return resolveFixtureUri(uri);
    } catch {
      return null;
    }
  }
  return LOADABLE.test(uri) ? uri : null;
}
