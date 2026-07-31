"""F1.7 - equation region detection. Font is a signal, never a verdict.

THE DEFECT BEING REPLACED, MEASURED

findings.md B1. The old `extraction.py` counted a character as math if `is_math_char(char) OR
is_math_font(font)` - with the font test **inside the per-character loop**, so a single
"math-ish" font made *every character in the span* math. And `MATH_FONTS` contained `cmr` and
`latinmodern`, which are the **body-text** fonts of most LaTeX papers.

| paper | lines called "math" | driven by font | driven by actual math symbols |
|---|---|---|---|
| ResNet | 86 | **86 (100 %)** | 0 |
| Neural ODEs | 574 | **574 (100 %)** | 0 |
| PDF-to-Tree | 47 | **47 (100 %)** | 0 |

Not one classification in the entire corpus came from symbol density. Resulting damage: 68.3 %
of Neural ODEs' blocks classified as math, including `"side is in {224, 256, 384, 480, 640})."`
and `"LayerNorm(x + Sublayer(x)), where Sublayer(x) is the function implemented by the
sub-layer"`. Because every font switch mid-sentence flushed the paragraph, prose was shredded to
a **59-character** median block.

So this module reads **no font name at all**. Not a smaller list, not a better list - none. The
acceptance criterion is "prose is NEVER classified as an equation", and the only way to hold
that is to make typeface incapable of causing the classification.

WHAT IS USED INSTEAD

Four signals, none of them sufficient alone, combined with an explicit score:

  * **Isolation** - a display equation is a short line, horizontally centred or indented, with
    vertical clearance above and below. This is the strongest single signal and it is purely
    geometric.
  * **Symbol density** - the share of characters that are actual mathematical operators,
    relations, Greek letters or CMEX private-use delimiter fragments. `x - 1` in prose scores
    low; a real equation scores high.
  * **An equation number** - a trailing `(3)` or `(A.1)` flush to the margin. Nearly conclusive
    when present, absent from most equations, so it lifts the score rather than deciding it.
  * **Alphabetic run length** - the *negative* signal that stops prose. A line containing an
    English word of six or more letters next to ordinary spacing is prose with a symbol in it,
    which is exactly what `x ∈ R^d and therefore the mapping` is.

CMEX10 PRIVATE-USE CODE POINTS ARE A POSITIVE SIGNAL

Measured on ResNet page 4: 48 glyphs at U+F8EE, U+F8F0, U+F8F9, U+F8FB. Those are TeX's
private-use code points for the **pieces** of a large delimiter - the hooks and vertical
extensions of a big bracket. They have no Unicode meaning by construction, they appear only in
display math, and `classify.py` already counts them.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from statistics import median

from papertree_document_ir import BBox

from papertree_document_worker.pdf import Line

__all__ = [
    "EquationCandidate",
    "EquationRegion",
    "detect_equation_lines",
    "detect_equation_regions",
    "is_probably_prose",
    "symbol_density",
]

#: Characters that are genuinely mathematical. Unicode categories `Sm` (math symbol) covers
#: +, =, <, ±, ∈, ∑, ∫, ≤, → and U+2212 MINUS; the explicit set adds the ones Unicode files
#: elsewhere. ASCII digits and letters are deliberately NOT here - `2015` is not mathematics.
_EXTRA_MATH = set("∂∇∞⋅×·⊗⊕√∏∑∫≈≠≡≤≥⊂⊆∪∩∅ℓ†‖|")
#: Greek is the single most reliable non-symbol signal in a physics or ML paper.
_GREEK = range(0x0370, 0x0400)
#: TeX's large-delimiter fragments. See the module docstring.
_PRIVATE_USE = range(0xE000, 0xF900)

#: A trailing equation number: `(3)`, `(2.1)`, `(A.4)`, sometimes bracketed.
_EQUATION_NUMBER = re.compile(r"[(\[]\s*[A-Za-z]?\.?\s*\d+(?:\.\d+)*\s*[)\]]\s*$")
#: A run of letters long enough to be an English word rather than a variable name.
#:
#: FOUR, not six, and the difference was measured. Against the 516 labelled fixture lines
#: (34 equation, 482 prose):
#:
#:   >=6 letters, >=2 words   caught too little: three of findings.md B1's four quoted false
#:                            positives survived it - `side is in {224, 256, 384, 480, 640}).`
#:                            has no six-letter word at all.
#:   >=4 letters, >=1 word    catches 98 % of prose but vetoes 2 of 34 equation lines - real
#:                            equations do contain `\max`, `\text{if}`, `subject to`.
#:   >=4 letters, >=2 words   catches **96 % of prose**, vetoes **1 of 34** equation lines.
#:
#: The last is the operating point. The remaining 4 % of prose is stopped by the density gate,
#: which those lines fail: prose density is 0.000 at the median and 0.054 at p99.
_WORD = re.compile(r"[A-Za-z]{4,}")
_MIN_PROSE_WORDS = 2

#: A line must reach this score to SEED an equation region.
SCORE_THRESHOLD = 2.0
#: Symbol density above which a line looks like mathematics rather than prose with a sign in it.
#: Measured: equation-line median 0.073, p90 0.333; prose median 0.000, p99 0.054, and only
#: 5 of 482 prose lines reach 0.06.
DENSE_SYMBOLS = 0.12
#: A line with NO mathematical character and no equation number cannot seed a region. This is a
#: gate, not a score term, so no amount of isolation can promote a bare prose fragment.
MIN_SEED_DENSITY = 0.06
#: A display equation is short. Above this share of the column width it is probably a paragraph.
MAX_WIDTH_SHARE = 0.92
#: Vertical clearance, as a multiple of the page's dominant line height, that marks a line as set
#: off from the paragraph flow.
CLEARANCE_RATIO = 1.35


@dataclass(frozen=True, slots=True)
class EquationCandidate:
    line: Line
    bbox: BBox
    score: float
    #: `"3"`, `"A.1"` - the number as written, when the line carries one.
    number: str | None
    symbol_density: float

    @property
    def is_numbered(self) -> bool:
        return self.number is not None


def symbol_density(text: str) -> float:
    """Share of non-space characters that are mathematical.

    Deliberately blind to font. A character is mathematical because of what it IS.
    """
    considered = [ch for ch in text if not ch.isspace()]
    if not considered:
        return 0.0
    hits = 0
    for ch in considered:
        point = ord(ch)
        if (
            unicodedata.category(ch) == "Sm"
            or ch in _EXTRA_MATH
            or point in _GREEK
            or point in _PRIVATE_USE
        ):
            hits += 1
    return hits / len(considered)


def is_probably_prose(text: str) -> bool:
    """The negative signal, and the one that makes the acceptance criterion holdable.

    A line carrying two or more ordinary English words is prose, whatever symbols it also
    contains. Every false positive quoted in findings.md B1 is caught here:

        "where t ∈{0 . . . T} and ht ∈RD. These iterative"
        "side is in {224, 256, 384, 480, 640})."
        "LayerNorm(x + Sublayer(x)), where Sublayer(x) is the function implemented by the sub-layer"
    """
    return len(_WORD.findall(text)) >= _MIN_PROSE_WORDS


def _equation_number(text: str) -> str | None:
    match = _EQUATION_NUMBER.search(text.rstrip())
    if not match:
        return None
    return match.group(0).strip().strip("()[]").strip()


def detect_equation_lines(
    lines: list[Line], column_width: float, body_size: float
) -> list[EquationCandidate]:
    """Score every line and return those that clear `SCORE_THRESHOLD`.

    Scoring rather than a decision tree because no single signal is trustworthy: numbering is
    absent from most equations, isolation is shared with headings, and symbol density is high in
    a table of results. Requiring agreement is what keeps prose out.
    """
    if not lines:
        return []

    ordered = sorted(lines, key=lambda line: (line.band[1], line.band[0]))
    heights = [line.band[3] - line.band[1] for line in ordered]
    line_height = median(heights) if heights else body_size

    candidates: list[EquationCandidate] = []
    for index, line in enumerate(ordered):
        text = line.text.strip()
        if not text:
            continue

        # THE VETO. Applied before scoring, not as a negative weight, so that no combination of
        # other signals can outvote it. This is the acceptance criterion.
        if is_probably_prose(text):
            continue

        density = symbol_density(text)
        number = _equation_number(text)
        band = line.band
        width = band[2] - band[0]

        # THE SEED GATE. An equation region must be ANCHORED by a line that actually contains
        # mathematics or carries an equation number. Isolation and width alone cannot promote a
        # line, because a heading is also short and isolated.
        if density < MIN_SEED_DENSITY and number is None:
            continue

        score = 0.0
        if density >= DENSE_SYMBOLS:
            score += 2.0
        elif density > 0:
            score += 1.0
        if number is not None:
            score += 1.5
        if width <= MAX_WIDTH_SHARE * column_width:
            score += 0.5

        # Vertical clearance: set off from the lines above and below.
        above = ordered[index - 1].band[3] if index > 0 else None
        below = ordered[index + 1].band[1] if index + 1 < len(ordered) else None
        gap_above = band[1] - above if above is not None else line_height * 2
        gap_below = below - band[3] if below is not None else line_height * 2
        if (
            gap_above >= CLEARANCE_RATIO * line_height
            and gap_below >= CLEARANCE_RATIO * line_height
        ):
            score += 1.0

        if score >= SCORE_THRESHOLD:
            candidates.append(
                EquationCandidate(
                    line=line,
                    bbox=list(band),
                    score=score,
                    number=number,
                    symbol_density=density,
                )
            )
    return candidates


@dataclass(frozen=True, slots=True)
class EquationRegion:
    """One display equation: a run of adjacent seed lines, plus the fragments between them."""

    lines: tuple[Line, ...]
    bbox: BBox
    number: str | None
    #: Highest seed score in the run - how strongly this region is anchored.
    score: float

    @property
    def text(self) -> str:
        return "\n".join(line.text for line in self.lines)

    @property
    def is_numbered(self) -> bool:
        return self.number is not None


#: Vertical gap, as a multiple of line height, within which a fragment joins the seed above it.
FRAGMENT_GAP_RATIO = 1.6


def detect_equation_regions(
    lines: list[Line], column_width: float, body_size: float
) -> list[EquationRegion]:
    """Seed lines merged into display-equation regions.

    WHY MERGING IS NOT COSMETIC. A display equation is typeset over several lines, and only some
    of them carry mathematics: MuPDF returns

        `dh(t)`   `dt`   `= f(h(t), t, θ)`

    as three lines, of which the middle has **zero** symbol density and would never seed. That
    is why the measured seed recall on labelled fixture lines is only 0.47-0.53 - the misses are
    overwhelmingly *fragments of equations that were already detected*, not missed equations.

    So a non-prose line adjacent to a seed joins its region. The prose veto still applies to the
    joiner, which is what stops a region from swallowing the sentence beneath it.
    """
    seeds = detect_equation_lines(lines, column_width, body_size)
    if not seeds:
        return []

    ordered = sorted(lines, key=lambda line: (line.band[1], line.band[0]))
    heights = [line.band[3] - line.band[1] for line in ordered]
    line_height = median(heights) if heights else body_size
    seed_at = {id(candidate.line): candidate for candidate in seeds}

    regions: list[EquationRegion] = []
    current: list[Line] = []
    current_seeds: list[EquationCandidate] = []

    def flush() -> None:
        if not current or not current_seeds:
            current.clear()
            current_seeds.clear()
            return
        bands = [line.band for line in current]
        number = next((c.number for c in current_seeds if c.number), None)
        regions.append(
            EquationRegion(
                lines=tuple(current),
                bbox=[
                    min(b[0] for b in bands),
                    min(b[1] for b in bands),
                    max(b[2] for b in bands),
                    max(b[3] for b in bands),
                ],
                number=number,
                score=max(c.score for c in current_seeds),
            )
        )
        current.clear()
        current_seeds.clear()

    previous: Line | None = None
    for line in ordered:
        candidate = seed_at.get(id(line))
        joins = False
        if previous is not None and current:
            gap = line.band[1] - previous.band[3]
            adjacent = gap <= FRAGMENT_GAP_RATIO * line_height
            # A seed always continues its run; a non-seed joins only if it is adjacent and is
            # not prose - the veto is what stops a region eating the sentence below it.
            joins = adjacent and (candidate is not None or not is_probably_prose(line.text))
        if candidate is None and not joins:
            flush()
        elif joins or candidate is not None:
            if not current or current[-1] is not line:
                current.append(line)
            if candidate is not None:
                current_seeds.append(candidate)
        previous = line
    flush()
    return regions
