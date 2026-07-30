/**
 * @papertree/anchoring — ADR-004's multi-selector anchor and the T0–T6 resolver.
 *
 * BROWSER-SAFE BY CONSTRUCTION. Nothing reachable from this entry point imports `node:crypto`. The
 * resolver compares content hashes the IR already carries; it never computes one. The perturbation
 * harness DOES need the real id formula and therefore the real hash, so it is a SEPARATE entry
 * point (`@papertree/anchoring/perturb`) and is Node-only. Keeping them apart is what lets the
 * reader bundle the resolver without dragging a hash implementation into the browser.
 *
 * (`@papertree/document-ir`'s own barrel is not browser-safe — `src/identity.ts` imports
 * `node:crypto` at module scope and `src/index.ts` re-exports it — so a browser build of anything
 * importing it needs the `node:crypto` alias in `apps/web/next.config.js`. That is tracked as an
 * issue against Epic 0 asking for subpath exports; see EPIC-02-RESULT.md.)
 */

export * from './types.js';
export * from './quotenorm.js';
export * from './match.js';
export * from './document.js';
export * from './resolve.js';
export * from './capture.js';
export * from './lineband.js';
