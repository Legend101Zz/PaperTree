"""F1.4 - headings, sections and the page furniture that must never become either.

findings.md B6 is the defect, measured: outline sizes of 42 (Attention), 81 (BERT), 58 (ResNet)
and **193** (Shannon) against real section counts of 7-25. What was being promoted to "heading":

  * section numbers split from their titles - `'1'`, `'Introduction'`, `'2'`, `'Background'`
    as **separate** blocks;
  * the arXiv margin stamp, on every arXiv paper;
  * diagram interior labels (`'T[SEP]'`, `'E[CLS]'`, `'BERT'`);
  * table cells (`'0.24 M'`, `'O(1)'`);
  * author and affiliation lines (`'Kaiming He'`, `'Microsoft Research'`).

Three of those five are already gone before this module runs, which is why it can be small:
`layout.py` routes the margin stamp to `flow: "margin"` and running heads to `header`/`footer`,
and `figures.py` claims diagram interiors. This module owns the remaining two - **joining a
split number to its title**, and **not promoting the author block**.

NUMBERING FIRST, FONT SECOND, AND NEVER FONT ALONE

A numbered heading is nearly unambiguous: `1`, `1.1`, `A.`, `IV.` at the start of a short line.
Font size is the fallback for unnumbered headings (`Abstract`, `References`, `Acknowledgements`)
and is only trusted **relative to the page's own body size**, because a two-column paper's body
is ~10 pt and a single-column one's ~12 pt, so no absolute threshold transfers.

Font alone is never sufficient. The author line on a title page is larger than the body too,
and that is exactly how `'Kaiming He'` became a heading.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from statistics import median

from papertree_document_worker.layout import LayoutBlock, PageLayout

__all__ = [
    "Heading",
    "SectionNode",
    "build_sections",
    "detect_headings",
    "parse_section_number",
]

#: `1`, `1.2`, `1.2.3`, `A`, `A.1`, `IV` - optionally followed by `.` or `)`, then the title.
#: The title group is what makes joining possible: MuPDF frequently returns the number and the
#: title as separate spans on one line, and sometimes as separate LINES.
_NUMBERED = re.compile(
    r"^\s*(?P<number>(?:\d+|[A-Z]|[IVXL]+)(?:\.\d+)*)\s*[.)]?\s+(?P<title>\S.*)$"
)
#: A bare number on its own line - the left half of the `'1'` / `'Introduction'` split.
_BARE_NUMBER = re.compile(r"^\s*(?P<number>(?:\d+|[A-Z]|[IVXL]+)(?:\.\d+)*)\s*[.)]?\s*$")
#: Unnumbered headings that every paper has. Matched case-insensitively on the whole line.
_NAMED_HEADINGS = frozenset(
    {
        "abstract",
        "introduction",
        "background",
        "related work",
        "method",
        "methods",
        "methodology",
        "experiments",
        "results",
        "discussion",
        "conclusion",
        "conclusions",
        "references",
        "bibliography",
        "acknowledgements",
        "acknowledgments",
        "appendix",
        "supplementary material",
    }
)

#: A heading is short. Longer than this many characters and it is a paragraph that happens to
#: start with a number - a numbered list item, or `2015 was the year that ...`.
MAX_HEADING_CHARS = 120
#: A heading must be at least this much larger than the body to qualify on font alone.
HEADING_SIZE_RATIO = 1.12
#: An `@` or a URL makes a line an author/affiliation line, never a heading. findings.md B6
#: records `'Illia Polosukhin* illia.polosukhin@gmail.com'` being promoted.
_CONTACT = re.compile(r"[@]|https?://|\bdoi\b", re.IGNORECASE)
#: ...or bold at body size, which is how most `\subsubsection` is set.
_BOLD_FLAG = 1 << 4


@dataclass(frozen=True, slots=True)
class Heading:
    block: LayoutBlock
    #: `"3.1"` when numbered, else `None`.
    number: str | None
    #: The title WITHOUT its number, which is what a reader wants to see.
    title: str
    #: 1 for a top-level section, 2 for `1.1`, and so on. Unnumbered headings are level 1.
    level: int

    @property
    def is_numbered(self) -> bool:
        return self.number is not None


@dataclass(slots=True)
class SectionNode:
    """A section as `packages/document-ir` models it - which has NO title and NO path.

    `Section` is exactly `{heading_block_id, level, block_ids}` plus `parent_heading_block_id`
    when `level > 1`. The display title IS the heading block's text, by construction, which is
    what makes an LLM-invented section title unrepresentable (findings.md C3). The anchor-schema
    prose in `synthesis-10` shows a `path` and a `headingText`; **neither exists**, and a
    consumer written against that document matches nothing.
    """

    heading_block: LayoutBlock
    level: int
    parent_heading_block: LayoutBlock | None
    member_blocks: list[LayoutBlock]


def parse_section_number(text: str) -> tuple[str, str] | None:
    """`("3.1", "Deep Residual Learning")` from `"3.1 Deep Residual Learning"`, else `None`."""
    match = _NUMBERED.match(text)
    if not match:
        return None
    number = match.group("number")
    title = match.group("title").strip()
    # `2015 was a good year` parses as number=2015; a heading's title does not start lowercase
    # and a real section number is rarely above 99.
    if number.isdigit() and int(number) > 99:
        return None
    return number, title


def _level_of(number: str) -> int:
    return number.count(".") + 1


def _is_bare_number(text: str) -> str | None:
    match = _BARE_NUMBER.match(text)
    if not match:
        return None
    number = match.group("number")
    if number.isdigit() and int(number) > 99:
        return None
    return number


def _is_name_list(text: str) -> bool:
    """Whether a line is a list of proper nouns - an author or affiliation line.

    THE GUARD THAT MUST APPLY TO NUMBERED HEADINGS TOO, which is what an earlier draft got
    wrong. Author lines carry SUPERSCRIPT AFFILIATION MARKERS, and those parse as section
    numbers: `1Shaoqing Ren` became `number="1", title="Shaoqing Ren"` and was emitted as
    section 1. Applying this only on the font path let every author through the other one.

    A heading contains at least one lower-case function word (`of`, `for`, `and`, `with`);
    `Deep Residual Learning for Image Recognition` has `for`. A name list has none.
    """
    if _CONTACT.search(text):
        return True
    words = [w for w in text.split() if w[:1].isalpha()]
    if len(words) < 2:
        return False
    return all(w[:1].isupper() for w in words)


def _looks_like_heading_by_font(block: LayoutBlock, body_size: float) -> bool:
    spans = [span for line in block.lines for span in line.spans]
    if not spans:
        return False
    size = median([span.size for span in spans])
    if size >= HEADING_SIZE_RATIO * body_size:
        return True
    return bool(spans[0].flags & _BOLD_FLAG) and size >= body_size * 0.98


def detect_headings(layout: PageLayout, body_size: float) -> list[Heading]:
    """Headings on one page, with split number/title pairs already joined.

    THE JOIN IS THE POINT. findings.md B6 records `'1'` and `'Introduction'` emitted as separate
    headings on every paper. When a block is a bare number and the block that follows it is a
    plausible title, they are one heading - and the number is carried in `Heading.number` rather
    than glued into the title, so a reader can render either.
    """
    body = [b for b in layout.blocks if b.flow == "body"]
    headings: list[Heading] = []
    skip: set[int] = set()

    for index, block in enumerate(body):
        if index in skip:
            continue
        text = " ".join(line.text for line in block.lines).strip()
        if not text or len(text) > MAX_HEADING_CHARS:
            continue

        # 1. `1 Introduction` on one line.
        parsed = parse_section_number(text)
        if parsed is not None and _looks_like_heading_by_font(block, body_size):
            number, title = parsed
            if not _is_name_list(title):
                headings.append(Heading(block, number, title, _level_of(number)))
                continue

        # 2. `1` alone, with `Introduction` in the next block. THE B6 JOIN.
        bare = _is_bare_number(text)
        if bare is not None and index + 1 < len(body):
            following = body[index + 1]
            title = " ".join(line.text for line in following.lines).strip()
            if (
                title
                and len(title) <= MAX_HEADING_CHARS
                and not title[0].islower()
                and not _is_name_list(title)
            ):
                headings.append(Heading(block, bare, title, _level_of(bare)))
                skip.add(index + 1)
                continue

        # 3. A named heading every paper has, or a short line set larger than the body.
        lowered = text.lower().rstrip(".:")
        if lowered in _NAMED_HEADINGS:
            headings.append(Heading(block, None, text, 1))
            continue
        if _looks_like_heading_by_font(block, body_size) and len(text) <= 60:
            # The author-line guard. findings.md B6: `'Kaiming He'` and `'Microsoft Research'`
            # are larger than the body on a title page and were promoted. A heading is not a
            # list of proper nouns, so a line that is ENTIRELY capitalised words with no
            # lower-case function word is rejected.
            if _is_name_list(text):
                continue
            headings.append(Heading(block, None, text, 1))

    return headings


def build_sections(headings: list[Heading], body_blocks: list[LayoutBlock]) -> list[SectionNode]:
    """Materialise the section view over a document's headings, in reading order.

    Front matter is deliberately **section-less**: blocks before the first heading belong to no
    section, which is DESIGN.md's stated design (`Section` rule 21 and the §3.3 note) rather
    than an omission. A paper's `title` block legitimately opens the outermost section when one
    is detected.
    """
    if not headings:
        return []

    order = {id(block): index for index, block in enumerate(body_blocks)}
    ordered = sorted(headings, key=lambda h: order.get(id(h.block), 0))

    sections: list[SectionNode] = []
    stack: list[SectionNode] = []
    for position, heading in enumerate(ordered):
        while stack and stack[-1].level >= heading.level:
            stack.pop()
        node = SectionNode(
            heading_block=heading.block,
            level=heading.level,
            parent_heading_block=stack[-1].heading_block if stack else None,
            member_blocks=[],
        )
        # Members run from just after this heading to just before the next one, whatever its
        # level - a subsection's blocks belong to the subsection, not to its parent.
        start = order.get(id(heading.block), 0) + 1
        end = (
            order.get(id(ordered[position + 1].block), len(body_blocks))
            if position + 1 < len(ordered)
            else len(body_blocks)
        )
        node.member_blocks = [
            block for block in body_blocks[start:end] if id(block) != id(heading.block)
        ]
        sections.append(node)
        stack.append(node)
    return sections
