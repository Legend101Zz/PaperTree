/**
 * reader/assetSrc — the one call-site guard `@papertree/ui/fixtureUri` asks every caller to write.
 *
 * That module's own header says it:
 *
 *     const src = isFixtureUri(image.uri) ? resolveFixtureUri(image.uri, base) : image.uri;
 *
 * It is three tokens long and it was going to be written independently in `GuidedView`, in the
 * Navigator's page thumbnails and in whatever renders figure crops in Source — three chances to get
 * the branch backwards and feed `fixture://…` straight into an `<img src>`, which renders nothing,
 * silently. For an equation crop that specific silence is the failure `provenance.tsx` exists to
 * prevent: the crop is the paper, and if it does not appear then the only thing on screen is our
 * transcription of it.
 *
 * It lives in `apps/web` rather than in the package because the base URL is a deployment fact.
 */

import { isFixtureUri, resolveFixtureUri } from '@papertree/ui';

/**
 * Resolve a PaperIR `image.uri` to something an `<img>` can load.
 *
 * `fixture://` assets are served root-relative from `/fixtures/<slug>/<rest>` — same origin, so no
 * base is needed. Anything else (an `https://` asset once the parser produces them) is already a
 * URL and is returned untouched; `resolveFixtureUri` would throw on it.
 */
export function assetSrc(uri: string): string {
  return isFixtureUri(uri) ? resolveFixtureUri(uri) : uri;
}
