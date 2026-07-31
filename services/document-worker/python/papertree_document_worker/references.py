"""The bibliography: `reference_entry` blocks, and the `Reference` records that point at them.

`Paper.references` has been `[]` on every paper since the epic began, and `reference_entry` is one
of the types gold uses that nothing emitted - a structural 0.00 in the macro-average, the same
shape of gap `frontmatter.py` closed for the front matter.

TWO PASSES, BECAUSE `Reference.reference_entry_block_id` IS REQUIRED

  `classify_reference_entries`  retypes blocks. Must run BEFORE `assign_ids()`, because
                                `block_id` hashes the block type.
  `extract_references`          builds the records. Must run AFTER, because it cites ids that do
                                not exist until then.

Splitting them is not a convenience; a record that names a block id minted for a different type
is a dangling citation that nothing downstream would question.

WHAT IS PARSED OUT OF AN ENTRY, AND WHAT IS NOT

`year` and `arxiv_id` only. Both are unambiguous patterns that survive being wrong loudly rather
than quietly - a four-digit year in the plausible range, and `arXiv:NNNN.NNNNN`.

`title`, `authors` and `venue` are left null on purpose. Reference strings are formatted a dozen
different ways ("He, K., Zhang, X." / "Kaiming He, Xiangyu Zhang" / "[11] K. He et al.") and a
heuristic split of one produces a *plausible* author list, which is worse than none: the field
would look populated, nothing would flag it, and every consumer downstream would trust it. D6's
rule for metadata is the same principle - a value or a null, never a guess.

A NOTE ON SCORING. Gold boxes a whole reference page as ONE region typed `citation`
(`research/benchmarks/gold/README.md` records this), while this emits one `reference_entry` per
entry, which is what `ANNOTATION_GUIDE.md` asks an annotator for. The two do not match and this
module will not improve the F1 on the current gold set. It is still the right output: the
disagreement is a gold-granularity limitation already recorded as a warning, not a parser defect.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - import cycle at runtime, types only
    from papertree_document_worker.assemble import AssembledBlock

__all__ = ["ReferenceRetype", "classify_reference_entries", "extract_references"]

#: The heading that opens a bibliography. Matched on the punctuation-stripped line, after any
#: section number, so `7 References` and `References` both qualify.
_REFERENCES_HEADING = re.compile(
    r"^(?:\s*(?:\d+|[A-Z]|[IVXL]+)(?:\.\d+)*\s*[.)]?\s*)?(?:references|bibliography)$",
    re.IGNORECASE,
)
#: A four-digit year in the range a citation can plausibly carry.
_YEAR = re.compile(r"\b(19[5-9][0-9]|20[0-4][0-9])\b")
#: `arXiv:1706.03762v7` as it appears inside a reference string.
_ARXIV = re.compile(r"arXiv:\s*([0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?", re.IGNORECASE)
#: The same identifier, so a year scan can skip the digits inside it - `arXiv:2005.14165` reads
#: `2005` as a publication year otherwise. `metadata.py` carries this trap too; both need it.
_ARXIV_SPAN = re.compile(r"arXiv:\s*[0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?", re.IGNORECASE)

#: Confidence on a reference. Coarse and stated rather than calibrated, matching `metadata.py`:
#: there is no gold for reference parsing either.
REFERENCE_CONFIDENCE = 0.6

#: A reference entry is at least this long. Below it the block is a stray fragment - a page
#: number that drifted into the bibliography, a column artefact - not a citation.
MIN_ENTRY_CHARS = 20


@dataclass(frozen=True, slots=True)
class ReferenceRetype:
    """One block that should become a `reference_entry`. Returned rather than applied."""

    block: AssembledBlock
    new_type: str = "reference_entry"


def _ordered_body(blocks: list[AssembledBlock]) -> list[AssembledBlock]:
    """Body blocks in document order, using `line_bands` - `bbox` is empty before `assign_ids`."""

    def key(block: AssembledBlock) -> tuple[int, float, float]:
        bands = block.line_bands
        top = min((b[1] for b in bands), default=0.0)
        left = min((b[0] for b in bands), default=0.0)
        return (block.page_index, top, left)

    return sorted(
        (b for b in blocks if b.flow == "body" and not b.is_nested),
        key=key,
    )


def classify_reference_entries(blocks: list[AssembledBlock]) -> list[ReferenceRetype]:
    """Every prose block after the `References` heading, until the next section that is not one.

    An appendix legitimately follows a bibliography, so the sweep closes at the next heading -
    with the exception of a heading that is ITSELF a references heading, since a paper may have
    per-section bibliographies and a two-column paper's `References` can be detected twice.
    """
    out: list[ReferenceRetype] = []
    inside = False
    for block in _ordered_body(blocks):
        text = (block.text or "").strip()
        if block.type == "heading":
            inside = bool(_REFERENCES_HEADING.match(text.rstrip(".:").strip()))
            continue
        if inside and block.type == "paragraph" and len(text) >= MIN_ENTRY_CHARS:
            out.append(ReferenceRetype(block))
    return out


def extract_references(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`Paper.references`, one record per `reference_entry` block, in document order.

    Runs on the SERIALISED blocks, after `assign_ids()`, because every record is required to name
    the block it came from.
    """
    entries = [b for b in blocks if b.get("type") == "reference_entry" and b.get("block_id")]
    entries.sort(key=lambda b: (b.get("page_index", 0), (b.get("bbox") or [0, 0, 0, 0])[1]))

    out: list[dict[str, Any]] = []
    for block in entries:
        text = block.get("text") or ""
        record: dict[str, Any] = {
            "reference_entry_block_id": block["block_id"],
            "confidence": REFERENCE_CONFIDENCE,
        }
        arxiv = _ARXIV.search(text)
        if arxiv:
            record["arxiv_id"] = arxiv.group(1)
        year = _year_of(text)
        if year is not None:
            record["year"] = year
        out.append(record)
    return out


def _year_of(text: str) -> int | None:
    """The last plausible year in the entry, ignoring the digits inside an arXiv identifier.

    THE LAST rather than the first: a reference string routinely carries a volume, an issue and a
    page range before its year, and `In Proceedings of the 2016 Conference` is a venue name whose
    year is the same one anyway. `metadata.py` records the arXiv trap - `arXiv:2005.14165` yields
    a verbatim, correctly-cited, simply wrong `2005`.
    """
    spans = [m.span() for m in _ARXIV_SPAN.finditer(text)]
    found: int | None = None
    for match in _YEAR.finditer(text):
        if any(start <= match.start() < end for start, end in spans):
            continue
        found = int(match.group(1))
    return found
