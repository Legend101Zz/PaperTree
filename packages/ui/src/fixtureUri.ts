/**
 * ui/fixtureUri — the `fixture://` scheme, resolved in exactly one place.
 *
 * Every `image.uri` in `packages/document-ir/fixtures/` is a custom URI:
 *
 *     fixture://resnet-cvpr-2col/equations/blk_aqbaozi7u2asflmg@8x.png
 *
 * 29 of them, across `pages/`, `figures/` and `equations/` for three papers. No browser resolves
 * that scheme, so an `<img src>` fed one renders nothing — and renders nothing SILENTLY, which for
 * an equation crop is the specific failure `provenance.tsx` is built to prevent: the crop is the
 * paper, and if it does not appear then the only thing on screen is our transcription of it.
 *
 * WHY THIS IS NOT `new URL(uri)`. `URL` parses `fixture://slug/rest` happily, but `.hostname`
 * lowercases, percent-decodes and IDNA-maps the authority — the slug — and `.pathname`
 * percent-encodes. A slug is a filesystem directory name, not a host, and passing it through host
 * normalisation is a mapping that is right for the three fixtures we have and wrong for the first
 * one that is not lowercase ASCII. So the split is done by hand and the parts are VALIDATED rather
 * than repaired.
 *
 * WHY IT THROWS. The alternative — return the input, return an empty string, return a best-effort
 * path — puts a broken `src` in the DOM, and a broken `src` is a blank box that looks like a
 * missing figure rather than like a bug. A throw names the malformed URI at the point it entered.
 *
 * The URL contract is `/fixtures/<slug>/<rest>`; the bytes live at
 * `packages/document-ir/fixtures/assets/<slug>/<rest>`. Whatever serves them owns that mapping —
 * a static route, a dev-server alias, or a copy into `public/` — and this module deliberately does
 * not know which, so nothing here has to change when that decision does.
 *
 * Non-fixture URIs (a real `https://` asset, once the parser is producing them) are NOT this
 * module's business; guard at the call site:
 *
 *     const src = isFixtureUri(image.uri) ? resolveFixtureUri(image.uri, base) : image.uri;
 */

/** The scheme, including `://`. */
export const FIXTURE_SCHEME = 'fixture://';

/** The path prefix every resolved fixture asset is served under. */
export const FIXTURE_URL_PREFIX = '/fixtures';

export interface ParsedFixtureUri {
  /** The paper slug — `attention-is-all-you-need`, `neural-odes-mathheavy`, `resnet-cvpr-2col`. */
  readonly slug: string;
  /** Everything after the slug, slashes intact: `pages/000@2x.png`. Never leading-slashed. */
  readonly path: string;
}

/**
 * Legal characters in a slug or a path segment.
 *
 * A whitelist, not a blacklist, and deliberately narrow: it covers every one of the 29 existing
 * assets (`blk_…@8x.png`, `000@2x.png`) and rejects everything that would need percent-encoding to
 * survive the trip into an `src`. `@` is a `pchar` in RFC 3986 and needs no encoding, which is why
 * these names can be concatenated rather than escaped. A future asset name outside this set throws
 * a named error here instead of producing a URL that 404s somewhere else.
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9._~@+-]+$/;

function fail(uri: string, why: string): never {
  throw new Error(`Malformed fixture URI ${JSON.stringify(uri)}: ${why}`);
}

export function isFixtureUri(uri: string): boolean {
  return uri.startsWith(FIXTURE_SCHEME);
}

/**
 * Split a `fixture://` URI into its slug and its path, validating both.
 *
 * `..` is rejected explicitly rather than being merely absent from the character whitelist: `.` and
 * `-` are legal in a slug, so `..` is spelled entirely in legal characters, and a traversal that
 * escapes the fixtures root is the one malformed input with a consequence beyond a blank image.
 */
export function parseFixtureUri(uri: string): ParsedFixtureUri {
  if (!isFixtureUri(uri)) fail(uri, `expected it to start with "${FIXTURE_SCHEME}"`);

  const rest = uri.slice(FIXTURE_SCHEME.length);
  if (rest.length === 0) fail(uri, 'it names no slug and no path');
  // A query or fragment would have to be stripped or preserved, and either choice is a guess about
  // an intent the fixtures never express. There are none; say so rather than pick.
  if (rest.includes('?') || rest.includes('#')) fail(uri, 'query strings and fragments are not part of the scheme');

  const slash = rest.indexOf('/');
  if (slash < 0) fail(uri, 'it names a slug but no asset path');

  const slug = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  if (slug.length === 0) fail(uri, 'the slug is empty');
  if (path.length === 0) fail(uri, 'the asset path is empty');
  if (!SEGMENT_PATTERN.test(slug)) fail(uri, `the slug ${JSON.stringify(slug)} contains characters outside [A-Za-z0-9._~@+-]`);

  for (const segment of path.split('/')) {
    if (segment.length === 0) fail(uri, 'the asset path contains an empty segment (a doubled or trailing "/")');
    if (segment === '.' || segment === '..') fail(uri, 'the asset path contains a relative segment');
    if (!SEGMENT_PATTERN.test(segment)) {
      fail(uri, `the path segment ${JSON.stringify(segment)} contains characters outside [A-Za-z0-9._~@+-]`);
    }
  }
  if (slug === '.' || slug === '..') fail(uri, 'the slug is a relative segment');

  return { slug, path };
}

/**
 * `fixture://<slug>/<rest>` → `<baseUrl>/fixtures/<slug>/<rest>`.
 *
 * `baseUrl` defaults to `''`, giving a root-relative URL — right for `apps/web`, where the assets
 * are served from the same origin. Pass an origin (or a CDN prefix) to point elsewhere; a trailing
 * slash on it is dropped so the caller does not have to care whether they left one on.
 */
export function resolveFixtureUri(uri: string, baseUrl = ''): string {
  const { slug, path } = parseFixtureUri(uri);
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${FIXTURE_URL_PREFIX}/${slug}/${path}`;
}
