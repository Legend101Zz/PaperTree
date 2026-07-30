/**
 * document-ir/canonical.spec — DESIGN.md §7.1, which Epic 0 defined normatively and did not
 * implement.
 *
 * The gap this closes is not hypothetical. Before it: no test in either language exercised
 * PaperIR SERIALISATION at all (every test matching /round.?trip/ in the repo was geometry), and
 * the two bindings did not agree on the bytes of the SAME committed golden fixture — 112 359
 * bytes computed in TypeScript against 112 777 in Python, diverging at 145 numeric literals,
 * because the fixtures store `"confidence": 1.0` and JavaScript re-emits it as `1`. Under §7.1's
 * own "shortest round-trip form" clause the two were BOTH right and the criterion was
 * unsatisfiable, because whichever language wrote a document decided its bytes.
 *
 * Everything here is asserted against `conformance/canonical-vectors.json`, which
 * `python/tests/test_canonical.py` also reads. Neither language is the oracle.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CanonicalJsonError,
  MAX_SAFE_JSON_INTEGER,
  canonicalJson,
  canonicalJsonForDeterminism,
  type JsonValue,
} from '../src/canonical.js';
import { PaperSchema } from '../src/generated/zod.js';
import { validatePaper } from '../src/validate.js';
import type { Paper } from '../src/generated/types.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Contract {
  readonly contract_version: string;
  readonly number_vectors: readonly { readonly python_repr: string; readonly canonical: string }[];
  readonly rejection_vectors: readonly {
    readonly label: string;
    readonly python_repr: string;
    readonly why: string;
  }[];
  readonly document_vectors: readonly {
    readonly label: string;
    readonly value: JsonValue;
    readonly canonical: string;
  }[];
  readonly fixture_vectors: readonly {
    readonly fixture: string;
    readonly canonical_bytes: number;
    readonly canonical_sha256: string;
    readonly determinism_sha256: string;
  }[];
}

const CONTRACT = JSON.parse(
  readFileSync(join(PKG, 'conformance/canonical-vectors.json'), 'utf8'),
) as Contract;

const SCHEMA = JSON.parse(readFileSync(join(PKG, 'schema/paperir-1.0.0.schema.json'), 'utf8')) as {
  $defs: Record<string, unknown>;
};

describe('the shipped contract', () => {
  it('is the one the Python twin reads', () => {
    expect(CONTRACT.contract_version).toBe('papertree/canonical-json/1.0.0');
    expect(CONTRACT.number_vectors.length).toBeGreaterThan(0);
    expect(CONTRACT.document_vectors.length).toBeGreaterThan(0);
    expect(CONTRACT.fixture_vectors).toHaveLength(3);
  });
});

describe('clause 3: numbers in ECMAScript shortest-round-trip form', () => {
  it.each(CONTRACT.number_vectors.map((v) => [v.python_repr, v.canonical] as const))(
    'python repr %s formats as %s',
    (repr, canonical) => {
      // Every one of these came out of Python's `ecmascript_number_to_string`. JavaScript gets
      // the same algorithm for free from `String(x)`, which is the point: the two languages are
      // pinned to ONE definition rather than to each other's defaults. Values integral and
      // beyond 2^53 are in this list on purpose — the FORMATTER must handle them even though
      // `canonicalJson` refuses to emit them (see the rejection test below).
      const value = Number(repr);
      expect(Object.is(value, -0) ? '0' : String(value)).toBe(canonical);
    },
  );

  it('rejects every rejection vector, in both languages', () => {
    expect(CONTRACT.rejection_vectors.length).toBeGreaterThan(0);
    for (const vector of CONTRACT.rejection_vectors) {
      const value =
        vector.python_repr === 'inf' ? Number.POSITIVE_INFINITY : Number(vector.python_repr);
      expect(() => canonicalJson(value), vector.why).toThrow(CanonicalJsonError);
    }
  });

  it('emits `1` for 1.0, which is the whole reason this module exists', () => {
    expect(canonicalJson({ confidence: 1.0 })).toBe('{"confidence":1}');
  });

  it('has no negative zero, exactly as identity.quantise has none', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson([0, -0])).toBe('[0,0]');
  });

  it('REJECTS an integer that cannot round-trip through a double', () => {
    expect(canonicalJson(MAX_SAFE_JSON_INTEGER)).toBe('9007199254740991');
    expect(() => canonicalJson(MAX_SAFE_JSON_INTEGER + 2)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(Number.NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(CanonicalJsonError);
  });
});

describe('clauses 1 and 2: sorted keys, no insignificant whitespace', () => {
  it.each(CONTRACT.document_vectors.map((v) => [v.label, v] as const))('%s', (_label, vector) => {
    expect(canonicalJson(vector.value)).toBe(vector.canonical);
  });

  it('sorts by CODE POINT, not by UTF-16 code unit', () => {
    // The one input where JavaScript's default sort is wrong: U+1F600 is above U+FFFD by code
    // point and below it by code unit, and Python's `sorted()` uses code points.
    const keys = ['\u{1F600}', '�'];
    expect(keys.toSorted()).toEqual(['\u{1F600}', '�']); // JS default: astral first
    expect(canonicalJson({ '\u{1F600}': 1, '�': 2 })).toBe('{"�":2,"\u{1F600}":1}');
  });

  it('keeps a null VALUE and drops only an ABSENT key', () => {
    expect(canonicalJson({ a: null, b: undefined, c: 1 })).toBe('{"a":null,"c":1}');
  });

  it('rejects a string that is not UTF-8-encodable', () => {
    expect(() => canonicalJson({ a: '\ud800' })).toThrow(CanonicalJsonError);
  });
});

describe('clause 4 is a SCHEMA guarantee, not a serialiser step', () => {
  /**
   * §7.1 says "empty optional arrays omitted (D11)", which reads like a serialiser rule and is
   * not one: several REQUIRED arrays (`Paper.relations`, every `Flows.*`, `Section.block_ids`)
   * are legitimately empty, so a serialiser that dropped empty arrays would turn a valid document
   * into an invalid one. What actually holds the line is `minItems: 1` on every OPTIONAL array,
   * which makes an empty optional array unrepresentable. This test asserts THAT, so a future
   * optional array shipped without `minItems` fails here instead of quietly reopening the gap.
   */
  it('every optional array in the schema carries minItems >= 1', () => {
    const defs = SCHEMA.$defs as Record<string, Record<string, unknown>>;
    const offenders: string[] = [];
    let checked = 0;
    for (const [defName, def] of Object.entries(defs)) {
      const properties = def['properties'] as Record<string, Record<string, unknown>> | undefined;
      if (properties === undefined) continue;
      const required = new Set((def['required'] as string[] | undefined) ?? []);
      for (const [prop, node] of Object.entries(properties)) {
        let target = node;
        const ref = node['$ref'] as string | undefined;
        if (ref !== undefined) target = defs[ref.split('/').pop() as string] as typeof node;
        if (target['type'] !== 'array' || required.has(prop)) continue;
        checked += 1;
        if (((target['minItems'] as number | undefined) ?? 0) < 1) {
          offenders.push(`${defName}.${prop}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describe('the two languages agree on the bytes of the SAME committed fixture', () => {
  it.each(CONTRACT.fixture_vectors.map((v) => [v.fixture, v] as const))('%s', (name, vector) => {
    const raw = readFileSync(join(PKG, 'fixtures', name), 'utf8');
    const document = JSON.parse(raw) as JsonValue;
    const canonical = canonicalJson(document);
    expect(Buffer.byteLength(canonical, 'utf8')).toBe(vector.canonical_bytes);
    expect(createHash('sha256').update(canonical, 'utf8').digest('hex')).toBe(
      vector.canonical_sha256,
    );
    expect(
      createHash('sha256').update(canonicalJsonForDeterminism(document), 'utf8').digest('hex'),
    ).toBe(vector.determinism_sha256);
  });

  it('is stable under re-serialisation, which is criterion 1 in one line', () => {
    for (const vector of CONTRACT.fixture_vectors) {
      const document = JSON.parse(readFileSync(join(PKG, 'fixtures', vector.fixture), 'utf8'));
      const once = canonicalJson(document as JsonValue);
      expect(canonicalJson(JSON.parse(once) as JsonValue)).toBe(once);
    }
  });

  it('strips parser.parsed_at and NOTHING else', () => {
    const document = JSON.parse(
      readFileSync(join(PKG, 'fixtures/resnet-cvpr-2col.paperir.json'), 'utf8'),
    ) as Record<string, unknown>;
    const moved = structuredClone(document);
    (moved['parser'] as Record<string, unknown>)['parsed_at'] = '2099-01-01T00:00:00Z';
    expect(canonicalJsonForDeterminism(moved as JsonValue)).toBe(
      canonicalJsonForDeterminism(document as JsonValue),
    );
    // …and a real change is still visible, so this is not "ignore everything".
    const changed = structuredClone(document);
    (changed['parser'] as Record<string, unknown>)['profile'] = 'something-else';
    expect(canonicalJsonForDeterminism(changed as JsonValue)).not.toBe(
      canonicalJsonForDeterminism(document as JsonValue),
    );
  });
});

describe('SERIALISATION round-trip, which nothing used to exercise', () => {
  /**
   * The hard rule is "`unknown` is a valid block type and must round-trip", and "round-trips" was
   * only ever proven as "validates". Here the block goes out through the canonicaliser and comes
   * back through the schema and the semantic validator.
   */
  it.each(['attention-is-all-you-need', 'neural-odes-mathheavy', 'resnet-cvpr-2col'])(
    '%s survives parse -> canonicalise -> re-parse with an unknown block appended',
    (slug) => {
      const document = JSON.parse(
        readFileSync(join(PKG, `fixtures/${slug}.paperir.json`), 'utf8'),
      ) as Record<string, unknown>;
      const blocks = document['blocks'] as Record<string, unknown>[];
      const model = structuredClone(blocks[0] as Record<string, unknown>);
      const unknown: Record<string, unknown> = {
        ...model,
        block_id: 'blk_zzzzzzzzzzzzzzzz',
        type: 'brand_new_type_v9',
        order: 100_000,
        doc_order: 100_000,
        payload: { opaque_field: [1, 2, { nested: true }] },
      };
      delete unknown['text'];
      delete unknown['text_normalised'];
      delete unknown['content_hash'];
      delete unknown['spans'];
      delete unknown['parent_id'];
      delete unknown['prev_id'];
      delete unknown['next_id'];
      delete unknown['child_ids'];
      delete unknown['repairs'];
      delete unknown['alternatives'];
      blocks.push(unknown);

      const bytes = canonicalJson(document as JsonValue);
      const reparsed = JSON.parse(bytes) as Record<string, unknown>;

      // 1. still schema-valid, and 2. byte-stable.
      expect(PaperSchema.safeParse(reparsed).success).toBe(true);
      expect(canonicalJson(reparsed as JsonValue)).toBe(bytes);

      // 3. the unknown block came back intact: type, geometry, payload, and NO invented text.
      const back = (reparsed['blocks'] as Record<string, unknown>[]).find(
        (b) => b['block_id'] === 'blk_zzzzzzzzzzzzzzzz',
      );
      expect(back?.['type']).toBe('brand_new_type_v9');
      expect(back?.['polygon']).toEqual(model['polygon']);
      expect(back?.['payload']).toEqual({ opaque_field: [1, 2, { nested: true }] });
      expect('text' in (back as object)).toBe(false);

      // 4. and the semantic validator has no new complaint about the round-tripped document
      //    that it did not already have about the one carrying the appended block.
      const before = validatePaper(document as unknown as Paper).diagnostics.map((d) => d.rule);
      const after = validatePaper(reparsed as unknown as Paper).diagnostics.map((d) => d.rule);
      expect(after).toEqual(before);
    },
  );
});
