"""A JSON Schema (2020-12) checker for the keywords `contracts/` uses. A TEST HELPER, not a
dependency: contracts.md §0 says "No new Python dependency", and no validator is locked.

It REFUSES a keyword it does not implement (`UnsupportedKeyword`) rather than ignoring it. A
checker that silently skips `if`/`then`, say, passes every stream and measures nothing — the
vacuous green AGENTS.md §2 records. The TypeScript side validates the same files with ajv, so a
disagreement between the two checkers fails one side or the other.
"""

from __future__ import annotations

import re
from typing import Any

#: Annotations: no effect on validity.
_ANNOTATIONS = frozenset({"$schema", "$id", "title", "description", "default", "examples"})
_KEYWORDS = frozenset(
    {
        "$ref",
        "$defs",
        "type",
        "enum",
        "const",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "prefixItems",
        "minItems",
        "maxItems",
        "uniqueItems",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minLength",
        "maxLength",
        "pattern",
        "anyOf",
        "oneOf",
        "allOf",
        "if",
        "then",
        "else",
    }
)


class UnsupportedKeyword(Exception):
    pass


def json_equal(a: Any, b: Any) -> bool:
    """JSON equality: `true` is not `1` (Python says it is), `1` is `1.0` (JSON Schema says so)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, int | float) and isinstance(b, int | float):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(json_equal(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(json_equal(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b


def _is_type(value: Any, name: str) -> bool:
    if name == "null":
        return value is None
    if name == "boolean":
        return isinstance(value, bool)
    if name == "integer":
        return (isinstance(value, int) and not isinstance(value, bool)) or (
            isinstance(value, float) and value.is_integer()
        )
    if name == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    if name == "string":
        return isinstance(value, str)
    if name == "array":
        return isinstance(value, list)
    if name == "object":
        return isinstance(value, dict)
    raise UnsupportedKeyword(f"type {name!r}")


class Validator:
    def __init__(self, root: dict[str, Any]) -> None:
        self.root = root

    def resolve(self, ref: str) -> Any:
        if not ref.startswith("#/"):
            raise UnsupportedKeyword(f"$ref {ref!r} (only local refs)")
        node: Any = self.root
        for part in ref[2:].split("/"):
            node = node[part]
        return node

    def errors(self, value: Any, schema: Any = None, path: str = "$") -> list[str]:
        schema = self.root if schema is None else schema
        if schema is True:
            return []
        if schema is False:
            return [f"{path}: no value is allowed here"]
        unknown = set(schema) - _KEYWORDS - _ANNOTATIONS
        if unknown:
            raise UnsupportedKeyword(f"{path}: {sorted(unknown)}")
        out: list[str] = []
        if "$ref" in schema:
            out += self.errors(value, self.resolve(schema["$ref"]), path)
        if "type" in schema:
            names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
            if not any(_is_type(value, n) for n in names):
                return out + [f"{path}: expected {names}, got {type(value).__name__}"]
        if "enum" in schema and not any(json_equal(value, e) for e in schema["enum"]):
            out.append(f"{path}: {value!r} is not one of {schema['enum']}")
        if "const" in schema and not json_equal(value, schema["const"]):
            out.append(f"{path}: {value!r} is not {schema['const']!r}")
        if isinstance(value, str):
            if "minLength" in schema and len(value) < schema["minLength"]:
                out.append(f"{path}: shorter than {schema['minLength']}")
            if "maxLength" in schema and len(value) > schema["maxLength"]:
                out.append(f"{path}: longer than {schema['maxLength']}")
            if "pattern" in schema and re.search(schema["pattern"], value) is None:
                out.append(f"{path}: {value!r} does not match {schema['pattern']}")
        if isinstance(value, int | float) and not isinstance(value, bool):
            if "minimum" in schema and value < schema["minimum"]:
                out.append(f"{path}: {value} < {schema['minimum']}")
            if "maximum" in schema and value > schema["maximum"]:
                out.append(f"{path}: {value} > {schema['maximum']}")
            if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
                out.append(f"{path}: {value} <= {schema['exclusiveMinimum']}")
            if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
                out.append(f"{path}: {value} >= {schema['exclusiveMaximum']}")
        if isinstance(value, list):
            out += self._array(value, schema, path)
        if isinstance(value, dict):
            out += self._object(value, schema, path)
        for sub in schema.get("allOf", []):
            out += self.errors(value, sub, path)
        if "anyOf" in schema and not any(not self.errors(value, s, path) for s in schema["anyOf"]):
            out.append(f"{path}: matches none of anyOf")
        if "oneOf" in schema:
            matched = sum(1 for s in schema["oneOf"] if not self.errors(value, s, path))
            if matched != 1:
                out.append(f"{path}: matches {matched} of oneOf, not exactly 1")
        if "if" in schema:
            branch = "then" if not self.errors(value, schema["if"], path) else "else"
            if branch in schema:
                out += self.errors(value, schema[branch], path)
        return out

    def _array(self, value: list[Any], schema: dict[str, Any], path: str) -> list[str]:
        out: list[str] = []
        if "minItems" in schema and len(value) < schema["minItems"]:
            out.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            out.append(f"{path}: more than {schema['maxItems']} items")
        if schema.get("uniqueItems"):
            for i, a in enumerate(value):
                if any(json_equal(a, b) for b in value[:i]):
                    out.append(f"{path}[{i}]: duplicate item")
        prefix = schema.get("prefixItems", [])
        for i, sub in enumerate(prefix[: len(value)]):
            out += self.errors(value[i], sub, f"{path}[{i}]")
        if "items" in schema:
            for i in range(len(prefix), len(value)):
                out += self.errors(value[i], schema["items"], f"{path}[{i}]")
        return out

    def _object(self, value: dict[str, Any], schema: dict[str, Any], path: str) -> list[str]:
        out = [f"{path}: missing {key!r}" for key in schema.get("required", []) if key not in value]
        properties = schema.get("properties", {})
        for key, item in value.items():
            if key in properties:
                out += self.errors(item, properties[key], f"{path}.{key}")
            elif "additionalProperties" in schema:
                out += self.errors(item, schema["additionalProperties"], f"{path}.{key}")
        return out


def validate(value: Any, root: dict[str, Any], ref: str | None = None) -> list[str]:
    """Errors of `value` against `root` (or against `root`'s `ref`, e.g. `#/$defs/done`)."""
    validator = Validator(root)
    return validator.errors(value, validator.resolve(ref) if ref else root)
