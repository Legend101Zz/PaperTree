/**
 * document-ir/equivalence.spec — the guarantee that matters more than the types.
 *
 * The point of generating three bindings from one schema is that they agree. This suite asserts
 * it, on a corpus that is not curated for the bindings: `test/cases/*.json` is seeded from EVERY
 * case already asserted in `test/schema.spec.ts` (the F0.2 acceptance test), so ajv, Zod and
 * Pydantic are judged against the same body of evidence as the schema itself.
 *
 * Three assertions per case, in increasing strength:
 *   1. ajv's verdict matches the RECORDED verdict — so a mis-recorded case is caught here rather
 *      than teaching the Python twin (which has no ajv) the wrong answer.
 *   2. Zod's verdict === ajv's verdict. This is the F0.3 acceptance criterion.
 *   3. The corpus actually covers the named criteria (unknown types validate in both languages).
 *
 * KNOWN DIVERGENCES. A handful of cases carry a `divergence` block, because on those inputs the
 * generated bindings are DELIBERATELY stricter than ajv — an unpaired surrogate is legal JSON but
 * not encodable as UTF-8, and a 2000-deep payload is not a verdict ajv can give at all (it throws).
 * Those cases are not skipped and not softened: assertion 2 pins the exact Zod verdict, so if the
 * divergence is ever closed the annotation goes red and has to be deleted. A documented divergence
 * is acceptable; an undocumented or a stale one is not. Every class is listed in DESIGN.md §12 and
 * enumerated below in `the known divergences are exactly the documented ones`.
 *
 * The Python twin is `python/tests/test_equivalence.py`; it reads the same files and asserts the
 * Pydantic verdict against the same recorded verdict (or the recorded divergence). Any UNRECORDED
 * divergence is a CODEGEN bug — fix codegen/generate.ts, never the test.
 */
// oxlint-disable typescript/no-explicit-any -- the corpus is deliberately untyped JSON.
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_PAYLOAD_DEPTH,
  PaperSchema,
  findExcessiveDepth,
  findModelDeclaration,
} from '../src/generated/zod.js';
import { DerivationSchema } from '../src/generated/derivation.zod.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');

const AjvCtor = Ajv2020 as unknown as new (opts: Record<string, unknown>) => any;
const applyFormats = addFormats as unknown as (ajv: unknown) => void;
const ajv = new AjvCtor({ strict: true, allErrors: true });
applyFormats(ajv);

const validators = {
  paperir: ajv.compile(
    JSON.parse(readFileSync(join(PKG, 'schema/paperir-1.0.0.schema.json'), 'utf8')),
  ),
  derivation: ajv.compile(
    JSON.parse(readFileSync(join(PKG, 'schema/derivation-1.0.0.schema.json'), 'utf8')),
  ),
} as const;

const zodValidators = { paperir: PaperSchema, derivation: DerivationSchema } as const;

interface Divergence {
  readonly class: string;
  readonly zod: 'valid' | 'invalid';
  readonly pydantic: 'valid' | 'invalid';
  readonly why: string;
}

interface Case {
  readonly name: string;
  readonly schema: 'paperir' | 'derivation';
  readonly expect: 'valid' | 'invalid';
  readonly reason: string;
  readonly origin: string;
  readonly document: unknown;
  readonly divergence?: Divergence;
  readonly file: string;
}

/** The complete set of classes on which the bindings are allowed to disagree with ajv. */
const DOCUMENTED_DIVERGENCES = ['lone-surrogate', 'payload-depth'] as const;

const CASE_DIR = join(PKG, 'test/cases');

function loadCases(): Case[] {
  const out: Case[] = [];
  for (const file of readdirSync(CASE_DIR)
    .filter((f) => f.endsWith('.json'))
    .toSorted()) {
    const parsed = JSON.parse(readFileSync(join(CASE_DIR, file), 'utf8')) as Omit<Case, 'file'>;
    out.push(Object.assign(parsed, { file }));
  }
  return out;
}

const CASES = loadCases();

/**
 * ajv does not always RETURN a verdict: `$defs/ModelFreeSubtree` is recursive, so a deeply nested
 * payload makes the compiled validator recurse until V8 throws `RangeError`. A caller writing
 * `if (validate(doc))` never sees that coming, and an uncaught throw here would take the whole
 * suite down rather than report a divergence. "Could not decide" is treated as "did not accept",
 * which is the only safe reading — and the bindings, which bound the depth, agree with it.
 */
const ajvVerdict = (c: Case): 'valid' | 'invalid' => {
  try {
    return validators[c.schema](c.document) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
};

const ajvMessage = (c: Case): string =>
  ajv.errorsText(validators[c.schema].errors, { separator: '; ' });

const zodVerdict = (c: Case): 'valid' | 'invalid' =>
  zodValidators[c.schema].safeParse(c.document).success ? 'valid' : 'invalid';

const zodMessage = (c: Case): string => {
  const r = zodValidators[c.schema].safeParse(c.document);
  return r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
};

// ---------------------------------------------------------------------------------------------
describe('the corpus itself', () => {
  it('is present and seeded from the F0.2 acceptance test', () => {
    expect(CASES.length).toBeGreaterThan(100);
    const seeded = CASES.filter((c) => c.origin === 'test/schema.spec.ts');
    expect(seeded.length).toBeGreaterThanOrEqual(100);
    expect(CASES.filter((c) => c.expect === 'valid').length).toBeGreaterThan(20);
    expect(CASES.filter((c) => c.expect === 'invalid').length).toBeGreaterThan(80);
  });

  it('covers both schema files', () => {
    expect(CASES.some((c) => c.schema === 'paperir')).toBe(true);
    expect(CASES.some((c) => c.schema === 'derivation')).toBe(true);
  });

  it('every case states a reason', () => {
    expect(CASES.filter((c) => !c.reason || c.reason.length < 10).map((c) => c.file)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('ajv agrees with the recorded verdict', () => {
  it.each(CASES.map((c) => [c.file, c] as const))('%s', (_file, c) => {
    const verdict = ajvVerdict(c);
    expect(
      verdict,
      `${c.file}: recorded ${c.expect}, ajv said ${verdict}. ${c.reason}\n${verdict === 'invalid' ? ajvMessage(c) : ''}`,
    ).toBe(c.expect);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the Zod verdict === the ajv verdict', () => {
  it.each(CASES.map((c) => [c.file, c] as const))('%s', (_file, c) => {
    const ajvSays = ajvVerdict(c);
    const ajvWhy = ajvSays === 'invalid' ? ajvMessage(c) : '';
    const zodSays = zodVerdict(c);
    const zodWhy = zodSays === 'invalid' ? zodMessage(c) : '';
    const want = c.divergence ? c.divergence.zod : ajvSays;
    expect(
      zodSays,
      [
        c.divergence
          ? `${c.file}: the RECORDED divergence "${c.divergence.class}" no longer holds. If it was`
          : `${c.file}: Zod and ajv disagree — this is a CODEGEN bug, fix codegen/generate.ts.`,
        c.divergence
          ? `  closed, delete the divergence block from codegen/build-corpus.ts and DESIGN.md §12.`
          : `  reason recorded: ${c.reason}`,
        `  ajv:  ${ajvSays}${ajvWhy ? ` — ${ajvWhy}` : ''}`,
        `  zod:  ${zodSays}${zodWhy ? ` — ${zodWhy}` : ''}`,
        c.divergence ? `  expected zod: ${want} — ${c.divergence.why}` : '',
      ].join('\n'),
    ).toBe(want);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the known divergences are exactly the documented ones', () => {
  const annotated = CASES.filter((c) => c.divergence);

  it('every annotated case really does diverge — no stale annotations', () => {
    for (const c of annotated) {
      const d = c.divergence as Divergence;
      expect(
        d.zod === ajvVerdict(c) && d.pydantic === c.expect,
        `${c.file}: annotated as diverging but agrees with ajv. Delete the annotation.`,
      ).toBe(false);
    }
  });

  it('no divergence class exists that DESIGN.md §12 does not name', () => {
    const classes = [
      ...new Set(annotated.map((c) => (c.divergence as Divergence).class)),
    ].toSorted();
    expect(classes).toEqual([...DOCUMENTED_DIVERGENCES].toSorted());
  });

  it('every divergence points at its DESIGN.md section', () => {
    for (const c of annotated) {
      expect((c.divergence as Divergence).why, c.file).toMatch(/DESIGN\.md §12\.\d/);
    }
  });

  it('the set is small — a binding that disagrees with the schema often is not a binding', () => {
    expect(annotated.length).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the named acceptance criteria, restated against the generated bindings', () => {
  const byName = (name: string): Case => {
    const c = CASES.find((x) => x.name === name);
    if (!c) throw new Error(`corpus case missing: ${name}`);
    return c;
  };

  it('an unknown block type validates under Zod, not merely under ajv', () => {
    for (const name of [
      'unknown-block-type',
      'unknown-type-carries-payload',
      'unknown-relation-type',
    ]) {
      expect(zodVerdict(byName(name)), name).toBe('valid');
    }
  });

  it('a block missing polygon fails under Zod', () => {
    expect(zodVerdict(byName('block-missing-polygon'))).toBe('invalid');
  });

  it('LLM-authored text in a source field fails under Zod', () => {
    for (const name of [
      'block-source-llm',
      'block-source-model',
      'block-source-vlm',
      'block-generated-by',
    ]) {
      expect(zodVerdict(byName(name)), name).toBe('invalid');
    }
  });

  it('additionalProperties:false survives into Zod at every depth', () => {
    for (const name of [
      'paper-extra-summary',
      'relation-extra-field',
      'strict-span-extra-field',
      'strict-provenance-extra-field',
      'strict-flows-extra-key',
      'conditional-equation-payload-extra-field',
      'strict-nested-table-cell-extra-field',
    ]) {
      expect(zodVerdict(byName(name)), name).toBe('invalid');
    }
  });

  it('nullable is not optional and optional is not nullable, in Zod', () => {
    expect(zodVerdict(byName('nullable-required-metadata-null'))).toBe('valid');
    expect(zodVerdict(byName('nullable-optional-doc-order-null'))).toBe('invalid');
    expect(zodVerdict(byName('nullable-required-overall-null'))).toBe('invalid');
  });

  /**
   * §12.1. The regression that matters most, restated at the mechanism rather than the verdict:
   * `z.record` REBUILT the payload, and `out["__proto__"] = v` writes the prototype instead of a
   * key — so every later check ran on a payload the key had already vanished from, and the payload
   * re-serialised as `{}`. The verdict cases above would go green again the moment someone
   * "simplified" `openObject()` back to `z.record`, as long as some other rule happened to fire;
   * this one would not.
   */
  it('an open object is passed through by reference, so __proto__ stays an own key', () => {
    const parsed = JSON.parse('{"__proto__": {"generated_by": "gpt-4"}, "ok": 1}') as object;
    expect(Object.keys(parsed)).toEqual(['__proto__', 'ok']);
    const doc = byName('proto-payload-bare');
    const block = (doc.document as any).blocks.at(-1);
    expect(Object.keys(block.payload as object)).toContain('__proto__');
    expect(zodVerdict(doc)).toBe('invalid');
    // and it is rejected FOR THE RIGHT REASON: the key, not some incidental other rule.
    expect(zodMessage(doc)).toMatch(/__proto__/);
  });

  it('the model-free walk sees a __proto__ subtree', () => {
    const payload = JSON.parse('{"__proto__": {"generated_by": "gpt-4"}}') as unknown;
    expect(findModelDeclaration(payload)).not.toBeNull();
  });

  /** §12.2 — one backslash, two engines, two divergences in opposite directions. */
  it('ECMA-262 \\s decides the URI in every binding', () => {
    for (const name of [
      'uri-whitespace-feff',
      'uri-whitespace-nbsp',
      'uri-whitespace-line-separator',
      'uri-whitespace-tab',
    ]) {
      expect(zodVerdict(byName(name)), name).toBe('invalid');
    }
    for (const name of ['uri-whitespace-nel', 'uri-whitespace-none']) {
      expect(zodVerdict(byName(name)), name).toBe('valid');
    }
  });

  /** §12.3 — `"type": "integer"` is a NUMBER with no fractional part, in all three. */
  it('an integer written as a float literal validates, and 1.5 does not', () => {
    for (const name of [
      'integer-generation-float-literal',
      'integer-generation-exponent-literal',
      'integer-page-index-float-literal',
      'integer-rotation-float-literal',
      'integer-block-order-float-literal',
    ]) {
      expect(zodVerdict(byName(name)), name).toBe('valid');
    }
    expect(zodVerdict(byName('integer-generation-fractional'))).toBe('invalid');
    expect(zodVerdict(byName('integer-rotation-bool'))).toBe('invalid');
  });

  /** §12.6 — the case ajv cannot answer at all. */
  it("a payload too deep for ajv's stack gets a VERDICT from the binding, not an exception", () => {
    let value: unknown = { leaf: 1 };
    for (let i = 0; i < 2000; i += 1) value = { a: value };
    const doc = structuredClone(byName('payload-depth-at-limit').document) as any;
    doc.blocks.at(-1).payload = value;
    const c = { ...byName('payload-depth-at-limit'), document: doc };

    // Deliberately NOT `expect(...).toThrow(RangeError)`: whether ajv overflows at 2000 depends on
    // the stack the process happened to get, and a test that depends on that flaps, and a flapping
    // test gets deleted. What must hold on every machine is that the HARNESS returns a verdict
    // instead of propagating whatever ajv does, and that the bindings answer without recursing.
    expect(() => ajvVerdict(c)).not.toThrow();
    expect(['valid', 'invalid']).toContain(ajvVerdict(c));
    expect(PaperSchema.safeParse(doc).success).toBe(false);
    expect(MAX_PAYLOAD_DEPTH).toBe(64);
    expect(findExcessiveDepth(value)).not.toBeNull();
    expect(findExcessiveDepth({ a: { b: 1 } })).toBeNull();
  });

  /** §12.5 — deliberately stricter than ajv, and consistent between the two bindings. */
  it('an unpaired surrogate is rejected by Zod in constrained AND unconstrained strings', () => {
    for (const name of [
      'lone-surrogate-constrained-string',
      'lone-surrogate-unconstrained-string',
    ]) {
      expect(ajvVerdict(byName(name)), name).toBe('valid');
      expect(zodVerdict(byName(name)), name).toBe('invalid');
    }
    expect(zodVerdict(byName('astral-pair-string'))).toBe('valid');
  });
});
