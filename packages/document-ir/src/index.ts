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
export * from './identity.js';
export * from './geometry.js';
export * from './validate.js';
