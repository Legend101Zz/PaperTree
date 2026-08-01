"""A JSON Schema SUBSET validator, written here, in the standard library, on purpose.

WHY NOT ``jsonschema``
    EPIC-03 §4: *"No new runtime dependency without a one-line justification."* The measured
    precedent is in ``packages/evaluation``'s pyproject: one ``docling>=2.0`` line took the
    workspace lock from 22 packages to 100+, because uv locks a dependency group whether or not
    it installs it — and ``uv sync --locked --all-packages`` is a CI gate, so the lock moving is
    a failed build for everyone, not a slower install for the person who added it. ``jsonschema``
    is a smaller blast radius than docling and it is still four packages
    (``jsonschema``, ``attrs``, ``jsonschema-specifications``, ``referencing``) for a feature
    this package uses at exactly one call site with a schema vocabulary of fourteen keywords.

WHAT MAKES A HAND-ROLLED VALIDATOR DANGEROUS, AND THE ONE RULE THAT DEFUSES IT
    A partial validator's failure mode is not "it rejects something valid". It is **it silently
    ignores the keyword you were relying on**. A schema that says ``"minItems": 768`` against a
    validator that has never heard of ``minItems`` reads, in review, as an enforced bound; the
    reviewer moves on; the bound is not there. That is the same shape as this repo's recurring
    defect (AGENTS.md §2: *"a green test may assert less than it appears to"*).

    So this module's load-bearing rule is not in :func:`validate_arguments`, it is in
    :func:`check_schema`: **every keyword in a registered schema must be one this validator
    implements, or registration fails.** An unimplemented keyword is a registration-time error
    with the keyword's name in it, never a call-time no-op. ``tests/test_registry.py`` asserts
    this with ``"multipleOf"``, which is real JSON Schema and is not implemented here.

    The corollary is that the supported set can grow deliberately and can never grow by
    accident. :data:`CONSTRAINT_KEYWORDS` is the complete list and it is what the tests assert
    against.

WHAT IS DELIBERATELY ABSENT
    ``$ref``, ``$defs``, ``allOf``/``anyOf``/``oneOf``/``not``, ``if``/``then``/``else``,
    ``patternProperties``, ``propertyNames``, ``dependentRequired``, ``format``, ``const``,
    ``multipleOf``, ``uniqueItems``, ``exclusiveMinimum``/``exclusiveMaximum``, tuple-form
    ``items``, and ``additionalProperties`` as a subschema. None of the eighteen tool schemas in
    ``tools.py`` needs one, and every one of them is a place where a partial implementation
    could be subtly wrong in a way that reads as correct. A tool that grows a need for one
    should get the keyword implemented here with a test, not a ``# type: ignore`` at the call
    site.

TWO PYTHON FACTS THIS MODULE IS BUILT AROUND, BOTH MEASURED IN A REPL BEFORE BEING RELIED ON
    1. ``isinstance(True, int)`` is ``True``. ``bool`` is a subclass of ``int``, so the obvious
       ``isinstance(value, int)`` accepts ``True`` for an ``"integer"`` argument and a model that
       emitted ``{"radius": true}`` would get ``radius == 1`` with no error anywhere. Every
       numeric check here excludes ``bool`` explicitly, and ``tests/test_registry.py`` asserts
       it, because this is the exact class of bug that is invisible in review.
    2. ``json.loads`` produces ``int`` for ``2`` and ``float`` for ``2.0``. A ``"number"``
       therefore accepts both, and an ``"integer"`` accepts only ``int`` — ``2.0`` is rejected
       rather than coerced, because a silent coercion is a value the caller did not send.

DEFAULTS ARE APPLIED, AND THAT IS A DECISION
    :func:`validate_arguments` returns a NEW dict with ``default`` filled in for absent optional
    properties. The alternative — every handler writing ``args.get("radius", 2)`` — puts the
    default in two places (the schema the model reads, and the code that runs) and they drift.
    Filling here means the model's documentation of the default and the executed default are the
    same literal. Defaults are validated against their own schema at :func:`check_schema` time,
    so a schema declaring ``{"type": "integer", "default": "two"}`` fails at registration.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any, Final

__all__ = [
    "ANNOTATION_KEYWORDS",
    "CONSTRAINT_KEYWORDS",
    "SUPPORTED_TYPES",
    "SchemaError",
    "ToolArgumentError",
    "check_schema",
    "validate_arguments",
]

#: Keywords that constrain a value. Everything this validator actually enforces.
CONSTRAINT_KEYWORDS: Final[frozenset[str]] = frozenset(
    {
        "type",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "enum",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "pattern",
        "default",
    }
)

#: Keywords that document a value and constrain nothing. Permitted because the schema is shown
#: to the model verbatim and a tool argument with no description is a tool argument the model
#: will guess at; refusing them would push the documentation somewhere the model cannot see.
ANNOTATION_KEYWORDS: Final[frozenset[str]] = frozenset({"description", "title", "examples"})

#: The seven JSON types. ``"null"`` is here because "the caller explicitly said there is none"
#: and "the caller omitted the key" are different statements and the answer contract needs both.
SUPPORTED_TYPES: Final[frozenset[str]] = frozenset(
    {"object", "array", "string", "integer", "number", "boolean", "null"}
)


class SchemaError(ValueError):
    """A schema this validator cannot faithfully enforce. Raised at REGISTRATION, never later.

    A ``ValueError`` on purpose, unlike :class:`ToolArgumentError`: this is a programming error
    in this repository's own source, discovered at import time by the test suite, and there is
    no call site that should be catching it.
    """


class ToolArgumentError(Exception):
    """Arguments that do not satisfy a tool's schema. Raised BEFORE the callable runs.

    Deliberately NOT a ``ValueError``, for the reason ``papertree_prompts.untrusted`` gives for
    ``UntrustedRenderError``: a runtime driving a model's tool calls wraps decoding in
    ``except ValueError`` as a matter of habit, and a swallowed argument-validation failure means
    a handler ran against arguments nobody checked. The runtime adapter is supposed to catch this
    by its own name and hand the model back a message it can correct from.
    """

    def __init__(self, tool: str, path: str, message: str) -> None:
        self.tool = tool
        self.path = path
        self.message = message
        super().__init__(f"{tool}: {path or '<arguments>'}: {message}")


def check_schema(schema: Mapping[str, Any], *, where: str = "<root>") -> None:
    """Rejects any schema this validator would not fully enforce. Called once, at registration.

    ``where`` is a JSON-Pointer-ish breadcrumb so the message names the nested subschema rather
    than the tool: a 40-line tool schema with one bad keyword six levels down is otherwise a
    hunt.
    """
    unknown = sorted(set(schema) - CONSTRAINT_KEYWORDS - ANNOTATION_KEYWORDS)
    if unknown:
        raise SchemaError(
            f"{where}: keyword(s) {unknown} are not implemented by papertree_agent_tools.schema. "
            "An unimplemented keyword would be SILENTLY IGNORED at call time, which reads as an "
            f"enforced constraint and is not one. Implemented: {sorted(CONSTRAINT_KEYWORDS)}."
        )

    for name in _declared_types(schema):
        if name not in SUPPORTED_TYPES:
            raise SchemaError(f"{where}: type={name!r} is not one of {sorted(SUPPORTED_TYPES)}")

    if "pattern" in schema:
        try:
            re.compile(str(schema["pattern"]))
        except re.error as exc:
            raise SchemaError(f"{where}: pattern is not a valid regex: {exc}") from exc

    if "additionalProperties" in schema and schema["additionalProperties"] is not False:
        raise SchemaError(
            f"{where}: additionalProperties must be False when present. A subschema form is not "
            "implemented, and `true` is the default anyway — writing it would state a policy "
            "this validator does not apply."
        )

    properties = schema.get("properties")
    if properties is not None:
        if not isinstance(properties, Mapping):
            raise SchemaError(f"{where}: properties must be an object")
        for name, subschema in properties.items():
            if not isinstance(subschema, Mapping):
                raise SchemaError(f"{where}/properties/{name}: must be an object")
            check_schema(subschema, where=f"{where}/properties/{name}")
            if "default" in subschema:
                # A default that does not satisfy its own schema is a landmine: it passes
                # review, and detonates only for the caller that omits the key.
                _validate(
                    "<schema>",
                    subschema,
                    subschema["default"],
                    f"{where}/properties/{name}/default",
                )

    required = schema.get("required")
    if required is not None:
        if not isinstance(required, Sequence) or isinstance(required, str):
            raise SchemaError(f"{where}: required must be an array of property names")
        known = set(properties or {})
        missing = [name for name in required if name not in known]
        if missing:
            raise SchemaError(
                f"{where}: required names {missing}, which are not in properties. A required "
                "property with no schema is unenforceable in both directions."
            )

    items = schema.get("items")
    if items is not None:
        if not isinstance(items, Mapping):
            raise SchemaError(
                f"{where}/items: must be a single object schema. Tuple-form `items` (an array of "
                "schemas) is not implemented."
            )
        check_schema(items, where=f"{where}/items")


def validate_arguments(
    tool: str, schema: Mapping[str, Any], arguments: Mapping[str, Any]
) -> dict[str, Any]:
    """Validates ``arguments`` against ``schema`` and returns a new dict with defaults filled.

    Raises :class:`ToolArgumentError` naming the offending path. The returned dict is a fresh
    top-level object; nested values are the caller's own objects and are not copied, because a
    deep copy would silently change the identity of a 768-float embedding on every call for no
    safety gain (nothing downstream mutates it).
    """
    validated = _validate(tool, schema, arguments, "")
    if not isinstance(validated, dict):  # pragma: no cover - tool schemas are always objects
        raise ToolArgumentError(tool, "", "a tool's argument schema must have type 'object'")
    return validated


def _declared_types(schema: Mapping[str, Any]) -> tuple[str, ...]:
    """``type`` as a tuple. JSON Schema allows a string or an array of strings, and this codebase
    needs the array form: the repo-wide "required and nullable" pattern (``Metadata``,
    ``EquationPayload.image``, ``GroundedAnswer.interpretation``) is exactly
    ``{"type": ["string", "null"]}``. Encoding it as an OPTIONAL property instead would collapse
    "we looked and there is none" into "nobody said", which is the encoding-of-absence rule
    ``papertree_document_ir`` is built on."""
    declared = schema.get("type")
    if declared is None:
        return ()
    if isinstance(declared, str):
        return (declared,)
    if isinstance(declared, Sequence):
        return tuple(str(name) for name in declared)
    raise SchemaError(f"type must be a string or an array of strings, got {declared!r}")


def _validate(tool: str, schema: Mapping[str, Any], value: Any, path: str) -> Any:
    declared = _declared_types(schema)
    if declared:
        _check_type(tool, declared, value, path)

    if "enum" in schema:
        allowed = list(schema["enum"])
        if value not in allowed:
            raise ToolArgumentError(tool, path, f"{value!r} is not one of {allowed}")

    if isinstance(value, str) and not isinstance(value, bool):
        _check_string(tool, schema, value, path)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        _check_number(tool, schema, value, path)
    if isinstance(value, list):
        return _check_array(tool, schema, value, path)
    if isinstance(value, Mapping):
        return _check_object(tool, schema, value, path)
    return value


def _check_type(tool: str, declared: tuple[str, ...], value: Any, path: str) -> None:
    actual = _json_type_name(value)
    # JSON has one number type; `2` satisfies `number`. The converse does NOT hold: `2.0` does
    # not satisfy `integer`, because coercing it would hand the handler a value nobody sent.
    if actual in declared or ("number" in declared and actual == "integer"):
        return
    expected = declared[0] if len(declared) == 1 else f"one of {list(declared)}"
    raise ToolArgumentError(tool, path, f"expected {expected}, got {actual} ({value!r})")


def _json_type_name(value: Any) -> str:
    """The JSON type name of a Python value, with ``bool`` resolved BEFORE ``int``.

    Order is the whole content of this function. ``isinstance(True, int)`` is ``True`` in
    CPython, so a ``bool`` reported as ``integer`` is how ``{"radius": true}`` becomes
    ``radius == 1`` with nothing raised anywhere.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, Mapping):
        return "object"
    return type(value).__name__


def _check_string(tool: str, schema: Mapping[str, Any], value: str, path: str) -> None:
    minimum = schema.get("minLength")
    if isinstance(minimum, int) and len(value) < minimum:
        raise ToolArgumentError(tool, path, f"is {len(value)} characters, minimum is {minimum}")
    maximum = schema.get("maxLength")
    if isinstance(maximum, int) and len(value) > maximum:
        raise ToolArgumentError(tool, path, f"is {len(value)} characters, maximum is {maximum}")
    pattern = schema.get("pattern")
    if isinstance(pattern, str) and re.fullmatch(pattern, value) is None:
        raise ToolArgumentError(tool, path, f"{value!r} does not match {pattern!r}")


def _check_number(tool: str, schema: Mapping[str, Any], value: float, path: str) -> None:
    minimum = schema.get("minimum")
    if isinstance(minimum, (int, float)) and value < minimum:
        raise ToolArgumentError(tool, path, f"{value} is below the minimum {minimum}")
    maximum = schema.get("maximum")
    if isinstance(maximum, (int, float)) and value > maximum:
        raise ToolArgumentError(tool, path, f"{value} is above the maximum {maximum}")


def _check_array(tool: str, schema: Mapping[str, Any], value: list[Any], path: str) -> list[Any]:
    minimum = schema.get("minItems")
    if isinstance(minimum, int) and len(value) < minimum:
        raise ToolArgumentError(tool, path, f"has {len(value)} items, minimum is {minimum}")
    maximum = schema.get("maxItems")
    if isinstance(maximum, int) and len(value) > maximum:
        raise ToolArgumentError(tool, path, f"has {len(value)} items, maximum is {maximum}")
    items = schema.get("items")
    if not isinstance(items, Mapping):
        return value
    return [_validate(tool, items, entry, f"{path}[{i}]") for i, entry in enumerate(value)]


def _check_object(
    tool: str, schema: Mapping[str, Any], value: Mapping[str, Any], path: str
) -> dict[str, Any]:
    properties = schema.get("properties")
    properties = properties if isinstance(properties, Mapping) else {}

    for name in schema.get("required", ()):
        if name not in value:
            raise ToolArgumentError(tool, f"{path}/{name}", "is required and was not supplied")

    if schema.get("additionalProperties") is False:
        extra = sorted(set(value) - set(properties))
        if extra:
            raise ToolArgumentError(
                tool,
                path,
                f"unknown argument(s) {extra}; this tool accepts {sorted(properties)}",
            )

    out: dict[str, Any] = {}
    for name, entry in value.items():
        subschema = properties.get(name)
        out[name] = (
            entry
            if not isinstance(subschema, Mapping)
            else _validate(tool, subschema, entry, f"{path}/{name}")
        )
    for name, subschema in properties.items():
        if name not in out and isinstance(subschema, Mapping) and "default" in subschema:
            out[name] = subschema["default"]
    return out
