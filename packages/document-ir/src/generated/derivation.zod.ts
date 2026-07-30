/*
DO NOT EDIT — generated from schema/derivation-1.0.0.schema.json by codegen/generate.ts.

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

/** ModelAuthor — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const ModelAuthorSchema = z
  .object({
    kind: z.literal("model"),
    model_id: z.string().min(1).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    prompt_hash: z.string().regex(new RegExp("^[a-z0-9]+:[0-9a-f]{16,128}$"), { message: "must match ^[a-z0-9]+:[0-9a-f]{16,128}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
  })
  .strict();

/** Derivation — every field set closed with `.strict()` (schema `additionalProperties: false`). */
export const DerivationSchema = z
  .object({
    derivation_id: z.string().regex(new RegExp("^drv_[0-9A-HJKMNP-TV-Z]{26}$"), { message: "must match ^drv_[0-9A-HJKMNP-TV-Z]{26}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    paper_id: z.string().regex(new RegExp("^ppr_[0-9A-HJKMNP-TV-Z]{26}$"), { message: "must match ^ppr_[0-9A-HJKMNP-TV-Z]{26}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    kind: z.string().min(1).regex(new RegExp("^[a-z][a-z0-9_]{0,63}$"), { message: "must match ^[a-z][a-z0-9_]{0,63}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }),
    author: ModelAuthorSchema,
    content: z.unknown(),
    derived_from: z.array(z.string().regex(new RegExp("^blk_[a-z2-7]{16}$"), { message: "must match ^blk_[a-z2-7]{16}$" }).refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" })).min(1),
    created_at: z.string().refine(isWellFormedText, { message: "string contains an unpaired surrogate and is not UTF-8-encodable" }).refine(isDateTime, { message: 'must match format "date-time"' }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!("content" in (value as Record<string, unknown>))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content"], message: "Required" });
    }
  });

// KnownDerivationKind is documentation only — no validator. See ./types.js for the value list
// and the isKnownDerivationKind() guard; narrowing a field to it would close an OPEN vocabulary.

/** The root of schema/derivation-1.0.0.schema.json. */
export const DerivationRootSchema = DerivationSchema;
