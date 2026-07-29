"""The Python twin of ``test/identity.spec.ts`` - the named EPIC-00 acceptance test for F0.4.

    "Same input => same ID, 10k times. Different input => different ID.
     Cross-language: TS and Python produce identical IDs for the shared vector file."

It reads the SAME file the TypeScript suite reads - ``conformance/identity-vectors.json``, the
normative artefact of ADR-001 Amendment 1 - and asserts the same things about it. That is what
makes the two languages provably agree: NEITHER IS THE ORACLE. If this suite compared itself with
the TypeScript implementation instead, a shared misreading of the spec would pass both.

The intermediates (``normalised_text``, ``quantised_coords``, ``payload``) are asserted as well as
the final id, because a bug that cancels out inside the digest is still a bug and the file records
them precisely so it can be localised.

Then the edge cases the cross-language proof (Amendment 1 §§ B, F) identified as real hazards -
code-point truncation, the version-pinned fold table, NFC-before-fold, non-NFC output, the 2**53
range guard, the enumerated whitespace set - each of which is a negative control in § B's table of
ten. And finally ``resolved_text`` (DESIGN.md D4).

EVERY NON-ASCII CHARACTER IN THIS FILE'S TEST DATA IS WRITTEN AS AN ESCAPE. Revision 3 of the
contract shipped a corrupt whitespace table because an editor flattened 16 exotic spaces held as
literal characters in a source file (Amendment 1 § F defect 1); a test whose expectations can be
silently rewritten by a paste is not a test.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

import pytest
from papertree_document_ir.generated.models import Block, Provenance
from papertree_document_ir.identity import (
    BLOCK_ID_FORMULA_VERSION,
    BLOCK_ID_PATTERN,
    CASE_FOLD_MAP,
    CASE_FOLD_UNICODE_VERSION,
    CONTENT_HASH_ALGORITHM,
    GRID_PT,
    LIGATURE_TABLE,
    MAX_QUANTISED_BUCKET,
    NFC_POST_PIN_DECOMPOSITIONS,
    TEXT_PREFIX_CODEPOINTS,
    WHITESPACE_CODE_POINTS,
    BlockIdInput,
    block_id,
    block_id_parts,
    content_hash,
    content_hash_of_normalised,
    normalise_text,
    quantise,
    resolved_text,
    truncate_code_points,
)

PKG = Path(__file__).resolve().parents[2]
CONTRACT: dict[str, Any] = json.loads(
    (PKG / "conformance" / "identity-vectors.json").read_text(encoding="utf-8")
)
VECTORS: list[dict[str, Any]] = CONTRACT["vectors"]
BY_LABEL: dict[str, dict[str, Any]] = {vector["label"]: vector for vector in VECTORS}


def input_of(vector: dict[str, Any]) -> BlockIdInput:
    return BlockIdInput(
        source_hash=vector["source_hash"],
        page_index=vector["page_index"],
        x0=vector["bbox"][0],
        y0=vector["bbox"][1],
        block_type=vector["block_type"],
        text=vector["raw_text"],
    )


def id_of_label(label: str) -> str:
    return block_id(input_of(BY_LABEL[label]))


#: A stable, ordinary input to vary one field of at a time.
SAMPLE = input_of(VECTORS[0])


def variant(**changes: Any) -> BlockIdInput:
    fields: dict[str, Any] = {
        "source_hash": SAMPLE.source_hash,
        "page_index": SAMPLE.page_index,
        "x0": SAMPLE.x0,
        "y0": SAMPLE.y0,
        "block_type": SAMPLE.block_type,
        "text": SAMPLE.text,
    }
    fields.update(changes)
    return BlockIdInput(**fields)


#: The 55 code points that gained a case mapping AFTER Unicode 15.0.0 (§ F defect 2): U+1C89, the
#: eight U+A7Cx/U+A7Dx additions, Garay U+10D50..U+10D65 and Medefaidrin U+16EA0..U+16EB8. Node 22
#: (Unicode 17.0) maps every one of them and Python 3.14 maps some; the pinned table maps none.
POST_15_DRIFT: list[int] = (
    [0x1C89, 0xA7CB, 0xA7CC, 0xA7CE, 0xA7D2, 0xA7D4, 0xA7DA, 0xA7DC]
    + list(range(0x10D50, 0x10D66))
    + list(range(0x16EA0, 0x16EB9))
)


# ─── the contract this implementation was built from ────────────────────────────────────────


def test_contract_is_revision_4() -> None:
    assert CONTRACT["vector_count"] == 427
    assert len(VECTORS) == 427
    assert len(CONTRACT["negative_vectors"]) == 8
    assert len(CONTRACT["equivalence_vectors"]) == 11
    assert CONTRACT["formula_version"] == BLOCK_ID_FORMULA_VERSION


def test_contract_agrees_with_the_frozen_configuration() -> None:
    spec = CONTRACT["spec"]
    assert spec["hash"] == CONTENT_HASH_ALGORITHM
    assert spec["grid_pt"] == GRID_PT
    assert spec["text_prefix_codepoints"] == TEXT_PREFIX_CODEPOINTS
    assert spec["geometry_payload"] == "anchor_xy"
    assert spec["id_shape"] == BLOCK_ID_PATTERN.pattern
    assert CONTRACT["case_fold_unicode_version"] == CASE_FOLD_UNICODE_VERSION


def test_embedded_tables_are_identical_to_the_shipped_ones() -> None:
    """The tables live in identity.py rather than being read from the 396 KB contract file at
    runtime (it is not inside the wheel). That is only safe if drift is a test failure."""
    shipped_fold = {int(key[2:], 16): value for key, value in CONTRACT["case_fold_map"].items()}
    assert len(shipped_fold) == 1530
    assert shipped_fold == CASE_FOLD_MAP

    shipped_whitespace = {int(u[2:], 16) for u in CONTRACT["whitespace_chars"]}
    # 26 DISTINCT code points: revision 3 shipped 16 duplicated "U+0020" entries (§ F defect 1).
    assert len(shipped_whitespace) == 26
    assert shipped_whitespace == WHITESPACE_CODE_POINTS

    shipped_ligatures = {ord(key): value for key, value in CONTRACT["ligature_table"].items()}
    assert shipped_ligatures == LIGATURE_TABLE


# ─── (a) same input => same ID, 10k times ───────────────────────────────────────────────────


def test_same_input_same_id_over_10k_runs(capsys: pytest.CaptureFixture[str]) -> None:
    """427 vectors x 24 rounds = 10 248 ids, not 10 000 identical calls: a constant function
    passes the latter. The walk order alternates so determinism cannot come from a warm cache."""
    rounds = 24
    first: dict[str, str] = {}
    computed = 0
    for round_index in range(rounds):
        order = VECTORS if round_index % 2 == 0 else list(reversed(VECTORS))
        for vector in order:
            identifier = block_id(input_of(vector))
            computed += 1
            seen = first.setdefault(vector["label"], identifier)
            assert identifier == seen, vector["label"]
            assert identifier == vector["block_id"], vector["label"]
    assert computed == len(VECTORS) * rounds
    assert computed >= 10_000
    assert len(first) == 427
    with capsys.disabled():
        print(
            f"\n[test_identity] determinism: {computed} ids over {len(VECTORS)} distinct inputs "
            f"x {rounds} rounds, 0 mismatches"
        )


def test_different_input_different_id() -> None:
    assert len(CONTRACT["negative_vectors"]) == 8
    for pair in CONTRACT["negative_vectors"]:
        a, b = id_of_label(pair["a"]), id_of_label(pair["b"])
        assert a != b, pair["why"]
        # ...and each side is the id the contract recorded, so "they differ" cannot be satisfied
        # by two equally wrong ids.
        assert a == pair["a_block_id"]
        assert b == pair["b_block_id"]


def test_inputs_that_should_collapse_do_collapse() -> None:
    assert len(CONTRACT["equivalence_vectors"]) == 11
    for pair in CONTRACT["equivalence_vectors"]:
        a, b = id_of_label(pair["a"]), id_of_label(pair["b"])
        assert a == b, pair["why"]
        assert a == pair["a_block_id"]
        assert b == pair["b_block_id"]


# ─── (b) TS and Python produce identical IDs for the shared vector file ─────────────────────


def test_reproduces_all_427_recorded_block_ids() -> None:
    mismatches = [v["label"] for v in VECTORS if block_id(input_of(v)) != v["block_id"]]
    assert mismatches == []


def test_reproduces_the_recorded_intermediates() -> None:
    """A bug that cancels out in the hash is still a bug."""
    quant_failures: list[str] = []
    norm_failures: list[str] = []
    payload_failures: list[str] = []
    for vector in VECTORS:
        parts = block_id_parts(input_of(vector))
        if list(parts.quantised_coords) != vector["quantised_coords"]:
            quant_failures.append(vector["label"])
        if parts.normalised_text != vector["normalised_text"]:
            norm_failures.append(vector["label"])
        if parts.payload != vector["payload"]:
            payload_failures.append(vector["label"])
    assert quant_failures == []
    assert norm_failures == []
    assert payload_failures == []


def test_every_id_satisfies_the_schema_pattern() -> None:
    # Revision 2's 217 vectors were UPPERCASE base32 and 0 of them validated against the schema
    # they were written for; the formula moved, not the schema.
    for vector in VECTORS:
        identifier = block_id(input_of(vector))
        assert BLOCK_ID_PATTERN.match(identifier), identifier
        assert len(identifier) == 20


def test_content_hash_is_pinned_across_the_two_languages() -> None:
    """content_hash is NOT in the vector file - ADR-001 left it as "blake2s:3f9a..." with no
    digest length, the very defect Amendment 1 fixed for block_id and flagged for this. So the
    cross-language pin lives here: the SHA-256 of all 427 content hashes, joined by "\\n" in
    vector order, is the same constant in this suite and in test/identity.spec.ts. If the two
    implementations ever disagree by one character, this fails in both."""
    aggregate = hashlib.sha256(
        "\n".join(content_hash(vector["raw_text"]) for vector in VECTORS).encode("utf-8")
    ).hexdigest()
    assert aggregate == "6ccde4b3bda72069733972a45f137a576fc225b67afb216940e180a7a86cd85b"


def test_content_hash_shape_and_normalisation() -> None:
    sha256_hash = re.compile(r"^sha256:[0-9a-f]{64}$")  # $defs/Sha256Hash
    algo_prefixed = re.compile(r"^[a-z0-9]+:[0-9a-f]{16,128}$")  # content_hash's actual type
    for vector in VECTORS:
        digest = content_hash(vector["raw_text"])
        assert sha256_hash.match(digest)
        assert algo_prefixed.match(digest)
        # the FULL normalised text, not the 8-code-point prefix the id uses
        expected = hashlib.sha256(normalise_text(vector["raw_text"]).encode("utf-8")).hexdigest()
        assert digest == f"{CONTENT_HASH_ALGORITHM}:{expected}"

    # Tier 2's whole job: same text => same hash, changed text => changed hash. This is what
    # detects the 11.7 % of merge survivors that inherit an id onto changed content (§ E.4).
    assert content_hash("Residual   learning") == content_hash("residual learning")
    assert content_hash("residual learning") != content_hash("residual learnings")
    # Unlike block_id, nothing is truncated: text differing past the 8-code-point prefix, which
    # block_id CANNOT see by design, is visible here.
    assert block_id(variant(text="abcdefghXXXX")) == block_id(variant(text="abcdefghYYYY"))
    assert content_hash("abcdefghXXXX") != content_hash("abcdefghYYYY")


def test_normalise_is_idempotent_so_hashing_text_normalised_agrees() -> None:
    for vector in VECTORS:
        assert normalise_text(vector["normalised_text"]) == vector["normalised_text"]
        assert content_hash(vector["raw_text"]) == content_hash(vector["normalised_text"])


# ─── edge case: truncation is by CODE POINT ─────────────────────────────────────────────────


def test_truncation_does_not_split_an_astral_character() -> None:
    text = "abcdefg\U0001f600tail"
    prefix = truncate_code_points(normalise_text(text), TEXT_PREFIX_CODEPOINTS)
    assert len(prefix) == 8
    assert prefix == "abcdefg\U0001f600"
    assert ord(prefix[-1]) == 0x1F600
    # Byte truncation (control C2, the Rust hazard, 266 divergences on the real corpus) would cut
    # this at 8 UTF-8 bytes; UTF-16-unit truncation (control C1, what JS's .slice does) would end
    # in a lone surrogate. Python's slicing is by code point, which is why this file is the twin
    # that CANNOT reproduce the bug - and why the TypeScript side asserts it explicitly.
    assert len(prefix.encode("utf-8")) == 11
    assert block_id_parts(variant(text=text)).text_prefix == prefix

    emoji = "".join(chr(0x1F600 + i) for i in range(9))
    emoji_prefix = truncate_code_points(normalise_text(emoji), TEXT_PREFIX_CODEPOINTS)
    assert len(emoji_prefix) == 8
    assert len(emoji_prefix.encode("utf-8")) == 32


def test_rejects_an_unpaired_surrogate() -> None:
    # Python raises on encode where Node substitutes U+FFFD: one input, two ids.
    with pytest.raises(ValueError, match="unpaired surrogate"):
        block_id(variant(text="ab\ud83dcd"))
    with pytest.raises(ValueError, match="unpaired surrogate"):
        content_hash("ab\udc00")


# ─── edge case: the case fold comes from the SHIPPED TABLE, never the runtime ────────────────


def test_folds_where_lower_would_not() -> None:
    # These fail on every runtime and every Unicode version if an implementation reaches for
    # str.lower() (controls C3 and C4), so they are never vacuous.
    assert normalise_text("\u1e9e") == "ss"  # capital sharp s folds to "ss"...
    assert "\u1e9e".lower() == "\u00df"  # ...while lower() gives U+00DF
    assert normalise_text("\u00df") == "ss"
    assert normalise_text("\u0391\u03a3") == "\u03b1\u03c3"  # never the final sigma U+03C2


def test_ignores_code_points_that_gained_a_mapping_after_unicode_15() -> None:
    assert len(POST_15_DRIFT) == 55
    for point in POST_15_DRIFT:
        assert point not in CASE_FOLD_MAP, f"U+{point:04X} is not in a 15.0.0 table"
        assert normalise_text(chr(point)) == chr(point)


def test_identity_never_calls_a_runtime_case_function() -> None:
    """The contract's MUST NOT, enforced structurally rather than merely documented.

    A behavioural test can only catch a runtime primitive where the runtime and the pinned table
    disagree TODAY, and ``str.casefold()`` is the RIGHT algorithm while this interpreter carries
    UCD 15.0.0 - there is no code point on which it forks here, and there will be on the next
    interpreter. So the AST is inspected instead: docstrings and comments (which discuss these
    functions at length) are Constant nodes and cannot produce a false positive.
    """
    module = ast.parse(
        (PKG / "python" / "papertree_document_ir" / "identity.py").read_text(encoding="utf-8")
    )
    forbidden_methods = {"casefold", "lower", "upper", "title", "swapcase", "capitalize"}
    forbidden_builtins = {"round"}
    offences: list[str] = []
    for node in ast.walk(module):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr in forbidden_methods:
                offences.append(f"line {func.lineno}: .{func.attr}()")
            if isinstance(func, ast.Name) and func.id in forbidden_builtins:
                offences.append(f"line {func.lineno}: {func.id}()")
    assert offences == []
    # ...and it must still contain the things that replace them.
    source = (PKG / "python" / "papertree_document_ir" / "identity.py").read_text(encoding="utf-8")
    assert "math.floor(" in source
    assert "CASE_FOLD_MAP.get(" in source


def test_table_wins_over_the_runtime_on_every_disagreeing_code_point(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """The exhaustive sweep, as a test: 1 112 064 code points, pinned table vs the runtime.

    ``str.lower()`` disagrees on hundreds of code points in every Python. ``str.casefold()`` is
    the right ALGORITHM, so it agrees exactly while the interpreter carries UCD 15.0.0 - and
    stops agreeing the moment it does not, which is the fork this test exists to catch. Both
    counts are printed rather than asserted to be non-zero, because the casefold one is
    legitimately 0 on Python 3.12 and non-zero on 3.14.
    """
    lower_drift: list[int] = []
    casefold_drift: list[int] = []
    for point in range(0x110000):
        if 0xD800 <= point <= 0xDFFF:
            continue  # surrogates are not encodable text
        char = chr(point)
        folded = CASE_FOLD_MAP.get(point, char)
        if char.lower() != folded:
            lower_drift.append(point)
        if char.casefold() != folded:
            casefold_drift.append(point)

    assert lower_drift, "str.lower() must disagree with full case folding somewhere"
    for point in lower_drift + casefold_drift:
        assert normalise_text(chr(point)) == CASE_FOLD_MAP.get(point, chr(point))

    with capsys.disabled():
        print(
            f"\n[test_identity] Python {sys.version_info.major}.{sys.version_info.minor} carries "
            f"UCD {unicodedata.unidata_version}; the pinned table is {CASE_FOLD_UNICODE_VERSION}. "
            f"Disagreements: str.lower() {len(lower_drift)}, str.casefold() {len(casefold_drift)}"
            f" - the table wins on all of them"
        )


# ─── edge case: NFC comes BEFORE the fold, and the output is not re-composed ─────────────────


def test_nfc_runs_before_the_fold() -> None:
    # NFC("J" + U+030C) is U+01F0, whose fold is "j" + U+030C.
    assert normalise_text("J\u030c") == normalise_text("\u01f0")
    assert block_id(variant(text="J\u030c")) == block_id(variant(text="\u01f0"))


def test_differs_from_fold_then_nfc() -> None:
    # U+00DF + U+0323 (sharp s, combining dot below).
    #   NFC first, then fold  => "s" "s" U+0323   (this contract)
    #   fold first, then NFC  => "s" U+1E63      (control C8: wrong, and a DIFFERENT id)
    assert normalise_text("\u00df\u0323") == "ss\u0323"
    assert normalise_text("\u00df\u0323") != "s\u1e63"
    assert block_id(variant(text="\u00df\u0323")) != block_id(variant(text="s\u1e63"))


def test_output_is_not_guaranteed_nfc() -> None:
    folded = normalise_text("\u01f0")
    assert [ord(c) for c in folded] == [0x6A, 0x030C]
    assert unicodedata.normalize("NFC", folded) == "\u01f0"
    assert folded != unicodedata.normalize("NFC", folded)
    # Never "tidy up" with a trailing NFC: that is control C8's failure mode.
    assert block_id_parts(variant(text="\u01f0")).text_prefix == "j\u030c"


# ─── step 1 (NFC) is version-pinned too ─────────────────────────────────────────────────────


def test_nfc_is_pinned_not_inherited_from_the_runtime() -> None:
    """The runtime's NFC was the last unpinned step in the formula, and it forks the id exactly
    the way the runtime case functions do. Node 22 carries Unicode 17.0 and composes 20 sequences
    Python 3.12's UCD 15.0.0 does not, all from the Unicode 16.0 scripts (Todhri, Tulu-Tigalari,
    Gurung Khema, Kirat Rai). NFC_POST_PIN_DECOMPOSITIONS undoes exactly those."""
    assert len(NFC_POST_PIN_DECOMPOSITIONS) == 20
    for point, decomposition in NFC_POST_PIN_DECOMPOSITIONS.items():
        # normalise() never lets the composed form out, from either direction, in either runtime.
        assert normalise_text(chr(point)) == decomposition
        assert normalise_text(decomposition) == decomposition


def test_canonical_decomposition_table_matches_the_typescript_twin(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """THE TRIPWIRE. The pinned list is only correct while it is exactly the difference between
    the two runtimes. This digest is over every canonical decomposition the runtime knows MINUS
    the pinned ones, and ``test/identity.spec.ts`` asserts the same constant on Node 22 /
    Unicode 17.0. The day either runtime gains a 21st composition, this fails - instead of
    block_ids, content_hashes and text_normaliseds silently forking between the two languages."""
    lines: list[str] = []
    for point in range(0x110000):
        if 0xD800 <= point <= 0xDFFF or point in NFC_POST_PIN_DECOMPOSITIONS:
            continue
        decomposed = unicodedata.normalize("NFD", chr(point))
        if len(decomposed) < 2:
            continue
        lines.append(f"{point:x}:" + ",".join(f"{ord(c):x}" for c in decomposed))
    assert len(lines) == 12_216
    digest = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
    assert digest == "1e66edb5461d417bd118d65e245348ac95d6005f4582cb15a1393336dd6e69fa"
    with capsys.disabled():
        print(
            f"\n[test_identity] canonical decompositions: {len(lines)} after pinning "
            f"{len(NFC_POST_PIN_DECOMPOSITIONS)} post-{CASE_FOLD_UNICODE_VERSION} compositions; "
            f"digest matches the TypeScript twin"
        )


# ─── normalise_text is NOT idempotent, and content_hash must not pretend it is ──────────────


def test_normalise_text_is_not_idempotent() -> None:
    """normalise() output is deliberately not NFC (Amendment 1 § A), so a second pass re-composes
    what the first produced. Any rule that normalises ``Block.text_normalised`` therefore digests
    a DIFFERENT string from ``content_hash(Block.text)`` - the library's own documented way of
    producing ``content_hash``. Semantic rule 29 calls ``content_hash_of_normalised`` for this."""
    once = normalise_text("\ufb01\u0302")
    assert [ord(c) for c in once] == [0x66, 0x69, 0x302]
    assert normalise_text(once) != once
    assert [ord(c) for c in normalise_text(once)] == [0x66, 0xEE]


def test_content_hash_is_content_hash_of_normalised_of_normalise_text() -> None:
    for text in ("\ufb01\u0302", "\u00df\u0323", "\u0132\u0301", "plain ascii", ""):
        assert content_hash(text) == content_hash_of_normalised(normalise_text(text))
    # ...and the trap it replaces: digesting the normalised form THROUGH content_hash disagrees.
    assert content_hash(normalise_text("\ufb01\u0302")) != content_hash("\ufb01\u0302")


# ─── edge case: the |q| <= 2^53-1 range guard ───────────────────────────────────────────────


def test_range_guard_rejects_rather_than_emitting_exponential_notation() -> None:
    for value in (1e21, -1e21, 1e22, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            quantise(value)
    # 2**53 - 1 is one bucket too far once 0.5 is added; 2**53 - 2 lands exactly on the guard.
    with pytest.raises(ValueError, match="outside"):
        quantise(float(MAX_QUANTISED_BUCKET))
    assert quantise(float(MAX_QUANTISED_BUCKET - 1)) == MAX_QUANTISED_BUCKET - 1
    with pytest.raises(ValueError):
        block_id(variant(x0=1e21))
    # Field 2 is emitted with str() exactly like fields 3 and 4, so it needs the same guard or the
    # payload forks silently against JS's String(1e21) == "1e+21".
    with pytest.raises(ValueError, match="page_index"):
        block_id(variant(page_index=MAX_QUANTISED_BUCKET + 1))
    with pytest.raises(ValueError, match="page_index"):
        block_id(variant(page_index=10**21))
    assert "e+" not in block_id_parts(variant(page_index=MAX_QUANTISED_BUCKET)).payload
    # The point of the guard: str() can never fork, because nothing above it is ever emitted.
    for value in (0.0, -0.0, 1.0, -1.0, 32767.0, -32767.0, 1e15, float(MAX_QUANTISED_BUCKET - 1)):
        assert "e" not in str(quantise(value)).lower()


def test_half_buckets_round_up_on_both_signs_with_no_negative_zero() -> None:
    assert quantise(22.5) == 23  # Python's round() is half-to-even and would give 22
    assert quantise(-22.5) == -22  # half-away-from-zero would give -23
    assert quantise(-0.5) == 0
    assert quantise(0.5) == 1
    assert quantise(90.0, 4.0) == 23  # the § B regression witness, at the refuted 4 pt grid
    assert str(quantise(-0.0)) == "0"
    assert str(quantise(-0.4)) == "0"
    assert quantise(10.499999999999998) == 10
    assert quantise(10.500000000000002) == 11
    assert quantise(0.30000000000000004) == 0


# ─── edge case: the whitespace set is the enumerated 26 code points, not \s ──────────────────


def test_collapses_u0085_which_javascripts_backslash_s_does_not_match() -> None:
    assert 0x0085 in WHITESPACE_CODE_POINTS
    assert normalise_text("a\u0085b") == "a b"


def test_collapses_ufeff_which_pythons_backslash_s_does_not_match() -> None:
    assert re.fullmatch(r"\s", "\ufeff") is None  # <- a Python-\s implementation would keep it
    assert 0xFEFF in WHITESPACE_CODE_POINTS
    assert normalise_text("a\ufeffb") == "a b"


def test_does_not_collapse_the_separators_pythons_backslash_s_does_match() -> None:
    for point in (0x1C, 0x1D, 0x1E, 0x1F):
        assert re.fullmatch(r"\s", chr(point)) is not None  # Python's \s matches these...
        assert point not in WHITESPACE_CODE_POINTS  # ...and the contract does not
        assert normalise_text(f"a{chr(point)}b") == f"a{chr(point)}b"


def test_collapses_all_16_exotic_spaces() -> None:
    exotic = [0x1680, *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F]
    assert len(exotic) == 16
    for point in exotic:
        assert point in WHITESPACE_CODE_POINTS
        assert normalise_text(f"a{chr(point)}b") == "a b"
    run = "".join(chr(point) for point in exotic)
    assert normalise_text(f"{run}a{run}b{run}") == "a b"


def test_collapses_each_of_the_26_and_nothing_that_merely_looks_like_a_space() -> None:
    for point in WHITESPACE_CODE_POINTS:
        assert normalise_text(f"a{chr(point)}b") == "a b"
    for point in (0x00B7, 0x180E, 0x200B, 0x2060):
        # U+200B ZERO WIDTH SPACE and U+2060 WORD JOINER are not in the set and must survive.
        assert normalise_text(f"a{chr(point)}b") == f"a{chr(point)}b"


# ─── edge case: the payload encoding admits no escaping ─────────────────────────────────────


def test_u007c_stays_confined_to_the_last_field() -> None:
    parts = block_id_parts(variant(block_type="paragraph", text="b|c"))
    fields = parts.payload.split("|")
    assert fields[:5] == [
        SAMPLE.source_hash,
        str(SAMPLE.page_index),
        str(parts.quantised_coords[0]),
        str(parts.quantised_coords[1]),
        "paragraph",
    ]
    assert "|".join(fields[5:]) == "b|c"
    # block_type is the field BEFORE text, and its pattern is what makes the encoding
    # unambiguous: "paragraph" + "b|c" must not collide with "paragraph_b" + "c".
    assert block_id(variant(block_type="paragraph", text="b|c")) != block_id(
        variant(block_type="paragraph_b", text="c")
    )
    with pytest.raises(ValueError, match="block_type"):
        block_id(variant(block_type="para|graph"))
    with pytest.raises(ValueError, match="block_type"):
        block_id(variant(block_type="Paragraph"))


def test_rejects_a_prefixed_source_hash() -> None:
    with pytest.raises(ValueError, match="sha256:"):
        block_id(variant(source_hash=f"sha256:{SAMPLE.source_hash}"))
    with pytest.raises(ValueError, match="source_hash"):
        block_id(variant(source_hash=SAMPLE.source_hash.upper()))
    with pytest.raises(ValueError, match="page_index"):
        block_id(variant(page_index=-1))
    with pytest.raises(TypeError, match="page_index"):
        block_id(variant(page_index=1.5))


# ─── resolved_text - DESIGN.md D4 ───────────────────────────────────────────────────────────

PROMPT_HASH = "sha256:" + "0" * 64


#: A model-authored repair: the schema pins it to applied:false, so Block.text keeps the
#: unrepaired OCR reading permanently and this proposal is only visible through resolved_text.
PROPOSED_OCR: dict[str, Any] = {
    "kind": "ocr_correction",
    "applied": False,
    "at": 3,
    "from": "m",
    "to": "rn",
    "model_id": "vision/ocr-1",
    "prompt_hash": PROMPT_HASH,
}


def proposal(**fields: Any) -> dict[str, Any]:
    """A model-authored proposal; model_id and prompt_hash are REQUIRED for these kinds (D4)."""
    return {"applied": False, "model_id": "vision/ocr-1", "prompt_hash": PROMPT_HASH, **fields}


def make_block(**fields: Any) -> Block:
    base: dict[str, Any] = {
        "block_id": "blk_aaaaaaaaaaaaaaaa",
        "type": "paragraph",
        "page_index": 0,
        "polygon": [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]],
        "bbox": [0.0, 0.0, 10.0, 10.0],
        "flow": "body",
        "order": 0,
        "source": "pdf_text_layer",
        "confidence": 1.0,
        "provenance": {"parser": "pymupdf", "stage": "layout+text"},
    }
    base.update(fields)
    return Block.model_validate(base)


def test_resolved_text_returns_block_text_verbatim_by_default() -> None:
    block = make_block(text="leaming", repairs=[PROPOSED_OCR])
    view = resolved_text(block)
    assert view.text == "leaming"
    assert view.contains_proposed_text is False
    assert view.applied_proposals == ()
    assert [(s.index, s.kind, s.reason) for s in view.skipped_proposals] == [
        (0, "ocr_correction", "not_requested")
    ]


def test_resolved_text_applies_proposals_only_when_asked() -> None:
    block = make_block(text="leaming", repairs=[PROPOSED_OCR])
    view = resolved_text(block, apply_proposed=True)
    assert view.text == "learning"  # the OCR "rn" -> "m" confusion, undone on request
    assert view.contains_proposed_text is True
    assert [(p.index, p.kind, p.at, p.from_, p.to) for p in view.applied_proposals] == [
        (0, "ocr_correction", 3, "m", "rn")
    ]
    assert view.skipped_proposals == ()


def test_resolved_text_leaves_applied_repairs_alone() -> None:
    # What applied:true means: Block.text already contains "to". Re-applying would double it.
    block = make_block(
        text="residual",
        repairs=[
            {
                "kind": "dehyphenate",
                "applied": True,
                "at": 0,
                "from": "resid-\nual",
                "to": "residual",
            }
        ],
    )
    assert resolved_text(block).text == "residual"
    view = resolved_text(block, apply_proposed=True)
    assert view.text == "residual"
    assert view.applied_proposals == ()
    assert view.skipped_proposals == ()
    assert view.contains_proposed_text is False


def test_resolved_text_applies_several_proposals_right_to_left() -> None:
    block = make_block(
        text="aaa bbb ccc",
        repairs=[
            {
                "kind": "vlm_substitution",
                "applied": False,
                "at": 0,
                "from": "aaa",
                "to": "AAAA",
                "model_id": "m",
                "prompt_hash": PROMPT_HASH,
            },
            {
                "kind": "vlm_substitution",
                "applied": False,
                "at": 8,
                "from": "ccc",
                "to": "C",
                "model_id": "m",
                "prompt_hash": PROMPT_HASH,
            },
        ],
    )
    view = resolved_text(block, apply_proposed=True)
    assert view.text == "AAAA bbb C"
    assert [p.index for p in view.applied_proposals] == [0, 1]


def test_resolved_text_skips_with_a_reason_rather_than_corrupting() -> None:
    block = make_block(
        text="abcdef",
        repairs=[
            proposal(kind="ocr_correction", at=2, **{"from": "zz"}, to="!"),
            {"kind": "reorder", "applied": False, "from": "a b", "to": "b a"},
            proposal(kind="vlm_substitution", at=5, **{"from": "fgh"}, to="X"),
        ],
    )
    view = resolved_text(block, apply_proposed=True)
    assert view.text == "abcdef"
    assert view.contains_proposed_text is False
    assert [(s.index, s.reason) for s in view.skipped_proposals] == [
        (0, "text_mismatch"),
        (1, "missing_offset"),
        (2, "offset_out_of_range"),
    ]


def test_resolved_text_skips_the_second_of_two_overlapping_proposals() -> None:
    block = make_block(
        text="abcdef",
        repairs=[
            {
                "kind": "vlm_substitution",
                "applied": False,
                "at": 1,
                "from": "bcd",
                "to": "X",
                "model_id": "m",
                "prompt_hash": PROMPT_HASH,
            },
            {
                "kind": "vlm_substitution",
                "applied": False,
                "at": 2,
                "from": "cde",
                "to": "Y",
                "model_id": "m",
                "prompt_hash": PROMPT_HASH,
            },
        ],
    )
    view = resolved_text(block, apply_proposed=True)
    assert [p.index for p in view.applied_proposals] == [1]
    assert [(s.index, s.reason) for s in view.skipped_proposals] == [(0, "conflicting_range")]
    assert view.text == "abYf"


def test_resolved_text_counts_offsets_in_code_points() -> None:
    # Semantic rule 25 defines offsets in code points; Python's len() agrees and JS's .length
    # does not. A UTF-16 implementation lands one position late here and reports a mismatch.
    block = make_block(
        text="\U0001f600xy",
        repairs=[
            {
                "kind": "vlm_substitution",
                "applied": False,
                "at": 1,
                "from": "xy",
                "to": "ZZ",
                "model_id": "m",
                "prompt_hash": PROMPT_HASH,
            }
        ],
    )
    view = resolved_text(block, apply_proposed=True)
    assert view.text == "\U0001f600ZZ"
    assert view.skipped_proposals == ()


def test_resolved_text_handles_a_block_with_no_text() -> None:
    block = make_block(repairs=[PROPOSED_OCR])
    view = resolved_text(block, apply_proposed=True)
    assert view.text == ""
    assert [(s.index, s.reason) for s in view.skipped_proposals] == [(0, "no_text")]
    assert resolved_text(make_block()).text == ""


def test_resolved_text_accepts_a_real_generated_block() -> None:
    """The structural Protocol is not a parallel schema: a validated Block satisfies it, and the
    Provenance import keeps this honest about which model is being passed."""
    block = make_block(text="leaming", repairs=[PROPOSED_OCR])
    assert isinstance(block.provenance, Provenance)
    assert resolved_text(block).text == "leaming"
    assert resolved_text(block, apply_proposed=True).contains_proposed_text is True
