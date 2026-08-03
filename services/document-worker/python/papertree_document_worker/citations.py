"""In-prose citation markers, the `cites` edges they justify, and the spans that locate them.

`cites` has been emitted ZERO times since the epic began (#66). Not "rarely" - never, on every
paper, which is why `resolve_citation`'s edge branch is unreachable code and `Span.role` carries
only `undecodable_glyphs`. This module closes that.

TWO MECHANISMS, TWO DENOMINATORS, AND THEY ARE NEVER AVERAGED

The corpus prints citations three ways, but only two of them are separate MECHANISMS:

  `printed_label`   `[12]` (resnet, attention) and `[ADG+16]` (gpt3) are one mechanism, because
                    the bibliography prints the label on the entry itself - gpt3's first entry
                    literally begins "[ADG+16] Marcin Andrychowicz, ...". Resolution is an exact
                    string match of a marker against a label the document printed. 3 papers.

  `author_year`     "(Kingma and Ba, 2014)" (a3c, bert, neural-odes, pdf-to-tree, superglue). The
                    entry prints no label, so there is nothing to match exactly and the surname
                    has to be found in the entry's TEXT. `Reference.authors` cannot help:
                    `references.py` leaves it null ON PURPOSE and it is 0-populated on all 8
                    papers (0/53 resnet, 0/45 attention, 0/6 neural-odes - re-derived). 5 papers.

The second is measurably weaker than the first, so the two are counted with SEPARATE
DENOMINATORS wherever they are reported. A blended corpus-wide rate would average a strong
mechanism over 3 papers with a weak one over 5 and describe neither - the composite-denominator
defect #111 found in `figures.spec`, in a new place.

WHY `author_year` MATCHES A *RECORD*, NOT THE WHOLE BLOCK

Epic 1 segments a bibliography into BLOCKS, not entries: bert's 29 `reference_entry` blocks hold
~60 printed references and run to 907 characters. Matching a surname anywhere in such a block
against a year anywhere else in it resolves nearly everything and is nearly all wrong - measured:
"(Dai and Le, 2015)" landed on the block whose text is "Supervised learning of universal sentence
representations...", because "Dai" and "2015" both happen to occur somewhere inside it.

So a block is first split into RECORDS at the reference boundaries visible in the text (a full
stop, then a capitalised name), and the surname must LEAD one - it has to appear in the record's
first `_AUTHOR_PREFIX_CHARS` characters, i.e. in the author list rather than in the title or the
venue. With that constraint the same marker resolves to "Andrew M Dai and Quoc V Le. 2015.
Semi-supervised sequence learning." A two-name marker ("X and Y, YYYY") must additionally find
the second surname in the record's author prefix; that one clause is what stops
"(Kingma and Welling, 2014)" from landing on "Diederik P Kingma and Jimmy Ba. Adam: ... 2014".

AMBIGUITY IS DROPPED, NEVER GUESSED. When more than one record satisfies a marker, no edge is
emitted. `references.py` states the same rule for `title`/`authors`: a plausible value is worse
than none, because nothing downstream would question it.

THE SECOND IMPLEMENTATION, AND WHY IT IS ALLOWED TO EXIST

`packages/retrieval` already has `_CITATION_MARKER` and `_citation_labels`. `document-worker`
must NOT depend on it - retrieval CONSUMES the IR, and the dependency would run backwards - so
the bracket-scanning here is a second implementation of the same idea. That is only tolerable
because the agreement is a CHECKED INVARIANT: `test_citations.py` asserts on a real parse that
every label retrieval finds in a block is also found here. `_NUMERIC_MARKER` is deliberately
character-for-character `expansion._CITATION_MARKER`, so the numeric half agrees by construction
and the test is what proves it stays that way.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from papertree_document_ir import Span

if TYPE_CHECKING:  # pragma: no cover - import cycle at runtime, types only
    from papertree_document_worker.assemble import AssembledBlock

__all__ = [
    "CITATION_ROLE",
    "CitationLink",
    "apply_citation_roles",
    "bracketed_marker_keys",
    "detect_citations",
]

#: `Span.role` for a citation marker. An OPEN vocabulary (`models.py` constrains the SHAPE only,
#: `^[a-z][a-z0-9_]{0,63}$`), and no semantic rule constrains its values - rule 23 governs
#: `cites.to` and says nothing about spans. The name is the one `Span.role`'s own schema
#: description and `text._span_role`'s docstring both already promise.
CITATION_ROLE = "citation"

#: CHARACTER-FOR-CHARACTER `papertree_retrieval.expansion._CITATION_MARKER`. Copied rather than
#: imported (the dependency would run backwards) and asserted equivalent by a test on a real
#: parse. `[.5, .95]` - a real string on resnet page 5 - does not match: the inner run must OPEN
#: with a digit.
_NUMERIC_MARKER = re.compile(r"\[(\d[\d,\s–-]*)\]")
#: Its split, also from retrieval: `[22, 21]` -> ("22", "21"), printed order, ranges NOT expanded.
_NUMERIC_SPLIT = re.compile(r"[,\s–-]+")
#: `[ADG+16]`, and `[GSL+18, NK19]` which prints two. Letter-initial, so it cannot collide with
#: the numeric pattern. `[MASK]`, `[CLS]` and `[SEP]` (53 hits across bert) match this shape and
#: are harmless: they resolve against the labels the bibliography actually printed, and bert
#: prints none, so they produce nothing.
_ALNUM_MARKER = re.compile(r"\[([A-Za-z][A-Za-z0-9+'’,;\s]{1,80})\]")
_ALNUM_SPLIT = re.compile(r"[,;\s]+")
_ALNUM_LABEL = re.compile(r"^[A-Za-z][A-Za-z0-9+'’]{1,19}$")
#: The label an entry prints for itself, at the start of the block OR the start of any line in it.
#: Line-start rather than anywhere, for `index._reference_label`'s reason: resnet's entry 3 begins
#: mid-block, and a substring search would match every `[3]` inside a page range.
_ENTRY_LABEL = re.compile(r"^\[([0-9]{1,4}|[A-Za-z][A-Za-z0-9+'’]{1,19})\]")

_UPPER = "A-ZÀ-ÖØ-Þ"
_YEAR = r"(?:19[5-9][0-9]|20[0-4][0-9])"
#: "Kingma and Ba", "Pontryagin et al.", "van der Maaten" - an author reference as a marker prints
#: it. The trailing comma before the year is REQUIRED, and it is what rejects "(NeurIPS 2018)".
_MARKER_NAME = (
    rf"[{_UPPER}][\w'’.-]*(?:[ .]+(?:and|&|et|al\.?|de|van|der|von|[{_UPPER}][\w'’.-]*)){{0,6}}"
)
_AUTHOR_YEAR = re.compile(rf"(?P<name>{_MARKER_NAME}),\s*(?P<year>{_YEAR})[a-z]?(?=[;,)\]]|$)")
#: Only INSIDE parentheses. The narrative form - "Chen et al. (2018)" - is out of scope: its
#: surname sits outside the bracket and pairing the two needs sentence structure this does not have.
_PARENTHETICAL = re.compile(r"\(([^()]{5,300})\)")
_SURNAME = re.compile(rf"[{_UPPER}][\w'’-]+")
_SECOND_SURNAME = re.compile(rf"\b(?:and|&)\s+(?:[{_UPPER}][\w'’.-]*\s+)*(?P<s>[{_UPPER}][\w'’-]+)")
#: A record boundary inside a `reference_entry` block: a full stop, then a capitalised name.
_RECORD_HEAD = re.compile(rf"(?<=\.)\s+(?=[{_UPPER}][a-zà-öø-þ]*[ ,])")
#: How far into a record a surname may sit and still count as an AUTHOR rather than a word in the
#: title or the venue. 40 characters is about two names; widening it to 120 cost precision and
#: recall at once (103 resolved / 38 ambiguous, against 112 / 25 - measured on this corpus).
_AUTHOR_PREFIX_CHARS = 40
#: The second surname of an "X and Y" marker may sit further in, because the first author's given
#: names precede it.
_SECOND_PREFIX_CHARS = 220

#: An exact match against a label the document itself printed.
LABEL_CONFIDENCE = 0.9
#: A surname-and-year heuristic against a fragmented block. Coarse and STATED rather than
#: calibrated, exactly like `references.REFERENCE_CONFIDENCE`: there is no gold for citations.
AUTHOR_YEAR_CONFIDENCE = 0.6


@dataclass(frozen=True, slots=True)
class CitationLink:
    """One resolved marker: which block cites which entry, and where the marker is printed."""

    source: AssembledBlock
    target: AssembledBlock
    #: Half-open offsets into `source.text`, so the role span can be placed exactly.
    start: int
    end: int
    provenance: str
    confidence: float


def bracketed_marker_keys(text: str) -> tuple[str, ...]:
    """Every bracketed label in `text`, first-appearance order, WITH duplicates removed.

    Public because the retrieval-agreement test needs it: `_citation_labels(text)` must be a
    subset of this on every block of a real parse.
    """
    out: list[str] = []
    for start, _end, key in _bracketed_markers(text):  # noqa: B007 - offsets unused here
        if key not in out:
            out.append(key)
    return tuple(out)


def _bracketed_markers(text: str) -> list[tuple[int, int, str]]:
    out: list[tuple[int, int, str]] = []
    for pattern, splitter in ((_NUMERIC_MARKER, _NUMERIC_SPLIT), (_ALNUM_MARKER, _ALNUM_SPLIT)):
        for match in pattern.finditer(text):
            cursor = match.start(1)
            for part in splitter.split(match.group(1)):
                if not part:
                    continue
                # Located by search rather than arithmetic: the split discards the separators and
                # their widths vary ("22, 21" against "22,21").
                at = text.find(part, cursor, match.end(1))
                if at < 0:
                    continue
                cursor = at + len(part)
                if part.isdigit() or _ALNUM_LABEL.match(part):
                    out.append((at, cursor, part))
    return sorted(out)


def _entry_labels(entries: list[AssembledBlock]) -> dict[str, AssembledBlock]:
    """label -> the entry block that PRINTS it. First block wins; a label is printed once."""
    out: dict[str, AssembledBlock] = {}
    for block in entries:
        for line in (block.text or "").split("\n"):
            match = _ENTRY_LABEL.match(line.lstrip())
            if match:
                out.setdefault(match.group(1), block)
    return out


def _records(text: str) -> list[str]:
    cuts = [0, *(m.end() for m in _RECORD_HEAD.finditer(text)), len(text)]
    return [text[a:b] for a, b in zip(cuts, cuts[1:], strict=False) if b > a]


def _author_year_markers(text: str) -> list[tuple[int, int, list[str], str]]:
    out: list[tuple[int, int, list[str], str]] = []
    for group in _PARENTHETICAL.finditer(text):
        base = group.start(1)
        for match in _AUTHOR_YEAR.finditer(group.group(1)):
            name = match.group("name")
            first = _SURNAME.match(name)
            if first is None:
                continue
            surnames = [first.group(0)]
            if "et al" not in name:
                second = _SECOND_SURNAME.search(name)
                if second is not None and second.group("s") != surnames[0]:
                    surnames.append(second.group("s"))
            out.append(
                (base + match.start("name"), base + match.end("year"), surnames, match.group("year"))
            )
    return out


def _resolve_author_year(
    surnames: list[str],
    year: str,
    records: list[tuple[AssembledBlock, list[str]]],
) -> AssembledBlock | None:
    lead = re.compile(r"\b" + re.escape(surnames[0]) + r"\b")
    also = re.compile(r"\b" + re.escape(surnames[1]) + r"\b") if len(surnames) > 1 else None
    # The suffix is optional on the ENTRY side: a paper printing "(Peters et al., 2018a)" has a
    # bibliography that prints plain "2018" as often as it prints "2018a".
    stamped = re.compile(r"\b" + year + r"[a-z]?\b")
    found: AssembledBlock | None = None
    for block, texts in records:
        for record in texts:
            at = lead.search(record)
            if at is None or at.start() > _AUTHOR_PREFIX_CHARS or not stamped.search(record):
                continue
            if also is not None and not also.search(record[:_SECOND_PREFIX_CHARS]):
                continue
            if found is not None and found is not block:
                return None  # Ambiguous across blocks: drop it rather than pick one.
            found = block
            break
    return found


def detect_citations(blocks: list[AssembledBlock]) -> list[CitationLink]:
    """Every in-prose marker that resolves to a `reference_entry` block, in document order.

    MUST RUN AFTER `PaperBuilder.assign_ids()`, and the reason is the whole of #66:
    `assemble._emit_relations` drops any edge whose endpoints are missing from `by_id` SILENTLY -
    no raise, no log - so an emitter at the wrong phase, or holding a block object that assembly
    has since replaced, produces a document with zero `cites` and nothing anywhere says so. The
    role spans need `target.block_id`, which also does not exist until then.
    """
    entries = [b for b in blocks if b.type == "reference_entry"]
    if not entries:
        return []
    labels = _entry_labels(entries)
    records = [(b, _records(b.text or "")) for b in entries]

    out: list[CitationLink] = []
    for block in blocks:
        text = block.text
        if not text or block.type == "reference_entry":
            continue
        for start, end, key in _bracketed_markers(text):
            target = labels.get(key)
            if target is not None and target is not block:
                out.append(
                    CitationLink(block, target, start, end, "printed_label", LABEL_CONFIDENCE)
                )
        for start, end, surnames, year in _author_year_markers(text):
            target = _resolve_author_year(surnames, year, records)
            if target is not None and target is not block:
                out.append(
                    CitationLink(block, target, start, end, "author_year", AUTHOR_YEAR_CONFIDENCE)
                )
    return out


def apply_citation_roles(links: list[CitationLink]) -> int:
    """Mark each resolved marker with `role="citation"` spans. Returns how many markers got one.

    A marker is normally MID-RUN - same font and size as the prose around it - so there is no
    existing span to label, and rule 26 forbids laying a role span ON TOP of the covering run. The
    run is SPLIT instead: before, marker, after.

    "UP TO THREE SPANS" IS WHAT THIS LOOKS LIKE WHEN ONE RUN COVERS THE MARKER, AND THE CORPUS
    OFTEN DISAGREES. `build_block_text` emits one span per PDF STYLE RUN, and bert-2col and
    neural-odes emit runs at word granularity: "(Radford et al., 2018)" arrives as `Radford` / ` `
    / `et` / ` ` / ... - measured, 0 of bert's 71 author-year markers lie inside a single run,
    against 60 of attention's 78 bracketed ones. Restricting to the single-run case would have
    given `role="citation"` on 3 papers and silently none on the other 5.

    So every run the marker OVERLAPS is clipped and roled. One marker therefore yields one span or
    several; each carries the same `block_id`, each has honest geometry, and consecutive ones
    coalesce trivially. A marker broken across a line yields a gap, because the LINE_SEPARATOR
    between two runs is covered by no span at all - the gap is the truth, not an omission.

    THIS IS SAFE AFTER `assign_ids()`, AND THAT WAS VERIFIED RATHER THAN ASSUMED. `block_id` hashes
    (source_hash, page_index, quantised top-left, block TYPE, normalised text prefix) and
    `content_hash` hashes the normalised text. Neither reads spans, so splitting retires no id and
    changes no content hash. `test_citations.py` asserts both on a real parse.
    """
    by_block: dict[int, tuple[AssembledBlock, list[CitationLink]]] = {}
    for link in links:
        by_block.setdefault(id(link.source), (link.source, []))[1].append(link)

    marked = 0
    for block, block_links in by_block.values():
        # Rule 26 wants ASCENDING, NON-OVERLAPPING spans, so overlapping markers cannot both be
        # honoured. They do not occur (brackets and parentheses are disjoint), and this drops the
        # later one rather than emitting a document that fails validation if they ever do.
        ordered: list[CitationLink] = []
        for link in sorted(block_links, key=lambda x: (x.start, x.end)):
            if not ordered or link.start >= ordered[-1].end:
                ordered.append(link)
        spans: list[Span] = []
        touched: set[int] = set()
        for span in block.spans:
            overlapping = [x for x in ordered if x.start < span.end and span.start < x.end]
            if not overlapping:
                spans.append(span)
                continue
            cursor = span.start
            for index, link in enumerate(ordered):
                if link not in overlapping:
                    continue
                start, end = max(link.start, span.start), min(link.end, span.end)
                if start > cursor:
                    spans.append(_slice(span, cursor, start))
                spans.append(_slice(span, start, end, target=link.target.block_id))
                touched.add(index)
                cursor = end
            if cursor < span.end:
                spans.append(_slice(span, cursor, span.end))
        block.spans = tuple(spans)
        marked += len(touched)
    return marked


def _slice(span: Span, start: int, end: int, *, target: str | None = None) -> Span:
    """One piece of a split run, with its share of the run's box.

    The box is apportioned by CHARACTER COUNT, not by glyph advance: a run is one font at one size
    on one line, so proportional width is a close approximation and the alternative - repeating the
    whole run's box on all three pieces - would claim the marker occupies the entire run, which is
    a worse lie than an approximate one. Stated here rather than left to be discovered.
    """
    x0, y0, x1, y1 = span.bbox
    width = (x1 - x0) / (span.end - span.start)
    optional: dict[str, object] = {}
    if target is not None:
        optional["role"] = CITATION_ROLE
        optional["block_id"] = target
    elif span.role is not None:
        optional["role"] = span.role
    if span.font:
        optional["font"] = span.font
    return Span(
        start=start,
        end=end,
        bbox=[x0 + width * (start - span.start), y0, x0 + width * (end - span.start), y1],
        size=span.size,
        **optional,  # type: ignore[arg-type]
    )
