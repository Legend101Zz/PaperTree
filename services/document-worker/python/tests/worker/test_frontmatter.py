"""`frontmatter.py` — the four types nothing used to emit, and the guards that keep it safe."""

from __future__ import annotations

from typing import Any

import pytest
from papertree_document_worker.assemble import AssembledBlock
from papertree_document_worker.frontmatter import classify_front_matter


def _block(
    kind: str,
    text: str,
    y0: float,
    y1: float,
    x0: float = 100.0,
    x1: float = 400.0,
    size: float = 10.0,
    page: int = 0,
    flow: str = "body",
) -> AssembledBlock:
    """A block with `line_bands` set and `bbox` EMPTY, exactly as it is before `assign_ids()`.

    The span is the IR's `Span` - `start`/`end`/`bbox`/`size` - not the worker's richer
    `pdf.Span`. `AssembledBlock.spans` carries the IR type, and only `size` is read here.
    """
    from papertree_document_ir import Span

    span = Span(start=0, end=len(text), bbox=[x0, y0, x1, y1], size=size, font="Times")
    return AssembledBlock(
        type=kind,
        page_index=page,
        flow=flow,  # type: ignore[arg-type]
        line_bands=[[x0, y0, x1, y1]],
        text=text,
        spans=(span,),
    )


def _applied(blocks: list[AssembledBlock], body_size: float = 10.0) -> dict[str, list[str]]:
    """Run the classifier and return `{new_type: [texts]}`."""
    out: dict[str, list[str]] = {}
    for retype in classify_front_matter(blocks, body_size):
        out.setdefault(retype.new_type, []).append(retype.block.text or "")
    return out


TITLE = _block("paragraph", "Attention Is All You Need", 150.0, 166.0, size=17.2)


class TestTitle:
    def test_the_largest_row_near_the_top_becomes_the_title(self) -> None:
        result = _applied([_block("paragraph", "Attention Is All You Need", 150, 166, size=17.2)])
        assert result["title"] == ["Attention Is All You Need"]

    def test_a_heading_may_be_promoted_to_title(self) -> None:
        """`resnet-cvpr-2col` verbatim: `hierarchy.py`'s font rule types its title `heading`.

        Excluding headings cost that paper its ENTIRE front matter, because no title row was
        found and the author rows below it were therefore never reached. Rule 21 accepts a
        section pointing at either type, so this is a promotion, not a downgrade.
        """
        result = _applied([_block("heading", "Deep Residual Learning", 107, 120, size=14.35)])
        assert result["title"] == ["Deep Residual Learning"]

    def test_body_sized_text_is_not_a_title(self) -> None:
        assert _applied([_block("paragraph", "Ordinary prose", 150, 166, size=10.0)]) == {}

    def test_a_paragraph_of_prose_is_not_a_title_however_large(self) -> None:
        assert _applied([_block("paragraph", "x" * 250, 150, 166, size=17.2)]) == {}

    def test_a_caption_is_never_promoted(self) -> None:
        assert _applied([_block("caption", "Figure 1: something", 150, 166, size=17.2)]) == {}


class TestAuthorsAndAffiliations:
    def test_the_row_below_the_title_is_the_authors(self) -> None:
        result = _applied([TITLE, _block("paragraph", "Kaiming He", 200, 212)])
        assert result["author"] == ["Kaiming He"]

    def test_the_row_after_that_is_the_affiliation(self) -> None:
        result = _applied(
            [
                TITLE,
                _block("paragraph", "Kaiming He", 200, 212),
                _block("paragraph", "Microsoft Research", 230, 242),
            ]
        )
        assert result["affiliation"] == ["Microsoft Research"]

    def test_a_four_across_grid_is_one_author_row(self) -> None:
        row = [
            _block("paragraph", name, 200, 212, x0=x, x1=x + 60)
            for x, name in ((100.0, "A One"), (200.0, "B Two"), (300.0, "C Three"))
        ]
        assert sorted(_applied([TITLE, *row])["author"]) == ["A One", "B Two", "C Three"]

    def test_the_first_row_is_authors_even_carrying_an_email(self) -> None:
        """`neural-odes-mathheavy` groups its author line and its e-mail line into one block.

        A contact test on the first row types that paper's ONLY author row `affiliation` and
        leaves it with no authors at all - which is what the first version of this did.
        """
        result = _applied(
            [TITLE, _block("paragraph", "Ricky T. Q. Chen\n{rtqichen}@cs.toronto.edu", 200, 212)]
        )
        assert "author" in result

    def test_a_later_row_with_an_affiliation_marker_is_authors_again(self) -> None:
        """`attention`'s second and third author rows, which a first-row-only rule mistypes."""
        result = _applied(
            [
                TITLE,
                _block("paragraph", "Ashish Vaswani∗", 200, 212),
                _block("paragraph", "Google Brain", 230, 242),
                _block("paragraph", "Llion Jones∗", 260, 272),
            ]
        )
        assert result["author"] == ["Ashish Vaswani∗", "Llion Jones∗"]
        assert result["affiliation"] == ["Google Brain"]

    def test_an_email_row_is_affiliation_not_an_author(self) -> None:
        result = _applied(
            [
                TITLE,
                _block("paragraph", "Ashish Vaswani∗", 200, 212),
                _block("paragraph", "avaswani@google.com", 230, 242),
            ]
        )
        assert result["affiliation"] == ["avaswani@google.com"]

    def test_attribution_stops_at_the_abstract(self) -> None:
        result = _applied(
            [
                TITLE,
                _block("paragraph", "Kaiming He", 200, 212),
                _block("heading", "Abstract", 230, 242),
                _block("paragraph", "Deeper networks are harder to train.", 250, 262),
            ]
        )
        assert "Deeper networks are harder to train." not in result.get("affiliation", [])


class TestAbstract:
    BODY = [
        _block("heading", "Abstract", 230, 242),
        _block("paragraph", "Deeper networks are harder to train.", 250, 262),
    ]

    def test_prose_under_the_abstract_heading_is_the_abstract(self) -> None:
        assert _applied(self.BODY)["abstract"] == ["Deeper networks are harder to train."]

    def test_the_heading_itself_stays_a_heading(self) -> None:
        """Rule 21 needs a section's `heading_block_id` to name a `heading` or `title`."""
        assert "Abstract" not in _applied(self.BODY).get("abstract", [])

    def test_the_next_heading_closes_it(self) -> None:
        result = _applied(
            [
                *self.BODY,
                _block("heading", "1 Introduction", 270, 282),
                _block("paragraph", "Deep networks have led to breakthroughs.", 290, 302),
            ]
        )
        assert result["abstract"] == ["Deeper networks are harder to train."]

    def test_a_large_gap_closes_it(self) -> None:
        """`attention`'s next heading is on the NEXT PAGE, so the gap rule is what stops it.

        Without it the abstract ran through the contribution note, the affiliation footnotes and
        the NeurIPS venue line, all of which sit below it on page 0.
        """
        result = _applied([*self.BODY, _block("paragraph", "31st Conference on NeurIPS", 300, 312)])
        assert result["abstract"] == ["Deeper networks are harder to train."]

    def test_a_footnote_marker_closes_it(self) -> None:
        result = _applied([*self.BODY, _block("paragraph", "∗Equal contribution.", 264, 276)])
        assert result["abstract"] == ["Deeper networks are harder to train."]

    @pytest.mark.parametrize("kind", ["caption", "figure", "table", "equation"])
    def test_a_stronger_detector_is_never_overruled(self, kind: str) -> None:
        """The `resnet` crash: the abstract sweep retyped a `caption` and rule 22 rejected it.

        The crash was the lucky case - swallowing a `figure` or a `table` breaks no rule and
        would have produced a quietly worse document instead of a stack trace.
        """
        result = _applied([*self.BODY, _block(kind, "Figure 1. Training error", 264, 276)])
        assert "Figure 1. Training error" not in result.get("abstract", [])


def test_nothing_outside_page_zero_is_touched_by_the_attribution_pass() -> None:
    later: list[AssembledBlock] = [_block("paragraph", "Kaiming He", 200, 212, page=3)]
    assert _applied([TITLE, *later]).get("author") is None


def test_geometry_is_read_before_assign_ids_populates_bbox() -> None:
    """Every input here has `bbox == []`, which is its real state at the call site.

    The first version read `bbox`, got `[]` for every block, collapsed the page into a single
    row and never found a title. `line_bands` is the geometry that exists at this point.
    """
    blocks: list[Any] = [TITLE, _block("paragraph", "Kaiming He", 200, 212)]
    assert all(block.bbox == [] for block in blocks)
    assert _applied(blocks)["author"] == ["Kaiming He"]
