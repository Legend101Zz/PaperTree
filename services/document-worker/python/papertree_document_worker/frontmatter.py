"""Type the front matter: `title`, `author`, `affiliation`, `abstract`.

THE LARGEST SINGLE GAP THE GOLD EXPOSED. Scored against PTUB gold, four of these types came back
with a *structural* 0.00 - not "detected badly", but never emitted by any code path at all. On
`attention-is-all-you-need` seven of fifteen gold types were in that state and they are close to
half of a macro-averaged F1, because a macro-average counts a type the parser has never heard of
exactly as heavily as one it gets right.

The same gap explains `Paper.metadata.authors == []` on all eight papers. `metadata.py` can only
cite a block that exists, rule 6b requires the value to be a verbatim slice of the block it names,
and nothing typed an `author` block for it to slice - so the field was empty for a reason that had
nothing to do with `metadata.py`.

THIS RUNS AS A RETYPE PASS, NOT INSIDE `_block_type`

`_block_type` sees one block and its flow. None of these four decisions can be made from one
block: a title is the largest thing on page 0 *relative to the others*, an author line is the
first row *below* it, an abstract is what sits *between* the `Abstract` heading and the next one.
So this runs over the assembled page-0 blocks once they all exist, and before `assign_ids()` -
`block_id` hashes the block type, so retyping afterwards would mint ids for types that no longer
exist.

WHAT IT ENCODES, AND WHERE IT STOPS

Academic front matter is laid out in ROWS: a title, then a row of author names, then a row of
affiliations, then often a row of e-mail addresses, then the abstract. That convention is what
this reads, and it holds across all three annotated papers despite their very different layouts
(one column, two columns, and a four-across author grid).

It is a convention, not a law. `_band_rows` is the whole of the layout assumption and it is one
function, so a paper that violates it fails in a locatable place rather than producing confident
nonsense. Everything unclaimed stays whatever it already was; nothing here downgrades a block.

"Google Brain" is why position wins over vocabulary. It is two capitalised words and carries no
institution keyword, so it is structurally identical to "Ashish Vaswani"; a keyword list large
enough to catch it catches surnames too. Its ROW, on the other hand, is unambiguous - it is the
one below the authors, and every author in that paper has one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from statistics import median
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - import cycle at runtime, types only
    from papertree_document_worker.assemble import AssembledBlock

__all__ = ["FrontMatterRetype", "classify_front_matter"]

#: The heading that opens an abstract. Matched on the normalised, punctuation-stripped line.
_ABSTRACT_HEADING = re.compile(r"^abstract$", re.IGNORECASE)
#: The heading that closes it - anything numbered, or the conventional first section name.
_FIRST_SECTION = re.compile(r"^\s*(?:1\b|i\b|introduction\b)", re.IGNORECASE)
#: An e-mail or URL. A row carrying these is contact detail, which gold types `affiliation`.
_CONTACT = re.compile(r"[@]|https?://", re.IGNORECASE)
#: The markers a footnote opens with. `∗` (U+2217) is what LaTeX's `\ast` emits and is NOT the
#: ASCII `*`; both are listed because papers use either.
_FOOTNOTE_MARKER = re.compile(r"^\s*[∗*†‡§¶]")
#: The same marker set ANYWHERE in a line, which is how an author is bound to an institution
#: (`Ashish Vaswani∗`, `Aidan N. Gomez∗†`). Only names carry one, which is what makes it a
#: usable author/affiliation discriminator where vocabulary is not.
_AFFILIATION_MARKER = re.compile(r"[∗*†‡§¶]")

#: The largest vertical gap that can sit inside one abstract. Its internal paragraph gaps measure
#: about 2 pt on this corpus; the gap from the abstract to the footnotes below it is 22 pt.
ABSTRACT_MAX_GAP_PT = 15.0

#: Two rows are the same row when their vertical centres are within this share of a row height.
#: Generous, because an author name and a superscript marker beside it sit at slightly different
#: heights, and a four-across author grid is only "one row" if that variation is absorbed.
_ROW_TOLERANCE = 0.6

#: A title is at most this many characters. `MAX_HEADING_CHARS` in `hierarchy.py` is the same
#: idea; this one is separate because a title may legitimately run longer than a section heading.
MAX_TITLE_CHARS = 200

#: A title must be set at least this much larger than the page's body text. Every paper in the
#: corpus sets its title at 1.4x or more; the abstract heading, the nearest competitor, is 1.1x.
TITLE_SIZE_RATIO = 1.25


@dataclass(frozen=True, slots=True)
class FrontMatterRetype:
    """One block, its new type, and the rule that chose it. Returned rather than applied."""

    block: AssembledBlock
    new_type: str
    rule: str


def _size_of(block: AssembledBlock) -> float:
    """The block's dominant type size. `Span.size` is nullable in the IR, so nulls are dropped.

    A block whose every span lacks a size returns 0.0 and can therefore never satisfy
    `TITLE_SIZE_RATIO` - which is the right failure: an unknown size is not evidence of a title.
    """
    sizes = [float(span.size) for span in block.spans if span.size is not None and span.size > 0]
    return float(median(sizes)) if sizes else 0.0


def _extent(block: AssembledBlock) -> tuple[float, float, float, float]:
    """The block's extent, from `line_bands` rather than `bbox`.

    THIS RUNS BEFORE `assign_ids()`, AND `bbox` IS EMPTY UNTIL THEN. `AssembledBlock.bbox` is
    documented as "filled during assembly" and `_geometry` populates it from inside `assign_ids`,
    so reading it here returns `[]` for every block. The first version of this module did exactly
    that: every centre came back 0.0, `_band_rows` collapsed the whole page into one row, and no
    title was ever found - while `_abstract` appeared to work, purely because sorting on a
    constant left the blocks in insertion order, which happens to be document order.

    `line_bands` is the geometry that exists at this point, and it is the same geometry the
    polygon is later built from, so the two cannot disagree.
    """
    bands = block.line_bands
    if not bands:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        min(b[0] for b in bands),
        min(b[1] for b in bands),
        max(b[2] for b in bands),
        max(b[3] for b in bands),
    )


def _centre(block: AssembledBlock) -> float:
    extent = _extent(block)
    return (extent[1] + extent[3]) / 2


def _height(block: AssembledBlock) -> float:
    extent = _extent(block)
    return extent[3] - extent[1]


def _band_rows(blocks: list[AssembledBlock]) -> list[list[AssembledBlock]]:
    """Group blocks into visual ROWS by vertical centre, each row ordered left to right.

    The entire layout assumption of this module, kept in one function so a paper that breaks it
    breaks somewhere findable. A row is a run of blocks whose centres sit within a fraction of a
    row height of each other - which is what makes a four-across author grid one row rather than
    four, without merging it with the affiliations beneath.
    """
    rows: list[list[AssembledBlock]] = []
    for block in sorted(blocks, key=lambda b: (_centre(b), _extent(b)[0])):
        if rows:
            reference = rows[-1][0]
            tolerance = _ROW_TOLERANCE * max(_height(reference), _height(block), 1.0)
            if abs(_centre(block) - _centre(reference)) <= tolerance:
                rows[-1].append(block)
                continue
        rows.append([block])
    return [sorted(row, key=lambda b: _extent(b)[0]) for row in rows]


def classify_front_matter(
    blocks: list[AssembledBlock], body_size: float
) -> list[FrontMatterRetype]:
    """Decide `title` / `author` / `affiliation` / `abstract` over a document's blocks.

    Returns the retypes rather than applying them, so the caller controls when they land - they
    must be applied BEFORE `assign_ids()`, because `block_id` hashes the block type.

    `body_size` is the page's dominant text size, already computed by the caller for
    `hierarchy.py`. Passed in rather than recomputed so the two agree about what "body" means.
    """
    out: list[FrontMatterRetype] = []
    page_zero = [
        block
        for block in blocks
        if block.page_index == 0
        and block.flow == "body"
        and not block.is_nested
        and _may_become_title(block)
    ]
    if page_zero:
        out.extend(_title_authors_affiliations(page_zero, body_size))
    out.extend(_abstract(blocks))
    return out


def _is_retypeable(block: AssembledBlock) -> bool:
    """Only untyped prose may become an author, an affiliation or an abstract.

    Without this, the abstract sweep on `resnet-cvpr-2col` retyped a `caption` and the parse died
    on rule 22 - *"caption_of.from must be a `caption` block, got `abstract`"*. That crash was the
    lucky outcome; the same sweep could as easily have swallowed a `figure` or a `table`, which no
    rule forbids, and the damage would have been a quietly worse document instead of a stack
    trace.

    A stronger detector has already spoken for anything not typed `paragraph` - `figures.py`,
    `tables.py`, `equations.py` and `hierarchy.py` all run before this - and a positional
    convention must not overrule evidence.
    """
    return block.type == "paragraph"


def _may_become_title(block: AssembledBlock) -> bool:
    """...but a `heading` MAY become the `title`, which is a promotion rather than a downgrade.

    `hierarchy.py`'s font rule types a paper's title `heading` on most of this corpus, since a
    title is exactly what that rule looks for: a short line set larger than the body. Excluding
    headings entirely cost `resnet-cvpr-2col` its whole front matter - no title row was found, so
    the author and affiliation rows beneath it were never reached either.

    Safe for rule 21, which requires a section's `heading_block_id` to name a `heading` OR a
    `title`, so a section node pointing at this block stays valid either way.
    """
    return block.type in ("paragraph", "heading")


def _title_authors_affiliations(
    page_zero: list[AssembledBlock], body_size: float
) -> list[FrontMatterRetype]:
    """Title, then the row below it, then every row after that up to the abstract."""
    rows = _band_rows(page_zero)
    title_row = _find_title_row(rows, body_size)
    if title_row is None:
        return []

    out: list[FrontMatterRetype] = [
        FrontMatterRetype(block, "title", "largest-text-on-page-zero") for block in rows[title_row]
    ]

    # Everything between the title and the abstract is attribution, in rows that ALTERNATE:
    # names, affiliations, e-mail addresses, then often names again. `attention` runs that cycle
    # three times over a four-across grid.
    #
    # The first row is authors UNCONDITIONALLY - not "authors unless it carries an e-mail".
    # `neural-odes` sets its author line and its e-mail line close enough to group into a single
    # block, so a contact test on the first row types the paper's only author row `affiliation`
    # and leaves it with no authors at all.
    #
    # Later rows are authors again when they carry an AFFILIATION MARKER: the superscript star or
    # dagger that binds a name to an institution. Only names carry one - "Google Brain" and
    # "noam@google.com" do not - so it recovers `attention`'s second and third author rows, which
    # a first-row-only rule types as affiliations, and costs nothing on the two papers whose
    # authors sit in a single row.
    for index, row in enumerate(rows[title_row + 1 :]):
        text = " ".join((block.text or "") for block in row).strip()
        if not text or _is_abstract_boundary(text):
            break
        if index == 0:
            kind, rule = "author", "first-row-below-title"
        elif _AFFILIATION_MARKER.search(text) and not _CONTACT.search(text):
            kind, rule = "author", "carries-an-affiliation-marker"
        else:
            kind, rule = "affiliation", "row-below-the-authors"
        out.extend(FrontMatterRetype(block, kind, rule) for block in row if _is_retypeable(block))
    return out


def _find_title_row(rows: list[list[AssembledBlock]], body_size: float) -> int | None:
    """The first row set clearly larger than the body, near the top of the page.

    Size rather than position, because an arXiv margin stamp and a running head both sit above
    the title. Bounded by `TITLE_SIZE_RATIO` rather than "the largest thing on the page" so a
    paper with no title - a bare appendix, a scanned fragment - reports nothing instead of
    promoting whatever happened to be biggest.
    """
    for index, row in enumerate(rows):
        size = max((_size_of(block) for block in row), default=0.0)
        text = " ".join((block.text or "") for block in row).strip()
        if not text or len(text) > MAX_TITLE_CHARS:
            continue
        if body_size > 0 and size >= TITLE_SIZE_RATIO * body_size:
            return index
    return None


def _is_abstract_boundary(text: str) -> bool:
    stripped = text.strip().rstrip(".:").strip()
    return bool(_ABSTRACT_HEADING.match(stripped) or _FIRST_SECTION.match(stripped))


def _abstract(blocks: list[AssembledBlock]) -> list[FrontMatterRetype]:
    """Body blocks between the `Abstract` heading and the next heading.

    The heading itself STAYS a heading. Gold types the word "Abstract" as `heading` and the prose
    under it as `abstract`, and rule 21 needs a section's `heading_block_id` to name a block of a
    known heading type - retyping it here would break the section tree to gain one region.
    """
    body = [
        b
        for b in blocks
        if b.flow == "body" and not b.is_nested and (b.type == "heading" or _is_retypeable(b))
    ]
    ordered = sorted(body, key=lambda b: (b.page_index, _extent(b)[1]))

    out: list[FrontMatterRetype] = []
    inside = False
    previous_bottom: float | None = None
    for block in ordered:
        text = (block.text or "").strip()
        if block.type == "heading":
            if _ABSTRACT_HEADING.match(text.rstrip(".:").strip()):
                inside = True
                previous_bottom = _extent(block)[3]
                continue
            if inside:
                break  # the next heading of any kind closes the abstract
        if not inside or not text:
            continue

        top, bottom = _extent(block)[1], _extent(block)[3]
        # AN ABSTRACT IS CONTIGUOUS PROSE, and on `attention-is-all-you-need` the next heading is
        # on the following page - so "until the next heading" alone ran the abstract through the
        # asterisked contribution note, the affiliation footnotes and the NeurIPS venue line, all
        # of which sit below it on page 0. A footnote separated by a 22 pt gap is not the
        # abstract continuing; the abstract's own internal gaps measure about 2 pt.
        if previous_bottom is not None and top - previous_bottom > ABSTRACT_MAX_GAP_PT:
            break
        if _FOOTNOTE_MARKER.match(text):
            break

        out.append(FrontMatterRetype(block, "abstract", "between-abstract-and-next-heading"))
        previous_bottom = bottom
    return out
