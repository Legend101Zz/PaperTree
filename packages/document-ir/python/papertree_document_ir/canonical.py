"""The Python twin of ``src/canonical.ts``: DESIGN.md §7.1 canonical JSON.

§7.1 defines definition-of-done criterion 1 ("re-parsing produces byte-identical PaperIR")
normatively, in prose, and Epic 0 shipped no implementation of it. That is the one contract Epic 0
left as prose, and it is exactly the shape of the failure ``findings.md`` is about: Epic 1's
``worker/determinism.spec`` and Epic 2 would each have written their own, in different languages,
from four clauses of English.

THE FOUR CLAUSES, and which of them is code:

1. KEYS SORTED - by UNICODE CODE POINT, which is what Python's ``sorted()`` already does and what
   ``canonical.ts`` implements explicitly (JavaScript's default sort is UTF-16 code-unit order and
   disagrees for keys mixing astral characters with U+E000..U+FFFF).
2. NO INSIGNIFICANT WHITESPACE.
3. NUMBERS IN SHORTEST ROUND-TRIP FORM - ECMAScript ``Number::toString`` (ECMA-262 §6.1.6.1.20) in
   BOTH languages, implemented here because Python's ``repr`` is also shortest-round-trip but
   formats differently: ``repr(1.0)`` is ``'1.0'`` where ``String(1)`` is ``'1'``, and
   ``repr(1e16)`` is ``'1e+16'`` where ``String(1e16)`` is ``'10000000000000000'``. The shipped
   fixtures store ``"confidence": 1.0``, so this is the clause the two languages actually differed
   on: 145 numeric literals in one golden fixture, 112 359 bytes against 112 777.
4. EMPTY OPTIONAL ARRAYS OMITTED (D11) - NOT DONE HERE, ON PURPOSE. Every optional array in the
   schema carries ``minItems: 1``, so an empty optional array is not schema-valid and cannot reach
   this function; whereas several REQUIRED arrays (``Paper.relations``, every ``Flows.*``,
   ``Section.block_ids``) legitimately are empty, and a serialiser that dropped empty arrays would
   turn a valid document into an invalid one. The clause is a SCHEMA guarantee, not a serialiser
   step, and ``test_canonical.py`` asserts that property directly.

WHAT THIS IS NOT: a hash, a validator, or a normalisation of CONTENT. It reorders and reformats;
it never changes a value.
"""

from __future__ import annotations

import json
import math
from typing import Any

__all__ = [
    "MAX_SAFE_JSON_INTEGER",
    "CanonicalJsonError",
    "canonical_json",
    "canonical_json_for_determinism",
    "ecmascript_number_to_string",
]

#: ``|n| <= 2**53 - 1``, the same bound ``identity.quantise`` enforces and for the same reason.
MAX_SAFE_JSON_INTEGER = 9007199254740991


class CanonicalJsonError(ValueError):
    """Raised on a value that has no canonical form both languages agree on."""

    def __init__(self, message: str, path: str) -> None:
        super().__init__(f"{message} at {path or '<root>'}")
        self.path = path


def ecmascript_number_to_string(value: float) -> str:
    """ECMA-262 §6.1.6.1.20 ``Number::toString(x, 10)``, which is what ``String(x)`` gives in JS.

    Python's ``repr`` already produces the SHORTEST decimal digits that round-trip (the same
    Ryu/Grisu-style result JavaScript uses), so the digits are taken from it and only the LAYOUT
    is re-derived - which is the half the two languages disagree about.
    """
    if isinstance(value, bool):  # bool is an int subclass; never let it reach the float path
        raise TypeError("bool is not a number here")
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_JSON_INTEGER:
            raise ValueError(f"integer {value} cannot round-trip through a double")
        value = float(value)
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"number must be finite, got {value}")
    if value == 0:
        return "0"  # covers -0.0; JSON has no negative zero and JS prints "0" too
    if value < 0:
        return "-" + ecmascript_number_to_string(-value)

    text = repr(value)
    if "e" in text or "E" in text:
        mantissa, _, exponent = text.replace("E", "e").partition("e")
        scale = int(exponent)
    else:
        mantissa, scale = text, 0
    integral, _, fractional = mantissa.partition(".")
    digits = integral + fractional
    # value == int(digits) * 10 ** (scale - len(fractional))
    power = scale - len(fractional)
    stripped = digits.lstrip("0")
    power += 0  # leading zeros do not move the point; they only shorten the digit string
    trimmed = stripped.rstrip("0")
    power += len(stripped) - len(trimmed)
    s = trimmed or "0"
    k = len(s)
    n = k + power  # value == 0.s * 10**n, ECMA's (s, k, n)

    if k <= n <= 21:
        return s + "0" * (n - k)
    if 0 < n <= 21:
        return s[:n] + "." + s[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + s
    # Exponential form. ECMA emits the exponent with an explicit sign and no leading zeros.
    exponent_part = f"e{'+' if n - 1 >= 0 else '-'}{abs(n - 1)}"
    if k == 1:
        return s + exponent_part
    return s[0] + "." + s[1:] + exponent_part


def _assert_encodable(text: str, path: str) -> None:
    """Reject text that cannot be encoded as UTF-8.

    A lone surrogate makes JavaScript's ``JSON.stringify`` emit a ``\\udXXX`` escape that
    ``json.dumps`` never produces, so the two canonicalisations would differ on a document neither
    language considers malformed.
    """
    for index, char in enumerate(text):
        if 0xD800 <= ord(char) <= 0xDFFF:
            raise CanonicalJsonError(
                f"string contains an unpaired surrogate at code point index {index}", path
            )


def _encode_string(text: str, path: str) -> str:
    _assert_encodable(text, path)
    # `ensure_ascii=False` matches JSON.stringify, which escapes only `"`, `\` and C0 controls.
    return json.dumps(text, ensure_ascii=False, separators=(",", ":"))


def _write(value: Any, path: str, out: list[str]) -> None:
    if value is None:
        out.append("null")
        return
    if isinstance(value, bool):  # BEFORE int: bool is an int subclass in Python and not in JS
        out.append("true" if value else "false")
        return
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_JSON_INTEGER:
            raise CanonicalJsonError(
                f"integer {value} is outside +/-{MAX_SAFE_JSON_INTEGER} and cannot round-trip "
                f"through a double: reject, never emit",
                path,
            )
        out.append(ecmascript_number_to_string(value))
        return
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise CanonicalJsonError(f"number must be finite, got {value}", path)
        # SAME BOUND AS THE int BRANCH, and the symmetry is the point: in JavaScript every number
        # is a double, so `1e16` and the literal `10000000000000000` are one value and one branch.
        # If this branch were laxer, `canonical.ts` would reject a document `canonical.py`
        # accepted - an asymmetric-acceptance fork, which is the same defect class as a byte fork
        # and harder to diagnose. PaperIR bounds every numeric field far below 2**53, so this can
        # only fire on input the schema would reject anyway.
        if value.is_integer() and abs(value) > MAX_SAFE_JSON_INTEGER:
            raise CanonicalJsonError(
                f"integer-valued number {value!r} is outside +/-{MAX_SAFE_JSON_INTEGER} and "
                f"cannot round-trip through a double: reject, never emit",
                path,
            )
        out.append(ecmascript_number_to_string(value))
        return
    if isinstance(value, str):
        out.append(_encode_string(value, path))
        return
    if isinstance(value, (list, tuple)):
        out.append("[")
        for index, item in enumerate(value):
            if index:
                out.append(",")
            _write(item, f"{path}[{index}]", out)
        out.append("]")
        return
    if isinstance(value, dict):
        # `None` VALUES ARE KEPT; only absent keys are absent. The schema distinguishes "absent"
        # from "null" and D11 turns on that distinction, so a canonicaliser that dropped nulls
        # would erase a difference the contract relies on.
        keys = sorted(value)
        out.append("{")
        for index, key in enumerate(keys):
            if not isinstance(key, str):
                raise CanonicalJsonError(f"object key {key!r} is not a string", path)
            if index:
                out.append(",")
            out.append(_encode_string(key, path))
            out.append(":")
            _write(value[key], key if path == "" else f"{path}.{key}", out)
        out.append("}")
        return
    raise CanonicalJsonError(f"value of type {type(value).__name__} is not JSON", path)


def canonical_json(value: Any) -> str:
    """The canonical bytes of ``value``, per DESIGN.md §7.1.

    ``canonical.ts``'s ``canonicalJson`` returns the same string for the same input;
    ``conformance/canonical-vectors.json`` pins the pair so neither language is the oracle.
    """
    out: list[str] = []
    _write(value, "", out)
    return "".join(out)


def canonical_json_for_determinism(paper: Any) -> str:
    """Canonical bytes with ``parser.parsed_at`` removed.

    Definition-of-done criterion 1's "byte-identical ... after removing parser.parsed_at".
    ``parsed_at`` is a wall clock, so it differs on every parse of the same bytes by the same
    parser, and it is the ONE field the criterion excuses. Nothing else is removed.
    """
    clone = json.loads(json.dumps(paper, default=str))
    parser = clone.get("parser") if isinstance(clone, dict) else None
    if isinstance(parser, dict):
        parser.pop("parsed_at", None)
    return canonical_json(clone)
