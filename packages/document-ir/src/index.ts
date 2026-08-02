/**
 * @papertree/document-ir — the PaperIR canonical document representation.
 *
 * The JSON Schema in `schema/` is the single source of truth (DESIGN.md §1). Everything exported
 * from here is GENERATED from it by `codegen/generate.ts`; nothing in `src/generated/` may be
 * hand-edited, and `test/codegen-drift.spec.ts` fails the build if it is.
 *
 * Types come from `./generated/*.types.js`; the runtime validators are the `*Schema` values in
 * `./generated/*.zod.js`. Two schema files ⇒ two generated modules (DESIGN.md §6): the PaperIR
 * modules and the Derivation modules are deliberately not merged, and there is no cross-file
 * `$ref` between them.
 */

// ─── generated bindings (F0.3) ──────────────────────────────────────────────
export * from './generated/types.js';
export * from './generated/derivation.types.js';
export * from './generated/zod.js';
export * from './generated/derivation.zod.js';

// ─── identity, geometry and the semantic validator (F0.4) ───────────────────
//
// These are hand-written, not generated, and each has a Python twin that is checked against the
// same committed conformance file rather than against the other language — see
// `conformance/identity-vectors.json` (ADR-001 Amendment 1) and `conformance/geometry-vectors.json`.
//
// `validate` carries the invariants JSON Schema cannot express (bbox == polygon extent, relation
// endpoints resolve, reading order is dense, and the block_id actually recomputes from the block's
// own content). A document that passes the Zod/Pydantic validator is well-FORMED; a document that
// also passes `validatePaper` is well-FORMED and internally CONSISTENT. Fixtures must pass both.
export * from './canonical.js';
// `./normalise.js`, NOT `./identity.js` — issue #33. `identity.ts` imports `node:crypto` at module
// scope and webpack 5 will not resolve a `node:` builtin, so re-exporting it here made ANY browser
// import of this barrel fail to compile, including one that only wanted `polygonExtent`. The pure
// half lives in `./normalise.js` and the two functions that hash — `blockId` and `contentHash` —
// are reachable as `@papertree/document-ir/identity`, documented Node-only.
//
// `test/browser-safety.spec.ts` fails if a `node:` specifier becomes reachable from this file
// again, so this is asserted rather than remembered.
export * from './normalise.js';
export * from './geometry.js';

// `./validate.js` is NOT re-exported here, and that is the second half of #33.
//
// The semantic validator's rule I1 recomputes each `block_id` from the block's own content —
// that is the whole point of it — so `validate.ts` imports `./identity.js`, which imports
// `node:crypto`. The barrel therefore reached a Node builtin through TWO paths, not one, and the
// webpack error trace only ever printed the shorter of them (via `quotenorm.ts`). Splitting
// `identity.ts` alone would have left the build red and the cause invisible.
//
// It is reachable as `@papertree/document-ir/validate`. Nothing outside this package imported it
// through the barrel — its only consumers are this package's own tests, which use a relative
// path — so this costs no call site. `test/browser-safety.spec.ts` is what found it.
