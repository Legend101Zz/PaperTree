"""In-prose float callouts, the `references` edges they justify, and the two payload mirrors.

`references` has been emitted ZERO times since the epic began (#66), and that is *why*
`EquationPayload.referenced_by` and `FigurePayload.referenced_by` are 0-populated: the schema
defines them as the inverse of a relation nothing emits. `FigurePayload.caption_block` is
0-populated for a different reason — its relation (`caption_of`) has existed all along at 142
edges corpus-wide and simply was never mirrored.

THE SCHEMA DICTATES THE DIRECTION, AND IT IS NOT NEGOTIABLE

`generated/models.py` says it three times, in the field docstrings themselves:

    :995  `EquationPayload.referenced_by` — "A denormalised convenience over the inverse of the
          `references` relation; THE RELATIONS ARRAY IS AUTHORITATIVE."
    :1076 `FigurePayload.caption_block`  — "Denormalised inverse of the caption_of relation,
          WHICH REMAINS AUTHORITATIVE."
    :1082 `FigurePayload.referenced_by`  — same shape.

So every payload value here is DERIVED FROM AN EMITTED EDGE and never computed beside one. A
payload field populated independently would be the second representation the schema exists to
prevent, and the two could disagree with nothing to catch it. `test_crossrefs.py` asserts the
agreement in both directions rather than asserting each side is non-empty.

WHAT A FLOAT'S NUMBER IS, AND WHY IT COMES FROM TWO PLACES

A callout resolves by matching the printed LABEL, not by geometry — proximity is what
`caption_of` already uses and it is wrong the moment two floats share a page.

  figures/tables/algorithms/listings   the number lives in the CAPTION, and the caption is
                                       attached by an existing `caption_of` edge. So the lookup
                                       is a two-hop join over data that already exists:
                                       `is_caption_line(caption.text)` -> ("figure", "3") ->
                                       the float that edge points at.
  equations                            have no caption. The number is already parsed and stored:
                                       `equations.py:162 _equation_number` writes it to
                                       `payload.equation_number` ("3", "A.1", "2.1").

**THE LABEL KIND IS NOT THE BLOCK TYPE.** `is_caption_line` returns `algorithm` and `listing`,
which are not block types — an "Algorithm 1" caption attaches to a block typed `figure` or
`table`. Keying the index on the printed label rather than on `Block.type` is therefore the only
thing that resolves "see Algorithm 1" at all, and it is why this module does not filter targets
by type.

AMBIGUITY IS DROPPED, NEVER GUESSED

Two floats captioned "Figure 3" (an appendix duplicate, or a caption mis-attached upstream) make
"Figure 3" unresolvable, and no edge is emitted. `references.py` and `citations.py` both state
the same rule for the same reason: a plausible link is worse than none, because nothing
downstream would question it.

WHAT THIS DELIBERATELY DOES NOT DO

Ranges and lists — "Figures 2-4", "Tables 1 and 2" — resolve only their FIRST number. Extending
the pattern is easy; deciding whether "2-4" means three edges or one is a convention question,
and inventing an answer would put an unreviewed convention into the relations array. Counted and
reported in the PR rather than silently half-handled.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from papertree_document_worker.figures import is_caption_line

if TYPE_CHECKING:  # pragma: no cover - types only
    from papertree_document_worker.assemble import AssembledBlock

__all__ = [
    "REFERENCES_RELATION",
    "FloatLink",
    "apply_payload_mirrors",
    "detect_float_references",
    "float_label_index",
]

REFERENCES_RELATION = "references"

#: THE SCHEMA IS ASYMMETRIC HERE AND IT IS NOT A TYPO — enumerated from `models.py`, not assumed:
#:
#:     EquationPayload   referenced_by ✓   caption_block ✗   (equations are numbered, not captioned)
#:     FigurePayload     referenced_by ✓   caption_block ✓
#:     TablePayload      referenced_by ✗   caption_block ✓
#:
#: `_Model` forbids extra keys, so writing `referenced_by` onto a table is a pydantic
#: `extra_forbidden` ValidationError at `Paper` construction — which is exactly what happened the
#: first time this ran, on four blocks. **The relation is still emitted for tables**: `references`
#: has no such restriction and it is the authoritative side, so "which text refers to Table 2" is
#: answerable from `relations` even though the table carries no mirror. The mirror is a
#: convenience the schema chose not to provide there, and inventing it would mean editing
#: `TablePayload`, which is a schema change and not this PR's.
_REFERENCED_BY_PAYLOADS = frozenset({"figure", "equation"})
_CAPTION_BLOCK_PAYLOADS = frozenset({"figure", "table"})

#: The blocks a callout may be found in. PROSE ONLY, and the exclusions are load-bearing:
#: `caption` is excluded because a caption opens with its own label and would otherwise
#: reference its own float 142 times; `reference_entry` because a bibliography entry's "Fig. 3"
#: belongs to the cited work, not this one.
_PROSE_TYPES = frozenset({"paragraph", "abstract", "footnote", "list_item"})

#: `Figure 3` · `Fig. 3` · `Table 1` · `Eq. (3)` · `Equation A.1` · `Algorithm 2` · `Listing 4`.
#: The number alternation is deliberately the SAME shape as `figures._CAPTION_START`'s, because
#: a callout that cannot express a label the caption parser can produce is unresolvable by
#: construction. Session B widened that one to reach appendix labels (`Figure G.2`, #102) and
#: this inherits the widening rather than re-deriving it.
_CALLOUT = re.compile(
    r"\b(figures?|figs?\.|figs?\b|tables?|equations?|eqs?\.|eqs?\b|algorithms?|listings?)"
    r"\s*\(?\s*"
    r"([0-9]+(?:\.[0-9]+)*|[A-Z]\.?[0-9]+(?:\.[0-9]+)*)"
    r"\s*\)?",
    re.IGNORECASE,
)

_KIND_ALIASES = {
    "fig": "figure",
    "figs": "figure",
    "figure": "figure",
    "figures": "figure",
    "eq": "equation",
    "eqs": "equation",
    "equation": "equation",
    "equations": "equation",
    "table": "table",
    "tables": "table",
    "algorithm": "algorithm",
    "algorithms": "algorithm",
    "listing": "listing",
    "listings": "listing",
}


def _normalise_kind(raw: str) -> str | None:
    return _KIND_ALIASES.get(raw.strip().rstrip(".").lower())


@dataclass(frozen=True, slots=True)
class FloatLink:
    """One resolved callout: `source` refers to `target`, by the printed label `label`."""

    source: AssembledBlock
    target: AssembledBlock
    label: str
    #: `"caption-label"` for figures/tables/algorithms/listings, `"equation-number"` for
    #: equations. Carried onto the relation's `provenance` so the two mechanisms stay separable
    #: in the emitted IR — they have different denominators and must never be reported as one
    #: rate (#111's composite-denominator defect).
    mechanism: str


def float_label_index(
    blocks: list[AssembledBlock],
    caption_edges: list[tuple[AssembledBlock, AssembledBlock]],
) -> dict[tuple[str, str], AssembledBlock | None]:
    """`("figure", "3") -> the float block`, or `None` where the label is AMBIGUOUS.

    A `None` value is not the same as an absent key: it records that the label was printed twice
    and is therefore unresolvable, which is why collisions are stored rather than dropped. A
    caller that used `.get(key)` alone would silently treat "ambiguous" as "unknown".
    """
    index: dict[tuple[str, str], AssembledBlock | None] = {}

    def offer(key: tuple[str, str], block: AssembledBlock) -> None:
        if key in index and index[key] is not block:
            index[key] = None  # collision: printed twice, resolvable to neither
        elif key not in index:
            index[key] = block

    for caption, target in caption_edges:
        parsed = is_caption_line(caption.text or "")
        if parsed is None:
            continue
        offer((parsed[0], parsed[1]), target)

    for block in blocks:
        if block.type != "equation" or not block.payload:
            continue
        number = block.payload.get("equation_number")
        if isinstance(number, str) and number:
            offer(("equation", number), block)

    return index


def detect_float_references(
    blocks: list[AssembledBlock],
    caption_edges: list[tuple[AssembledBlock, AssembledBlock]],
) -> list[FloatLink]:
    """Every in-prose callout that resolves to a float, in document order.

    MUST RUN AFTER `PaperBuilder.assign_ids()` — not because the edges would be dropped (they
    would not; `relate` stores block OBJECTS and `build()` re-runs `assign_ids`, measured in
    `citations.detect_citations`) but because `apply_payload_mirrors` writes `block_id` STRINGS
    into payloads, and before ids exist those are `""`, which fails the schema's `BlockId`
    pattern. The failure is LOUD, which is the point.
    """
    index = float_label_index(blocks, caption_edges)
    if not index:
        return []

    targets = {id(block) for block in index.values() if block is not None}
    links: list[FloatLink] = []
    seen: set[tuple[int, int]] = set()

    for block in blocks:
        if block.type not in _PROSE_TYPES or not block.text:
            continue
        # A float's own nested content is prose-typed but belongs to the float; a paragraph
        # inside Figure 3 saying "3" is not a callout to itself.
        if id(block) in targets or (block.parent is not None and id(block.parent) in targets):
            continue
        for match in _CALLOUT.finditer(block.text):
            kind = _normalise_kind(match.group(1))
            if kind is None:
                continue
            target = index.get((kind, match.group(2)))
            if target is None or target is block:
                continue
            key = (id(block), id(target))
            if key in seen:
                continue
            seen.add(key)
            links.append(
                FloatLink(
                    source=block,
                    target=target,
                    label=f"{kind} {match.group(2)}",
                    mechanism="equation-number" if kind == "equation" else "caption-label",
                )
            )
    return links


def apply_payload_mirrors(
    caption_edges: list[tuple[AssembledBlock, AssembledBlock]],
    reference_links: list[FloatLink],
) -> tuple[int, int]:
    """Mirror the two authoritative relations into their denormalised payload fields.

    Returns `(caption_block_set, referenced_by_set)` so the caller can assert the counts rather
    than trust them. **Every value written here is read off an edge that was emitted** — see the
    module docstring: the relations array is authoritative and this is its mirror, never a second
    derivation.
    """
    captions = 0
    for caption, target in caption_edges:
        # Rule: `caption_block` must name a block of type `caption`. `caption_of` already
        # guarantees it (rule 22 constrains BOTH ends), so this is an assertion of a fact rather
        # than a filter — but it is cheap and it is the kind of invariant that stops being true
        # quietly.
        if caption.type != "caption" or not caption.block_id:
            continue
        if target.type not in _CAPTION_BLOCK_PAYLOADS:
            continue
        if target.payload is None:
            target.payload = {}
        target.payload["caption_block"] = caption.block_id
        captions += 1

    by_target: dict[int, tuple[AssembledBlock, list[str]]] = {}
    for link in reference_links:
        if not link.source.block_id:
            continue
        entry = by_target.setdefault(id(link.target), (link.target, []))
        if link.source.block_id not in entry[1]:
            entry[1].append(link.source.block_id)

    referenced = 0
    for target, source_ids in by_target.values():
        if not source_ids:
            continue  # `min_length=1`: an empty array is not a valid encoding, omit instead
        if target.type not in _REFERENCED_BY_PAYLOADS:
            continue
        if target.payload is None:
            target.payload = {}
        target.payload["referenced_by"] = source_ids
        referenced += 1

    return captions, referenced
