/**
 * A deliberately hostile stub for `node:crypto` in the browser bundle. See issue #33.
 *
 * `@papertree/document-ir`'s barrel re-exports `identity.js`, which imports `node:crypto` at module
 * scope, so ANY import of that package — even one that only wants `polygonExtent` — pulls
 * `node:crypto` into the client bundle. webpack 5 will not resolve a `node:` builtin for the
 * browser, so the build fails. `next.config.js` aliases it here.
 *
 * IT THROWS. It does not return a fake digest, and that is the whole design:
 *
 *   • Nothing in the browser needs to hash. `@papertree/anchoring` COMPARES content hashes the IR
 *     already carries and never COMPUTES one; the perturbation harness, which does need the real
 *     formula, is a separate Node-only entry point.
 *   • A polyfill returning a plausible-but-different digest would mint `block_id`s matching none of
 *     the 433 conformance vectors and no stored anchor — silently. Silent wrong ids are exactly the
 *     failure mode the identity module's 200 lines of warnings exist to prevent.
 *
 * So if this ever throws, it has found a real bug: some browser code path is trying to mint an id
 * or a content hash, and it must be moved server-side or into the worker instead.
 *
 * DELETE THIS FILE, and the aliases in `next.config.js`, when issue #33 lands.
 */

const MESSAGE =
  'node:crypto is not available in the browser bundle (issue #33). Nothing in the reader should ' +
  'hash: @papertree/anchoring compares the content hashes the IR already carries and never ' +
  'computes one. Reaching this means some code path is minting a block_id or a content_hash ' +
  'client-side — move it server-side rather than polyfilling, or the ids will be silently wrong.';

export function createHash(): never {
  throw new Error(MESSAGE);
}

export function randomUUID(): never {
  throw new Error(MESSAGE);
}

export default { createHash, randomUUID };
