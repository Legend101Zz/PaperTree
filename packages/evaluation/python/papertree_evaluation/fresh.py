"""Score a PaperIR document against the S2 fresh-set gold: pages 1-2, ANCHOR units, not boxes.

`research/benchmarks/fresh/gold-pp12.json` (slice-plan §S2, #141) was written from page images by
two model annotators and an adjudicator; **owner review is pending** (#54), so every number this
module produces is provisional and is printed with that n. Its unit is an ANCHOR - the first
printed words of a paragraph, heading or front-matter group - so this scorer finds each anchor in
the parser's own text and asks what the parser did with the block it landed in. There is no IoU.

WHAT IT MEASURES, PER PAPER (slice-plan §S2 "Per-paper table")

  merged paragraphs   gold paragraphs (a `body` unit plus its `cont` units) whose anchors land in
                      a block holding ANOTHER gold paragraph's anchor. The user-visible defect: a
                      highlight or a citation on that block covers several paragraphs. Reported
                      under BOTH readings of the open owner ruling on `cont` after a display
                      equation (`alt_kind: "body"`).
  mistyped body       gold body/cont units whose block is not typed as prose (`paragraph`,
                      `list`, `list_item`; `abstract` inside the Abstract section only).
  headings            gold headings found in a `heading`/`title` block, over gold headings; and
                      FALSE headings - heading-typed blocks on pp1-2 matching no gold heading,
                      run-in heading or front unit.
  title first         the title's anchor is the first found unit in the parser's reading order.
  pairwise order      over pairs of found units on the same page, the share the parser orders as
                      gold does, pooled (agree / pairs), within page.
  caption pairing     gold captions found in a `caption` block with a `caption_of` edge to a float
                      of the kind its printed label names (the regex-label proxy).

HOW ANCHORS ARE FOUND, AND WHAT THAT CANNOT SEE

The document is linearised in the parser's reading order: page by page, `Page.flows` in the order
body, caption, footnote, header, footer, margin, each block followed by the blocks nested in it
(table cells excepted). Text is normalised to lower-case ASCII letters and digits only, after NFKC,
so hyphenation, ligatures, whitespace, small caps and inline-math glyphs do not decide a match -
the gold's own conventions (`_provenance.conventions`) ask for case-insensitive, substring, fuzzy
matching. An anchor is searched on its own gold page only, and a match at the START of a block is
preferred to one inside a block, so a short heading like "Abstract" is not found inside a word of
the title. This is agent C's matcher (`proposal-C-evidence/scripts/score.py`) with that preference
added; the S2 report re-measures the baseline commit with THIS scorer on THIS gold rather than
quoting C's numbers, because the gold changed (the gold README says so).

An anchor the matcher cannot find is reported as missing, never scored as a merge or a mistype.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any

__all__ = [
    "FRESH_GOLD",
    "FreshScore",
    "load_fresh_gold",
    "linearise",
    "normalise_anchor",
    "render_fresh_report",
    "score_fresh_paper",
]

REPO = Path(__file__).resolve().parents[4]
FRESH_GOLD = REPO / "research" / "benchmarks" / "fresh" / "gold-pp12.json"
FRESH_PDFS = REPO / "research" / "benchmarks" / "fresh" / "pdfs"

#: What every row carries, because the n belongs in the row, not in a footnote (AGENTS.md §4).
PROVENANCE_NOTE = "2 model annotators + adjudicator, owner review pending"

#: Block types a printed paragraph may honestly be.
PROSE_TYPES = frozenset({"paragraph", "list", "list_item"})
HEADING_TYPES = frozenset({"heading", "title"})
#: Block types that are not running text, so never expected to start at a gold `order` unit.
NOT_RUNNING_TEXT = frozenset(
    {
        "figure",
        "table",
        "table_row",
        "table_cell",
        "equation",
        "caption",
        "footnote",
        "page_number",
        "header",
        "footer",
        "margin_note",
        "reference_entry",
    }
)
#: The float a caption's printed label names, and the IR types that honour it. `algorithm` has no
#: IR float type of its own; the parser emits pseudocode floats as figures or tables.
LABEL_KINDS: dict[str, frozenset[str]] = {
    "figure": frozenset({"figure", "diagram", "plot"}),
    "table": frozenset({"table"}),
    "algorithm": frozenset({"figure", "table", "algorithm"}),
}
_FLOWS = ("body", "caption", "footnote", "header", "footer", "margin")
_NUMERIC_ONLY = re.compile(r"^[\s\d.,:;%±+\-−–()×x*/]+$")


def normalise_anchor(text: str) -> str:
    """Lower-case ASCII letters and digits only, after NFKC. See the module docstring."""
    folded = unicodedata.normalize("NFKC", text or "").casefold()
    return re.sub(r"[^a-z0-9]", "", folded)


def is_numeric_only(text: str) -> bool:
    """A heading that is only digits and punctuation (`66.4`, `830`, `(3)`) is a table value or
    an equation number, never a section title."""
    stripped = (text or "").strip()
    return bool(stripped) and bool(_NUMERIC_ONLY.match(stripped))


@dataclass(frozen=True, slots=True)
class Item:
    """One block in the parser's reading order."""

    page: int  # 1-based, as the gold writes pages
    type: str
    flow: str
    text: str
    block_id: str
    start: int  # offset of this block's normalised text in the stream


@dataclass(slots=True)
class Found:
    unit: int
    item: int
    position: int


@dataclass(slots=True)
class FreshScore:
    paper: str
    units: int = 0
    found: int = 0
    missing: list[str] = field(default_factory=list)
    #: Units whose anchor runs across two or more of the parser's blocks.
    split_anchors: list[str] = field(default_factory=list)
    #: Running-text blocks on pp1-2 that start at no gold unit: fragments (over-segmentation).
    unanchored_prose: list[str] = field(default_factory=list)
    #: Gold paragraphs (body + its conts) under each reading of the `cont`-after-display ruling.
    paragraphs: dict[str, int] = field(default_factory=dict)
    merged_paragraphs: dict[str, int] = field(default_factory=dict)
    #: Parser blocks holding two or more gold paragraphs, per reading.
    merged_blocks: dict[str, int] = field(default_factory=dict)
    #: Any gold units (front, heading, paragraph) sharing a block - agent C's original count.
    merged_units: int = 0
    body_units: int = 0
    mistyped: list[tuple[str, str]] = field(default_factory=list)
    headings_gold: int = 0
    headings_typed: int = 0
    false_headings: list[str] = field(default_factory=list)
    numeric_headings_whole_paper: list[str] = field(default_factory=list)
    title_first: bool = False
    pairs: int = 0
    pairs_agree: int = 0
    captions_gold: int = 0
    captions_paired: int = 0
    caption_detail: list[str] = field(default_factory=list)

    @property
    def pairwise(self) -> float | None:
        return self.pairs_agree / self.pairs if self.pairs else None


def load_fresh_gold(path: Path = FRESH_GOLD) -> dict[str, Any]:
    gold: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return gold


def linearise(document: dict[str, Any]) -> list[Item]:
    """Every block, in the parser's reading order, with its offset in one normalised stream."""
    by_id = {b["block_id"]: b for b in document.get("blocks") or []}
    items: list[Item] = []
    cursor = 0

    def emit(block: dict[str, Any]) -> None:
        nonlocal cursor
        text = block.get("text") or ""
        items.append(
            Item(
                page=int(block["page_index"]) + 1,
                type=str(block.get("type")),
                flow=str(block.get("flow")),
                text=text,
                block_id=str(block["block_id"]),
                start=cursor,
            )
        )
        cursor += len(normalise_anchor(text)) + 1  # +1 for the separator
        if block.get("type") not in ("table", "table_row"):
            for child in block.get("child_ids") or []:
                if child in by_id:
                    emit(by_id[child])

    for page in sorted(document.get("pages") or [], key=lambda p: p["index"]):
        flows = page.get("flows") or {}
        for flow in _FLOWS:
            for block_id in flows.get(flow) or []:
                if block_id in by_id:
                    emit(by_id[block_id])
    return items


def _stream(items: Sequence[Item]) -> str:
    return "".join(normalise_anchor(item.text) + "|" for item in items)


def _find(
    anchor: str, page: int, items: Sequence[Item], stream: str
) -> tuple[int, int, bool] | None:
    """(item index, stream position, spans blocks) of `anchor` on `page`.

    In order of preference: a match at the START of a block; a match inside one block; a match
    that runs ACROSS consecutive blocks of the page's stream (the parser split the anchor's own
    words - a title broken over two blocks, a section number split from its title, a paragraph
    cut after its first sentence). The last kind is assigned to the block it STARTS in and flagged,
    because it is a segmentation fact about the parser, not a missing unit.
    """
    needle = normalise_anchor(anchor)
    if not needle:
        return None
    on_page = [i for i, item in enumerate(items) if item.page == page]
    for index in on_page:
        item = items[index]
        if stream.startswith(needle, item.start):
            return index, item.start, False
    for index in on_page:
        item = items[index]
        end = item.start + len(normalise_anchor(item.text))
        position = stream.find(needle, item.start, end)
        if position >= 0:
            return index, position, False
    # Across blocks: the page's normalised text with the separators removed, mapped back.
    joined: list[str] = []
    owner: list[tuple[int, int]] = []  # per character: (item index, stream position)
    for index in on_page:
        item = items[index]
        text = normalise_anchor(item.text)
        joined.append(text)
        owner.extend((index, item.start + offset) for offset in range(len(text)))
    at = "".join(joined).find(needle)
    if at < 0:
        return None
    return owner[at][0], owner[at][1], True


def _paragraph_ids(order: Sequence[Sequence[Any]], alt: bool) -> list[int | None]:
    """Gold paragraph id per unit: a `body` opens one, a `cont` continues it, everything else is
    not a paragraph. Under `alt`, a unit carrying `alt_kind` takes that kind instead."""
    out: list[int | None] = []
    current = -1
    for unit in order:
        kind = str(unit[1])
        extras = unit[3] if len(unit) > 3 and isinstance(unit[3], dict) else {}
        if alt and "alt_kind" in extras:
            kind = str(extras["alt_kind"])
        if kind == "body":
            current += 1
            out.append(current)
        elif kind == "cont" and current >= 0:
            out.append(current)
        else:
            out.append(None)
    return out


def score_fresh_paper(paper: str, document: dict[str, Any], gold: dict[str, Any]) -> FreshScore:
    entry = gold[paper]
    order: list[list[Any]] = [list(u) for u in entry["order"]]
    items = linearise(document)
    stream = _stream(items)
    score = FreshScore(paper=paper, units=len(order))

    found: list[Found | None] = []
    for index, unit in enumerate(order):
        page, _kind, anchor = int(unit[0]), str(unit[1]), str(unit[2])
        hit = _find(anchor, page, items, stream)
        if hit is None:
            found.append(None)
            score.missing.append(f"p{page} {unit[1]}: {anchor[:50]}")
        else:
            found.append(Found(unit=index, item=hit[0], position=hit[1]))
            if hit[2]:
                score.split_anchors.append(f"p{page} {unit[1]}: {anchor[:50]}")
    score.found = sum(f is not None for f in found)

    # OVER-SEGMENTATION, which anchors alone cannot see: a rule that cut every line into its own
    # block would score zero merges. Every running-text block in the body flow of pp1-2 should
    # START at a gold unit; one that does not is a fragment - of a paragraph that began in another
    # block, of an equation, of a figure's labels. Counted whatever the parser TYPED it, so that
    # retyping a fragment (a false heading `T` becoming a paragraph) moves nothing.
    starts = {f.position for f in found if f is not None}
    for item in items:
        running = item.page in (1, 2) and item.flow == "body" and item.type not in NOT_RUNNING_TEXT
        if running and normalise_anchor(item.text) and item.start not in starts:
            score.unanchored_prose.append(item.text.strip()[:40])

    # Merges, under both readings of the open `cont`-after-display ruling.
    for reading, alt in (("gold", False), ("alt_kind", True)):
        pids = _paragraph_ids(order, alt)
        score.paragraphs[reading] = len({p for p in pids if p is not None})
        per_item: dict[int, set[int]] = {}
        for f, pid in zip(found, pids, strict=True):
            if f is not None and pid is not None:
                per_item.setdefault(f.item, set()).add(pid)
        merged = [pids_ for pids_ in per_item.values() if len(pids_) > 1]
        score.merged_blocks[reading] = len(merged)
        score.merged_paragraphs[reading] = len({p for group in merged for p in group})

    unit_ids: dict[int, set[int]] = {}
    unit_of = _paragraph_ids(order, alt=False)
    for index, f in enumerate(found):
        if f is None:
            continue
        # A non-paragraph unit (front, heading) is its own unit, keyed apart from every pid.
        pid = unit_of[index]
        unit_ids.setdefault(f.item, set()).add(pid if pid is not None else 10_000 + index)
    score.merged_units = sum(len(v) for v in unit_ids.values() if len(v) > 1)

    # Types.
    in_abstract = False
    for index, unit in enumerate(order):
        kind, anchor = str(unit[1]), str(unit[2])
        if kind == "heading":
            in_abstract = normalise_anchor(anchor) == "abstract"
        if kind not in ("body", "cont"):
            continue
        score.body_units += 1
        f = found[index]
        if f is None:
            continue
        block_type = items[f.item].type
        allowed = PROSE_TYPES | ({"abstract"} if in_abstract else frozenset())
        if block_type not in allowed:
            score.mistyped.append((anchor[:40], block_type))

    headings = [i for i, u in enumerate(order) if u[1] == "heading"]
    score.headings_gold = len(headings)
    score.headings_typed = sum(
        1 for i in headings if (f := found[i]) is not None and items[f.item].type in HEADING_TYPES
    )
    known = [normalise_anchor(str(u[2])) for u in order if u[1] in ("heading", "front")] + [
        normalise_anchor(str(r[1] if isinstance(r, list) else r))
        for r in entry.get("run_in_headings") or []
    ]
    for item in items:
        if item.page not in (1, 2) or item.type != "heading":
            continue
        text = normalise_anchor(item.text)
        if not any(k and (k in text or (len(text) >= 4 and text in k)) for k in known):
            score.false_headings.append(item.text.strip()[:40])
    score.numeric_headings_whole_paper = [
        item.text.strip() for item in items if item.type == "heading" and is_numeric_only(item.text)
    ]

    fronts = [i for i, u in enumerate(order) if u[1] == "front"]
    if fronts and (title := found[fronts[0]]) is not None:
        score.title_first = all(title.position <= f.position for f in found if f is not None)

    for left, right in combinations(range(len(order)), 2):
        a, b = found[left], found[right]
        if a is None or b is None or order[left][0] != order[right][0]:
            continue
        score.pairs += 1
        score.pairs_agree += a.position < b.position

    relations = [
        (r.get("type"), r.get("from"), r.get("to")) for r in document.get("relations") or []
    ]
    type_of = {b["block_id"]: b.get("type") for b in document.get("blocks") or []}
    for caption in entry.get("floats") or []:
        page, anchor, kind = int(caption[0]), str(caption[2]), str(caption[3])
        score.captions_gold += 1
        hit = _find(anchor, page, items, stream)
        if hit is None:
            score.caption_detail.append(f"p{page} {anchor[:30]}: not found")
            continue
        item = items[hit[0]]
        targets = [
            type_of.get(t)
            for kind_, s, t in relations
            if kind_ == "caption_of" and s == item.block_id
        ]
        ok = item.type == "caption" and any(
            t in LABEL_KINDS.get(kind, frozenset()) for t in targets
        )
        score.captions_paired += ok
        if not ok:
            score.caption_detail.append(
                f"p{page} {anchor[:30]}: typed {item.type}, caption_of -> {targets or 'none'}"
            )
    return score


def _row(label: str, rows: Sequence[FreshScore]) -> str:
    """One table row over `rows` - a single paper, or all of them pooled."""

    def total(get: Any) -> int:
        return sum(int(get(s)) for s in rows)

    agree, pairs = total(lambda s: s.pairs_agree), total(lambda s: s.pairs)
    pairwise = f"{agree / pairs:.3f} ({agree}/{pairs})" if pairs else "-"
    title = (
        ("yes" if rows[0].title_first else "no")
        if len(rows) == 1
        else f"{total(lambda s: s.title_first)}/{len(rows)}"
    )
    cells = [
        label,
        f"{total(lambda s: s.units)} ({total(lambda s: s.found)})",
        f"{total(lambda s: s.merged_paragraphs['gold'])} of {total(lambda s: s.paragraphs['gold'])}"
        f" / {total(lambda s: s.merged_paragraphs['alt_kind'])} of "
        f"{total(lambda s: s.paragraphs['alt_kind'])}",
        str(total(lambda s: s.merged_blocks["gold"])),
        str(total(lambda s: len(s.split_anchors))),
        str(total(lambda s: len(s.unanchored_prose))),
        f"{total(lambda s: len(s.mistyped))} of {total(lambda s: s.body_units)}",
        f"{total(lambda s: s.headings_typed)}/{total(lambda s: s.headings_gold)}",
        str(total(lambda s: len(s.false_headings))),
        str(total(lambda s: len(s.numeric_headings_whole_paper))),
        title,
        pairwise,
        f"{total(lambda s: s.captions_paired)}/{total(lambda s: s.captions_gold)}",
        PROVENANCE_NOTE,
    ]
    return "| " + " | ".join(cells) + " |"


def render_fresh_report(scores: Iterable[FreshScore]) -> str:
    """One markdown table: a row per paper and a pooled row, EVERY row carrying its n and its
    provenance (`AGENTS.md` §4: the n belongs in the row, not in a footnote)."""
    rows = list(scores)
    header = (
        "| paper | n units (found) | merged paragraphs gold / alt_kind (of n) | merged blocks | "
        "split anchors | unanchored prose blocks | mistyped body (of n) | headings typed / gold | "
        "false headings pp1-2 | numeric headings (whole paper) | title first | "
        "pairwise within page | captions paired | gold |"
    )
    lines = [header, "|" + "---|" * 14]
    lines.extend(_row(score.paper, [score]) for score in rows)
    if rows:
        lines.append(_row("**pooled**", rows))
    return "\n".join(lines)
