/**
 * document-ir/canonical — the ONE implementation of DESIGN.md §7.1 canonical JSON.
 *
 * §7.1 defines definition-of-done criterion 1 ("re-parsing produces byte-identical PaperIR")
 * normatively, in prose, and Epic 0 shipped no implementation of it. That is the one contract
 * Epic 0 left as prose, and it is exactly the shape of the failure `findings.md` is about:
 * `worker/determinism.spec` (Epic 1) and Epic 2 would each have written their own, in different
 * languages, from four clauses of English — and the two runtimes' default JSON number formatting
 * already disagrees on values this schema permits (`JSON.stringify(1e16)` is
 * `"10000000000000000"`, `json.dumps(1e16)` is `"1e+16"`; the shipped fixtures store
 * `"confidence": 1.0`, which JavaScript re-emits as `1`).
 *
 * THE FOUR CLAUSES, and which of them is code:
 *
 *   1. KEYS SORTED — by UNICODE CODE POINT, implemented explicitly in both languages. Not
 *      `Array.prototype.sort`'s default, which is UTF-16 code-unit order and disagrees with
 *      Python's `sorted()` for any key mixing astral characters with U+E000…U+FFFF. PaperIR's
 *      own keys are ASCII identifiers so the two orders coincide today; this function is
 *      generic, and "coincides today" is how a contract rots.
 *   2. NO INSIGNIFICANT WHITESPACE — no spaces after `:` or `,`, no newlines.
 *   3. NUMBERS IN SHORTEST ROUND-TRIP FORM — ECMAScript `Number::toString` (ECMA-262 §6.1.6.1.20)
 *      in BOTH languages. JavaScript gets it for free from `String(n)`; `canonical.py` implements
 *      the algorithm, because Python's `repr` is also shortest-round-trip but formats differently.
 *      An integer outside ±(2^53 − 1) is REJECTED rather than emitted, for the same reason
 *      `identity.quantise` rejects one: it cannot survive the round trip through a double, and a
 *      silent fork is worse than an error.
 *   4. EMPTY OPTIONAL ARRAYS OMITTED (D11) — NOT DONE HERE, ON PURPOSE, and this is the one place
 *      §7.1's prose is misleading. Every optional array in the schema carries `minItems: 1`, so an
 *      empty optional array is not schema-valid and cannot reach this function; whereas several
 *      REQUIRED arrays (`Paper.relations`, every `Flows.*`, `Section.block_ids`) legitimately are
 *      empty, and a serialiser that dropped empty arrays would turn a valid document into an
 *      invalid one. The clause is a SCHEMA guarantee, not a serialiser step.
 *      `canonical.spec` asserts that property directly, so if a future optional array ships
 *      without `minItems: 1` the test fails rather than this comment going quietly stale.
 *
 * WHAT THIS IS NOT: a hash, a validator, or a normalisation of CONTENT. It reorders and
 * reformats; it never changes a value. `identity.normaliseText` is the only text normalisation
 * in the system and this function does not call it.
 */

/** Values this function accepts. `undefined` is only legal as an object property value. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

/** `|n| <= 2^53 - 1`, the same bound `identity.quantise` enforces and for the same reason. */
export const MAX_SAFE_JSON_INTEGER = 9007199254740991;

export class CanonicalJsonError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`${message} at ${path === '' ? '<root>' : path}`);
    this.name = 'CanonicalJsonError';
    this.path = path;
  }
}

/**
 * Code-point order, not UTF-16 code-unit order. `'\u{1F600}' < '�'` is TRUE by code point
 * and FALSE by code unit, and Python's `sorted()` uses the former.
 */
function compareByCodePoint(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = (left[i] as string).codePointAt(0) as number;
    const y = (right[i] as string).codePointAt(0) as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/**
 * Reject text that cannot be encoded as UTF-8. A lone surrogate makes `JSON.stringify` emit a
 * `\udXXX` escape that Python's `json.dumps` will not produce from any input, so the two
 * canonicalisations would differ on a document neither language considers malformed.
 */
function assertEncodable(text: string, path: string): void {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalJsonError('string contains an unpaired high surrogate', path);
      }
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new CanonicalJsonError('string contains an unpaired low surrogate', path);
    }
  }
}

function encodeNumber(value: number, path: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(`number must be finite, got ${String(value)}`, path);
  }
  if (Number.isInteger(value) && Math.abs(value) > MAX_SAFE_JSON_INTEGER) {
    throw new CanonicalJsonError(
      `integer ${String(value)} is outside +/-${String(MAX_SAFE_JSON_INTEGER)} and cannot ` +
        `round-trip through a double: reject, never emit`,
      path,
    );
  }
  // ECMAScript Number::toString. `-0` prints as `0`, which is what Python's twin also emits:
  // JSON has no negative zero and `identity.quantise` makes the same choice.
  return value === 0 ? '0' : String(value);
}

function write(value: JsonValue, path: string, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  if (typeof value === 'boolean') {
    out.push(value ? 'true' : 'false');
    return;
  }
  if (typeof value === 'number') {
    out.push(encodeNumber(value, path));
    return;
  }
  if (typeof value === 'string') {
    assertEncodable(value, path);
    out.push(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out.push(',');
      write(value[i] as JsonValue, `${path}[${String(i)}]`, out);
    }
    out.push(']');
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, JsonValue | undefined>;
    // `undefined` is dropped, exactly as JSON.stringify drops it and as Pydantic's
    // `exclude_unset=True` drops an unset optional. `null` is NOT dropped: the schema
    // distinguishes "absent" from "null" and D11 turns on that distinction.
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .toSorted(compareByCodePoint);
    out.push('{');
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i] as string;
      if (i > 0) out.push(',');
      assertEncodable(key, path);
      out.push(JSON.stringify(key), ':');
      write(record[key] as JsonValue, path === '' ? key : `${path}.${key}`, out);
    }
    out.push('}');
    return;
  }
  throw new CanonicalJsonError(`value of type ${typeof value} is not JSON`, path);
}

/**
 * The canonical bytes of `value`, per DESIGN.md §7.1. `canonical.py`'s `canonical_json` returns
 * the same string for the same input; `conformance/canonical-vectors.json` pins the pair.
 *
 * @throws CanonicalJsonError on a non-finite number, an integer outside ±(2^53 − 1), an
 *   unpaired surrogate, or a value that is not JSON.
 */
export function canonicalJson(value: JsonValue): string {
  const out: string[] = [];
  write(value, '', out);
  return out.join('');
}

/**
 * The canonical bytes of a PaperIR document with `parser.parsed_at` removed — definition-of-done
 * criterion 1's "byte-identical … after removing parser.parsed_at".
 *
 * `parsed_at` is a wall-clock timestamp, so it differs on every parse of the same bytes by the
 * same parser and it is the ONE field the criterion excuses. Nothing else is removed: a
 * determinism check that quietly ignored a second field would be measuring something other than
 * what it claims. This is the function `worker/determinism.spec` (Epic 1) should call — not a
 * second copy of the rule.
 */
export function canonicalJsonForDeterminism(paper: JsonValue): string {
  const clone = JSON.parse(JSON.stringify(paper)) as Record<string, unknown>;
  const parser = clone['parser'] as Record<string, unknown> | undefined;
  if (parser !== undefined) delete parser['parsed_at'];
  return canonicalJson(clone as JsonValue);
}
