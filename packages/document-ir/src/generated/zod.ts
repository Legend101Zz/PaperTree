/*
DO NOT EDIT — generated from schema/paperir-1.0.0.schema.json by codegen/generate.ts.

Regenerate with `pnpm --filter @papertree/document-ir codegen`. Hand edits are deleted by
the next run and are caught before that by test/codegen-drift.spec.ts. The JSON Schema is the
single source of truth (DESIGN.md §1); Zod is one of its bindings, never a second one.
*/

import { z } from "zod";

/**
 * Unpaired-surrogate guard, applied to EVERY string in this binding.
 *
 * `JSON.parse` and ajv both accept a lone surrogate; it is not UTF-8-encodable, so such a document
 * cannot survive the serialisation round-trip `$defs/Point` names as a precondition, and
 * pydantic-core already rejects it in every string carrying `pattern` or `minLength` — while
 * silently accepting it in an unconstrained one. Rather than inherit one engine's incidental
 * behaviour, BOTH generated bindings reject it in every string. This is a deliberate, documented
 * strengthening over ajv (DESIGN.md §12.5); the corpus asserts the three-way verdict rather than
 * hiding it.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isWellFormedText(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

/**
 * `{"type": "object"}` with no `properties` — an open object, as `type: "object"` means in JSON
 * Schema: it rejects arrays and null and constrains nothing else.
 *
 * NOT `z.record()`. `z.record` REBUILDS the value key by key, and `out["__proto__"] = v` writes the
 * prototype rather than an own property, so `JSON.parse`'s own `__proto__` key VANISHED from the
 * parsed output before `propertyNames`, `findModelDeclaration` or a nested `.strict()` ever saw it.
 * Zod accepted a payload carrying a whole model-authorship declaration that ajv and Pydantic both
 * reject, and re-serialised the payload as `{}`. `z.custom` passes the value through by reference,
 * so every later check sees the real own keys. See DESIGN.md §12.1.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openObject(): z.ZodType<Record<string, unknown>> {
  return z.custom<Record<string, unknown>>(isPlainObject, { message: "Expected object" });
}

/** See codegen/generate.ts `MAX_PAYLOAD_DEPTH`; the Python twin carries the same number. */
export const MAX_PAYLOAD_DEPTH = 64;

/**
 * The path at which `value` first nests deeper than MAX_PAYLOAD_DEPTH, or null.
 *
 * Iterative on purpose: a guard against unbounded recursion that is itself recursive would
 * overflow on exactly the input it exists to reject.
 */
export function findExcessiveDepth(value: unknown): (string | number)[] | null {
  const stack: Array<{ node: unknown; path: (string | number)[] }> = [{ node: value, path: [] }];
  while (stack.length > 0) {
    const { node, path } = stack.pop() as { node: unknown; path: (string | number)[] };
    if (node === null || typeof node !== "object") continue;
    if (path.length > MAX_PAYLOAD_DEPTH) return path;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) stack.push({ node: node[i], path: [...path, i] });
      continue;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      stack.push({ node: child, path: [...path, key] });
    }
  }
  return null;
}

/**
 * `format: "date-time"`, ported from ajv-formats' `date-time` so the Zod verdict and the ajv
 * verdict agree on the same strings (including the leap-second rule). Formats must VALIDATE,
 * not merely document.
 */
const DATE_RE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const TIME_RE = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)$/i;

function isDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const leap = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const limit = (DAYS_IN_MONTH[month] ?? 0) + (leap ? 1 : 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= limit;
}

function isTime(value: string): boolean {
  const m = TIME_RE.exec(value);
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3]);
  const sign = m[5] === "-" ? -1 : 1;
  const tzHour = Number(m[6] ?? 0);
  const tzMinute = Number(m[7] ?? 0);
  if (tzHour > 23 || tzMinute > 59) return false;
  if (hour <= 23 && minute <= 59 && second < 60) return true;
  // A leap second is only legal at 23:59:60 UTC.
  const utcMinute = minute - tzMinute * sign;
  const utcHour = hour - tzHour * sign - (utcMinute < 0 ? 1 : 0);
  return (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1) && second < 61;
}

function isDateTime(value: string): boolean {
  const parts = value.split(/t|\s/i);
  return parts.length === 2 && isDate(parts[0] as string) && isTime(parts[1] as string);
}

/**
 * A recursive constraint on Block.payload for block types this schema does not know, which is the one place in PaperIR where an open object shape is required for forward compatibility. Two rules, applied to every object ANYWHERE in the subtree.
 *
 * 1. KEYS MUST BE IDENTIFIER-SHAPED, at every depth: ^[a-z][a-z0-9_]{0,63}$. This is the rule that makes rule 2 bounded rather than a guessing game - without it `{"meta": {"model-id": "gpt-4o"}}` and `{"meta": {"GENERATED_BY": "gpt-4"}}` both validated while their identical lowercase spellings one level up were correctly rejected. An earlier revision applied it only to the OUTERMOST payload object; that was the hole.
 *
 * 2. NO OBJECT MAY CARRY ONE OF THE LISTED KEY NAMES. Without this, `blocks[i].payload` was the single object in the file with no "additionalProperties": false, and a complete Derivation - or a bare {"generated_by": "gpt-4"} - fitted inside it whole, one level below the block that rejects exactly those fields.
 *
 * WHAT THIS IS NOT. The list is a DENY-LIST OF NAMES and a deny-list cannot be complete; it covers the seven fields PaperIR itself uses for derivation plus the near-miss spellings an acceptance review actually reached for. A producer that declares authorship under a name nobody listed - `payload.provenance_note`, say - still validates. So do not read this as "authorship is unrepresentable": it makes the OBVIOUS declarations unrepresentable and raises the cost of the rest. Detecting authorship is `ingest/source-authenticity.spec`'s job (Epic 1, owed); see DESIGN.md 11 residual risks 1 and 8.
 *
 * This blocks the SHAPE of a declared derivation, not prose. A payload string containing model output is still expressible - see the schema-level description on undeclarable-vs-undetectable.
 */
export const PAYLOAD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export const MODEL_AUTHORSHIP_KEYS = [
  "model_id",
  "prompt_hash",
  "generated_by",
  "derivation_id",
  "derived_from",
  "prompt",
  "llm",
  "model",
  "models",
  "model_name",
  "model_version",
  "llm_model",
  "generator",
  "generated",
  "generation_model",
  "agent",
  "assistant",
  "completion",
  "completions",
  "response",
  "author",
  "authored_by",
  "written_by",
  "synthesised_by",
  "synthesized_by",
  "system_prompt",
  "system_prompt_digest",
  "prompt_id",
  "prompt_sha256",
  "prompt_template",
  "prompt_tokens",
  "temperature",
  "top_p",
  "ai",
  "ai_generated",
] as const;

/**
 * Walks a value and returns the path of the first model-authorship declaration, or null.
 * TypeScript cannot express this constraint as a type, so it is a runtime guard (DESIGN.md §6).
 *
 * The descent stops at MAX_PAYLOAD_DEPTH so this guard cannot itself overflow the stack. That
 * is not a hole: every caller rejects an over-deep value outright before searching it, so the
 * truncated levels are levels no valid document has.
 */
export function findModelDeclaration(
  value: unknown,
  depth = 0,
): { path: (string | number)[]; reason: "key" | "authorship" } | null {
  if (depth > MAX_PAYLOAD_DEPTH) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findModelDeclaration(value[i], depth + 1);
      if (hit) return { path: [i, ...hit.path], reason: hit.reason };
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!PAYLOAD_KEY_PATTERN.test(key)) return { path: [key], reason: "key" };
      if ((MODEL_AUTHORSHIP_KEYS as readonly string[]).includes(key)) {
        return { path: [key], reason: "authorship" };
      }
      const hit = findModelDeclaration(child, depth + 1);
      if (hit) return { path: [key, ...hit.path], reason: hit.reason };
    }
  }
  return null;
}

/** Throws if `value` is over-deep or declares model authorship anywhere in its subtree. */
export function assertModelFree(value: unknown): void {
  const tooDeep = findExcessiveDepth(value);
  if (tooDeep) {
    throw new Error(`payload nests deeper than 64 levels at ${tooDeep.join(".")}`);
  }
  const hit = findModelDeclaration(value);
  if (hit) {
    throw new Error(
      hit.reason === "key"
        ? `payload key at ${hit.path.join(".")} must match ${String(PAYLOAD_KEY_PATTERN)}`
        : `model-authorship declaration at ${hit.path.join(".")}`,
    );
  }
}

export const PaperIdSchema = z.string().regex(new RegExp("^ppr_[0-9A-HJKMNP-TV-Z]{26}$"), { message: "must match ^ppr_[0-9A-HJKMNP-TV-Z]{26}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" });

export const Sha256HashSchema = z.string().regex(new RegExp("^sha256:[0-9a-f]{64}$"), { message: "must match ^sha256:[0-9a-f]{64}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" });

export const AlgoPrefixedHashSchema = z.string().regex(new RegExp("^[a-z0-9]+:[0-9a-f]{16,128}$"), { message: "must match ^[a-z0-9]+:[0-9a-f]{16,128}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" });

/** ParserInfo — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const ParserInfoSchema = z
  .object({
    name: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    version: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    config_hash: AlgoPrefixedHashSchema,
    profile: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    parsed_at: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).refine(isDateTime, { message: 'must match format "date-time"' }),
  })
  .strict();

export const PaperStatusSchema = z.enum(["partial", "complete", "failed"]);

export const BlockIdSchema = z.string().regex(new RegExp("^blk_[a-z2-7]{16}$"), { message: "must match ^blk_[a-z2-7]{16}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" });

export const ConfidenceSchema = z.number().min(0).max(1);

/** MetadataValue — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const MetadataValueSchema = z
  .object({
    value: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    source_block_id: BlockIdSchema,
    confidence: ConfidenceSchema,
  })
  .strict();

/** AbstractRef — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const AbstractRefSchema = z
  .object({
    block_ids: z.array(BlockIdSchema).min(1),
    confidence: ConfidenceSchema,
  })
  .strict();

/** MetadataYear — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const MetadataYearSchema = z
  .object({
    value: z.number().int(),
    source_block_id: BlockIdSchema,
    confidence: ConfidenceSchema,
  })
  .strict();

/** Metadata — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const MetadataSchema = z
  .object({
    title: MetadataValueSchema.nullable(),
    authors: z.array(MetadataValueSchema),
    abstract: AbstractRefSchema.nullable(),
    doi: MetadataValueSchema.nullable(),
    arxiv_id: MetadataValueSchema.nullable(),
    venue: MetadataValueSchema.nullable(),
    year: MetadataYearSchema.nullable(),
  })
  .strict();

export const PageIdSchema = z.string().regex(new RegExp("^pg_[a-z2-7]{16}$"), { message: "must match ^pg_[a-z2-7]{16}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" });

export const BBoxSchema = z.tuple([z.number().min(-20000).max(20000), z.number().min(-20000).max(20000), z.number().min(-20000).max(20000), z.number().min(-20000).max(20000)]);

/** ImageRef — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const ImageRefSchema = z
  .object({
    uri: z.string().min(1).max(2048).regex(new RegExp("^[a-z][a-z0-9+.\\-]*://[^\\s]+$"), { message: "must match ^[a-z][a-z0-9+.\\-]*://[^\\s]+$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    scale: z.number().gt(0).max(64).optional(),
    dpi: z.number().gt(0).max(4800).optional(),
    rendered_from: z.enum(["raster", "vector", "page"]).optional(),
  })
  .strict();

/** Flows — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const FlowsSchema = z
  .object({
    body: z.array(BlockIdSchema),
    caption: z.array(BlockIdSchema),
    footnote: z.array(BlockIdSchema),
    header: z.array(BlockIdSchema),
    footer: z.array(BlockIdSchema),
    margin: z.array(BlockIdSchema),
  })
  .strict();

/** Page — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const PageSchema = z
  .object({
    page_id: PageIdSchema,
    index: z.number().int().min(0),
    width: z.number().gt(0).max(20000),
    height: z.number().gt(0).max(20000),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    user_unit: z.number().min(0.001).max(1000),
    crop_box: BBoxSchema,
    media_box: BBoxSchema,
    image: ImageRefSchema.nullable(),
    has_text_layer: z.boolean(),
    is_scanned: z.boolean(),
    block_ids: z.array(BlockIdSchema),
    flows: FlowsSchema,
    confidence: ConfidenceSchema,
  })
  .strict();

export const PointSchema = z.tuple([z.number().min(-20000).max(20000), z.number().min(-20000).max(20000)]);

export const PolygonSchema = z.array(PointSchema).min(3).max(512);

export const FlowSchema = z.enum(["body", "caption", "footnote", "header", "footer", "margin"]);

/** Span — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const SpanSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    bbox: BBoxSchema,
    role: z.string().regex(new RegExp("^[a-z][a-z0-9_]{0,63}$"), { message: "must match ^[a-z][a-z0-9_]{0,63}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    block_id: BlockIdSchema.optional(),
    font: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    size: z.number().gt(0).max(2000).optional(),
  })
  .strict();

export const SourceKindSchema = z.enum(["pdf_text_layer", "pdf_vector", "pdf_raster", "ocr"]);

/** Provenance — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const ProvenanceSchema = z
  .object({
    parser: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    stage: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    native_id: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
  })
  .strict();

export const RepairKindSchema = z.enum(["dehyphenate", "ligature", "unicode_normalise", "whitespace", "reorder", "ocr_correction", "vlm_substitution"]);

/** Repair — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const RepairSchema = z
  .object({
    kind: RepairKindSchema,
    applied: z.boolean(),
    at: z.number().int().min(0).optional(),
    from: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    to: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    model_id: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    prompt_hash: AlgoPrefixedHashSchema.optional(),
    confidence: ConfidenceSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (["ocr_correction", "vlm_substitution"].includes(value.kind)) {
      if (value.model_id === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model_id"], message: "model_id is required when kind is one of ocr_correction/vlm_substitution" });
      }
      if (value.prompt_hash === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt_hash"], message: "prompt_hash is required when kind is one of ocr_correction/vlm_substitution" });
      }
      if (value.applied !== false) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["applied"], message: "applied must be false when kind is one of ocr_correction/vlm_substitution" });
      }
    }
    if (["dehyphenate", "ligature", "unicode_normalise", "whitespace", "reorder"].includes(value.kind)) {
      if (value.model_id !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model_id"], message: "model_id is forbidden when kind is one of dehyphenate/ligature/unicode_normalise/whitespace/reorder" });
      }
      if (value.prompt_hash !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt_hash"], message: "prompt_hash is forbidden when kind is one of dehyphenate/ligature/unicode_normalise/whitespace/reorder" });
      }
    }
  });

/** Alternative — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const AlternativeSchema = z
  .object({
    parser: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    authored_by: z.enum(["parser", "model"]),
    text: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    confidence: ConfidenceSchema,
    decision: z.enum(["selected", "not_selected"]),
    rule: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.authored_by === "model") {
      if (value.decision !== "not_selected") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "decision must be \"not_selected\" when authored_by is model" });
      }
    }
  });

/** EquationSymbol — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const EquationSymbolSchema = z
  .object({
    symbol: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    definition_block: BlockIdSchema,
  })
  .strict();

/** EquationPayload — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const EquationPayloadSchema = z
  .object({
    display: z.boolean(),
    equation_number: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    latex: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    latex_confidence: ConfidenceSchema.optional(),
    mathml: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    image: ImageRefSchema.nullable(),
    symbols: z.array(EquationSymbolSchema).min(1).optional(),
    referenced_by: z.array(BlockIdSchema).min(1).optional(),
  })
  .strict();

/** FigurePanel — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const FigurePanelSchema = z
  .object({
    label: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    polygon: PolygonSchema,
    source: SourceKindSchema,
    confidence: ConfidenceSchema,
  })
  .strict();

/** DetectedLabel — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const DetectedLabelSchema = z
  .object({
    text: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    polygon: PolygonSchema,
    source: SourceKindSchema,
    confidence: ConfidenceSchema,
  })
  .strict();

/** FigurePayload — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const FigurePayloadSchema = z
  .object({
    figure_number: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    figure_kind: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    is_vector: z.boolean(),
    image: ImageRefSchema.nullable(),
    caption_block: BlockIdSchema.optional(),
    panels: z.array(FigurePanelSchema).min(1).optional(),
    detected_labels: z.array(DetectedLabelSchema).min(1).optional(),
    referenced_by: z.array(BlockIdSchema).min(1).optional(),
  })
  .strict();

/** TableCell — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const TableCellSchema = z
  .object({
    cell_id: BlockIdSchema,
    r: z.number().int().min(0),
    c: z.number().int().min(0),
    rowspan: z.number().int().min(1).optional(),
    colspan: z.number().int().min(1).optional(),
    polygon: PolygonSchema,
    text: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    is_header: z.boolean().optional(),
  })
  .strict();

/** TableGrid — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const TableGridSchema = z
  .object({
    rows: z.number().int().min(0),
    cols: z.number().int().min(0),
    cells: z.array(TableCellSchema),
  })
  .strict();

/** TablePayload — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const TablePayloadSchema = z
  .object({
    table_number: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    caption_block: BlockIdSchema.optional(),
    grid: TableGridSchema,
    html: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
  })
  .strict();

/**
 * OpaquePayload: open in SHAPE (forward compatibility) but closed against authorship declarations at
 * any depth, and restricted to identifier-shaped keys.
 */
export const OpaquePayloadSchema = openObject()
  .superRefine((value, ctx) => {
    const tooDeep = findExcessiveDepth(value);
    if (tooDeep) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: tooDeep, message: "payload nests deeper than 64 levels" });
      return;
    }
    // ONE walk, and it checks keys at EVERY depth. The key check used to be a loop over
    // Object.keys(value) here, i.e. the outermost object only.
    const offending = findModelDeclaration(value);
    if (offending) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: offending.path,
        message:
          offending.reason === "key"
            ? "payload keys must match ^[a-z][a-z0-9_]{0,63}$ at every depth"
            : "model-authorship declaration is forbidden in a payload subtree",
      });
    }
  });

/** Block — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const BlockSchema = z
  .object({
    block_id: BlockIdSchema,
    type: z.string().min(1).regex(new RegExp("^[a-z][a-z0-9_]{0,63}$"), { message: "must match ^[a-z][a-z0-9_]{0,63}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    page_index: z.number().int().min(0),
    polygon: PolygonSchema,
    bbox: BBoxSchema,
    flow: FlowSchema,
    order: z.number().int().min(0),
    doc_order: z.number().int().min(0).optional(),
    parent_id: BlockIdSchema.optional(),
    child_ids: z.array(BlockIdSchema).min(1).optional(),
    prev_id: BlockIdSchema.optional(),
    next_id: BlockIdSchema.optional(),
    text: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    text_normalised: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    content_hash: AlgoPrefixedHashSchema.optional(),
    spans: z.array(SpanSchema).min(1).optional(),
    source: SourceKindSchema,
    confidence: ConfidenceSchema,
    provenance: ProvenanceSchema,
    repairs: z.array(RepairSchema).min(1).optional(),
    alternatives: z.array(AlternativeSchema).min(1).optional(),
    payload: openObject().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (["equation", "inline_equation"].includes(value.type)) {
      if (value.payload === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "payload is required when type is one of equation/inline_equation" });
      }
      if (value.payload !== undefined) {
        const r = EquationPayloadSchema.safeParse(value.payload);
        if (!r.success) {
          for (const issue of r.error.issues) {
            ctx.addIssue({ ...issue, path: ["payload", ...issue.path] });
          }
        }
      }
    }
    if (value.type === "figure") {
      if (value.payload === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "payload is required when type is figure" });
      }
      if (value.payload !== undefined) {
        const r = FigurePayloadSchema.safeParse(value.payload);
        if (!r.success) {
          for (const issue of r.error.issues) {
            ctx.addIssue({ ...issue, path: ["payload", ...issue.path] });
          }
        }
      }
    }
    if (value.type === "table") {
      if (value.payload === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload"], message: "payload is required when type is table" });
      }
      if (value.payload !== undefined) {
        const r = TablePayloadSchema.safeParse(value.payload);
        if (!r.success) {
          for (const issue of r.error.issues) {
            ctx.addIssue({ ...issue, path: ["payload", ...issue.path] });
          }
        }
      }
    }
    if (!["equation", "inline_equation", "figure", "table"].includes(value.type)) {
      if (value.payload !== undefined) {
        const r = OpaquePayloadSchema.safeParse(value.payload);
        if (!r.success) {
          for (const issue of r.error.issues) {
            ctx.addIssue({ ...issue, path: ["payload", ...issue.path] });
          }
        }
      }
    }
  });

/** Relation — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const RelationSchema = z
  .object({
    type: z.string().min(1).regex(new RegExp("^[a-z][a-z0-9_]{0,63}$"), { message: "must match ^[a-z][a-z0-9_]{0,63}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    from: BlockIdSchema,
    to: BlockIdSchema,
    confidence: ConfidenceSchema,
    provenance: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
  })
  .strict();

/** Section — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const SectionSchema = z
  .object({
    heading_block_id: BlockIdSchema,
    level: z.number().int().min(1),
    parent_heading_block_id: BlockIdSchema.optional(),
    block_ids: z.array(BlockIdSchema),
  })
  .strict();

/** Reference — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const ReferenceSchema = z
  .object({
    reference_entry_block_id: BlockIdSchema,
    title: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    authors: z.array(z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" })).min(1).optional(),
    year: z.number().int().optional(),
    venue: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    doi: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    arxiv_id: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    url: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).optional(),
    confidence: ConfidenceSchema,
  })
  .strict();

/** DocumentConfidence — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const DocumentConfidenceSchema = z
  .object({
    overall: ConfidenceSchema.nullable(),
    by_page: z.array(ConfidenceSchema.nullable()),
    weakest_pages: z.array(z.number().int().min(0)),
    needs_review: z.boolean(),
  })
  .strict();

/** Paper — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const PaperSchema = z
  .object({
    ir_version: z.string().regex(new RegExp("^1\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"), { message: "must match ^1\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    paper_id: PaperIdSchema,
    source_hash: Sha256HashSchema,
    generation: z.number().int().min(1),
    coordinate_space: z.literal("pdf_user_space_topleft"),
    parser: ParserInfoSchema,
    status: PaperStatusSchema,
    partial_reason: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).nullable(),
    metadata: MetadataSchema,
    pages: z.array(PageSchema),
    blocks: z.array(BlockSchema),
    relations: z.array(RelationSchema),
    sections: z.array(SectionSchema),
    references: z.array(ReferenceSchema),
    confidence: DocumentConfidenceSchema,
  })
  .strict();

// KnownBlockType is documentation only — no validator. See ./types.js for the value list
// and the isKnownBlockType() guard; narrowing a field to it would close an OPEN vocabulary.

// KnownHeadingBlockType is documentation only — no validator. See ./types.js for the value list
// and the isKnownHeadingBlockType() guard; narrowing a field to it would close an OPEN vocabulary.

// KnownRelationType is documentation only — no validator. See ./types.js for the value list
// and the isKnownRelationType() guard; narrowing a field to it would close an OPEN vocabulary.

/** The root of schema/paperir-1.0.0.schema.json. */
export const PaperRootSchema = PaperSchema;
