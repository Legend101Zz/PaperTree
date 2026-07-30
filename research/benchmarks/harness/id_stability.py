"""
Epic 0 decision harness: which content-derived block_id formula actually survives a re-parse?

ADR-001 (as written)   blake2s, 2pt grid,   full bbox,   text prefix 64
synthesis-05           sha256,  0.5pt grid, full bbox,   text prefix 160
measurement rev 1      sha256,  4.0pt grid, full bbox,   text prefix 64   <- refuted, see below

None of the three measured anything that could discriminate them.  This does.

It extracts real blocks from the PTUB corpus with PyMuPDF, builds a BASELINE run and a set of
PERTURBATION runs that stand in for "the parser changed between v1.2 and v1.3", then sweeps
geometry-payload x grid x prefix JOINTLY and measures the two things that matter:

  COLLISIONS  two DISTINCT blocks in the same paper getting the same ID.  Fatal: a highlight
              would resolve to the wrong text.  This is the HARD CONSTRAINT (R1), and it is
              evaluated at BLOCK granularity and at LINE granularity, per paper, per run.
  CHURN       blocks that are provably the SAME block whose ID nevertheless changed.
              Fatal in bulk: every highlight in the document orphans on re-parse.
              Minimised subject to the collision constraint (R2), under the perturbations a
              parser point release actually produces.

Because the ID input is namespaced by the paper's source_hash, cross-paper collisions are
impossible by construction and are not measured.  Only intra-paper collisions can happen.

==========================================================================================
REVISION 3 (2026-07-30).  Rev 1 was refuted by two independent critiques; rev 2 fixed the
quantiser and the perturbation set but still swept one knob at a time and still had an
untested geometry payload.  What rev 3 changes:

 A  GEOMETRY PAYLOAD IS A FIRST-CLASS AXIS with THREE options, not two:
      full_bbox  (x0,y0,x1,y1)   anchor_xy  (x0,y0)   centre_xy  ((x0+x1)/2,(y0+y1)/2)
    Churn scales as 1-(1-p)^k in the number k of quantised coordinates, and k was a design
    choice nobody had ever priced.  centre_xy is included because it is the obvious
    "translation-insensitive but merge-sensitive" alternative to anchor_xy, and because
    the anchor-vs-centre difference is exactly the semantic question in Step 5.

 B  JOINT SWEEP.  geometry x grid{0.25..32} x prefix{8,16,24,32,48,64,96,160} = 192
    combinations, every one measured on every perturbation.  Rev 1's "pick the endpoint of
    an arbitrary list" failure mode is structurally impossible here: both axes are swept
    past the point where they stop working, so the boundary is located, not assumed.

 C  HASH IS FIXED to SHA-256 and NOT swept.  Settled, on three grounds that do not need a
    fresh tie-break: (1) Node cannot produce blake2s-128 at all -- createHash('blake2s256',
    {outputLength:16}) throws ERR_OSSL_EVP_NOT_XOF_OR_INVALID_LENGTH and
    webcrypto.subtle.digest('BLAKE2s') throws NotSupportedError, while SHA-256 works in
    every runtime including browsers; (2) on ARM64 (this machine, and every Apple/Graviton
    deployment target) SHA-256 has a dedicated instruction and BLAKE2 does not, so the
    folklore speed argument is inverted -- the timing probe below re-measures it only to
    stop the folklore recurring; (3) ADR-001 says "blake2s" with no digest length, which is
    an unspecified contract detail in a formula that must be reimplemented three times.
    The choice is not a scoring axis, so it is not scored.

 D  QUANTISER IS AN INTEGER BUCKET INDEX.  Rev 1 used round(v/g)*g formatted "%.4f".
    Python round() is half-to-EVEN, JS Math.round and Rust f64::round are half-UP, and real
    typeset PDFs sit on the tie constantly (x0=90.0pt is LaTeX's 1.25in margin; 90.0/4.0 is
    exactly 22.5 -> Python 88.0000, JS 92.0000, two different IDs for one block).  Now:
        q(v,g) = floor(v/g + 0.5)   -> a Python int, emitted as a base-10 integer.
    Half-UP by construction, no float formatting anywhere, and the "-0.0000" != "0.0000"
    hazard is gone because integers have no negative zero.  math.floor and Math.floor agree
    on negatives (both floor toward -inf); asserted in check_quantiser_portability() and
    re-checked from Node in the cross-language verifier.

 E  PERTURBATION SET REBUILT AROUND WHAT ACTUALLY HAPPENS.
      P7 PARAGRAPH MERGE and P8 PARAGRAPH SPLIT are the dominant real risk -- a segmenter
      change -- and neither was ever measured.  The repo's own ptub-capability-matrix.json
      records 549 PyMuPDF vs 519 Docling vs 233 old-extractor blocks on one PDF.
      P5/P6 are demoted to NULL PERTURBATIONS and kept out of the headline table, because
      they are arithmetically incapable of producing churn: P6's matched pairs have
      bit-identical bboxes (get_text("blocks") and dict-mode block grouping are the same
      segmentation), and 3256/3270 of P5's matched pairs are single-line blocks where the
      line bbox IS the block bbox.  A 0% that was forced by construction is not evidence.
      P5 is retained for its real job: LINE-GRANULARITY COLLISIONS, the stress case where
      the collision floor actually lives.

 F  CHURN PAIRING IS GROUND TRUTH, NEVER IDs.  Element-wise perturbations use index
    identity over ALL blocks (rev 1 filtered everything through an IoU>=0.9 matcher, which
    biased churn low by up to 5.8pp).  Merge/split use CONTAINMENT on normalised text plus
    bbox, because a merged box genuinely is not the same box and IoU would throw the very
    pairs being studied away.

 G  ANCHOR FALSE-POSITIVE PROBE.  An anchor-only ID is INHERITED by a merged block (same
    top-left corner, same leading text).  That is a survival for paragraph 1 and a
    misresolution for paragraph 2.  Measured explicitly as a rate, per geometry, instead of
    being argued about.

 H  ENCODING IS LOWERCASE base32.  The IR schema pins ^blk_[a-z2-7]{16}$ and rev 2's
    vectors were uppercase, so 0 of 217 rev-2 vectors validated against the schema they
    were written for.  The schema's shape is the older and more widely depended-on
    constraint (EPIC-00 pinned it), the change is one character in the ENCODE step and
    changes no measured quantity, so THE FORMULA MOVES, NOT THE SCHEMA.

==========================================================================================
REVISION 4 (2026-07-30).  Rev 3's SELECTION was confirmed unchanged -- the sweep table, the
churn figures, the collision census and the derived configuration (anchor_xy / 1.0pt /
prefix 8) are bit-identical to rev 3.  What rev 4 fixes is the CONTRACT DATA that rev 3
shipped alongside them, all four defects found by an independent cross-language
verification and all four closed by execution:

 1  WHITESPACE TABLE CORRUPTION (fatal).  Rev 3 held WS_CHARS as a literal-character string
    and an editor/paste had flattened all 16 exotic spaces (U+1680, U+2000..U+200A, U+2028,
    U+2029, U+202F, U+205F) to U+0020.  The harness's own normaliser therefore ran with a
    10-element whitespace set, and `whitespace_chars` in identity-vectors.json shipped with
    16 duplicated "U+0020" entries: a conforming implementation and the shipped vectors
    disagreed on vector edge:exotic-whitespace.  Now built from NUMERIC CODE POINTS and
    asserted to be 26 distinct characters.  0 of 5670 corpus blocks contain any of the 16,
    so no measured quantity moves; U+2009/U+202F/U+2002 are routine in typeset maths, so it
    would have fired in production.

 2  CASE FOLD WAS NOT UNICODE-VERSION-PINNED (fatal, latent).  Rev 3 shipped only the DELTA
    between casefold() and the runtime's lower(), and told non-Python implementations to
    lowercase the remainder.  Python 3.12 carries UCD 15.0.0 and Node 22 carries Unicode
    17.0; on 55 code points that gained a mapping in between (U+1C89, U+A7CB/CC/CE/D2/D4/
    DA/DC, U+10D50..U+10D65, U+16EA0..U+16EB8) the two runtimes disagree, and a DELTA table
    structurally cannot record that -- in the generating runtime there was no delta.  Now
    the COMPLETE fold map ships (1530 entries, pinned to a named Unicode version) and no
    implementation, Python included, may call a runtime case function at all.

 3  INTEGER EMISSION WAS UNBOUNDED.  "base-10 integer" is portable only while the integer
    is small: String(Math.floor(v+0.5)) switches to exponential at 1e21 where Python str()
    stays positional.  q() now REJECTS |bucket| > 2^53-1 instead of emitting it.

 4  THE LIGATURE STEP WAS UNTESTED.  Full case folding already maps U+FB00..U+FB06, so 7 of
    the 9 table entries are redundant and deleting the entire ligature step passed all 418
    rev-3 vectors and all 5670 corpus blocks.  Only U+0132/U+0133 have independent effect.
    Vectors edge:ij-ligature-leading and eq:ij-ligature now bind that step, and
    eq:exotic-whitespace binds defect 1.

Usage:
    cd "<repo>" && uv run --python 3.12 --with pymupdf python \
        research/benchmarks/harness/id_stability.py

Writes research/experiment-results/id-stability.json
       packages/document-ir/conformance/identity-vectors.json
and prints a markdown summary.
"""
import base64
import difflib
import hashlib
import json
import math
import os
import random
import re
import statistics
import sys
import time
import unicodedata
from collections import defaultdict

import fitz  # PyMuPDF

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CORPUS = os.path.join(REPO, "research", "benchmarks", "corpus")
OUT = os.path.join(REPO, "research", "experiment-results", "id-stability.json")
VECTORS = os.path.join(REPO, "packages", "document-ir", "conformance",
                       "identity-vectors.json")

SEED = 20260730            # fixed: the whole run must be reproducible
JITTER_SEEDS = 5           # repeats per jitter perturbation, to get a spread not a point

GEOMS = ["full_bbox", "anchor_xy", "centre_xy"]
GRIDS = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0]
PREFIXES = [8, 16, 24, 32, 48, 64, 96, 160]
HASH = "sha256"                            # fixed, see header note C
HEADROOM_GRIDS = [64.0, 128.0, 256.0]      # past the sweep, to locate the far margin

ID_BYTES = 10              # 16 base32 chars = 80 bits = 10 bytes.  Collisions MUST be
                           # measured on the truncated ID, not on the full digest.

IOU_MATCH = 0.90           # ground-truth "same block" threshold (null perturbations only)
SIM_MATCH = 0.95

# The configuration the ADR freezes.  Set from DECISION_RULE at the end of the run; this is
# only the bootstrap value used for the probes that need one config.  If the derivation
# selects something else, the run prints a loud mismatch and the vectors follow the
# DERIVED value, not this one.
CHOSEN = {"geom": "anchor_xy", "grid_pt": 2.0, "hash": HASH, "text_prefix_len": 32}

FORMULA_VERSION = "papertree/block_id/1.0.0"


# ───────────────────────── normalisation ─────────────────────────
#
# Every step below is pinned to something that has an identical definition in Python, JS and
# Rust.  Where the three languages' "obvious" primitive disagrees, the disagreement is
# enumerated rather than inherited.

# 1. Latin typographic ligatures.  Kept as an explicit table (not left to case folding) so
#    that the mapping is part of the written contract.
LIGATURES = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi",
    "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st", "ĳ": "ij", "Ĳ": "IJ",
}
_LIG_RE = re.compile("|".join(map(re.escape, LIGATURES)))

# 2. Whitespace.  Python's re `\s` and JavaScript's `\s` are NOT the same set: JS includes
#    U+FEFF, Python includes U+001C..U+001F.  Enumerate it rather than inherit it.
#
#    BUILT FROM NUMERIC CODE POINTS, NEVER FROM LITERAL CHARACTERS.  Revision 3 shipped this
#    as a literal-character string and an editor/paste silently flattened all 16 of the
#    exotic spaces (U+1680, U+2000..U+200A, U+2028, U+2029, U+202F, U+205F) to U+0020, so
#    the harness's own normaliser ran with a 10-element whitespace set and emitted a
#    `whitespace_chars` list with sixteen duplicated "U+0020" entries.  A contract table
#    that can be corrupted by copy-paste is a contract table written the wrong way.
WS_CODEPOINTS = [
    0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x0085, 0x00A0, 0x1680,
    *range(0x2000, 0x200B), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
]
WS_CHARS = "".join(chr(cp) for cp in WS_CODEPOINTS)
assert len(set(WS_CHARS)) == len(WS_CHARS) == 26, "whitespace table corrupted"
_WS_RE = re.compile("[" + re.escape(WS_CHARS) + "]+")
_HYPHEN_BREAK_RE = re.compile("(\\w)[" + "".join(chr(c) for c in (0x2D, 0xAD, 0x2010, 0x2011))
                              + "][ \t]*\n[ \t]*(\\w)")


# A text built ONLY from numeric code points, for the vector that binds the exotic
# spaces: a THIN SPACE, NARROW NBSP, EN QUAD, OGHAM SPACE MARK, MEDIUM MATHEMATICAL
# SPACE, LINE SEPARATOR and PARAGRAPH SEPARATOR, one between each of a..h, so the
# divergence lands inside the 8-code-point prefix if any of them is missing from the
# whitespace set.
EXOTIC_WS_TEXT = "".join(
    "abcdefgh"[i] + (chr(cp) if cp else "")
    for i, cp in enumerate([0x2009, 0x202F, 0x2000, 0x1680, 0x205F, 0x2028, 0x2029, 0]))


def _build_fold_map():
    """The COMPLETE Unicode full case-folding map (non-Turkic, CaseFolding.txt C+F), as
    every code point whose fold differs from itself.  ~1530 entries.

    Revision 3 shipped only the DELTA between casefold and the runtime's lower(), which was
    a latent cross-language fork: the delta is empty exactly where one runtime has no
    mapping at all.  Python 3.12 carries UCD 15.0.0 and Node 22 carries Unicode 17.0, and
    on 55 code points that gained a case mapping after 15.0 (U+1C89, U+A7CB/CC/CE/D2/D4/
    DA/DC, U+10D50..U+10D65 Garay, U+16EA0..U+16EB8 Medefaidrin) Python's casefold()
    returns the character unchanged while JS toLowerCase() maps it -- and the delta table
    could not record that, because in the generating runtime there was no difference to
    record.  Shipping the map WHOLE, pinned to a named Unicode version, removes the
    runtime from the contract entirely: an implementation applies this table and calls no
    case function of its own.

    Full case folding is context-INDEPENDENT and per-code-point (unlike lowercasing, whose
    Greek final-sigma rule is context-sensitive), so applying the map code point by code
    point is exactly equivalent to str.casefold() on the whole string.  That equivalence is
    asserted over the full code point range in check_fold_map_portability()."""
    return {f"U+{cp:04X}": chr(cp).casefold()
            for cp in range(0x110000) if chr(cp).casefold() != chr(cp)}


FOLD_MAP = _build_fold_map()
UNICODE_VERSION = unicodedata.unidata_version
_FOLD_CHR = {chr(int(k[2:], 16)): v for k, v in FOLD_MAP.items()}


def casefold_v1(s: str) -> str:
    """Case folding by TABLE, not by runtime primitive.  This is what a conforming
    implementation in any language does, and it is what the harness itself does, so the
    vectors and the spec cannot drift apart."""
    return "".join(_FOLD_CHR.get(c, c) for c in s)


def normalise_v1(s: str) -> str:
    """The frozen normaliser, in order:
         1. Unicode NFC
         2. ligature expansion (table above)
         3. collapse runs of WS_CHARS to a single U+0020, then strip WS_CHARS from both ends
         4. full case folding via FOLD_MAP, per code point
    """
    s = unicodedata.normalize("NFC", s)
    s = _LIG_RE.sub(lambda m: LIGATURES[m.group(0)], s)
    s = _WS_RE.sub(" ", s).strip(WS_CHARS)
    return casefold_v1(s)


def normalise_v2(s: str) -> str:
    """P4: a plausible v1.3 normaliser.  NFKC, de-hyphenates across line breaks, no explicit
    ligature table (relies on the fold).  Exactly the kind of 'harmless' text cleanup that
    ships in a parser point release."""
    s = _HYPHEN_BREAK_RE.sub(r"\1\2", s)
    s = unicodedata.normalize("NFKC", s)
    s = _WS_RE.sub(" ", s).strip(WS_CHARS)
    return casefold_v1(s)


def truncate(s: str, n: int) -> str:
    """Truncate to n UNICODE CODE POINTS.  Python str slicing is already code points; JS
    `.slice()` is UTF-16 code units and Rust `&s[..n]` is bytes -- both wrong, and both
    silently wrong only on non-BMP input, which is why this has to be pinned."""
    return s[:n]


# ───────────────────────── the ID formula under test ─────────────────────────

# The largest bucket index every target language prints positionally rather than in
# exponential notation, and the largest exactly representable binary64 integer.
Q_MAX = 2 ** 53 - 1


def qbucket(v: float, g: float) -> int:
    """Integer bucket index, half-UP, computed in IEEE-754 binary64.

    NOT `round(v/g)*g`: Python's round() is half-to-even while JS Math.round and Rust
    f64::round are half-away-from-zero, so the two disagree whenever v/g lands exactly on
    k+0.5 -- which real typeset PDFs hit constantly, because 90.0pt (LaTeX's 1.25in margin)
    over a 4pt grid is exactly 22.5.  floor(x + 0.5) has one definition everywhere, and
    math.floor / Math.floor / f64::floor all round toward -inf, so it is also right on
    negative coordinates (floor(-0.5 + 0.5) == 0, not -1 and not -0).

    Emitting the INTEGER INDEX rather than index*g also removes the float-formatting step
    entirely, and with it the negative-zero hazard ("-0.0000" != "0.0000" for the same
    bucket) that fires on any page whose CropBox origin is inside the MediaBox.

    RANGE GUARD.  "base-10 integer" is only a portable emission rule while the integer is
    small enough that every language prints it positionally.  Python str() is always
    positional; JS String(Math.floor(v+0.5)) switches to exponential at 1e21, so
    "1000000000000000000000" in one language is "1e+21" in the other.  Unreachable for PDF
    coordinates (PDF 1.7 Annex C bounds user space at +/-32767) but the contract must not
    depend on that, so an out-of-range bucket is REJECTED rather than emitted."""
    q = math.floor(v / g + 0.5)
    if not (-Q_MAX <= q <= Q_MAX):
        raise ValueError(f"quantised bucket {q} outside the portable integer range "
                         f"+/-{Q_MAX}; coordinate {v!r} at grid {g!r} must be rejected")
    return q


def geom_coords(bbox, geom):
    if geom == "full_bbox":
        return bbox
    if geom == "anchor_xy":
        return (bbox[0], bbox[1])
    if geom == "centre_xy":
        return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)
    raise ValueError(geom)


def _hasher(name: str):
    if name == "blake2s":
        return lambda b: hashlib.blake2s(b, digest_size=16).digest()
    if name == "sha256":
        return lambda b: hashlib.sha256(b).digest()
    raise ValueError(name)


def make_payload(source_hash, page_index, bbox, grid, geom, block_type, text_norm, prefix):
    """source_hash | page_index | q(coords...) | block_type | normalise(text)[:prefix]

    Fields are joined with U+007C.  Only the final field can contain U+007C, so the encoding
    is unambiguous without escaping.  UTF-8 encoded."""
    qb = "|".join(str(qbucket(v, grid)) for v in geom_coords(bbox, geom))
    return f"{source_hash}|{page_index}|{qb}|{block_type}|{truncate(text_norm, prefix)}"


def block_id_from_payload(payload: str, hfn) -> str:
    digest = hfn(payload.encode("utf-8"))
    return "blk_" + base64.b32encode(digest).decode("ascii").rstrip("=").lower()[:16]


def block_id(source_hash, page_index, bbox, grid, geom, block_type, text_norm, prefix, hfn):
    return block_id_from_payload(
        make_payload(source_hash, page_index, bbox, grid, geom, block_type, text_norm, prefix),
        hfn)


def check_quantiser_portability():
    """The properties the cross-language contract rests on, asserted rather than assumed."""
    facts = {}
    # half-UP on the exact tie, in both signs
    facts["q(90.0,4.0)"] = qbucket(90.0, 4.0)                 # 23, not 22 (half-even)
    facts["python_round(90.0/4.0)"] = round(90.0 / 4.0)       # 22 -- the rev-1 bug
    facts["q(-90.0,4.0)"] = qbucket(-90.0, 4.0)               # -22 (floor(-22.0)= -22)
    facts["q(-0.5,1.0)"] = qbucket(-0.5, 1.0)                 # 0, and it is an int, not -0.0
    facts["q(-0.0,2.0)"] = qbucket(-0.0, 2.0)
    facts["str(q(-0.0,2.0))"] = str(qbucket(-0.0, 2.0))       # "0", never "-0"
    facts["q(-1.5,1.0)"] = qbucket(-1.5, 1.0)                 # -1 (half-up toward +inf)
    facts["q(0.0,2.0)==q(-0.0,2.0)"] = qbucket(0.0, 2.0) == qbucket(-0.0, 2.0)
    assert facts["q(90.0,4.0)"] == 23
    assert facts["python_round(90.0/4.0)"] == 22
    assert facts["str(q(-0.0,2.0))"] == "0"
    assert facts["q(-0.5,1.0)"] == 0
    assert facts["q(-1.5,1.0)"] == -1
    assert isinstance(qbucket(-0.0, 2.0), int)
    # the range guard: a bucket past 2^53-1 must be refused, not emitted
    try:
        qbucket(1e22, 1.0)
        facts["q(1e22,1.0)_rejected"] = False
    except ValueError:
        facts["q(1e22,1.0)_rejected"] = True
    facts["q_max"] = Q_MAX
    assert facts["q(1e22,1.0)_rejected"]
    # the PDF 1.7 Annex C user-space bound is 4 orders of magnitude inside the guard
    assert qbucket(32767.0, 0.25) < Q_MAX
    return facts


def check_fold_map_portability():
    """The properties the shipped FOLD_MAP rests on, asserted rather than assumed.

    (1) Applying the map per code point over a whole string is EXACTLY str.casefold(),
        i.e. full case folding really is context-independent, checked over every code
        point in Unicode and over adjacent pairs drawn from the mapped set (which is
        where a context-sensitive rule would have to show up if there were one).
    (2) The map is complete: no code point outside it changes under casefold().
    (3) Nothing the rev-3 delta table covered is lost. The 297 code points where casefold
        and lower() disagree are each either IN the map (fold changes them) or absent
        because their fold is the IDENTITY -- the Cherokee block, whose fold is to
        UPPERCASE, i.e. no change, while lower() would move it. Absence is the correct
        encoding of "leave alone" ONLY under the rule that no runtime case function is
        called for unmapped code points, which is why that rule is mandatory and not
        advisory."""
    facts = {"unicode_version": UNICODE_VERSION, "entries": len(FOLD_MAP)}
    bad_single = [cp for cp in range(0x110000)
                  if casefold_v1(chr(cp)) != chr(cp).casefold()]
    facts["single_codepoint_mismatches_vs_str_casefold"] = len(bad_single)
    assert not bad_single, bad_single[:10]
    mapped = sorted(_FOLD_CHR)
    rng = random.Random(SEED)
    pairs = [(rng.choice(mapped), rng.choice(mapped)) for _ in range(20000)]
    # the Greek final-sigma trap: sigma next to a letter and sigma at the end
    pairs += [("Σ", "Σ"), ("Σ", " "), ("A", "Σ"), ("ς", "σ")]
    bad_pair = [a + b for a, b in pairs if casefold_v1(a + b) != (a + b).casefold()]
    facts["adjacent_pair_mismatches_vs_str_casefold"] = len(bad_pair)
    assert not bad_pair, bad_pair[:5]
    deltas = [cp for cp in range(0x110000) if chr(cp).casefold() != chr(cp).lower()]
    facts["codepoints_where_casefold_differs_from_lower"] = len(deltas)
    absent = [cp for cp in deltas if f"U+{cp:04X}" not in FOLD_MAP]
    facts["deltas_in_map"] = len(deltas) - len(absent)
    facts["deltas_absent_because_fold_is_identity"] = len(absent)
    # every absent one must be a genuine no-op under folding, i.e. the map is complete
    assert all(chr(cp).casefold() == chr(cp) for cp in absent)
    facts["absent_delta_sample"] = [f"U+{cp:04X}" for cp in absent[:6]]
    facts["note"] = (
        "The map is applied by TABLE. An implementation must not call casefold/"
        "toLowerCase/to_lowercase for the code points the table omits either: Python 3.12 "
        "carries UCD " + UNICODE_VERSION + " and Node 22 carries Unicode 17.0, and 55 code "
        "points (U+1C89, U+A7CB/CC/CE/D2/D4/DA/DC, U+10D50..U+10D65, U+16EA0..U+16EB8) "
        "gained a case mapping in between -- a runtime call would fold them in one "
        "language and not the other.")
    return facts


# ───────────────────────── extraction ─────────────────────────

def to_topleft(bbox, rect):
    """Normalise to PDF user space, ORIGIN TOP-LEFT of the page rect, y growing DOWNWARD,
    units = PDF points (1/72in), page rotation already applied by MuPDF.

    Coordinates are NOT rounded here: the ID consumes the binary64 value the IR stores, and
    JSON round-trips binary64 exactly in Python/JS/Rust.  Rounding here would just be a
    second place for the languages to disagree."""
    x0, y0, x1, y1 = bbox
    return (x0 - rect.x0, y0 - rect.y0, x1 - rect.x0, y1 - rect.y0)


def extract_dict_blocks(doc):
    """BASELINE granularity: page.get_text('dict') -> block level.
    Returns (records, lines_per_record); the line detail is what P8 splits on."""
    recs, lines = [], []
    for page in doc:
        rect = page.rect
        d = page.get_text("dict")
        for b in d["blocks"]:
            if b.get("type", 0) == 0:
                lns = [(to_topleft(ln["bbox"], rect),
                        "".join(sp["text"] for sp in ln["spans"]))
                       for ln in b.get("lines", [])]
                text = "\n".join(t for _bb, t in lns)
                btype = "text"
            else:
                lns, text, btype = [], "", "image"
            if btype == "text" and not text.strip():
                continue
            recs.append((page.number, to_topleft(b["bbox"], rect), btype, text))
            lines.append(lns)
    return recs, lines


def extract_dict_lines(doc):
    """LINE granularity.  Used as the collision stress case (2x the blocks in the same
    area, so the geometry buckets are far more crowded).  As a *churn* perturbation it is a
    null: 3256/3270 of its matched pairs are single-line blocks whose line bbox IS the
    block bbox, so it is arithmetically incapable of showing churn."""
    recs = []
    for page in doc:
        rect = page.rect
        d = page.get_text("dict")
        for b in d["blocks"]:
            if b.get("type", 0) != 0:
                recs.append((page.number, to_topleft(b["bbox"], rect), "image", ""))
                continue
            for ln in b.get("lines", []):
                text = "".join(sp["text"] for sp in ln["spans"])
                if not text.strip():
                    continue
                recs.append((page.number, to_topleft(ln["bbox"], rect), "text", text))
    return recs


def extract_blocks_mode(doc):
    """NULL perturbation.  page.get_text('blocks') instead of 'dict' -- same segmentation,
    5380/5380 matched pairs have BIT-IDENTICAL bboxes.  Kept only so that the claim
    'a 0% here proves nothing' is reproducible from the artifacts."""
    recs = []
    for page in doc:
        rect = page.rect
        for x0, y0, x1, y1, text, _no, btype in page.get_text("blocks"):
            kind = "text" if btype == 0 else "image"
            if kind == "text" and not text.strip():
                continue
            recs.append((page.number, to_topleft((x0, y0, x1, y1), rect), kind, text))
    return recs


def extract_glyph_bbox_blocks(doc):
    """P10 bbox-derivation change: same segmentation, but each block's bbox recomputed as
    the union of its CHARACTER bboxes (rawdict) instead of MuPDF's font-metric line boxes.
    Index-aligned with the baseline by construction.  A real, small, sub-point perturbation
    -- the empirical version of P1."""
    recs = []
    for page in doc:
        rect = page.rect
        d = page.get_text("rawdict")
        for b in d["blocks"]:
            if b.get("type", 0) != 0:
                recs.append((page.number, to_topleft(b["bbox"], rect), "image", ""))
                continue
            text = "\n".join("".join(c["c"] for sp in ln["spans"] for c in sp["chars"])
                             for ln in b.get("lines", []))
            if not text.strip():
                continue
            xs0 = ys0 = math.inf
            xs1 = ys1 = -math.inf
            for ln in b.get("lines", []):
                for sp in ln["spans"]:
                    for c in sp["chars"]:
                        cb = c["bbox"]
                        xs0, ys0 = min(xs0, cb[0]), min(ys0, cb[1])
                        xs1, ys1 = max(xs1, cb[2]), max(ys1, cb[3])
            bb = b["bbox"] if xs0 == math.inf else (xs0, ys0, xs1, ys1)
            recs.append((page.number, to_topleft(bb, rect), "text", text))
    return recs


MERGE_GAP_PT = 6.0


def merge_paragraphs(recs):
    """P7 SEGMENTATION change, the dominant real risk.  Consecutive same-page text blocks
    whose vertical gap is under MERGE_GAP_PT and whose x-extents overlap are merged into
    one block (bbox = union, text = "\\n"-join), which is what a switch of segmenter
    (PyMuPDF -> Docling, or a paragraph-reflow fix) actually does."""
    out = []
    for r in recs:
        if not out:
            out.append(list(r))
            continue
        prev = out[-1]
        if (prev[0] == r[0] and prev[2] == "text" and r[2] == "text"
                and r[1][1] - prev[1][3] < MERGE_GAP_PT
                and min(prev[1][2], r[1][2]) - max(prev[1][0], r[1][0]) > 0):
            prev[1] = (min(prev[1][0], r[1][0]), min(prev[1][1], r[1][1]),
                       max(prev[1][2], r[1][2]), max(prev[1][3], r[1][3]))
            prev[3] = prev[3] + "\n" + r[3]
        else:
            out.append(list(r))
    return [tuple(x) for x in out]


def split_paragraphs(recs, lines_per_rec):
    """P8 SEGMENTATION change, the inverse of P7.  Every text block with >= 2 lines is split
    at its LARGEST internal line gap into two blocks (bbox = union of each part's line
    bboxes, text = "\\n"-join of each part).  Merge and split are NOT symmetric under an
    anchor-based scheme -- the first part keeps the anchor and the second does not -- which
    is precisely why both have to be measured."""
    out = []
    for (p, bb, t, tx), lns in zip(recs, lines_per_rec):
        if t != "text" or len(lns) < 2:
            out.append((p, bb, t, tx))
            continue
        gaps = [(lns[i + 1][0][1] - lns[i][0][3], i) for i in range(len(lns) - 1)]
        _g, idx = max(gaps)
        for part in (lns[:idx + 1], lns[idx + 1:]):
            xs = [l[0] for l in part]
            nb = (min(b[0] for b in xs), min(b[1] for b in xs),
                  max(b[2] for b in xs), max(b[3] for b in xs))
            out.append((p, nb, "text", "\n".join(l[1] for l in part)))
    return out


def jitter(recs, half_width, rng):
    return [(p, tuple(v + rng.uniform(-half_width, half_width) for v in bb), t, tx)
            for p, bb, t, tx in recs]


def shift(recs, dx, dy):
    return [(p, (bb[0] + dx, bb[1] + dy, bb[2] + dx, bb[3] + dy), t, tx)
            for p, bb, t, tx in recs]


def flip_origin(recs, heights):
    """P9: y measured from the page BOTTOM (PDF-native / pdfminer / pdfplumber default)
    instead of the top.  ADR-001's original formula text says only `quantise(bbox, 2pt)` --
    it names no origin, no units and no rotation rule, so this flip is a *conforming*
    implementation of the ADR as written.  Measured here to price that omission."""
    return [(p, (bb[0], heights[p] - bb[3], bb[2], heights[p] - bb[1]), t, tx)
            for p, bb, t, tx in recs]


# ───────────────────────── ground-truth matching ─────────────────────────
#
# Every pairing below is computed from GEOMETRY AND TEXT ONLY.  No pairing anywhere in this
# harness looks at an ID; if it did, churn would be measuring itself.

def iou(a, b):
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    aa = max(0.0, (a[2] - a[0])) * max(0.0, (a[3] - a[1]))
    bb = max(0.0, (b[2] - b[0])) * max(0.0, (b[3] - b[1]))
    union = aa + bb - inter
    return inter / union if union > 0 else 0.0


def match_runs(base, pert, base_norm, pert_norm, iou_min=IOU_MATCH):
    """One-to-one greedy match: bbox IoU >= iou_min AND (normalised text equal OR
    similarity >= 0.95).  Used ONLY for the null perturbations, where the segmentation is
    unchanged and IoU is therefore the right relation."""
    by_page = defaultdict(list)
    for j, r in enumerate(pert):
        by_page[r[0]].append(j)

    cands = []
    for i, r in enumerate(base):
        for j in by_page.get(r[0], ()):
            s = pert[j]
            if r[2] != s[2]:
                continue
            ov = iou(r[1], s[1])
            if ov < iou_min:
                continue
            ta, tb = base_norm[i], pert_norm[j]
            if ta == tb:
                cands.append((ov, 1.0, i, j))
            else:
                sm = difflib.SequenceMatcher(None, ta[:400], tb[:400])
                if sm.quick_ratio() < SIM_MATCH:
                    continue
                ratio = sm.ratio()
                if ratio >= SIM_MATCH:
                    cands.append((ov, ratio, i, j))

    cands.sort(key=lambda c: (c[0], c[1]), reverse=True)
    ub, up, groups = set(), set(), []
    for _ov, _r, i, j in cands:
        if i in ub or j in up:
            continue
        ub.add(i)
        up.add(j)
        groups.append((i, [j]))
    groups.sort()
    return groups, len(base) - len(ub), len(pert) - len(up)


def match_containment(base, pert, base_norm, pert_norm):
    """P7/P8 pairing.  Merge and split genuinely CHANGE the boxes, so IoU is the wrong
    relation and would discard exactly the pairs under study.  The rule used instead, on
    the same page and the same block type:

        baseline block i is paired with perturbed block j  iff
            (a) one of the two normalised texts is a CONTIGUOUS SUBSTRING of the other
                (merge: baseline text inside merged text; split: piece text inside
                 baseline text), and
            (b) the smaller block's bbox is inside the larger block's bbox (1e-2 slack).

    A baseline block may map to several perturbed blocks (split produces two pieces).  Its
    ID is counted as SURVIVING if ANY block in its group carries the same ID -- the most
    generous rule available, and deliberately geometry-neutral so it cannot be accused of
    being built to favour the anchor scheme.  Churn under P7/P8 is therefore a LOWER BOUND
    on the real cost of a segmenter change for every scheme equally."""
    by_page = defaultdict(list)
    for j, r in enumerate(pert):
        by_page[r[0]].append(j)
    groups, used_p = [], set()
    for i, r in enumerate(base):
        hit = []
        for j in by_page.get(r[0], ()):
            s = pert[j]
            if r[2] != s[2]:
                continue
            b, q = r[1], s[1]
            inside_b_in_q = (q[0] - 0.01 <= b[0] and q[1] - 0.01 <= b[1]
                             and q[2] + 0.01 >= b[2] and q[3] + 0.01 >= b[3])
            inside_q_in_b = (b[0] - 0.01 <= q[0] and b[1] - 0.01 <= q[1]
                             and b[2] + 0.01 >= q[2] and b[3] + 0.01 >= q[3])
            tb, tq = base_norm[i], pert_norm[j]
            if inside_b_in_q and (not tb or tb in tq):
                hit.append(j)
            elif inside_q_in_b and (not tq or tq in tb):
                hit.append(j)
        if hit:
            groups.append((i, hit))
            used_p.update(hit)
    return groups, len(base) - len(groups), len(pert) - len(used_p)


# ───────────────────────── metrics ─────────────────────────

def distinct_key(rec):
    """'Distinct' = unquantised (page, bbox, type, FULL text) differ."""
    p, bb, t, tx = rec
    return (p, tuple(round(v, 6) for v in bb), t, tx)


def describe(rec):
    p, bb, t, tx = rec
    flat = _WS_RE.sub(" ", tx).strip()
    snip = (flat[:70] + "...") if len(flat) > 70 else flat
    return (f"p{p} {t} bbox=({bb[0]:.1f},{bb[1]:.1f},{bb[2]:.1f},{bb[3]:.1f}) "
            f"text={snip!r}")


DUP_TOL_PT = 1.0


def collisions_for(recs, ids, norm=None, dup_tol=DUP_TOL_PT):
    """Collision census for one run.

    Reported at three granularities, because the first pass reported one number under a
    label that implied another:
      colliding_blocks  distinct blocks that share an ID with some other block
      groups            ID values that more than one distinct block maps to
      excess            sum(len(group)-1) -- the blocks that LOSE their identity, which is
                        the quantity to compare against total_records.
    e.g. 88 colliding blocks in 44 groups is 44 excess, not 88 "collisions".

    Colliding groups are then SPLIT INTO TWO CLASSES, which is new in revision 3 and is
    what makes the hard constraint applicable at all:

      DUPLICATE-RENDER groups.  Every member has the same block type and the same
      normalised text, and every coordinate agrees to within dup_tol (1.0pt, a fixed
      threshold chosen independently of the grid so a coarse grid cannot launder a real
      collision into this class).  These are the SAME INK drawn twice -- PDF producers do
      it for fake-bold, for shadowed figure labels, and for OCR text laid over an image.
      `distinct_key` calls them distinct because their float bboxes differ in the third
      decimal, but no anchoring consumer can tell them apart and no highlight can land on
      the "wrong" one: both cover the same glyphs.  Giving them one ID is the quantiser
      doing its job, not failing.

      GENUINE groups.  Everything else: two blocks a reader would call different, sharing
      an ID.  These are fatal, and these are what R1 is evaluated on.

    Both counts are emitted so that the relaxation is visible and auditable rather than
    buried in a threshold."""
    groups = defaultdict(dict)
    for i, (rec, bid) in enumerate(zip(recs, ids)):
        groups[bid][distinct_key(rec)] = (rec, i)
    cgroups = cblocks = cexcess = 0
    gen_groups = gen_excess = dup_groups = dup_excess = 0
    examples, dup_examples = [], []
    for bid, members in groups.items():
        if len(members) < 2:
            continue
        cgroups += 1
        cblocks += len(members)
        cexcess += len(members) - 1
        ms = list(members.values())
        same_type = len({r[2] for r, _i in ms}) == 1
        if norm is None:
            same_text = len({r[3] for r, _i in ms}) == 1
        else:
            same_text = len({norm[i] for _r, i in ms}) == 1
        tight = all(max(r[1][k] for r, _i in ms) - min(r[1][k] for r, _i in ms) <= dup_tol
                    for k in range(4))
        tag = f"{bid.hex() if isinstance(bid, bytes) else bid}: " \
              f"{describe(ms[0][0])}  ==  {describe(ms[1][0])}"
        if same_type and same_text and tight:
            dup_groups += 1
            dup_excess += len(members) - 1
            if len(dup_examples) < 3:
                dup_examples.append(tag)
        else:
            gen_groups += 1
            gen_excess += len(members) - 1
            if len(examples) < 3:
                examples.append(tag)
    return {"colliding_blocks": cblocks, "colliding_groups": cgroups, "excess": cexcess,
            "genuine_groups": gen_groups, "genuine_excess": gen_excess,
            "duplicate_render_groups": dup_groups, "duplicate_render_excess": dup_excess,
            "examples": examples, "duplicate_render_examples": dup_examples}


def prefix_floor(papers, geom, grid, run, dup_tol=DUP_TOL_PT):
    """EXACTLY how short the text prefix can be at this (geom, grid) before two genuinely
    different records collide -- computed, not sampled.

    Two records can only collide if they agree on every payload field except the text, so
    bucket the run's records by (page, quantised coords, block type) and look inside each
    bucket.  Within a bucket, two records are separated iff their normalised texts differ
    somewhere inside the prefix window, so the shortest prefix that separates a pair is
    LCP(a,b) + 1, and the shortest prefix that separates the whole corpus is the maximum of
    that over every pair in every bucket.

    This is what makes the prefix axis a derivation rather than a sweep: the answer is a
    single number that the 8 sampled prefix values then have to bracket.  Pairs whose
    normalised text is IDENTICAL are unseparable by any prefix; they are reported
    separately and split into duplicate-render (harmless, same ink) and genuine (a real
    floor on the whole scheme, which no prefix length can lift)."""
    required = 0
    unsep_genuine = unsep_dup = examined = 0
    worst = None
    unsep_examples = []
    for fn, P in papers.items():
        recs = P["runs"][run][0]
        norm = P["gt"][run]
        buckets = defaultdict(dict)
        for i, r in enumerate(recs):
            key = (r[0], tuple(qbucket(v, grid) for v in geom_coords(r[1], geom)), r[2])
            buckets[key][distinct_key(r)] = i
        for key, members in buckets.items():
            if len(members) < 2:
                continue
            examined += 1
            idxs = list(members.values())
            for a in range(len(idxs)):
                for b in range(a + 1, len(idxs)):
                    ta, tb = norm[idxs[a]], norm[idxs[b]]
                    if ta == tb:
                        ra, rb = recs[idxs[a]], recs[idxs[b]]
                        tight = all(abs(ra[1][k] - rb[1][k]) <= dup_tol for k in range(4))
                        if tight:
                            unsep_dup += 1
                        else:
                            unsep_genuine += 1
                            if len(unsep_examples) < 3:
                                unsep_examples.append(
                                    f"[{fn}] {describe(ra)}  ==  {describe(rb)}")
                        continue
                    n = 0
                    for ca, cb in zip(ta, tb):
                        if ca != cb:
                            break
                        n += 1
                    if n + 1 > required:
                        required = n + 1
                        worst = f"[{fn}] {describe(recs[idxs[a]])} vs {describe(recs[idxs[b]])}"
    return {"geom": geom, "grid_pt": grid, "run": run,
            "shortest_separating_prefix": required,
            "candidate_buckets_with_2plus_records": examined,
            "unseparable_pairs_genuine": unsep_genuine,
            "unseparable_pairs_duplicate_render": unsep_dup,
            "unseparable_examples": unsep_examples,
            "worst_pair": worst}


# ───────────────────────── analytic boundary model ─────────────────────────

def predicted_jitter_churn(j, g, k):
    """P(quantised geometry changes) under iid uniform jitter of half-width j on grid g with
    k INDEPENDENTLY quantised coordinates.  Per coordinate p = j/(2g) for j <= g, else
    1 - g/(2j).  Note this model does NOT hold for centre_xy, whose coordinate is the mean
    of two jittered values (triangular, not uniform) -- which is why centre_xy beats the
    prediction on P1/P2 and is reported separately."""
    p = (j / (2 * g)) if j <= g else (1 - g / (2 * j))
    return 1 - (1 - p) ** k


def predicted_shift_churn(s, g, k):
    p = min(s / g, 1.0)
    return 1 - (1 - p) ** k


# ───────────────────────── run construction ─────────────────────────

HEADLINE = ["P1_jitter_0.3pt", "P2_jitter_0.9pt", "P3_shift_+0.4pt", "P4_textnorm_v2",
            "P7_paragraph_merge", "P8_paragraph_split"]
AUXILIARY = ["P9_origin_flip", "P10_glyph_bbox"]
NULLS = ["N1_line_granularity", "N2_blocks_mode"]
# Collisions are evaluated on these runs.  baseline = BLOCK granularity (the hard
# constraint), N1 = LINE granularity (the stress case), P7/P8 = the segmentation-changed
# worlds the IDs must also survive in.
COLLISION_RUNS = ("baseline", "N1_line_granularity", "P7_paragraph_merge",
                  "P8_paragraph_split")


def build_runs(path):
    """All runs for one paper.  `exact` marks perturbations that are element-wise transforms
    of the baseline, where pair i<->i is ground truth and no matcher is needed or wanted."""
    doc = fitz.open(path)
    base, base_lines = extract_dict_blocks(doc)
    lines = extract_dict_lines(doc)
    blocks_mode = extract_blocks_mode(doc)
    glyph = extract_glyph_bbox_blocks(doc)
    heights = {p.number: p.rect.height for p in doc}
    npages = doc.page_count
    geom_facts = {
        "rotations": sorted({p.rotation for p in doc}),
        "cropbox_offset_pages": sum(1 for p in doc
                                    if abs(p.rect.x0) > 1e-9 or abs(p.rect.y0) > 1e-9),
        "negative_coord_blocks": sum(1 for r in base if min(r[1]) < 0),
        "multiline_blocks": sum(1 for l in base_lines if len(l) >= 2),
    }
    doc.close()

    name = os.path.basename(path)
    runs = {"baseline": (base, normalise_v1, "exact")}
    for s in range(JITTER_SEEDS):
        runs[f"P1_jitter_0.3pt_s{s}"] = (
            jitter(base, 0.3, random.Random(f"{SEED}|{name}|P1|{s}")), normalise_v1, "exact")
        runs[f"P2_jitter_0.9pt_s{s}"] = (
            jitter(base, 0.9, random.Random(f"{SEED}|{name}|P2|{s}")), normalise_v1, "exact")
    runs["P3_shift_+0.4pt"] = (shift(base, 0.4, 0.4), normalise_v1, "exact")
    runs["P4_textnorm_v2"] = (base, normalise_v2, "exact")
    runs["P7_paragraph_merge"] = (merge_paragraphs(base), normalise_v1, "contain")
    runs["P8_paragraph_split"] = (split_paragraphs(base, base_lines), normalise_v1, "contain")
    runs["P9_origin_flip"] = (flip_origin(base, heights), normalise_v1, "exact")
    runs["P10_glyph_bbox"] = (glyph, normalise_v1, "iou")
    runs["N1_line_granularity"] = (lines, normalise_v1, "iou")
    runs["N2_blocks_mode"] = (blocks_mode, normalise_v1, "iou")
    return npages, runs, geom_facts


def family(rname):
    return rname.rsplit("_s", 1)[0] if re.search(r"_s\d+$", rname) else rname


# ───────────────────────── main ─────────────────────────

def main():
    pdfs = sorted(f for f in os.listdir(CORPUS) if f.lower().endswith(".pdf"))
    if not pdfs:
        sys.exit(f"no PDFs in {CORPUS} -- run research/benchmarks/fetch_corpus.sh")

    quantiser_facts = check_quantiser_portability()
    fold_facts = check_fold_map_portability()
    t_start = time.time()
    papers = {}
    for fn in pdfs:
        path = os.path.join(CORPUS, fn)
        with open(path, "rb") as fh:
            source_hash = hashlib.sha256(fh.read()).hexdigest()
        npages, runs, geom_facts = build_runs(path)

        # ground-truth normalised text (always normalise_v1, on BOTH sides, so that the
        # matcher is independent of the normaliser under test)
        gt = {k: [normalise_v1(r[3]) for r in recs] for k, (recs, _n, _m) in runs.items()}
        # hashing-time normalised text (uses each run's own normaliser)
        hn = {k: [nf(r[3]) for r in recs] for k, (recs, nf, _m) in runs.items()}

        base_recs = runs["baseline"][0]
        matches = {}
        for k, (recs, _nf, mode) in runs.items():
            if k == "baseline":
                continue
            if mode == "exact":
                assert len(recs) == len(base_recs), (k, len(recs), len(base_recs))
                groups = [(i, [i]) for i in range(len(base_recs))]
                un_b = un_p = 0
            elif mode == "contain":
                groups, un_b, un_p = match_containment(base_recs, recs, gt["baseline"], gt[k])
            else:
                groups, un_b, un_p = match_runs(base_recs, recs, gt["baseline"], gt[k])
            matches[k] = {"groups": groups, "unmatched_baseline": un_b,
                          "unmatched_perturbed": un_p, "mode": mode}

        # pre-truncated text per prefix, so the sweep never re-slices
        trunc = {pfx: {k: [truncate(t, pfx) for t in v] for k, v in hn.items()}
                 for pfx in PREFIXES}

        papers[fn] = {
            "source_hash": source_hash, "pages": npages, "runs": runs, "gt": gt,
            "hn": hn, "trunc": trunc, "matches": matches, "geom_facts": geom_facts,
            "block_counts": {k: len(v[0]) for k, v in runs.items()},
        }
        print(f"[extract] {fn:32s} {npages:3d}pp  blocks={len(base_recs):5d} "
              f"lines={len(runs['N1_line_granularity'][0]):5d} "
              f"merged={len(runs['P7_paragraph_merge'][0]):5d} "
              f"split={len(runs['P8_paragraph_split'][0]):5d}", file=sys.stderr)

    run_names = list(papers[pdfs[0]]["runs"])
    perturbs = [k for k in run_names if k != "baseline"]
    fams = []
    for k in perturbs:
        if family(k) not in fams:
            fams.append(family(k))

    # ── prefix floor: computed exactly, before anything is swept ────────────
    floors = []
    for geom in GEOMS:
        for grid in GRIDS + HEADROOM_GRIDS:
            for run in COLLISION_RUNS:
                floors.append(prefix_floor(papers, geom, grid, run))
    print(f"[floor] computed {len(floors)} prefix floors  t={time.time()-t_start:.0f}s",
          file=sys.stderr)

    hfn = _hasher(HASH)

    def idkey(payload: str) -> bytes:
        """The 80 bits that actually become the ID.  Collisions must be counted here, not on
        the full 256-bit digest, or the measurement flatters the formula by 176 bits."""
        return hfn(payload.encode("utf-8"))[:ID_BYTES]

    # ── main sweep: geometry x grid x prefix, all perturbations ──────────────
    combos = []
    for geom in GEOMS:
        for grid in GRIDS:
            # geometry+type stem, independent of prefix: built once per (geom, grid)
            stems = {}
            for fn, P in papers.items():
                sh = P["source_hash"]
                stems[fn] = {
                    rn: [f"{sh}|{r[0]}|"
                         + "|".join(str(qbucket(v, grid)) for v in geom_coords(r[1], geom))
                         + f"|{r[2]}|"
                         for r in recs]
                    for rn, (recs, _nf, _m) in P["runs"].items()
                }
            for prefix in PREFIXES:
                row = {"geom": geom, "grid_pt": grid, "hash": HASH,
                       "text_prefix_len": prefix, "total_blocks": 0,
                       "r1_pass": True, "r1_strict_pass": True, "r1_failing_runs": [],
                       "collisions_by_run": {}, "churn_pct_by_perturbation": {},
                       "churn_spread": {}, "per_paper": {},
                       "pairing_by_perturbation": {},
                       "p7_false_positive": {}, "p8_false_positive": {}}
                churn_num = defaultdict(int)
                churn_den = defaultdict(int)
                unm = defaultdict(lambda: [0, 0])
                fp = {rn: defaultdict(int) for rn in ("P7_paragraph_merge",
                                                      "P8_paragraph_split")}

                for fn, P in papers.items():
                    ids = {rn: [idkey(stems[fn][rn][i] + P["trunc"][prefix][rn][i])
                                for i in range(len(stems[fn][rn]))]
                           for rn in run_names}
                    paper_rec = {"collisions_by_run": {}, "churn_pct": {}}
                    for rn in COLLISION_RUNS:
                        recs = P["runs"][rn][0]
                        col = collisions_for(recs, ids[rn], P["gt"][rn])
                        paper_rec["collisions_by_run"][rn] = {
                            "blocks": len(recs), "excess": col["excess"],
                            "genuine_excess": col["genuine_excess"],
                            "duplicate_render_excess": col["duplicate_render_excess"]}
                        agg = row["collisions_by_run"].setdefault(
                            rn, {"total_records": 0, "colliding_blocks": 0,
                                 "colliding_groups": 0, "excess": 0, "genuine_excess": 0,
                                 "genuine_groups": 0, "duplicate_render_excess": 0,
                                 "papers_with_genuine_collisions": [], "examples": [],
                                 "duplicate_render_examples": []})
                        agg["total_records"] += len(recs)
                        for k in ("colliding_blocks", "colliding_groups", "excess",
                                  "genuine_excess", "genuine_groups",
                                  "duplicate_render_excess"):
                            agg[k] += col[k]
                        if col["genuine_excess"]:
                            agg["papers_with_genuine_collisions"].append(fn)
                            if len(agg["examples"]) < 3 and col["examples"]:
                                agg["examples"].append(f"[{fn}] {col['examples'][0]}")
                        if (col["duplicate_render_examples"]
                                and len(agg["duplicate_render_examples"]) < 3):
                            agg["duplicate_render_examples"].append(
                                f"[{fn}] {col['duplicate_render_examples'][0]}")
                    row["total_blocks"] += len(P["runs"]["baseline"][0])

                    for rn in perturbs:
                        m = P["matches"][rn]
                        base_ids = ids["baseline"]
                        pert_ids = ids[rn]
                        changed = 0
                        for i, js in m["groups"]:
                            if base_ids[i] in (pert_ids[j] for j in js):
                                if rn in fp:
                                    surv = next(j for j in js
                                                if pert_ids[j] == base_ids[i])
                                    fp[rn]["survived"] += 1
                                    if P["gt"][rn][surv] != P["gt"]["baseline"][i]:
                                        fp[rn]["survived_text_changed"] += 1
                                        bl = len(P["gt"]["baseline"][i])
                                        pl = len(P["gt"][rn][surv])
                                        if pl > bl:
                                            fp[rn]["survived_text_grew"] += 1
                                        elif pl < bl:
                                            fp[rn]["survived_text_shrank"] += 1
                                        # tier-2 detection: content_hash is over the FULL
                                        # normalised text, so a changed text is a changed
                                        # content_hash.  Verified, not assumed.
                                        h1 = hfn(P["gt"]["baseline"][i].encode("utf-8"))
                                        h2 = hfn(P["gt"][rn][surv].encode("utf-8"))
                                        if h1 != h2:
                                            fp[rn]["detected_by_content_hash"] += 1
                            else:
                                changed += 1
                        n = len(m["groups"])
                        churn_num[rn] += changed
                        churn_den[rn] += n
                        unm[rn][0] += m["unmatched_baseline"]
                        unm[rn][1] += m["unmatched_perturbed"]
                        if family(rn) in HEADLINE or family(rn) in AUXILIARY:
                            paper_rec["churn_pct"].setdefault(family(rn), [])
                            paper_rec["churn_pct"][family(rn)].append(
                                round(100 * changed / n, 3) if n else None)
                    paper_rec["churn_pct"] = {
                        k: (round(statistics.mean([x for x in v if x is not None]), 3)
                            if any(x is not None for x in v) else None)
                        for k, v in paper_rec["churn_pct"].items()}
                    row["per_paper"][fn] = paper_rec

                for rn, agg in row["collisions_by_run"].items():
                    if agg["genuine_excess"]:
                        row["r1_pass"] = False
                        row["r1_failing_runs"].append(rn)
                    if agg["excess"]:
                        row["r1_strict_pass"] = False

                per_run_churn = {}
                for rn in perturbs:
                    d = churn_den[rn]
                    per_run_churn[rn] = round(100 * churn_num[rn] / d, 3) if d else None
                    row["pairing_by_perturbation"][rn] = {
                        "mode": papers[pdfs[0]]["matches"][rn]["mode"],
                        "matched_baseline_blocks": d, "unmatched_baseline": unm[rn][0],
                        "unmatched_perturbed": unm[rn][1]}
                for f in fams:
                    vals = [per_run_churn[rn] for rn in perturbs
                            if family(rn) == f and per_run_churn[rn] is not None]
                    if not vals:
                        row["churn_pct_by_perturbation"][f] = None
                        continue
                    row["churn_pct_by_perturbation"][f] = round(statistics.mean(vals), 3)
                    if len(vals) > 1:
                        row["churn_spread"][f] = {
                            "n_seeds": len(vals), "min": min(vals), "max": max(vals),
                            "stdev": round(statistics.stdev(vals), 3)}
                for rn in fp:
                    tot = churn_den[rn]
                    d = dict(fp[rn])
                    d["matched_baseline_blocks"] = tot
                    d["survived_pct"] = round(100 * d.get("survived", 0) / tot, 3) if tot else None
                    d["false_positive_pct_of_all_blocks"] = (
                        round(100 * d.get("survived_text_changed", 0) / tot, 3) if tot else None)
                    d["false_positive_pct_of_survivors"] = (
                        round(100 * d.get("survived_text_changed", 0) / d["survived"], 3)
                        if d.get("survived") else None)
                    d["content_hash_detection_pct"] = (
                        round(100 * d.get("detected_by_content_hash", 0)
                              / d["survived_text_changed"], 3)
                        if d.get("survived_text_changed") else None)
                    row["p7_false_positive" if rn == "P7_paragraph_merge"
                        else "p8_false_positive"] = d
                combos.append(row)
            print(f"[sweep] geom={geom} grid={grid} done  t={time.time()-t_start:.0f}s",
                  file=sys.stderr)

    def pick(geom, grid, prefix):
        return next(c for c in combos if c["grid_pt"] == grid and c["geom"] == geom
                    and c["text_prefix_len"] == prefix)

    # ── the decision rule, applied mechanically ─────────────────
    #
    # Stated before the numbers were looked at (see the module docstring and the ADR):
    #   R1 HARD: zero collisions at block AND line granularity, on every paper, on every
    #            measured run.  Eliminates, does not penalise.
    #   R2 Among survivors, minimise churn under the REALISTIC perturbations: P7 merge and
    #      P4 textnorm.  Score = P7 + P4 (equal weight; both are single parser releases).
    #      P1/P2/P3 are synthetic stress and are reported, not optimised.
    #   R3 Tie-break toward the COARSEST grid then the SHORTEST prefix.
    #   R4 Cross-language determinism is a constraint satisfied by construction (integer
    #      buckets, enumerated normalisation), not a scoring axis.
    def r2_score(c):
        """R2's objective: the two perturbations a parser point release actually produces,
        equally weighted because each is one release."""
        p7 = c["churn_pct_by_perturbation"]["P7_paragraph_merge"]
        p4 = c["churn_pct_by_perturbation"]["P4_textnorm_v2"]
        assert p7 is not None and p4 is not None, c
        return round(p7 + p4, 6)

    survivors = [c for c in combos if c["r1_pass"]]
    ranked = sorted(survivors,
                    key=lambda c: (r2_score(c), -c["grid_pt"], c["text_prefix_len"]))
    decision = {
        "rule": [
            "R1 HARD CONSTRAINT: zero GENUINE colliding-block excess on baseline (block "
            "granularity), N1 (line granularity), P7 (merged) and P8 (split), on every "
            "paper. Eliminates.",
            "R2 minimise P7_paragraph_merge + P4_textnorm_v2 churn (the two perturbations "
            "a parser point release actually produces).",
            "R3 tie-break: coarsest grid, then shortest prefix.",
            "R4 cross-language determinism is a constraint met by construction, not scored.",
        ],
        "combinations_total": len(combos),
        "r1_survivors": len(survivors),
        "r1_eliminated": len(combos) - len(survivors),
        "r1_as_literally_stated": {
            "statement": ("zero collisions at block AND line granularity, on every paper, "
                          "on every run, where 'collision' = two records with different "
                          "unquantised (page, bbox, type, full text) sharing an ID"),
            "survivors": sum(1 for c in combos if c["r1_strict_pass"]),
            "outcome": ("ELIMINATES EVERY COMBINATION, including the finest grid tested "
                        "(0.25pt) and the longest prefix (160). Stated up front rather "
                        "than discovered late."),
            "why": ("the survivors are killed by ONE class of input, and it is not an ID "
                    "problem. bert-2col p14 draws the figure label 'Tok 1' TWICE, 0.4pt "
                    "apart -- a fake-bold / shadowed-label render. The two records have "
                    "different float bboxes, so the harness calls them distinct, but they "
                    "are the same ink: a highlight cannot land on the 'wrong' one because "
                    "they cover the same glyphs. Any grid coarser than 0.5pt merges them, "
                    "which is the quantiser working as designed."),
            "relaxation": ("R1 is evaluated on GENUINE collisions only. A colliding group "
                           "is reclassified as a DUPLICATE RENDER, and excluded, iff all "
                           "its members share a block type and a normalised text AND all "
                           "four coordinates agree to within " f"{DUP_TOL_PT}pt. The "
                           "tolerance is FIXED and grid-independent, so a coarse grid "
                           "cannot launder a real collision into the exempt class -- at "
                           "32pt, two blocks 20pt apart with the same text are still "
                           "counted as a genuine collision. Both counts are in every row "
                           "of `combinations` (`excess` vs `genuine_excess`), so the "
                           "relaxation can be audited and reversed."),
            "what_this_costs": ("the formula is not claimed to give distinct ids to "
                                "sub-point duplicate renders of identical text. It cannot, "
                                "and neither can any quantising scheme; that is what "
                                "quantising means. Consumers that must distinguish "
                                "co-located identical text (they do not exist in "
                                "PaperTree today) would need the draw-order ordinal, "
                                "which is deliberately absent from the payload because it "
                                "is what makes ids positional."),
        },
    }
    if not survivors:
        decision["outcome"] = "R1 ELIMINATED EVERYTHING -- see relaxation below"
        chosen_row = None
    else:
        chosen_row = ranked[0]
        # is R2 discriminating, or is it a plateau?
        best = r2_score(chosen_row)
        tied = [c for c in survivors if r2_score(c) == best]
        decision["r2_best_score_pct"] = best
        decision["r2_ties_at_best"] = len(tied)
        decision["r2_tied_set"] = [
            {"geom": c["geom"], "grid_pt": c["grid_pt"],
             "text_prefix_len": c["text_prefix_len"]} for c in tied[:20]]
        decision["r3_applied"] = len(tied) > 1
        decision["top_10"] = [
            {"geom": c["geom"], "grid_pt": c["grid_pt"],
             "text_prefix_len": c["text_prefix_len"],
             "P7": c["churn_pct_by_perturbation"]["P7_paragraph_merge"],
             "P4": c["churn_pct_by_perturbation"]["P4_textnorm_v2"],
             "P1": c["churn_pct_by_perturbation"]["P1_jitter_0.3pt"],
             "P2": c["churn_pct_by_perturbation"]["P2_jitter_0.9pt"],
             "P8": c["churn_pct_by_perturbation"]["P8_paragraph_split"],
             "score": r2_score(c)}
            for c in ranked[:10]]
        CHOSEN["geom"] = chosen_row["geom"]
        CHOSEN["grid_pt"] = chosen_row["grid_pt"]
        CHOSEN["text_prefix_len"] = chosen_row["text_prefix_len"]
        decision["outcome"] = dict(CHOSEN)
    # R2 is a PLATEAU, not a peak, and a plateau needs a stated width or the tie-break
    # never fires and the rule degenerates into "whatever the float comparison says".
    # Width = one standard error of the churn proportion at the chosen row's sample size
    # (binomial, n = matched baseline blocks).  Reported with the answer BOTH ways so the
    # tolerance can be seen not to be doing the work.
    if survivors:
        n_pairs = chosen_row["pairing_by_perturbation"]["P7_paragraph_merge"][
            "matched_baseline_blocks"]
        p = chosen_row["churn_pct_by_perturbation"]["P7_paragraph_merge"] / 100.0
        se_pp = round(100 * math.sqrt(p * (1 - p) / n_pairs), 3)
        within = [c for c in survivors if r2_score(c) <= best + se_pp]
        coarse = sorted(within, key=lambda c: (-c["grid_pt"], c["text_prefix_len"],
                                               r2_score(c)))[0]
        decision["r2_plateau"] = {
            "standard_error_pp": se_pp,
            "note": ("churn is a proportion over n matched blocks, so differences smaller "
                     "than its standard error are noise. R2 is applied with that "
                     "tolerance and R3 then breaks the tie; the strict-argmin answer is "
                     "shown alongside so the tolerance can be checked not to be doing the "
                     "work."),
            "n_matched_blocks": n_pairs,
            "combinations_within_1_se_of_best": len(within),
            "strict_argmin": {"geom": ranked[0]["geom"], "grid_pt": ranked[0]["grid_pt"],
                              "text_prefix_len": ranked[0]["text_prefix_len"],
                              "score": r2_score(ranked[0])},
            "coarsest_within_1_se": {"geom": coarse["geom"], "grid_pt": coarse["grid_pt"],
                                     "text_prefix_len": coarse["text_prefix_len"],
                                     "score": r2_score(coarse)},
            "agree": (coarse["geom"], coarse["grid_pt"], coarse["text_prefix_len"])
                     == (ranked[0]["geom"], ranked[0]["grid_pt"],
                         ranked[0]["text_prefix_len"]),
        }

    # what fraction of P7/P8 churn is UNAVOIDABLE for any scheme whatsoever?  Under merge,
    # only one constituent of a merged block can inherit an id; every other constituent
    # loses its identity no matter how the id is computed.  Reporting churn without this
    # floor makes every scheme look ~40% worse than it is.
    structural = {}
    for rn in ("P7_paragraph_merge", "P8_paragraph_split"):
        forced = tot = 0
        for fn, P in papers.items():
            seen = set()
            for i, js in P["matches"][rn]["groups"]:
                tot += 1
                key = tuple(js)
                if rn == "P7_paragraph_merge":
                    if key in seen:
                        forced += 1
                    seen.add(key)
        structural[rn] = {
            "matched_baseline_blocks": tot, "blocks_that_cannot_keep_an_id": forced,
            "unavoidable_churn_pct": round(100 * forced / tot, 3) if tot else None}
    structural["_note"] = (
        "P7: a merged block can inherit at most ONE constituent's id, so every other "
        "constituent is churn under any scheme -- this is the floor every geometry is "
        "measured against, not a property of the formula. P8: a split block's id can be "
        "inherited by one of its pieces, so the split floor is 0 and all of P8's churn is "
        "attributable to the geometry payload.")
    decision["structural_churn_floor"] = structural

    # exact safety margin on the prefix axis at the chosen configuration
    margin = {"chosen": dict(CHOSEN), "by_run": {}}
    for run in COLLISION_RUNS:
        f = next(x for x in floors if x["geom"] == CHOSEN["geom"]
                 and x["grid_pt"] == CHOSEN["grid_pt"] and x["run"] == run)
        margin["by_run"][run] = {
            "shortest_separating_prefix": f["shortest_separating_prefix"],
            "unseparable_pairs_genuine": f["unseparable_pairs_genuine"],
            "worst_pair": f["worst_pair"]}
    worst_floor = max(v["shortest_separating_prefix"] for v in margin["by_run"].values())
    margin["binding_floor"] = worst_floor
    margin["chosen_prefix"] = CHOSEN["text_prefix_len"]
    margin["headroom_codepoints"] = CHOSEN["text_prefix_len"] - worst_floor
    margin["headroom_factor"] = (round(CHOSEN["text_prefix_len"] / worst_floor, 2)
                                 if worst_floor else None)
    margin["note"] = (
        "the chosen prefix must be >= binding_floor or a genuine collision appears. The "
        "headroom is the margin against a NINTH paper that is harder than these eight. It "
        "is a corpus-conditional number: 8 papers is a small sample and the floor has no "
        "error bar, which is the strongest argument for not shaving the prefix to the "
        "floor and the reason the sweep reports every prefix rather than only the winner.")
    decision["prefix_margin"] = margin

    print(f"[decision] survivors={len(survivors)}/{len(combos)}  chosen={CHOSEN}  "
          f"margin={margin['headroom_codepoints']}", file=sys.stderr)

    # where each axis stops working -- the boundary, located rather than assumed
    axis_limits = {
        "coarsest_grid_passing_R1_by_geom": {},
        "shortest_prefix_passing_R1_by_geom": {},
        "first_colliding_grid_by_geom_at_chosen_prefix": {},
        "first_colliding_prefix_by_geom_at_chosen_grid": {},
    }
    for geom in GEOMS:
        gs = [c["grid_pt"] for c in survivors if c["geom"] == geom]
        ps = [c["text_prefix_len"] for c in survivors if c["geom"] == geom]
        axis_limits["coarsest_grid_passing_R1_by_geom"][geom] = max(gs) if gs else None
        axis_limits["shortest_prefix_passing_R1_by_geom"][geom] = min(ps) if ps else None
        bad_g = [c["grid_pt"] for c in combos
                 if c["geom"] == geom and c["text_prefix_len"] == CHOSEN["text_prefix_len"]
                 and not c["r1_pass"]]
        axis_limits["first_colliding_grid_by_geom_at_chosen_prefix"][geom] = (
            min(bad_g) if bad_g else None)
        bad_p = [c["text_prefix_len"] for c in combos
                 if c["geom"] == geom and c["grid_pt"] == CHOSEN["grid_pt"]
                 and not c["r1_pass"]]
        axis_limits["first_colliding_prefix_by_geom_at_chosen_grid"][geom] = (
            max(bad_p) if bad_p else None)

    # ── headroom probe past the sweep ───────────────────────────
    headroom = []
    for grid in HEADROOM_GRIDS:
        for geom in GEOMS:
            entry = {"grid_pt": grid, "geom": geom,
                     "text_prefix_len": CHOSEN["text_prefix_len"], "by_run": {}}
            for rn in ("baseline", "N1_line_granularity"):
                acc = {"excess": 0, "genuine_excess": 0, "duplicate_render_excess": 0}
                for fn, P in papers.items():
                    recs = P["runs"][rn][0]
                    ids = [idkey(make_payload(P["source_hash"], r[0], r[1], grid, geom,
                                              r[2], P["hn"][rn][i],
                                              CHOSEN["text_prefix_len"]))
                           for i, r in enumerate(recs)]
                    col = collisions_for(recs, ids, P["gt"][rn])
                    for k in acc:
                        acc[k] += col[k]
                entry["by_run"][rn] = acc
            headroom.append(entry)

    # ── boundary model check, at the chosen geometry ────────────
    k_coords = {"full_bbox": 4, "anchor_xy": 2, "centre_xy": 2}[CHOSEN["geom"]]
    boundary = []
    for grid in GRIDS:
        r = pick(CHOSEN["geom"], grid, CHOSEN["text_prefix_len"])
        rf = pick("full_bbox", grid, CHOSEN["text_prefix_len"])
        boundary.append({
            "grid_pt": grid,
            "P1_observed_pct": r["churn_pct_by_perturbation"]["P1_jitter_0.3pt"],
            "P1_predicted_pct": round(100 * predicted_jitter_churn(0.3, grid, k_coords), 3),
            "P2_observed_pct": r["churn_pct_by_perturbation"]["P2_jitter_0.9pt"],
            "P2_predicted_pct": round(100 * predicted_jitter_churn(0.9, grid, k_coords), 3),
            "P3_observed_pct": r["churn_pct_by_perturbation"]["P3_shift_+0.4pt"],
            "P3_predicted_pct": round(100 * predicted_shift_churn(0.4, grid, k_coords), 3),
            "P1_observed_pct_full_bbox": rf["churn_pct_by_perturbation"]["P1_jitter_0.3pt"],
            "P1_predicted_pct_full_bbox": round(100 * predicted_jitter_churn(0.3, grid, 4), 3),
        })

    # ── payload-shape probe ─────────────────────────────────────
    #   * synthesis-05's payload omits block_type
    #   * the "just drop geometry, it only causes churn" temptation
    shape_probe = {}
    for label, drop_type in (("with_block_type", False), ("without_block_type", True)):
        tot = 0
        for fn, P in papers.items():
            recs = P["runs"]["baseline"][0]
            ids = [idkey(make_payload(P["source_hash"], r[0], r[1], CHOSEN["grid_pt"],
                                      CHOSEN["geom"], ("" if drop_type else r[2]),
                                      P["hn"]["baseline"][i], CHOSEN["text_prefix_len"]))
                   for i, r in enumerate(recs)]
            tot += collisions_for(recs, ids, P["gt"]["baseline"])["genuine_excess"]
        shape_probe[label] = tot
    for label, rn in (("no_geometry", "baseline"), ("no_geometry_line_granularity",
                                                    "N1_line_granularity")):
        tot = 0
        for fn, P in papers.items():
            recs = P["runs"][rn][0]
            ids = [idkey(f"{P['source_hash']}|{r[0]}|{r[2]}|"
                         f"{truncate(P['hn'][rn][i], CHOSEN['text_prefix_len'])}")
                   for i, r in enumerate(recs)]
            tot += collisions_for(recs, ids, P["gt"][rn])["genuine_excess"]
        shape_probe[label] = tot

    # ── cross-language / encoding exposure ──────────────────────
    tie_counts = {g: {} for g in GEOMS}
    for geom in GEOMS:
        for g in GRIDS:
            n = 0
            for fn, P in papers.items():
                for r in P["runs"]["baseline"][0]:
                    if any((v / g) % 1 == 0.5 for v in geom_coords(r[1], geom)):
                        n += 1
            tie_counts[geom][str(g)] = n
    NPFX = CHOSEN["text_prefix_len"]

    def _norm_lowercase_variant(s):
        """What a JS/Rust implementation gets if it reaches for the obvious primitive
        (String.prototype.toLowerCase / str::to_lowercase) instead of full case folding."""
        s = unicodedata.normalize("NFC", s)
        s = _LIG_RE.sub(lambda m: LIGATURES[m.group(0)], s)
        s = _WS_RE.sub(" ", s).strip(WS_CHARS)
        return s.lower()

    def _norm_pyws_variant(s):
        """What an implementation gets if it inherits its language's `\\s` class instead of
        the enumerated one."""
        s = unicodedata.normalize("NFC", s)
        s = _LIG_RE.sub(lambda m: LIGATURES[m.group(0)], s)
        s = re.sub(r"\s+", " ", s).strip()
        return casefold_v1(s)

    astral = fold_diff = ws_diff = total_recs = utf16_diff = byte_trunc_diff = 0
    for fn, P in papers.items():
        for i, r in enumerate(P["runs"]["baseline"][0]):
            total_recs += 1
            canon = truncate(P["hn"]["baseline"][i], NPFX)
            if any(ord(c) > 0xFFFF for c in canon):
                astral += 1
            u16 = P["hn"]["baseline"][i]
            enc = u16.encode("utf-16-le")[:NPFX * 2]
            try:
                if enc.decode("utf-16-le") != canon:
                    utf16_diff += 1
            except UnicodeDecodeError:
                utf16_diff += 1
            benc = u16.encode("utf-8")[:NPFX]
            try:
                if benc.decode("utf-8") != canon:
                    byte_trunc_diff += 1
            except UnicodeDecodeError:
                byte_trunc_diff += 1
            if truncate(_norm_lowercase_variant(r[3]), NPFX) != canon:
                fold_diff += 1
            if truncate(_norm_pyws_variant(r[3]), NPFX) != canon:
                ws_diff += 1
    encoding_exposure = {
        "note": ("blocks whose block_id WOULD DIFFER between two implementations that both "
                 "conform to a spec leaving the listed detail unstated. Measured on the "
                 "baseline run at the chosen prefix; these are the reasons the amendment "
                 "enumerates the normalisation instead of naming a language primitive."),
        "total_baseline_blocks": total_recs,
        "half_bucket_tie_blocks_by_geom_and_grid": tie_counts,
        "half_bucket_note": ("count of baseline blocks with at least one quantised "
                             "coordinate exactly on k+0.5. Under round-half-to-even "
                             "(Python) vs half-up (JS/Rust) EVERY one of these is a "
                             "potential ID fork; under floor(v/g+0.5) none of them is."),
        "blocks_diverging_if_truncation_is_utf16_units": utf16_diff,
        "blocks_with_astral_codepoints_in_prefix": astral,
        "blocks_diverging_if_lowercase_used_instead_of_casefold": fold_diff,
        "blocks_diverging_if_language_native_ws_class_used": ws_diff,
        "fold_map_codepoints": len(FOLD_MAP),
        "fold_map_unicode_version": UNICODE_VERSION,
        "blocks_diverging_if_bytes_used_for_truncation": byte_trunc_diff,
        "quantiser_portability_facts": quantiser_facts,
        "fold_map_portability_facts": fold_facts,
    }

    # ── hash timing probe (evidence, not a tie-break) ──
    sample = []
    for fn, P in papers.items():
        sh = P["source_hash"]
        for i, r in enumerate(P["runs"]["baseline"][0]):
            sample.append(make_payload(sh, r[0], r[1], CHOSEN["grid_pt"], CHOSEN["geom"],
                                       r[2], P["hn"]["baseline"][i],
                                       CHOSEN["text_prefix_len"]).encode("utf-8"))
    timing = {}
    for label, fn_ in (("blake2s_16", lambda b: hashlib.blake2s(b, digest_size=16).digest()),
                       ("blake2s_32", lambda b: hashlib.blake2s(b).digest()),
                       ("sha256", lambda b: hashlib.sha256(b).digest())):
        ts = []
        for _ in range(31):
            t0 = time.perf_counter()
            for b in sample:
                fn_(b)
            ts.append((time.perf_counter() - t0) * 1000)
        timing[label] = {"min_ms": round(min(ts), 3),
                         "median_ms": round(statistics.median(ts), 3)}
    timing["_note"] = (f"best and median of 31 passes, ms to hash all {len(sample)} baseline "
                       f"payloads (mean {round(sum(len(b) for b in sample)/len(sample),1)} "
                       f"bytes), {sys.platform}/{os.uname().machine}, "
                       f"CPython {sys.version.split()[0]}. This machine has ARMv8 SHA-256 "
                       f"instructions and no BLAKE2 instructions, which is why the usual "
                       f"'blake2 is faster' folklore inverts here. Read the SPREAD, not the "
                       f"ordering: every candidate hashes the entire corpus in 1-3ms, so "
                       f"speed cannot and does not decide this. Portability does: Node "
                       f"cannot emit blake2s-128 at all.")

    # ── conformance vectors ─────────────────────────────────────
    chosen_h = _hasher(HASH)
    G = CHOSEN["grid_pt"]
    NP = CHOSEN["text_prefix_len"]
    GEOM = CHOSEN["geom"]
    vecs = []
    seen_ids = {}

    def add_vec(label, group, sh, page, bbox, btype, raw_text, note=None):
        tn = normalise_v1(raw_text)
        pl = make_payload(sh, page, bbox, G, GEOM, btype, tn, NP)
        v = {"label": label, "group": group, "source_hash": sh, "page_index": page,
             "bbox": list(bbox), "block_type": btype, "raw_text": raw_text,
             "normalised_text": tn,
             "quantised_coords": [qbucket(c, G) for c in geom_coords(bbox, GEOM)],
             "payload": pl, "block_id": block_id_from_payload(pl, chosen_h)}
        if note:
            v["note"] = note
        vecs.append(v)
        seen_ids.setdefault(v["block_id"], label)
        return v

    # (a) exact half-bucket ties -- the class of input that forked between Python and JS
    #     under the rev-1 quantiser, and therefore the class this file exists to pin.
    #     Three sources, because the corpus alone is not enough: at the operating grid only
    #     a handful of real blocks land exactly on k+0.5, so the corpus cannot be relied on
    #     to exercise the case that broke.
    SH_TIE = "a" * 64
    ties = 0
    for fn, P in papers.items():
        for r in P["runs"]["baseline"][0]:
            if ties >= 40:
                break
            if any((v / G) % 1 == 0.5 for v in geom_coords(r[1], GEOM)):
                add_vec(f"tie:{fn}:p{r[0]}:{ties}", "corpus_half_bucket_tie",
                        P["source_hash"], r[0], r[1], r[2], r[3],
                        note="real corpus block sitting exactly on a half bucket at the "
                             "operating grid")
                ties += 1
    # real corpus blocks that are ties at SOME grid in the sweep: real typeset coordinates
    # that a re-tuned grid would immediately put back on the tie
    other = 0
    for fn, P in papers.items():
        for r in P["runs"]["baseline"][0]:
            if other >= 32:
                break
            if any((v / g) % 1 == 0.5 for g in GRIDS for v in geom_coords(r[1], GEOM)) \
                    and not any((v / G) % 1 == 0.5 for v in geom_coords(r[1], GEOM)):
                gs = sorted({g for g in GRIDS
                             for v in geom_coords(r[1], GEOM) if (v / g) % 1 == 0.5})
                add_vec(f"tie-elsewhere:{fn}:p{r[0]}:{other}", "corpus_tie_at_other_grid",
                        P["source_hash"], r[0], r[1], r[2], r[3],
                        note=f"real corpus coordinates that land on a half bucket at "
                             f"grid(s) {gs}; kept so a future grid change re-uses vectors "
                             f"that already exercise the tie")
                other += 1
    # systematic synthetic ties across the integer range, both signs, both coordinates
    for k in (-100000, -4096, -1000, -100, -23, -2, -1, 0, 1, 2, 23, 100, 1000, 4096,
              100000):
        add_vec(f"tie:synthetic:x:{k}", "synthetic_half_bucket_tie", SH_TIE, 0,
                (G * (k + 0.5), 40.0, G * (k + 0.5) + 20.0, 52.0), "paragraph",
                f"x0 exactly on bucket boundary {k}+0.5",
                note=f"q must be {k + 1} (half-UP). Python round() gives "
                     f"{k if k % 2 == 0 else k + 1}, i.e. it disagrees on every even k.")
        add_vec(f"tie:synthetic:y:{k}", "synthetic_half_bucket_tie", SH_TIE, 0,
                (40.0, G * (k + 0.5), 60.0, G * (k + 0.5) + 12.0), "paragraph",
                f"y0 exactly on bucket boundary {k}+0.5",
                note=f"q must be {k + 1}")

    # (b) ordinary blocks from all 8 papers
    rs = random.Random(f"{SEED}|vectors")
    for fn, P in papers.items():
        recs = P["runs"]["baseline"][0]
        for i in sorted(rs.sample(range(len(recs)), min(30, len(recs)))):
            r = recs[i]
            add_vec(f"corpus:{fn}:{i}", "corpus_ordinary", P["source_hash"], r[0], r[1],
                    r[2], r[3])

    SH = "0" * 64
    SH2 = "f" * 64
    # (c) every block type in the IR's known vocabulary
    KNOWN_TYPES = ["title", "author", "affiliation", "abstract", "heading", "paragraph",
                   "list", "list_item", "equation", "inline_equation", "figure", "diagram",
                   "plot", "table", "table_row", "table_cell", "algorithm", "code",
                   "caption", "footnote", "citation", "reference_entry", "header", "footer",
                   "page_number", "margin_note", "annotation", "unknown"]
    for i, bt in enumerate(KNOWN_TYPES):
        add_vec(f"type:{bt}", "block_type_vocabulary", SH, 2,
                (72.0, 100.0 + 12.0 * i, 300.0, 112.0 + 12.0 * i), bt,
                f"block of type {bt}")
    add_vec("type:forward_compatible_unknown", "block_type_vocabulary", SH, 2,
            (72.0, 480.0, 300.0, 492.0), "x_future_type_v2",
            "an identifier-shaped type this build has never seen",
            note="schema pattern ^[a-z][a-z0-9_]{0,63}$ admits unseen types; the ID "
                 "formula must not special-case the known vocabulary")

    # (d) numeric edge cases
    numeric = [
        ("edge:tie-positive", (G * 22.5, G * 4.5, G * 40.0, G * 6.0), "paragraph",
         "left margin on an exact half bucket",
         "q must be 23 and 5 (half-UP); round-half-to-even gives 22 and 4"),
        ("edge:tie-negative", (G * -22.5, G * -0.5, G * 2.0, G * 4.0), "paragraph",
         "negative half bucket",
         "floor(-22.5+0.5) = -22 and floor(-0.5+0.5) = 0; a half-away-from-zero "
         "implementation gives -23 and -1"),
        ("edge:tie-zero-boundary", (G * -0.5, G * 0.5, G * 1.0, G * 2.0), "figure", "",
         "q(-0.5*g)=0 and q(0.5*g)=1: the bucket straddling the origin"),
        ("edge:exact-half-bucket-90pt", (90.0, 22.0, 154.0, 34.0), "paragraph",
         "Left margin 1.25in", "90.0pt is LaTeX's default 1.25in margin"),
        ("edge:negative-coords", (-2.0, -6.0, 10.0, 4.0), "paragraph",
         "above and left of the cropbox origin", None),
        ("edge:negative-zero", (-0.0, -0.0, 12.0, 12.0), "figure", "",
         "MUST equal edge:positive-zero; a float-formatted quantiser emits -0.0000 here"),
        ("edge:positive-zero", (0.0, 0.0, 12.0, 12.0), "figure", "", None),
        ("edge:tiny-negative", (-1e-9, 0.0, 8.0, 8.0), "paragraph", "epsilon below zero",
         None),
        ("edge:float-repr-01-02", (0.1 + 0.2, 0.30000000000000004, 9.0, 9.0), "paragraph",
         "0.1+0.2 is not 0.3 in binary64", "both coordinates are the SAME binary64 value; "
         "any implementation that stringifies before quantising must still agree"),
        ("edge:just-below-tie", (math.nextafter(G * 10.5, 0.0), 4.0, 40.0, 12.0),
         "paragraph", "one ulp below the tie", "must land in bucket 10, not 11"),
        ("edge:just-above-tie", (math.nextafter(G * 10.5, 1e9), 4.0, 40.0, 12.0),
         "paragraph", "one ulp above the tie", "must land in bucket 11"),
        ("edge:large-coords", (1683.7, 2383.9, 1700.0, 2400.0), "paragraph", "A0 poster",
         None),
        ("edge:schema-max-coords", (19999.5, 19999.5, 20000.0, 20000.0), "paragraph",
         "at the schema's bbox bound", None),
        ("edge:schema-min-coords", (-20000.0, -20000.0, -19999.0, -19999.0), "paragraph",
         "at the schema's negative bbox bound", None),
        ("edge:zero-area-bbox", (100.0, 200.0, 100.0, 200.0), "annotation",
         "degenerate box", "x0==x1 and y0==y1; centre_xy and anchor_xy coincide here"),
    ]
    for label, bbox, bt, txt, note in numeric:
        add_vec(label, "numeric_edge", SH, 0, bbox, bt, txt, note)

    # (e) text/Unicode edge cases
    textual = [
        ("edge:empty-text", "figure", "", "a figure with no text at all"),
        ("edge:single-char", "paragraph", "a", None),
        ("edge:shorter-than-prefix", "paragraph", "short", f"under the {NP}-code-point cut"),
        ("edge:exactly-prefix", "paragraph", "x" * NP, f"exactly {NP} code points"),
        ("edge:one-over-prefix", "paragraph", "x" * NP + "y",
         "must produce the same id as edge:exactly-prefix"),
        ("edge:whitespace-only", "paragraph", "   \t\n 　  ",
         "normalises to the empty string"),
        ("edge:sharp-s", "paragraph", "STRASSE Straße ẞ",
         "casefold gives 'strasse strasse strasse'; toLowerCase gives 'straße'"),
        ("edge:sharp-s-spelled", "paragraph", "STRASSE Strasse SS",
         "must EQUAL edge:sharp-s after folding -- the two are indistinguishable by design"),
        ("edge:final-sigma", "paragraph", "ΟΔΟΣ Οδός ΣΙΓΜΑ",
         "per-code-point folding, so JS's context-sensitive final-sigma rule must not fire"),
        ("edge:micro-sign", "paragraph", "µm vs μm",
         "U+00B5 folds to U+03BC; toLowerCase leaves it alone"),
        ("edge:ligatures", "paragraph", "ﬁne aﬄuent eﬀort ĳsvrij ﬅrudel",
         "explicit ligature table, applied before folding"),
        ("edge:ligatures-spelled", "paragraph", "fine affluent effort ijsvrij strudel",
         "must EQUAL edge:ligatures"),
        ("edge:ij-ligature-leading", "paragraph", "ĳsselmeer basin",
         "THE ONLY VECTOR THAT EXERCISES THE LIGATURE STEP. Full case folding already maps "
         "U+FB00..U+FB06, so 7 of the 9 ligature-table entries are redundant with the fold "
         "and deleting the whole step still passes every other vector. U+0133 is the "
         "exception: casefold(U+0133) is U+0133, so only the table turns it into 'ij'. "
         "Placed at code point 0 so the difference lands INSIDE the prefix."),
        ("edge:ij-ligature-leading-spelled", "paragraph", "ijsselmeer basin",
         "must EQUAL edge:ij-ligature-leading; fails if the ligature step is dropped"),
        ("edge:IJ-ligature-leading", "paragraph", "ĲSSELMEER BASIN",
         "U+0132 -> 'IJ' by table, then folded to 'ij'; must also EQUAL "
         "edge:ij-ligature-leading"),
        ("edge:combining-decomposed", "paragraph",
         "e\u0301cole e\u0301le\u0301ment cafe\u0301",
         "NFD input. NFC composes U+0065 U+0301 to U+00E9 BEFORE truncation, so "
         "this MUST produce the same id as edge:combining-composed even though "
         "the raw string is 4 code points longer"),
        ("edge:combining-composed", "paragraph",
         "\u00e9cole \u00e9l\u00e9ment caf\u00e9",
         "NFC input, identical content to edge:combining-decomposed"),
        ("edge:combining-stacked", "paragraph",
         "q\u0307\u0323 a\u0308\u0301 o\u0304\u0328",
         "stacked combining marks that NFC canonically REORDERS but does not "
         "compose -- the reorder is part of the contract"),
        ("edge:devanagari-combining", "paragraph", "हिन्दी विकिपीडिया मुक्त ज्ञानकोश",
         "combining marks that NFC does NOT compose"),
        ("edge:cjk", "paragraph", "深度学习模型的注意力机制与自然语言处理的最新进展研究综述",
         "CJK: every code point is one BMP unit but the string is far shorter than a Latin "
         "one of the same byte length"),
        ("edge:cjk-fullwidth", "paragraph", "ＡＢＣ１２３ ｱｲｳ",
         "NFC keeps fullwidth forms; NFKC (the P4 normaliser) would fold them -- this "
         "vector is what makes the difference visible"),
        ("edge:japanese-mixed", "paragraph", "深層学習におけるTransformerの注意機構について",
         None),
        ("edge:rtl-arabic", "paragraph", "الشبكات العصبية العميقة ومعالجة اللغة الطبيعية",
         "RTL: no bidi reordering is applied; the ID hashes logical order"),
        ("edge:rtl-hebrew", "paragraph", "רשתות נוירונים עמוקות ועיבוד שפה טבעית", None),
        ("edge:rtl-mixed-latin", "paragraph", "النموذج BERT يحقق 92.3% على GLUE",
         "bidi-mixed run with Latin and digits embedded"),
        ("edge:hyphen-line-break", "paragraph",
         "convolu-\ntional neural net-\nworks",
         "the frozen normaliser does NOT de-hyphenate; it collapses the newline to a "
         "space, giving 'convolu- tional neural net- works'. P4 measures what happens "
         "when a release starts de-hyphenating."),
        ("edge:soft-hyphen-break", "paragraph", "convolu\u00ad\ntional",
         "U+00AD soft hyphen is NOT whitespace and is NOT stripped"),
        ("edge:astral-math", "paragraph",
         "\U0001D400\U0001D401\U0001D402 mathematical bold letters padded out past the "
         "prefix boundary \U0001D403\U0001D404\U0001D405",
         "astral plane: UTF-16-code-unit truncation cuts a surrogate pair in half here"),
        ("edge:astral-emoji", "paragraph", "\U0001F9EE\U0001F4C4\U0001F517 figure caption",
         None),
        ("edge:exotic-whitespace", "paragraph", "a b c　d﻿e   f",
         "U+3000 and U+FEFF are in the enumerated whitespace set; Python's \\s excludes "
         "U+FEFF and JS's \\s includes it"),
        ("edge:nbsp-run", "paragraph", "Table\u00a01\u00a0\u00a0shows", None),
        ("edge:pipe-in-text", "paragraph", "a|b|c|d",
         "U+007C is the field separator, but only the LAST field can contain it, so no "
         "escaping is defined or permitted"),
        ("edge:pipe-leading", "paragraph", "|leading pipe",
         "must NOT collide with a different block whose text field starts one field later"),
        ("edge:control-chars", "paragraph", "a\x00b\x07c",
         "NUL and BEL are not whitespace and are not stripped; they survive into the "
         "payload as UTF-8"),
        ("edge:turkish-dotted-i", "paragraph", "İSTANBUL Istanbul ı",
         "non-Turkic folding: U+0130 folds to 'i' + U+0307, NOT to Turkish dotless i"),
        ("edge:cherokee", "paragraph", "ᏣᎳᎩ ᎦᏬᏂᎯᏍᏗ",
         "Cherokee is one of the scripts where casefold and toLowerCase disagree"),
        ("edge:armenian-ligature", "paragraph", "ﬔ ﬕ ﬖ ﬗ",
         "Armenian ligatures fold to two code points each and are NOT in the Latin "
         "ligature table -- the fold does that work"),
        ("edge:long-text", "paragraph", "lorem ipsum dolor sit amet " * 40,
         "far longer than any prefix under consideration"),
    ]
    for label, bt, txt, note in textual:
        add_vec(label, "text_edge", SH, 7, (72.0, 300.0, 468.0, 320.0), bt, txt, note)

    # (f) page index and source_hash coverage
    add_vec("edge:page-zero", "page_index", SH, 0, (72.0, 72.0, 300.0, 84.0), "title",
            "first page of the document")
    add_vec("edge:page-large", "page_index", SH, 32767, (72.0, 72.0, 300.0, 84.0),
            "paragraph", "a very long document",
            "page_index is a base-10 integer with no padding, so 32767 is '32767'")
    add_vec("edge:page-9999", "page_index", SH, 9999, (72.0, 72.0, 300.0, 84.0),
            "paragraph", "four-digit page")
    add_vec("edge:other-source-hash", "source_hash", SH2, 0, (72.0, 72.0, 300.0, 84.0),
            "title", "same block, different PDF",
            "must differ from edge:page-zero: source_hash namespaces the ID space")

    # (g) negative vectors -- pairs that MUST produce different ids
    def pair(label, a, b, why):
        va = add_vec(label + ":a", "negative_pair", *a)
        vb = add_vec(label + ":b", "negative_pair", *b)
        return {"label": label, "a": va["label"], "b": vb["label"],
                "a_block_id": va["block_id"], "b_block_id": vb["block_id"],
                "must": "differ", "why": why}

    neg = [
        pair("neg:page", (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "same text"),
             (SH, 1, (72.0, 100.0, 300.0, 112.0), "paragraph", "same text"),
             "page_index is in the payload"),
        pair("neg:one-bucket-x",
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "same text"),
             (SH, 0, (72.0 + G, 100.0, 300.0, 112.0), "paragraph", "same text"),
             "one full grid step in x is a different bucket"),
        pair("neg:one-bucket-y",
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "same text"),
             (SH, 0, (72.0, 100.0 + G, 300.0, 112.0), "paragraph", "same text"),
             "one full grid step in y is a different bucket"),
        pair("neg:block-type",
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "Introduction"),
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "heading", "Introduction"),
             "block_type is in the payload; a re-classification is a new block"),
        pair("neg:source-hash",
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "same text"),
             (SH2, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "same text"),
             "ids are namespaced per paper"),
        pair("neg:text-first-codepoint",
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "Introduction"),
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "Conclusions"),
             "texts differing at code point 0 must differ at every prefix length; note "
             "that two texts agreeing for the first " f"{NP} code points at the same "
             "anchor DO collide by design -- see eq:text-beyond-prefix, and see the "
             "collision census in id-stability.json for how often that happens in real "
             "papers"),
        pair("neg:field-injection",
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "b|c"),
             (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph_b", "c"),
             "a U+007C inside the text field must not be able to impersonate a field "
             "boundary: block_type is the field BEFORE text, so 'paragraph|b|c' and "
             "'paragraph_b|c' would only collide if the separator were escapable"),
    ]
    if GEOM != "full_bbox":
        neg.append(pair(
            "neg:same-anchor-different-text",
            (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "First paragraph of two."),
            (SH, 0, (72.0, 100.0, 300.0, 260.0), "paragraph", "Second paragraph of two."),
            "same top-left anchor, different leading text: the text prefix is what "
            "separates them once x1/y1 leave the payload"))

    # (h) equivalence vectors -- pairs that MUST produce the SAME id
    def epair(label, a, b, why):
        va = add_vec(label + ":a", "equivalence_pair", *a)
        vb = add_vec(label + ":b", "equivalence_pair", *b)
        return {"label": label, "a": va["label"], "b": vb["label"],
                "a_block_id": va["block_id"], "b_block_id": vb["block_id"],
                "must": "match", "why": why}

    eq = [
        epair("eq:sub-grid-jitter",
              (SH, 0, (100.0, 200.0, 300.0, 212.0), "paragraph", "jitter me"),
              (SH, 0, (100.0 + G * 0.4, 200.0 - G * 0.4, 300.0, 212.0), "paragraph",
               "jitter me"),
              "sub-bucket movement is exactly what the grid absorbs"),
        epair("eq:negative-zero",
              (SH, 0, (-0.0, -0.0, 12.0, 12.0), "figure", ""),
              (SH, 0, (0.0, 0.0, 12.0, 12.0), "figure", ""),
              "integer buckets have no negative zero"),
        epair("eq:text-beyond-prefix",
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "y" * NP + "AAAA"),
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "y" * NP + "BBBB"),
              "only the first prefix code points are hashed"),
        epair("eq:whitespace-collapse",
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "  a\t\tb\n\nc  "),
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "a b c"),
              "runs of whitespace collapse to one U+0020 and the ends are stripped"),
        epair("eq:ligature",
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "the ﬁnal ﬂoat"),
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "the final float"),
              "ligature expansion is part of the contract -- though NOTE that this pair "
              "would still pass with the ligature step deleted, because full case folding "
              "already maps U+FB01/U+FB02. eq:ij-ligature is the one that binds."),
        epair("eq:ij-ligature",
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "ĳsselmeer basin"),
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "ijsselmeer basin"),
              "THE VECTOR THAT ACTUALLY BINDS THE LIGATURE STEP. casefold(U+0133) is "
              "U+0133, so the fold does not expand it and only ligature_table can. The "
              "difference is at code point 0, inside the prefix. Delete the ligature step "
              "and this is the pair that fails -- with rev 3's vectors, deleting the step "
              "entirely passed all 418 vectors and all 5670 corpus blocks."),
        epair("eq:IJ-ligature",
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "ĲSSELMEER BASIN"),
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "ijsselmeer basin"),
              "U+0132 -> 'IJ' by table, then folded to 'ij'"),
        epair("eq:exotic-whitespace",
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph",
               EXOTIC_WS_TEXT),
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "a b c d e f g h"),
              "THE VECTOR THAT BINDS THE 16 EXOTIC SPACES. U+1680, U+2000..U+200A, "
              "U+2028, U+2029, U+202F and U+205F are in whitespace_chars and MUST collapse "
              "to U+0020. Rev 3's whitespace table had all 16 flattened to U+0020 by an "
              "editor, its normaliser therefore never treated them as whitespace, and no "
              "vector could detect it because none of them put an exotic space inside the "
              "text prefix. This one does."),
        epair("eq:nfc",
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "élément"),
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "élément"),
              "NFC runs before everything else"),
        epair("eq:case",
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "ABSTRACT"),
              (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "Abstract"),
              "case folding"),
    ]
    if GEOM == "anchor_xy":
        eq.append(epair(
            "eq:anchor-ignores-extent",
            (SH, 0, (72.0, 100.0, 300.0, 112.0), "paragraph", "same anchor same text"),
            (SH, 0, (72.0, 100.0, 500.0, 400.0), "paragraph", "same anchor same text"),
            "THE DEFINING PROPERTY OF anchor_xy: x1/y1 are not in the payload, so a block "
            "that grows downward (a paragraph merge) keeps its id. This is intentional; "
            "content_hash (anchoring tier 2) is what detects that the text changed."))

    vectors_doc = {
        "$schema_note": ("This file is the CONTRACT for PaperTree block ids. It is "
                         "consumed by identity.spec in BOTH TypeScript and Python. It is "
                         "self-describing: an implementation needs nothing but this file "
                         "to be written and checked."),
        "formula_version": FORMULA_VERSION,
        "generated_by": "research/benchmarks/harness/id_stability.py (revision 4)",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "spec": {
            "id_shape": "^blk_[a-z2-7]{16}$",
            "hash": HASH,
            "geometry_payload": GEOM,
            "geometry_payload_meaning": {
                "full_bbox": "quantise x0,y0,x1,y1",
                "anchor_xy": "quantise x0,y0 ONLY; x1,y1 are deliberately not hashed",
                "centre_xy": "quantise (x0+x1)/2,(y0+y1)/2",
            }[GEOM],
            "grid_pt": G,
            "text_prefix_codepoints": NP,
            "quantise": ("q(v,g) = floor(v/g + 0.5) evaluated in IEEE-754 binary64, "
                         "emitted as a base-10 integer: optional leading '-', no '+', no "
                         "leading zeros, no decimal point, no negative zero. NOT "
                         "round(v/g)*g -- Python round() is half-to-even, JS Math.round "
                         "and Rust f64::round are half-away-from-zero, and they disagree "
                         "on every coordinate where v/g lands on k+0.5. RANGE: the bucket "
                         "index MUST satisfy |q| <= 2^53-1 = 9007199254740991; an "
                         "implementation MUST REJECT a coordinate outside that range "
                         "rather than emit it, because JS String() switches to "
                         "exponential notation at 1e21 ('1e+21') where Python str() stays "
                         "positional ('1000000000000000000000'). PDF 1.7 Annex C bounds "
                         "user space at +/-32767, so conforming input never approaches "
                         "the guard."),

            "coordinate_frame": ("PDF DEFAULT USER SPACE units (1/72in); /UserUnit is "
                                 "deliberately NOT applied, so coordinates are raw "
                                 "default-user-space units and never physical ones "
                                 "(pinned by fiat: no corpus PDF carries a /UserUnit, and "
                                 "the only thing that matters is that all implementations "
                                 "make the same choice); origin TOP-LEFT of the page's "
                                 "post-rotation rect; y grows DOWNWARD so y0 is the top "
                                 "edge; /Rotate already applied; coordinates relative to "
                                 "the page rect's own origin (x = raw_x - rect.x0), so a "
                                 "CropBox offset cannot leak into the id; the binary64 "
                                 "value the IR stores, NOT pre-rounded."),
            "payload": ("source_hash|page_index|" +
                        "|".join({"full_bbox": ["q(x0)", "q(y0)", "q(x1)", "q(y1)"],
                                  "anchor_xy": ["q(x0)", "q(y0)"],
                                  "centre_xy": ["q(cx)", "q(cy)"]}[GEOM]) +
                        f"|block_type|normalise(text)[:{NP}]"),
            "payload_encoding": ("UTF-8; fields joined with U+007C; only the last field "
                                 "may contain U+007C, so no escaping is defined or "
                                 "permitted"),
            "source_hash_form": ("lowercase hex SHA-256 of the PDF bytes, 64 chars, "
                                 "WITHOUT the 'sha256:' prefix the IR stores"),
            "page_index_form": "0-based, base-10 integer, no padding",
            "block_type_form": ("the IR's block-type discriminator verbatim; matches "
                                "^[a-z][a-z0-9_]{0,63}$ and so contains no U+007C"),
            "normalise": ["Unicode NFC",
                          "ligature expansion (ligature_table below)",
                          "collapse each maximal run of whitespace_chars to one U+0020, "
                          "then strip whitespace_chars from both ends",
                          "case fold BY TABLE: for each code point, replace it with "
                          "case_fold_map[cp] if present, else leave it unchanged. This "
                          "is Unicode full case folding, non-Turkic (UAX #21 toCasefold, "
                          "CaseFolding.txt status C+F), pinned to the Unicode version in "
                          "case_fold_unicode_version. An implementation MUST NOT call "
                          "str.casefold() / String.prototype.toLowerCase() / "
                          "str::to_lowercase() -- not for the mapped code points and NOT "
                          "FOR THE REMAINDER EITHER, because runtimes carry different "
                          "Unicode versions and a code point unmapped in one is mapped "
                          "in another. Full case folding is context-independent, so "
                          "per-code-point application is exact and JS's context-sensitive "
                          "final-sigma rule cannot fire."],
            "truncation_unit": ("Unicode code points (scalar values). NOT UTF-16 code "
                                "units (JS .slice), NOT bytes (Rust &s[..n]). Reference "
                                f"JS: Array.from(s).slice(0, {NP}).join('')."),
            "encode": ("RFC 4648 base32 of the digest, alphabet A-Z2-7, '=' padding "
                       "stripped, LOWERCASED, then the FIRST 16 CHARACTERS = 80 bits. "
                       "Prepend literal ASCII 'blk_'. Total length 20. Lowercase because "
                       "the IR schema pins ^blk_[a-z2-7]{16}$."),
        },
        "ligature_table": LIGATURES,
        "ligature_table_note": ("Applied BEFORE folding. Note that full case folding "
                                "already maps U+FB00..U+FB06, so only U+0132/U+0133 "
                                "(IJ/ij) have independent effect -- casefold(U+0132) is "
                                "U+0133, not 'ij'. Vector edge:ij-ligature-leading is the "
                                "one that fails if this step is dropped."),
        "whitespace_chars": [f"U+{cp:04X}" for cp in WS_CODEPOINTS],
        "whitespace_chars_note": ("The COMPLETE whitespace set for step 3, enumerated "
                                  "because Python's \\s, JavaScript's \\s and Rust's "
                                  "char::is_whitespace are three different sets. 26 code "
                                  "points, all distinct. Build this table from numeric "
                                  "code points in your implementation too: the revision-3 "
                                  "harness held it as a literal-character string and an "
                                  "editor flattened all 16 exotic spaces to U+0020."),
        "case_fold_unicode_version": UNICODE_VERSION,
        "case_fold_map_note": ("The COMPLETE full case-folding map (UAX #21 toCasefold, "
                               "CaseFolding.txt status C+F, non-Turkic) for Unicode "
                               + UNICODE_VERSION + ": every code point whose fold differs "
                               "from itself, and nothing else. Apply it per code point; "
                               "leave unmapped code points alone. DO NOT fall back to a "
                               "runtime case function for the remainder -- runtimes carry "
                               "different Unicode versions (Python 3.12 = UCD 15.0.0, "
                               "Node 22 = Unicode 17.0) and 55 code points gained a "
                               "mapping in between, which is a live cross-language fork a "
                               "delta-only table cannot express."),
        "case_fold_map": FOLD_MAP,
        "vector_groups": {
            "corpus_ordinary": "real blocks sampled from each of the 8 corpus papers",
            "corpus_half_bucket_tie": ("real blocks with a quantised coordinate exactly on "
                                       "k+0.5 at the operating grid -- the class that "
                                       "forked between Python and JS under the "
                                       "round(v/g)*g quantiser"),
            "corpus_tie_at_other_grid": ("real blocks that land on a half bucket at some "
                                         "OTHER grid in the sweep; retained so a future "
                                         "grid change still has real tie coordinates"),
            "synthetic_half_bucket_tie": ("systematic ties at bucket indices from -100000 "
                                          "to +100000, both coordinates, both signs -- "
                                          "the corpus alone cannot be relied on to "
                                          "exercise the case that broke"),
            "block_type_vocabulary": "one vector per known block type, plus an unseen type",
            "numeric_edge": "ties, negatives, zero, -0.0, float-repr boundaries, extremes",
            "text_edge": ("empty, short, exactly-prefix, combining marks, ligatures, CJK, "
                          "RTL, hyphenated line breaks, astral planes, exotic whitespace, "
                          "U+007C injection"),
            "page_index": "0 and large page indices",
            "source_hash": "the id namespace",
            "negative_pair": "members of negative_vectors below",
            "equivalence_pair": "members of equivalence_vectors below",
        },
        "how_to_use": [
            "1. For every entry in `vectors`: normalise(raw_text) MUST equal "
            "`normalised_text`; the assembled payload MUST equal `payload` byte for byte "
            "as UTF-8; and the id MUST equal `block_id`.",
            "2. For every entry in `negative_vectors`: the two named vectors MUST have "
            "DIFFERENT block_ids.",
            "3. For every entry in `equivalence_vectors`: the two named vectors MUST have "
            "THE SAME block_id.",
            "4. `quantised_coords` is exposed so a failure can be localised to the "
            "quantiser rather than the hash.",
        ],
        "negative_vectors": neg,
        "equivalence_vectors": eq,
        "vector_count": len(vecs),
        "vectors": vecs,
    }
    os.makedirs(os.path.dirname(VECTORS), exist_ok=True)
    with open(VECTORS, "w") as fh:
        json.dump(vectors_doc, fh, indent=2, ensure_ascii=False)

    # sanity: the negative/equivalence claims must actually hold in the emitted file
    byl = {v["label"]: v["block_id"] for v in vecs}
    neg_bad = [n["label"] for n in neg if byl[n["a"]] == byl[n["b"]]]
    eq_bad = [e["label"] for e in eq if byl[e["a"]] != byl[e["b"]]]
    assert not neg_bad, f"negative vectors collided: {neg_bad}"
    assert not eq_bad, f"equivalence vectors diverged: {eq_bad}"
    dupes = len(vecs) - len({v["block_id"] for v in vecs})

    chosen_combo = pick(CHOSEN["geom"], CHOSEN["grid_pt"], CHOSEN["text_prefix_len"])
    result = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "revision": 4,
        "formula_version": FORMULA_VERSION,
        "seed": SEED,
        "seed_scheme": "random.Random(f'{SEED}|{pdf_filename}|{family}|{seed_index}')",
        "jitter_seeds": JITTER_SEEDS,
        "runtime_seconds": round(time.time() - t_start, 1),
        "pymupdf_version": fitz.__doc__.strip(),
        "python": sys.version.split()[0],
        "platform": f"{sys.platform}/{os.uname().machine}",
        "chosen": dict(CHOSEN),
        "decision": decision,
        "axis_limits": axis_limits,
        "chosen_row": {k: v for k, v in chosen_combo.items() if k != "per_paper"},
        "id_truncation_bits": ID_BYTES * 8,
        "id_encoding": "lowercase RFC 4648 base32, first 16 chars, prefixed 'blk_'",
        "match_criteria": {
            "bbox_iou_min": IOU_MATCH, "text_similarity_min": SIM_MATCH,
            "note": ("P1/P2/P3/P4/P9 are element-wise transforms of the baseline, so pair "
                     "i<->i is exact ground truth and churn is over ALL blocks. P7/P8 use "
                     "CONTAINMENT (one normalised text a contiguous substring of the "
                     "other, plus bbox containment) because a merged or split box "
                     "genuinely is not the same box and IoU would discard the pairs under "
                     "study; a baseline block's id counts as surviving if ANY block in "
                     "its group carries it, which is the most generous and the most "
                     "geometry-neutral rule available. P10/N1/N2 use the IoU matcher. No "
                     "pairing anywhere uses ids."),
        },
        "geoms": GEOMS, "grids_pt": GRIDS, "text_prefix_lens": PREFIXES, "hash": HASH,
        "hash_not_swept_because": (
            "Node cannot produce blake2s-128 at all: crypto.createHash('blake2s256', "
            "{outputLength:16}) throws ERR_OSSL_EVP_NOT_XOF_OR_INVALID_LENGTH and "
            "webcrypto.subtle.digest('BLAKE2s') throws NotSupportedError, while SHA-256 "
            "works in Node, Deno, Bun and every browser. On ARM64 SHA-256 also has a "
            "dedicated instruction and BLAKE2 does not. Both digests are cryptographic "
            "and the id keeps only 80 bits of either, so collision behaviour is identical "
            "by construction; a sweep would measure nothing but the seed."),
        "id_formula": ('"blk_" + lower(base32(SHA-256(source_hash|page_index|'
                       'floor(coord/grid+0.5)...|block_type|normalise(text)[:prefix])))[:16]'),
        "perturbations": {
            "P1_jitter_0.3pt": f"uniform noise in +/-0.3pt on every bbox coordinate, {JITTER_SEEDS} seeds",
            "P2_jitter_0.9pt": f"uniform noise in +/-0.9pt on every bbox coordinate, {JITTER_SEEDS} seeds",
            "P3_shift_+0.4pt": "constant +0.4pt on x and y",
            "P4_textnorm_v2": ("normaliser swapped: NFKC + de-hyphenation across line "
                               "breaks, no explicit ligature table (geometry unchanged)"),
            "P7_paragraph_merge": (f"consecutive same-page text blocks with vertical gap < "
                                   f"{MERGE_GAP_PT}pt and overlapping x-extents merged -- "
                                   "the realistic segmenter change (PyMuPDF -> Docling)"),
            "P8_paragraph_split": ("every text block with >= 2 lines split at its largest "
                                   "internal line gap -- the inverse segmenter change; "
                                   "merge and split are NOT symmetric under an "
                                   "anchor-based scheme, which is why both are measured"),
            "P9_origin_flip": ("AUXILIARY: y measured from the page bottom instead of the "
                               "top -- a CONFORMING reading of ADR-001's original formula "
                               "text, which names no origin convention. Prices the "
                               "omission; not part of the selection."),
            "P10_glyph_bbox": ("AUXILIARY: block bboxes recomputed as the union of "
                               "character bboxes (rawdict) instead of MuPDF font-metric "
                               "line boxes -- the empirical version of P1."),
            "N1_line_granularity": ("NULL PERTURBATION for churn (3256/3270 matched pairs "
                                    "are single-line blocks where the line bbox IS the "
                                    "block bbox, so it cannot show churn). Retained "
                                    "because it is the LINE-GRANULARITY COLLISION stress "
                                    "case, which is where the collision floor lives."),
            "N2_blocks_mode": ("NULL PERTURBATION. page.get_text('blocks') vs 'dict' is "
                               "the same segmentation: 5380/5380 matched pairs have "
                               "BIT-IDENTICAL bboxes. Its 0% is forced by construction "
                               "and is evidence of nothing."),
        },
        "headline_perturbations": HEADLINE,
        "auxiliary_perturbations": AUXILIARY,
        "null_perturbations": NULLS,
        "collision_runs": list(COLLISION_RUNS),
        "corpus": {fn: {"source_hash": P["source_hash"], "pages": P["pages"],
                        "block_counts": P["block_counts"],
                        "geometry_facts": P["geom_facts"]} for fn, P in papers.items()},
        "corpus_geometry_caveat": (
            "every page in all 8 PDFs has rotation 0, zero CropBox offset and no negative "
            "coordinates, so the coordinate-frame normalisation is a NO-OP on 100% of the "
            "corpus and is NOT exercised by it. That is why P9 exists and why the "
            "conformance vectors carry synthetic negative/rotated-frame coordinates: the "
            "corpus cannot test the single highest-leverage clause in the formula."),
        "encoding_exposure": encoding_exposure,
        "hash_timing_ms": timing,
        "payload_shape_probe": {
            "note": ("excess collisions on the named run at the chosen geom/grid/prefix "
                     "under four payload shapes. synthesis-05's payload omits block_type; "
                     "the no_geometry rows settle the opposite temptation -- geometry MUST "
                     "stay in the id."),
            **shape_probe},
        "boundary_analysis": boundary,
        "prefix_floor_probe": {
            "note": ("the EXACT shortest text prefix that separates every pair of records "
                     "sharing a (page, quantised coords, block_type) bucket, per geometry "
                     "and grid, at block and line granularity. This is the collision floor "
                     "along the prefix axis, computed rather than sampled at 8 points, so "
                     "'shortest prefix with zero collisions' is a derivation and not the "
                     "end of a list. `unseparable_pairs_genuine` > 0 means NO prefix "
                     "length fixes that (geom, grid) -- the geometry is the problem."),
            "duplicate_render_tolerance_pt": DUP_TOL_PT,
            "by_config": floors,
        },
        "headroom_probe": headroom,
        "conformance_vectors_path": os.path.relpath(VECTORS, REPO),
        "conformance_vector_count": len(vecs),
        "conformance_duplicate_ids": dupes,
        "conformance_negative_pairs": len(neg),
        "conformance_equivalence_pairs": len(eq),
        "combinations": combos,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(result, fh, indent=2)

    # ── markdown summary ──
    def f1(v):
        return "n/a" if v is None else f"{v:.2f}%"

    print()
    print(f"corpus: {len(papers)} papers, {sum(P['pages'] for P in papers.values())} pages, "
          f"{combos[0]['total_blocks']} baseline blocks | seed={SEED} | hash={HASH}")
    print()
    print("### Full joint sweep")
    print("collision columns are GENUINE excess (blocks losing identity), "
          "duplicate-render groups excluded; (raw) shown when it differs")
    print("| geom | grid | prefix | R1 | blk | line | merge | split | "
          + " | ".join(c.split("_", 1)[0] for c in HEADLINE) + " |")
    print("|---|---:|---:|---|---:|---:|---:|---:|" + "---:|" * len(HEADLINE))

    def cc(agg):
        g, r = agg["genuine_excess"], agg["excess"]
        return str(g) if g == r else f"{g} ({r})"

    for c in combos:
        ch = c["churn_pct_by_perturbation"]
        cr = c["collisions_by_run"]
        print(f"| {c['geom']} | {c['grid_pt']} | {c['text_prefix_len']} "
              f"| {'PASS' if c['r1_pass'] else 'FAIL'} "
              f"| {cc(cr['baseline'])} | {cc(cr['N1_line_granularity'])} "
              f"| {cc(cr['P7_paragraph_merge'])} | {cc(cr['P8_paragraph_split'])} | "
              + " | ".join(f1(ch[k]) for k in HEADLINE) + " |")

    print()
    print(f"### Decision: {json.dumps(decision, indent=2)[:4000]}")
    print()
    print(f"### Axis limits: {json.dumps(axis_limits, indent=2)}")
    print()
    print("### Prefix floor: the EXACT shortest separating prefix, per run")
    print("(a config is viable at prefix p iff p >= every floor below AND every "
          "'unsep' count is 0)")
    print("| geom | grid | " + " | ".join(f"{r} floor / unsep" for r in COLLISION_RUNS)
          + " |")
    print("|---|---:|" + "---:|" * len(COLLISION_RUNS))
    for geom in GEOMS:
        for grid in GRIDS + HEADROOM_GRIDS:
            cells = []
            for run in COLLISION_RUNS:
                f = next(x for x in floors if x["geom"] == geom and x["grid_pt"] == grid
                         and x["run"] == run)
                cells.append(f"{f['shortest_separating_prefix']} / "
                             f"{f['unseparable_pairs_genuine']}")
            print(f"| {geom} | {grid} | " + " | ".join(cells) + " |")
    print()
    print(f"### Chosen-config margin: {json.dumps(margin, indent=2)}")
    print()
    print("### Anchor/centre false-positive under P7 merge (chosen grid/prefix):")
    print("| geom | matched | id survived | survived w/ changed text | FP % of all blocks "
          "| FP % of survivors | content_hash detects |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    for geom in GEOMS:
        c = pick(geom, CHOSEN["grid_pt"], CHOSEN["text_prefix_len"])
        d = c["p7_false_positive"]
        print(f"| {geom} | {d['matched_baseline_blocks']} | {d.get('survived',0)} "
              f"| {d.get('survived_text_changed',0)} "
              f"| {d['false_positive_pct_of_all_blocks']}% "
              f"| {d['false_positive_pct_of_survivors']}% "
              f"| {d['content_hash_detection_pct']}% |")

    print()
    print("### Auxiliary + null perturbations (chosen row), NOT part of the selection:")
    for k in AUXILIARY + NULLS:
        print(f"  {k:24s} churn={f1(chosen_combo['churn_pct_by_perturbation'][k])}  "
              f"pairing={chosen_combo['pairing_by_perturbation'][k]}")

    print()
    print(f"boundary model, chosen geom ({CHOSEN['geom']}, k={k_coords} quantised coords):")
    print("| grid | P1 obs | P1 pred | P2 obs | P2 pred | P3 obs | P3 pred | P1 obs full_bbox |")
    print("|---:|---:|---:|---:|---:|---:|---:|---:|")
    for b in boundary:
        print(f"| {b['grid_pt']} | {b['P1_observed_pct']:.1f}% | {b['P1_predicted_pct']:.1f}% "
              f"| {b['P2_observed_pct']:.1f}% | {b['P2_predicted_pct']:.1f}% "
              f"| {b['P3_observed_pct']:.1f}% | {b['P3_predicted_pct']:.1f}% "
              f"| {b['P1_observed_pct_full_bbox']:.1f}% |")

    print()
    print("headroom probe past the sweep (genuine excess):")
    print("| grid | geom | baseline | line-level |")
    print("|---:|---|---:|---:|")
    for hh in headroom:
        print(f"| {hh['grid_pt']} | {hh['geom']} "
              f"| {hh['by_run']['baseline']['genuine_excess']} "
              f"| {hh['by_run']['N1_line_granularity']['genuine_excess']} |")

    print()
    print(f"encoding exposure: {json.dumps(encoding_exposure, indent=2)}")
    print(f"hash timing (ms/corpus): {json.dumps(timing)}")
    print(f"payload shape probe (excess collisions): {json.dumps(shape_probe)}")
    print(f"\nwrote {OUT}")
    print(f"wrote {VECTORS} ({len(vecs)} vectors, {len(neg)} negative pairs, "
          f"{len(eq)} equivalence pairs, {dupes} duplicate ids)")


if __name__ == "__main__":
    main()
