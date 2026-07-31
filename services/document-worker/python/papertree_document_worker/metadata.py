"""Bibliographic metadata, extracted from blocks that are already in the document.

`DESIGN.md` §10: *"**`Metadata` is a required object and no epic currently owns filling it** —
Epic 1's feature list needs document-metadata and bibliography extraction added, or Wave 1
ships all-null metadata."* This is Epic 1 taking it.

RULE 6b IS WHAT SHAPES THIS MODULE

Every `MetadataValue` carries a `source_block_id`, and rule 6b (**ERROR**) requires the value,
under the library's normalisation, to be a **substring of the normalised text of that block**:

> Requiring the citation was only half of D6: without this, `title = <model-composed>` with a
> plausible `source_block_id` validates end to end.

So nothing here may clean, title-case, reformat or reorder anything. A value is a **verbatim
slice of a block that exists**, or it is null. That rules out the obvious conveniences — no
"Author, A." reformatting, no stripping a trailing period from a title, no joining an author
list into a single string.

It also means extraction and citation cannot be separated: a field is only extractable if the
exact characters sit in one block. `authors` is the sharp case — a comma-separated author line
yields each name as a substring of that line, which works; an author list split across three
blocks does not yield a single block containing all of them, and each name cites its own block.

WHAT IS NOT ATTEMPTED

`venue` and `doi` are left null for this corpus: arXiv preprints carry neither in a form that
survives the substring test. `year` needs `MetadataYear`, whose value is an integer rendered as
a decimal string for the rule-6b check - so `2015` must literally appear in the cited block.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from papertree_document_ir.identity import normalise_text

__all__ = ["MetadataCandidate", "extract_metadata"]

#: arXiv ids as they appear in the margin stamp: `arXiv:1512.03385v1`, `arXiv:1706.03762v7`.
_ARXIV = re.compile(r"arXiv:\s*([0-9]{4}\.[0-9]{4,5})(v[0-9]+)?", re.IGNORECASE)
#: A four-digit year in the plausible range for a paper.
_YEAR = re.compile(r"\b(19[5-9][0-9]|20[0-4][0-9])\b")
#: Author lines separate names with commas, `and`, or superscript markers.
_AUTHOR_SPLIT = re.compile(r"\s*(?:,|\band\b|;)\s*")
#: Trailing affiliation markers on a name: `Kaiming He1`, `Ross Girshick∗`.
_NAME_TRAILER = re.compile(r"[\s\d*†‡§¶∗,]+$")

#: A name is two-to-five capitalised words. Longer is a sentence; shorter is an initial.
_NAME = re.compile(r"^[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){1,4}$")


#: Confidence on every metadata value. Coarse and stated, not calibrated - there is no gold
#: for metadata extraction either. 0.9 where the field came from a TYPED block (`title`,
#: `author`, `abstract`), 0.6 where it came from a heuristic (largest font on page 0, a regex
#: over the margin stamp). Revise alongside DESIGN.md's confidence mapping table.
TYPED_CONFIDENCE = 0.9
HEURISTIC_CONFIDENCE = 0.6


@dataclass(frozen=True, slots=True)
class MetadataCandidate:
    """A value, the block it was taken from verbatim, and how it was found."""

    value: str
    source_block_id: str
    confidence: float = HEURISTIC_CONFIDENCE

    def as_json(self) -> dict[str, object]:
        return {
            "value": self.value,
            "source_block_id": self.source_block_id,
            "confidence": self.confidence,
        }


def _cites(value: str, block_text: str) -> bool:
    """Rule 6b, checked here rather than discovered by the validator.

    Uses the LIBRARY's normalisation on both sides - the same function rule 6b uses - so a value
    that passes here passes there. Re-implementing the comparison would let this module agree
    with itself and disagree with the validator.
    """
    return normalise_text(value) in normalise_text(block_text)


def _clean_name(raw: str) -> str:
    """Strip an affiliation marker from the END only.

    Rule 6b still has to hold afterwards, and it does: removing a suffix leaves a substring.
    Removing anything from the MIDDLE would not, which is why nothing here rewrites interiors.
    """
    return _NAME_TRAILER.sub("", raw).strip()


def extract_metadata(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """Build `Paper.metadata` from the document's own blocks.

    Returns the full seven-key object. Every key is REQUIRED and non-nullable as a key; the
    values are nullable, and `authors` must be `[]` rather than null when empty.
    """
    first_page = [b for b in blocks if b.get("page_index") == 0 and b.get("text")]

    title = _find_title(first_page)
    authors = _find_authors(first_page)
    abstract = _find_abstract(blocks)
    arxiv = _find_arxiv(blocks)
    year = _find_year(blocks, arxiv)

    return {
        "title": title.as_json() if title else None,
        "authors": [a.as_json() for a in authors],
        "abstract": abstract,
        "doi": None,
        "arxiv_id": arxiv.as_json() if arxiv else None,
        "venue": None,
        "year": (
            {
                "value": int(year.value),
                "source_block_id": year.source_block_id,
                "confidence": year.confidence,
            }
            if year
            else None
        ),
    }


def _find_title(first_page: list[dict[str, Any]]) -> MetadataCandidate | None:
    """The `title` block if one was typed, else the largest text on page 0.

    Falls back to font size because `hierarchy.py` types a paper's title as `heading` rather
    than `title` on most of this corpus - a real gap, and one this module should not paper over
    by inventing a title that no block contains.
    """
    titled = [b for b in first_page if b.get("type") == "title"]
    if titled:
        text = (titled[0].get("text") or "").strip()
        return MetadataCandidate(text, titled[0]["block_id"], TYPED_CONFIDENCE) if text else None

    def size_of(block: dict[str, Any]) -> float:
        spans = block.get("spans") or []
        return max((float(s.get("size", 0)) for s in spans), default=0.0)

    candidates = [b for b in first_page if b.get("type") in ("heading", "paragraph")]
    if not candidates:
        return None
    biggest = max(candidates, key=size_of)
    text = (biggest.get("text") or "").strip().replace("\n", " ")
    # A title is one line or two, not a paragraph.
    if not text or len(text) > 200 or size_of(biggest) <= 0:
        return None
    # `text` had its newlines replaced, so re-check rule 6b against the STORED text.
    return (
        MetadataCandidate(text, biggest["block_id"])
        if _cites(text, biggest.get("text") or "")
        else None
    )


def _find_authors(first_page: list[dict[str, Any]]) -> list[MetadataCandidate]:
    """Names from `author`-typed blocks, or from the block below the title.

    Each name cites the block it came from, so an author list split across blocks is fine -
    what is NOT possible is one `source_block_id` covering names from several blocks.
    """
    sources = [b for b in first_page if b.get("type") == "author"]
    out: list[MetadataCandidate] = []
    for block in sources:
        text = block.get("text") or ""
        for line in text.split("\n"):
            for piece in _AUTHOR_SPLIT.split(line):
                name = _clean_name(piece)
                if _NAME.match(name) and _cites(name, text):
                    out.append(MetadataCandidate(name, block["block_id"], TYPED_CONFIDENCE))
    # Deduplicate, preserving order - the same name can appear in two blocks.
    seen: set[str] = set()
    unique: list[MetadataCandidate] = []
    for candidate in out:
        if candidate.value not in seen:
            seen.add(candidate.value)
            unique.append(candidate)
    return unique


def _find_abstract(blocks: list[dict[str, Any]]) -> dict[str, Any] | None:
    """`AbstractRef` is `{block_ids: [...]}` - it names blocks rather than copying their text.

    That is D6 working: the abstract lives in exactly one place, the blocks, and the metadata
    points at it. Nothing to check against rule 6b, because nothing is duplicated.
    """
    ids = [b["block_id"] for b in blocks if b.get("type") == "abstract"]
    return {"block_ids": ids, "confidence": TYPED_CONFIDENCE} if ids else None


def _find_arxiv(blocks: list[dict[str, Any]]) -> MetadataCandidate | None:
    """The id from the margin stamp - which `layout.py` routes to `flow: "margin"`.

    findings.md B6 recorded that stamp being promoted to a HEADING on every arXiv paper. Here it
    is the one block that carries the paper's identifier, which is a better use for it.
    """
    for block in blocks:
        text = block.get("text") or ""
        match = _ARXIV.search(text)
        if match:
            # The bare id WITHOUT the version suffix is not always a substring (the stamp reads
            # `arXiv:1512.03385v1`), so cite what is actually there.
            value = match.group(1)
            if _cites(value, text):
                return MetadataCandidate(value, block["block_id"])
    return None


def _find_year(
    blocks: list[dict[str, Any]], arxiv: MetadataCandidate | None
) -> MetadataCandidate | None:
    """A four-digit year that literally appears in the cited block.

    `MetadataYear.value` is an integer, and rule 6b compares it RENDERED AS A DECIMAL STRING -
    so `2015` must be in the block's text. An arXiv id encodes the year as `1512`, which does
    NOT contain `2015`, so the id cannot be used to derive it. The margin stamp's date can.
    """
    preferred = (
        [b for b in blocks if b["block_id"] == arxiv.source_block_id] if arxiv else []
    ) or [b for b in blocks if b.get("flow") == "margin"]
    for block in preferred + blocks:
        text = block.get("text") or ""
        for match in _YEAR.finditer(text):
            # SKIP A MATCH THAT IS PART OF AN arXiv ID. gpt3-longform is `arXiv:2005.14165`, and
            # a bare four-digit scan reads `2005` out of the identifier and calls it the
            # publication year - a value that is verbatim in the block, cites it correctly, and
            # passes rule 6b while being simply wrong. Rule 6b guarantees PROVENANCE, not truth;
            # nothing in the schema catches this and nothing downstream would question it.
            if any(span.start() <= match.start() < span.end() for span in _ARXIV.finditer(text)):
                continue
            if _cites(match.group(1), text):
                return MetadataCandidate(match.group(1), block["block_id"])
    return None
