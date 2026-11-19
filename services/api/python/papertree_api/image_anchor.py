"""An IMAGE anchor: what "select a figure or a region and ask about it" is made of (v0.3 #348).

It is an ordinary Anchor v1 (``contracts/anchor/anchor-v1.schema.json``), told apart by its target
kind and holding no words:

    targetKind   ``figure``         a whole float (figure, diagram, plot, table, algorithm), with a
                                    ``BlockSelector`` naming its block when the capture knows it
                 ``figure_region``  a free rectangle of a page
    selectors    ``PageSelector``   the page, 0-based (``index``)
                 ``ShapeSelector``  the page again (``pageIndex``) and ONE quad
                                    ``[x0, y0, x1, y1]``: the rectangle in the page's PDF space
                                    (PyMuPDF's: points, origin top-left, the space of every IR
                                    ``bbox``)

No ``TextQuoteSelector`` is needed (a rectangle has no words); ``papertree_db.highlights`` accepts
such an anchor for a highlight, and a board ``excerpt`` node carries one as its ``source_anchor``.
This module is pure (no I/O, no database) so the request models can use it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Final

#: The target kinds of an image anchor (the same set ``papertree_db.highlights`` relaxes).
IMAGE_TARGET_KINDS: Final = frozenset({"figure", "figure_region"})

BBox = tuple[float, float, float, float]


def is_image_anchor(anchor: Mapping[str, Any] | None) -> bool:
    """Whether ``anchor`` is an image anchor by its target kind (its shape is ``image_box``'s)."""
    return anchor is not None and anchor.get("targetKind") in IMAGE_TARGET_KINDS


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value


def image_box(anchor: Mapping[str, Any]) -> tuple[int, BBox]:
    """``(page_index, (x0, y0, x1, y1))`` of an image anchor.

    ``ValueError`` (naming what is wrong) when it is not one: not a ``figure`` or ``figure_region``,
    no page, no ``ShapeSelector`` with exactly one quad, a quad that is not four finite numbers, or
    one with no area. A rectangle drawn backwards (x1 < x0) is not repaired: the web sends it
    normalised.
    """
    if not is_image_anchor(anchor):
        raise ValueError("anchor.targetKind: an image anchor is a figure or a figure_region")
    selectors = [s for s in anchor.get("selectors", ()) if isinstance(s, Mapping)]
    shapes = [s for s in selectors if s.get("type") == "ShapeSelector"]
    pages = [s for s in selectors if s.get("type") == "PageSelector"]
    if len(shapes) != 1:
        raise ValueError("anchor.selectors: an image anchor holds exactly one ShapeSelector")
    shape = shapes[0]
    quads = shape.get("quads")
    if not isinstance(quads, list) or len(quads) != 1:
        raise ValueError("anchor.selectors: the ShapeSelector holds exactly one quad (the box)")
    quad = quads[0]
    if not (isinstance(quad, list) and len(quad) == 4 and all(_is_number(v) for v in quad)):
        raise ValueError("anchor.selectors: the quad is four numbers [x0, y0, x1, y1]")
    x0, y0, x1, y1 = (float(v) for v in quad)
    if not (x1 > x0 and y1 > y0):
        raise ValueError("anchor.selectors: the quad has no area (x1 > x0 and y1 > y0)")
    page = shape.get("pageIndex")
    if not isinstance(page, int) or isinstance(page, bool) or page < 0:
        raise ValueError("anchor.selectors: the ShapeSelector's pageIndex is a page number from 0")
    if len(pages) != 1 or pages[0].get("index") != page:
        raise ValueError("anchor.selectors: one PageSelector on the same page as the ShapeSelector")
    return page, (x0, y0, x1, y1)


def block_id_of(anchor: Mapping[str, Any]) -> str | None:
    """The float block an image anchor names (a ``BlockSelector``), when it does."""
    for selector in anchor.get("selectors", ()):
        if isinstance(selector, Mapping) and selector.get("type") == "BlockSelector":
            block_id = selector.get("blockId")
            if isinstance(block_id, str) and block_id:
                return block_id
    return None
