"""An IMAGE anchor's validator, re-exported from the db package (v0.3 #348).

The module is ``papertree_db.image_anchor`` (read its docstring for what an image anchor is): the
board's node writer in the db package needs the same ``image_box`` the request models and the image
run use, and the db package cannot import this one.
"""

from __future__ import annotations

from papertree_db.image_anchor import (
    IMAGE_TARGET_KINDS,
    MAX_COORD_PT,
    BBox,
    block_id_of,
    image_box,
    is_image_anchor,
)

__all__ = [
    "IMAGE_TARGET_KINDS",
    "MAX_COORD_PT",
    "BBox",
    "block_id_of",
    "image_box",
    "is_image_anchor",
]
