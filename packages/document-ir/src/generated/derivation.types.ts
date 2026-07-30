/*
DO NOT EDIT — generated from schema/derivation-1.0.0.schema.json by codegen/generate.ts.

Regenerate with `pnpm --filter @papertree/document-ir codegen`. Hand edits are deleted by
the next run and are caught before that by test/codegen-drift.spec.ts. The JSON Schema is the
single source of truth (DESIGN.md §1); TypeScript is one of its bindings, never a second one.
*/

/**
 * Who generated this. kind is the constant "model": there is no human or source option, because a human note is not a derivation and source text belongs in PaperIR. Recording model_id and prompt_hash makes a generation reproducible, attributable and invalidatable when the prompt changes.
 */
export interface ModelAuthor {
  /** Always "model". The mirror image of PaperIR's Block.source, which has no model value at all. */
  kind: "model";
  /**
   * Exact model identifier, e.g. "anthropic/claude-haiku-4.5". Not a family name: a regression must be attributable to a specific model version.
   */
  model_id: string;
  /**
   * Algorithm-prefixed digest of the exact prompt used, e.g. "sha256:...". Lets a prompt change invalidate stale derivations instead of leaving them silently mismatched.
   */
  prompt_hash: string;
}

/**
 * One piece of model-authored content, permanently tied to the source blocks it was derived from.
 *
 * ONE DERIVATION IS ONE RENDERABLE UNIT. ADR-001 Commitment 1 requires the Guided view to be "a derivation whose EVERY PARAGRAPH carries derived_from: [block_ids]"; `content` is deliberately unconstrained in shape, so the granularity has to be stated rather than schema-enforced. A twenty-paragraph guided section is TWENTY Derivations, each grounded in the blocks that paragraph came from — not one Derivation with three block ids attached. This is what makes Epic 2's reader/provenance.spec ("no Guided block renders without a visible derived marker and a working source link") testable at all.
 */
export interface Derivation {
  /**
   * Derivation identity: "drv_" + a 26-character Crockford base32 ULID. Random and time-ordered, NOT content-derived: unlike a block, a derivation is an event that happened, not a region of a document that can be re-found.
   */
  derivation_id: string;
  /** The paper this derivation is about. */
  paper_id: string;
  /**
   * What sort of derivation this is. ANY IDENTIFIER-SHAPED STRING VALIDATES (^[a-z][a-z0-9_]{0,63}$) — the same open-vocabulary forward-compatibility rule as PaperIR's Block.type, and the same identifier-shape constraint. The known kinds are listed in $defs/KnownDerivationKind for codegen and documentation only. A consumer that meets an unknown kind must not render it as source.
   */
  kind: DerivationKind;
  author: ModelAuthor;
  /**
   * The generated content of ONE renderable unit. Deliberately unconstrained in shape — a guided paragraph is Markdown, a canvas node is an object, a narration is a script — because the point of this file is to keep generated content OUT of the source schema, not to standardise it. This is the ONE place in the whole system where unconstrained model output is correct. Whatever it is, it is model output and must be rendered in a visually distinct register.
   */
  content: unknown;
  /**
   * The PaperIR block ids this content was derived from, in order of relevance. minItems 1 is load-bearing: a derivation that cannot point at any source block is ungrounded, and ungrounded generated content is exactly what the product currently ships (findings.md C4 — no block ids, no page spans, no citations). Every paragraph of the Guided view carries these so the reader can jump to the source.
   */
  derived_from: [string, ...string[]];
  /** RFC 3339 timestamp of generation. */
  created_at: string;
}

/**
 * The known derivation kinds. NOT REFERENCED BY Derivation.kind and not a validation constraint — documentation and codegen input only, exactly like PaperIR's KnownBlockType.
 */
export const KNOWN_DERIVATION_KINDS = [
  "guided_section",
  "summary",
  "narration",
  "explanation",
  "canvas_node",
  "flashcard",
] as const;

export type KnownDerivationKind = (typeof KNOWN_DERIVATION_KINDS)[number];

export function isKnownDerivationKind(value: string): value is KnownDerivationKind {
  return (KNOWN_DERIVATION_KINDS as readonly string[]).includes(value);
}

/**
 * The OPEN type: any identifier-shaped string validates, and a v1 consumer MUST tolerate a
 * type it has never seen (DESIGN.md D2). `(string & {})` keeps editor autocompletion on the
 * known values without narrowing the type to them.
 */
export type DerivationKind = KnownDerivationKind | (string & {});
