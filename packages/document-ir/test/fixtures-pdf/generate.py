#!/usr/bin/env python3
"""Generate the synthetic geometry fixtures and `conformance/geometry-vectors.json`.

    cd "<repo>" && uv run --python 3.12 --with pymupdf python \
        packages/document-ir/test/fixtures-pdf/generate.py

WHY THIS EXISTS. ADR-001 Amendment 1 section C.6 / H.2 records a measured fact: all 8 corpus PDFs
have /Rotate 0, no CropBox offset, no /UserUnit and no negative coordinates. The whole normalisation
path is therefore a NO-OP on 100% of the real corpus and is completely untested by it - while the
cost of getting the frame wrong was measured at 99.93% of block ids (perturbation P9). These
fixtures are the missing coverage, and they are committed WITH this script so they are reproducible
rather than mystery binaries.

WHAT IS AN ORACLE HERE, stated honestly, because a test that grades an implementation against itself
grades nothing:

  * `expected` on every fixture marker comes from MUPDF, not from `geometry.ts`/`geometry.py`. Each
    fixture carries marker rectangles painted by a RAW PDF content stream (`x y w h re f`), i.e.
    coordinates that entered the file in raw PDF user space with no library between. They are read
    back with `page.get_drawings()` and mapped into IR space with MuPDF's own `rotation_matrix`.
    That is a second, independently-implemented coordinate pipeline.
  * `expected` on every `normalisation_vector`, `viewport_vector`, `polygon_vector`,
    `intersection_vector` and `line_union_vector` is a HAND-COMPUTED literal in this file, with the
    arithmetic shown in the comment above it. Nothing in those tables is produced by running the
    code under test.

Two MuPDF facts this script pins, both of which are traps (see `geometry.ts` module header):
  1. `page.rect` and every coordinate `get_drawings()` returns ARE pre-multiplied by /UserUnit.
     Amendment 1's stated rationale for "UserUnit is not applied" ("it is what MuPDF's page.rect
     gives") is therefore factually wrong; the RULE still stands, but a parser must divide it out.
  2. `page.rotation_matrix` is NOT scaled by /UserUnit. Divide the drawing coordinates by
     /UserUnit BEFORE applying it, or the two disagree by exactly that factor.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pymupdf

HERE = Path(__file__).resolve().parent
PKG = HERE.parents[1]
VECTORS = PKG / "conformance" / "geometry-vectors.json"

CONTRACT_VERSION = "papertree/geometry/1.0.0"
FIXED_PDF_ID = b"5041504552545245474D545930303031"  # "PAPERTREEGMTY0001", 16 bytes of hex

# --------------------------------------------------------------------------------------------
# 1. the fixture PDFs
# --------------------------------------------------------------------------------------------

# Each marker is a rectangle emitted into the content stream as raw PDF user space `x y w h re f`.
# Markers are kept inside the crop box so that MuPDF does not clip them away.
Fixture = dict[str, Any]

FIXTURES: list[Fixture] = [
    {
        "file": "rotate-0.pdf",
        "why": "the baseline: /Rotate 0, CropBox == MediaBox, no /UserUnit. Matches 100% of the "
        "real corpus, so it is the case that proves the fixtures agree with reality.",
        "media_box": [0, 0, 200, 300],
        "crop_box": None,
        "rotate": 0,
        "user_unit": None,
        "markers": [[20, 250, 40, 20], [100, 200, 20, 30], [150, 20, 40, 40]],
    },
    {
        "file": "rotate-90.pdf",
        "why": "/Rotate 90. The corpus has none; P9 measured the cost of a wrong frame at 99.93%.",
        "media_box": [0, 0, 200, 300],
        "crop_box": None,
        "rotate": 90,
        "user_unit": None,
        "markers": [[20, 250, 40, 20], [100, 200, 20, 30], [150, 20, 40, 40]],
    },
    {
        "file": "rotate-180.pdf",
        "why": "/Rotate 180.",
        "media_box": [0, 0, 200, 300],
        "crop_box": None,
        "rotate": 180,
        "user_unit": None,
        "markers": [[20, 250, 40, 20], [100, 200, 20, 30], [150, 20, 40, 40]],
    },
    {
        "file": "rotate-270.pdf",
        "why": "/Rotate 270.",
        "media_box": [0, 0, 200, 300],
        "crop_box": None,
        "rotate": 270,
        "user_unit": None,
        "markers": [[20, 250, 40, 20], [100, 200, 20, 30], [150, 20, 40, 40]],
    },
    {
        "file": "cropbox-offset.pdf",
        "why": "a CropBox strictly inside the MediaBox with a non-zero origin - the case DESIGN.md "
        "D23 exists for, and the one that silently offsets every polygon when unhandled.",
        "media_box": [0, 0, 612, 792],
        "crop_box": [72, 90, 540, 720],
        "rotate": 0,
        "user_unit": None,
        "markers": [[72, 700, 100, 20], [300, 400, 40, 30], [500, 100, 40, 20]],
    },
    {
        "file": "userunit.pdf",
        "why": "/UserUnit 2.5. The stored frame must be IDENTICAL to the same page without it "
        "(Amendment 1 pins UserUnit out of the id frame); only the viewport scale changes.",
        "media_box": [0, 0, 200, 300],
        "crop_box": None,
        "rotate": 0,
        "user_unit": 2.5,
        "markers": [[20, 250, 40, 20], [100, 200, 20, 30], [150, 20, 40, 40]],
    },
    {
        "file": "negative-mediabox.pdf",
        "why": "a MediaBox with negative coordinates. The corpus has zero negative coordinates; "
        "the normalised origin must be the crop rect's own corner, not (0, 0).",
        "media_box": [-100, -50, 300, 400],
        "crop_box": None,
        "rotate": 0,
        "user_unit": None,
        "markers": [[-100, 380, 60, 20], [0, 0, 40, 40], [240, -50, 60, 30]],
    },
    {
        "file": "cropbox-outside-mediabox.pdf",
        "why": "a CropBox that escapes the MediaBox. PDF 1.7 14.11.2 says the visible page is the "
        "INTERSECTION; a reader that trusts the CropBox verbatim gets the page size wrong.",
        "media_box": [0, 0, 200, 300],
        "crop_box": [-200, -100, 400, 500],
        "rotate": 0,
        "user_unit": None,
        "markers": [[20, 250, 40, 20], [100, 200, 20, 30]],
    },
    {
        "file": "combined.pdf",
        "why": "all four at once: negative MediaBox, offset CropBox, /Rotate 270, /UserUnit 1.5. "
        "This is where implementations break, so it is the one that must be in the suite.",
        "media_box": [-100, -50, 300, 400],
        "crop_box": [-40, 10, 260, 330],
        "rotate": 270,
        "user_unit": 1.5,
        "markers": [[-40, 310, 60, 20], [100, 160, 30, 20], [200, 10, 60, 30]],
    },
]


def _pdf_box(values: list[float]) -> str:
    return "[ " + " ".join(f"{v:g}" for v in values) + " ]"


def build_pdf(fx: Fixture) -> bytes:
    """Write the page dictionary keys DIRECTLY.

    PyMuPDF's `set_cropbox` takes MuPDF top-left coordinates and writes a FLIPPED /CropBox, which is
    exactly the kind of hidden convention this library exists to pin down. Setting the raw keys
    means the bytes in the file are the numbers in the table above.
    """
    media = fx["media_box"]
    doc = pymupdf.open()
    page = doc.new_page(width=media[2] - media[0], height=media[3] - media[1])
    doc.xref_set_key(page.xref, "MediaBox", _pdf_box(media))
    if fx["crop_box"] is not None:
        doc.xref_set_key(page.xref, "CropBox", _pdf_box(fx["crop_box"]))
    doc.xref_set_key(page.xref, "Rotate", str(fx["rotate"]))
    if fx["user_unit"] is not None:
        doc.xref_set_key(page.xref, "UserUnit", f"{fx['user_unit']:g}")

    ops = ["q", "0 0 0 rg"]
    for x, y, w, h in fx["markers"]:
        ops.append(f"{x:g} {y:g} {w:g} {h:g} re f")
    ops.append("Q")
    stream = (" ".join(ops)).encode("ascii")

    xref = doc.get_new_xref()
    doc.update_object(xref, "<<>>")
    doc.update_stream(xref, stream)
    doc.xref_set_key(page.xref, "Contents", f"{xref} 0 R")
    doc.set_metadata({})  # deterministic bytes: no creation date, no producer drift
    raw = bytes(doc.tobytes(garbage=4, deflate=False, clean=True))
    # The trailer /ID is randomised per write - and MuPDF spells the random bytes as a hex string
    # <..> or as a literal string (..) depending on what they contain, so the pattern must not
    # assume hex. Pin it, so re-running this script is a no-op in git and the recorded sha256 is a
    # real integrity check rather than noise. The trailer sits AFTER the xref table and startxref
    # points at the table, so changing its length moves no recorded offset.
    pinned, count = re.subn(
        rb"/ID\s*\[.*?\]>>",
        b"/ID[<" + FIXED_PDF_ID + b"><" + FIXED_PDF_ID + b">]>>",
        raw,
        flags=re.DOTALL,
    )
    if count != 1:
        raise AssertionError(f"expected exactly one trailer /ID to pin, found {count}")
    return pinned


def mupdf_oracle(pdf_bytes: bytes, user_unit: float) -> dict[str, Any]:
    """Read the markers back through MuPDF's OWN coordinate pipeline.

    `get_drawings()` returns unrotated, crop-box-relative, top-left coordinates PRE-MULTIPLIED by
    /UserUnit; `page.rotation_matrix` is NOT scaled. So: divide by /UserUnit first, then rotate.
    """
    doc = pymupdf.open("pdf", pdf_bytes)
    page = doc[0]
    rects: list[list[float]] = []
    for drawing in page.get_drawings():
        r = pymupdf.Rect(drawing["rect"]) / user_unit
        r = r * page.rotation_matrix
        r.normalize()
        rects.append([round(v, 9) + 0.0 for v in (r.x0, r.y0, r.x1, r.y1)])
    raw_rect = page.rect
    return {
        "page_rect_as_mupdf_reports_it": [round(v, 9) + 0.0 for v in raw_rect],
        "page_size": [
            round(raw_rect.width / user_unit, 9) + 0.0,
            round(raw_rect.height / user_unit, 9) + 0.0,
        ],
        "marker_bboxes": rects,
    }


# --------------------------------------------------------------------------------------------
# 2. hand-computed tables
# --------------------------------------------------------------------------------------------

# Every `expected` below is arithmetic done by hand; the working is in the comment. None of it comes
# from geometry.ts or geometry.py.
#
#   u = raw_x - crop.x0            v = crop.y1 - raw_y
#   rot   0  (x, y) = (u, v)             page = cw x ch
#   rot  90  (x, y) = (ch - v, u)        page = ch x cw
#   rot 180  (x, y) = (cw - u, ch - v)   page = cw x ch
#   rot 270  (x, y) = (v, cw - u)        page = ch x cw

PAGE_FRAMES: list[dict[str, Any]] = [
    {
        # crop = [72, 90, 540, 720] -> cw = 468, ch = 630. rot 0 -> page 468 x 630.
        # media corners: (0,0)   -> u=-72, v=720 -> (-72, 720)
        #                (612,792) -> u=540, v=-72 -> (540, -72)   extent [-72,-72,540,720]
        "label": "frame:letter-cropped-rot0",
        "raw": {
            "media_box": [0, 0, 612, 792],
            "crop_box": [72, 90, 540, 720],
            "rotate": 0,
            "user_unit": 1,
        },
        "frame": {
            "width": 468,
            "height": 630,
            "rotation": 0,
            "user_unit": 1,
            "crop_box": [0, 0, 468, 630],
            "media_box": [-72, -72, 540, 720],
            "source_crop_box": [72, 90, 540, 720],
        },
    },
    {
        # same crop, rot 90 -> page ch x cw = 630 x 468.
        # media (0,0):   u=-72, v=720 -> (630-720, -72) = (-90, -72)
        # media (612,792): u=540, v=-72 -> (630+72, 540) = (702, 540)  extent [-90,-72,702,540]
        "label": "frame:letter-cropped-rot90",
        "raw": {
            "media_box": [0, 0, 612, 792],
            "crop_box": [72, 90, 540, 720],
            "rotate": 90,
            "user_unit": 1,
        },
        "frame": {
            "width": 630,
            "height": 468,
            "rotation": 90,
            "user_unit": 1,
            "crop_box": [0, 0, 630, 468],
            "media_box": [-90, -72, 702, 540],
            "source_crop_box": [72, 90, 540, 720],
        },
    },
    {
        # rot 180 -> page 468 x 630.
        # media (0,0):     (468-(-72), 630-720) = (540, -90)
        # media (612,792): (468-540, 630-(-72)) = (-72, 702)   extent [-72,-90,540,702]
        "label": "frame:letter-cropped-rot180",
        "raw": {
            "media_box": [0, 0, 612, 792],
            "crop_box": [72, 90, 540, 720],
            "rotate": 180,
            "user_unit": 1,
        },
        "frame": {
            "width": 468,
            "height": 630,
            "rotation": 180,
            "user_unit": 1,
            "crop_box": [0, 0, 468, 630],
            "media_box": [-72, -90, 540, 702],
            "source_crop_box": [72, 90, 540, 720],
        },
    },
    {
        # rot 270 -> page 630 x 468.
        # media (0,0):     (720, 468-(-72)) = (720, 540)
        # media (612,792): (-72, 468-540)   = (-72, -72)   extent [-72,-72,720,540]
        "label": "frame:letter-cropped-rot270",
        "raw": {
            "media_box": [0, 0, 612, 792],
            "crop_box": [72, 90, 540, 720],
            "rotate": 270,
            "user_unit": 1,
        },
        "frame": {
            "width": 630,
            "height": 468,
            "rotation": 270,
            "user_unit": 1,
            "crop_box": [0, 0, 630, 468],
            "media_box": [-72, -72, 720, 540],
            "source_crop_box": [72, 90, 540, 720],
        },
    },
    {
        # negative media box, no crop box -> crop defaults to media. cw = 400, ch = 450.
        "label": "frame:negative-mediabox",
        "raw": {"media_box": [-100, -50, 300, 400], "crop_box": None, "rotate": 0, "user_unit": 1},
        "frame": {
            "width": 400,
            "height": 450,
            "rotation": 0,
            "user_unit": 1,
            "crop_box": [0, 0, 400, 450],
            "media_box": [0, 0, 400, 450],
            "source_crop_box": [-100, -50, 300, 400],
        },
    },
    {
        # /UserUnit 2.5 changes NOTHING in this frame. That is the whole point (Amendment 1).
        "label": "frame:userunit-2.5",
        "raw": {"media_box": [0, 0, 200, 300], "crop_box": None, "rotate": 0, "user_unit": 2.5},
        "frame": {
            "width": 200,
            "height": 300,
            "rotation": 0,
            "user_unit": 2.5,
            "crop_box": [0, 0, 200, 300],
            "media_box": [0, 0, 200, 300],
            "source_crop_box": [0, 0, 200, 300],
        },
    },
    {
        # CropBox escaping the MediaBox: PDF 1.7 14.11.2 -> the visible page is the intersection.
        "label": "frame:cropbox-outside-mediabox",
        "raw": {
            "media_box": [0, 0, 200, 300],
            "crop_box": [-200, -100, 400, 500],
            "rotate": 0,
            "user_unit": 1,
        },
        "frame": {
            "width": 200,
            "height": 300,
            "rotation": 0,
            "user_unit": 1,
            "crop_box": [0, 0, 200, 300],
            "media_box": [0, 0, 200, 300],
            "source_crop_box": [0, 0, 200, 300],
        },
    },
    {
        # corners written in the "wrong" order; PDF permits it and a viewer must cope.
        "label": "frame:reversed-corners",
        "raw": {
            "media_box": [612, 792, 0, 0],
            "crop_box": [540, 720, 72, 90],
            "rotate": 0,
            "user_unit": 1,
        },
        "frame": {
            "width": 468,
            "height": 630,
            "rotation": 0,
            "user_unit": 1,
            "crop_box": [0, 0, 468, 630],
            "media_box": [-72, -72, 540, 720],
            "source_crop_box": [72, 90, 540, 720],
        },
    },
    {
        # /Rotate given as -90: PDF permits any multiple of 90. -90 mod 360 = 270.
        "label": "frame:rotate-negative-90",
        "raw": {"media_box": [0, 0, 200, 300], "crop_box": None, "rotate": -90, "user_unit": 1},
        "frame": {
            "width": 300,
            "height": 200,
            "rotation": 270,
            "user_unit": 1,
            "crop_box": [0, 0, 300, 200],
            "media_box": [0, 0, 300, 200],
            "source_crop_box": [0, 0, 200, 300],
        },
    },
    {
        # all four hazards at once. crop = [-40,10,260,330] -> cw = 300, ch = 320. rot 270 ->
        # page 320 x 300. media (-100,-50): u=-60, v=380 -> (380, 300+60) = (380, 360)
        #                 media (300,400):  u=340, v=-70 -> (-70, 300-340) = (-70, -40)
        "label": "frame:combined",
        "raw": {
            "media_box": [-100, -50, 300, 400],
            "crop_box": [-40, 10, 260, 330],
            "rotate": 270,
            "user_unit": 1.5,
        },
        "frame": {
            "width": 320,
            "height": 300,
            "rotation": 270,
            "user_unit": 1.5,
            "crop_box": [0, 0, 320, 300],
            "media_box": [-70, -40, 380, 360],
            "source_crop_box": [-40, 10, 260, 330],
        },
    },
]

NORMALISATION_VECTORS: list[dict[str, Any]] = [
    # frame:letter-cropped-rot0, crop [72,90,540,720], cw=468 ch=630
    {
        "label": "norm:rot0:crop-top-left",
        "frame": "frame:letter-cropped-rot0",
        "raw_point": [72, 720],
        "expected": [0, 0],
        "why": "the crop box's top-left corner IS the IR origin (u=0, v=720-720=0)",
    },
    {
        "label": "norm:rot0:crop-bottom-right",
        "frame": "frame:letter-cropped-rot0",
        "raw_point": [540, 90],
        "expected": [468, 630],
        "why": "u=468, v=720-90=630",
    },
    {
        "label": "norm:rot0:centre",
        "frame": "frame:letter-cropped-rot0",
        "raw_point": [306, 405],
        "expected": [234, 315],
        "why": "u=234, v=315",
    },
    {
        "label": "norm:rot0:outside-crop-origin",
        "frame": "frame:letter-cropped-rot0",
        "raw_point": [0, 0],
        "expected": [-72, 720],
        "why": "the PDF origin is OUTSIDE the crop box: u=-72, v=720. Not clamped.",
    },
    # rot 90: (ch - v, u)
    {
        "label": "norm:rot90:crop-top-left",
        "frame": "frame:letter-cropped-rot90",
        "raw_point": [72, 720],
        "expected": [630, 0],
        "why": "u=0,v=0 -> (630-0, 0). Rotating clockwise sends the top-left to the top-right.",
    },
    {
        "label": "norm:rot90:crop-bottom-right",
        "frame": "frame:letter-cropped-rot90",
        "raw_point": [540, 90],
        "expected": [0, 468],
        "why": "u=468,v=630 -> (630-630, 468)",
    },
    {
        "label": "norm:rot90:centre",
        "frame": "frame:letter-cropped-rot90",
        "raw_point": [306, 405],
        "expected": [315, 234],
        "why": "u=234,v=315 -> (630-315, 234)",
    },
    {
        "label": "norm:rot90:outside-crop-origin",
        "frame": "frame:letter-cropped-rot90",
        "raw_point": [0, 0],
        "expected": [-90, -72],
        "why": "u=-72,v=720 -> (630-720, -72)",
    },
    # rot 180: (cw - u, ch - v)
    {
        "label": "norm:rot180:crop-top-left",
        "frame": "frame:letter-cropped-rot180",
        "raw_point": [72, 720],
        "expected": [468, 630],
        "why": "u=0,v=0 -> (468, 630)",
    },
    {
        "label": "norm:rot180:crop-bottom-right",
        "frame": "frame:letter-cropped-rot180",
        "raw_point": [540, 90],
        "expected": [0, 0],
        "why": "u=468,v=630 -> (0, 0)",
    },
    {
        "label": "norm:rot180:centre",
        "frame": "frame:letter-cropped-rot180",
        "raw_point": [306, 405],
        "expected": [234, 315],
        "why": "u=234,v=315 -> (234, 315)",
    },
    # rot 270: (v, cw - u)
    {
        "label": "norm:rot270:crop-top-left",
        "frame": "frame:letter-cropped-rot270",
        "raw_point": [72, 720],
        "expected": [0, 468],
        "why": "u=0,v=0 -> (0, 468-0)",
    },
    {
        "label": "norm:rot270:crop-bottom-right",
        "frame": "frame:letter-cropped-rot270",
        "raw_point": [540, 90],
        "expected": [630, 0],
        "why": "u=468,v=630 -> (630, 0)",
    },
    {
        "label": "norm:rot270:centre",
        "frame": "frame:letter-cropped-rot270",
        "raw_point": [306, 405],
        "expected": [315, 234],
        "why": "u=234,v=315 -> (315, 468-234)",
    },
    # negative media box, crop == media, cw=400 ch=450
    {
        "label": "norm:negative:crop-top-left",
        "frame": "frame:negative-mediabox",
        "raw_point": [-100, 400],
        "expected": [0, 0],
        "why": "u=0, v=400-400=0",
    },
    {
        "label": "norm:negative:crop-bottom-right",
        "frame": "frame:negative-mediabox",
        "raw_point": [300, -50],
        "expected": [400, 450],
        "why": "u=400, v=450",
    },
    {
        "label": "norm:negative:pdf-origin",
        "frame": "frame:negative-mediabox",
        "raw_point": [0, 0],
        "expected": [100, 400],
        "why": "u=0-(-100)=100, v=400-0=400",
    },
    # /UserUnit is NOT applied. Same numbers as if it were absent.
    {
        "label": "norm:userunit:top-left",
        "frame": "frame:userunit-2.5",
        "raw_point": [0, 300],
        "expected": [0, 0],
        "why": "/UserUnit 2.5 does not scale IR space",
    },
    {
        "label": "norm:userunit:interior",
        "frame": "frame:userunit-2.5",
        "raw_point": [100, 200],
        "expected": [100, 100],
        "why": "if this were [250,250] the impl applied /UserUnit - Amendment 1 forbids it",
    },
    # combined: crop [-40,10,260,330], cw=300 ch=320, rot 270 -> (v, cw-u)
    {
        "label": "norm:combined:crop-top-left",
        "frame": "frame:combined",
        "raw_point": [-40, 330],
        "expected": [0, 300],
        "why": "u=0,v=0 -> (0, 300-0)",
    },
    {
        "label": "norm:combined:crop-bottom-right",
        "frame": "frame:combined",
        "raw_point": [260, 10],
        "expected": [320, 0],
        "why": "u=300,v=320 -> (320, 300-300)",
    },
    {
        "label": "norm:combined:interior",
        "frame": "frame:combined",
        "raw_point": [110, 170],
        "expected": [160, 150],
        "why": "u=150,v=160 -> (160, 300-150)",
    },
    {
        "label": "norm:combined:outside-crop",
        "frame": "frame:combined",
        "raw_point": [-100, 400],
        "expected": [-70, 360],
        "why": "u=-60,v=-70 -> (-70, 300+60)",
    },
    # reversed corner order must produce the same frame and the same points as the ordered one.
    {
        "label": "norm:reversed-corners:crop-top-left",
        "frame": "frame:reversed-corners",
        "raw_point": [72, 720],
        "expected": [0, 0],
        "why": "corner order in the file is irrelevant",
    },
]

# raw rect -> IR bbox. Rotation exchanges corners, so the result is an EXTENT, not a corner map.
NORMALISE_RECT_VECTORS: list[dict[str, Any]] = [
    {
        "label": "rect:rot0",
        "frame": "frame:letter-cropped-rot0",
        "raw_rect": [100, 600, 200, 650],
        "expected": [28, 70, 128, 120],
        "why": "(100,600)->(28,120); (200,650)->(128,70); extent [28,70,128,120]",
    },
    {
        "label": "rect:rot90",
        "frame": "frame:letter-cropped-rot90",
        "raw_rect": [100, 600, 200, 650],
        "expected": [510, 28, 560, 128],
        "why": "(100,600)->u=28,v=120->(510,28); (200,650)->u=128,v=70->(560,128)",
    },
    {
        "label": "rect:rot270",
        "frame": "frame:letter-cropped-rot270",
        "raw_rect": [100, 600, 200, 650],
        "expected": [70, 340, 120, 440],
        "why": "(100,600)->(120,440); (200,650)->(70,340)",
    },
    {
        "label": "rect:combined",
        "frame": "frame:combined",
        "raw_rect": [0, 100, 60, 140],
        "expected": [190, 200, 230, 260],
        "why": "(0,100)->u=40,v=230->(230,260); (60,140)->u=100,v=190->(190,200)",
    },
]

# --------------------------------------------------------------------------------------------
# viewport: hand-computed. s = zoom * user_unit; W = page_width*s; H = page_height*s.
#   rot   0  (x,y) -> (x*s, y*s)          surface W x H
#   rot  90  (x,y) -> (H - y*s, x*s)      surface H x W
#   rot 180  (x,y) -> (W - x*s, H - y*s)  surface W x H
#   rot 270  (x,y) -> (y*s, W - x*s)      surface H x W
# --------------------------------------------------------------------------------------------

VIEWPORT_VECTORS: list[dict[str, Any]] = [
    # page 468 x 630, zoom 1, uu 1 -> s=1, W=468, H=630
    {
        "label": "vp:rot0:zoom1:origin",
        "page": [468, 630],
        "zoom": 1,
        "rotation": 0,
        "user_unit": 1,
        "surface": [468, 630],
        "pdf_point": [0, 0],
        "viewport_point": [0, 0],
    },
    {
        "label": "vp:rot0:zoom1:corner",
        "page": [468, 630],
        "zoom": 1,
        "rotation": 0,
        "user_unit": 1,
        "surface": [468, 630],
        "pdf_point": [468, 630],
        "viewport_point": [468, 630],
    },
    {
        "label": "vp:rot0:zoom2:interior",
        "page": [468, 630],
        "zoom": 2,
        "rotation": 0,
        "user_unit": 1,
        "surface": [936, 1260],
        "pdf_point": [100, 200],
        "viewport_point": [200, 400],
    },
    # rot 90: origin -> top-right of the surface
    {
        "label": "vp:rot90:zoom1:origin",
        "page": [468, 630],
        "zoom": 1,
        "rotation": 90,
        "user_unit": 1,
        "surface": [630, 468],
        "pdf_point": [0, 0],
        "viewport_point": [630, 0],
        "why": "H - 0 = 630, so the page's top-left lands on the surface's top-RIGHT",
    },
    {
        "label": "vp:rot90:zoom1:corner",
        "page": [468, 630],
        "zoom": 1,
        "rotation": 90,
        "user_unit": 1,
        "surface": [630, 468],
        "pdf_point": [468, 630],
        "viewport_point": [0, 468],
    },
    {
        "label": "vp:rot90:zoom0.5:interior",
        "page": [468, 630],
        "zoom": 0.5,
        "rotation": 90,
        "user_unit": 1,
        "surface": [315, 234],
        "pdf_point": [100, 200],
        "viewport_point": [215, 50],
        "why": "s=0.5: H=315, (315-100, 50)",
    },
    # rot 180
    {
        "label": "vp:rot180:zoom1:origin",
        "page": [468, 630],
        "zoom": 1,
        "rotation": 180,
        "user_unit": 1,
        "surface": [468, 630],
        "pdf_point": [0, 0],
        "viewport_point": [468, 630],
    },
    {
        "label": "vp:rot180:zoom4:interior",
        "page": [468, 630],
        "zoom": 4,
        "rotation": 180,
        "user_unit": 1,
        "surface": [1872, 2520],
        "pdf_point": [100, 200],
        "viewport_point": [1472, 1720],
        "why": "s=4: (1872-400, 2520-800)",
    },
    # rot 270: origin -> bottom-left of the surface
    {
        "label": "vp:rot270:zoom1:origin",
        "page": [468, 630],
        "zoom": 1,
        "rotation": 270,
        "user_unit": 1,
        "surface": [630, 468],
        "pdf_point": [0, 0],
        "viewport_point": [0, 468],
    },
    {
        "label": "vp:rot270:zoom1:corner",
        "page": [468, 630],
        "zoom": 1,
        "rotation": 270,
        "user_unit": 1,
        "surface": [630, 468],
        "pdf_point": [468, 630],
        "viewport_point": [630, 0],
    },
    # userUnit is applied HERE and only here. s = zoom * user_unit.
    {
        "label": "vp:userunit:rot0:zoom1",
        "page": [200, 300],
        "zoom": 1,
        "rotation": 0,
        "user_unit": 2.5,
        "surface": [500, 750],
        "pdf_point": [100, 100],
        "viewport_point": [250, 250],
        "why": "s = 1*2.5. The SAME point normalised to [100,100] in IR space (see "
        "norm:userunit:interior) renders at 250 - that is the whole UserUnit boundary.",
    },
    {
        "label": "vp:userunit:rot90:zoom2",
        "page": [200, 300],
        "zoom": 2,
        "rotation": 90,
        "user_unit": 2.5,
        "surface": [1500, 1000],
        "pdf_point": [100, 100],
        "viewport_point": [1000, 500],
        "why": "s=5: H=1500, (1500-500, 500)",
    },
    {
        "label": "vp:userunit:rot270:zoom0.25",
        "page": [200, 300],
        "zoom": 0.25,
        "rotation": 270,
        "user_unit": 1.5,
        "surface": [112.5, 75],
        "pdf_point": [200, 300],
        "viewport_point": [112.5, 0],
        "why": "s=0.375: W=75, H=112.5; (300*0.375, 75-200*0.375)",
    },
]

ROUNDTRIP_GRID: dict[str, Any] = {
    "zooms": [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8],
    "rotations": [0, 90, 180, 270],
    "user_units": [1, 2.5, 0.75],
    "pages": [[468, 630], [200, 300], [612, 792]],
    "points": [
        [0, 0],
        [468, 630],
        [0, 630],
        [468, 0],
        [234, 315],
        [1, 1],
        [-72, -90],
        [700, 900],
        [0.5, 0.25],
        [123.456789, 654.321],
    ],
    "max_abs_error_pt": 0.01,
    "why": "the named acceptance test: document-ir/geometry.spec. Points deliberately include the "
    "page corners AND points outside the crop box (negative, and beyond width/height) - a "
    "transform that only works inside the page is not a transform.",
}

# --------------------------------------------------------------------------------------------
# polygons: hand-computed
# --------------------------------------------------------------------------------------------

SQUARE = [[0, 0], [10, 0], [10, 10], [0, 10]]
# The staircase produced by highlighting two lines where the second is shorter. Area by bands:
#   100..127 x 54..292 -> 27 * 238 = 6426 ;  127..140 x 54..200 -> 13 * 146 = 1898 ; total 8324
STAIRCASE = [[292, 100], [292, 127], [200, 127], [200, 140], [54, 140], [54, 100]]

POLYGON_VECTORS: list[dict[str, Any]] = [
    {
        "label": "poly:square",
        "polygon": SQUARE,
        "extent": [0, 0, 10, 10],
        "area": 100,
        "signed_area": 100,
        "is_simple": True,
        "points": [
            {"point": [5, 5], "inside": True},
            {"point": [0, 0], "inside": True, "why": "boundary is INCLUSIVE by default"},
            {"point": [10, 5], "inside": True},
            {"point": [-0.0001, 5], "inside": False},
            {"point": [5, 10.0001], "inside": False},
            {"point": [11, 11], "inside": False},
        ],
    },
    {
        "label": "poly:staircase",
        "polygon": STAIRCASE,
        "extent": [54, 100, 292, 140],
        "area": 8324,
        "signed_area": 8324,
        "is_simple": True,
        "points": [
            {"point": [250, 110], "inside": True},
            {
                "point": [250, 135],
                "inside": False,
                "why": "the notch. A bounding box would say True - that is highlight bleed.",
            },
            {"point": [100, 135], "inside": True},
            {"point": [292, 100], "inside": True},
            {"point": [53.9, 120], "inside": False},
        ],
    },
    {
        "label": "poly:triangle",
        "polygon": [[0, 0], [10, 0], [0, 10]],
        "extent": [0, 0, 10, 10],
        "area": 50,
        "signed_area": 50,
        "is_simple": True,
        "points": [
            {"point": [1, 1], "inside": True},
            {"point": [6, 6], "inside": False},
            {"point": [5, 5], "inside": True, "why": "exactly on the hypotenuse"},
        ],
    },
    {
        "label": "poly:bowtie",
        "polygon": [[0, 0], [10, 10], [10, 0], [0, 10]],
        "extent": [0, 0, 10, 10],
        "area": 0,
        "signed_area": 0,
        "is_simple": False,
        "why": "self-intersecting: validator rule G6 WARNs on this and G6's area check ERRORs",
        "points": [{"point": [5, 5], "inside": True, "why": "the crossing point, on both edges"}],
    },
    {
        "label": "poly:counter-clockwise-square",
        "polygon": [[0, 0], [0, 10], [10, 10], [10, 0]],
        "extent": [0, 0, 10, 10],
        "area": 100,
        "signed_area": -100,
        "is_simple": True,
        "why": "reversing the ring flips the SIGN and leaves the absolute area alone",
        "points": [{"point": [5, 5], "inside": True}],
    },
    {
        "label": "poly:negative-coords",
        "polygon": [[-30, -20], [-10, -20], [-10, -5], [-30, -5]],
        "extent": [-30, -20, -10, -5],
        "area": 300,
        "signed_area": 300,
        "is_simple": True,
        "why": "IR space is not the positive quadrant - see media_box on a cropped page",
        "points": [{"point": [-20, -10], "inside": True}, {"point": [0, 0], "inside": False}],
    },
]

INTERSECTION_VECTORS: list[dict[str, Any]] = [
    {
        "label": "isect:two-columns",
        "a": [[54, 100], [292, 100], [292, 140], [54, 140]],
        "b": [[320, 100], [558, 100], [558, 140], [320, 140]],
        "intersects": False,
        "why": "THE case. Two column blocks on the same lines must not intersect.",
    },
    {
        "label": "isect:touching-edges",
        "a": [[0, 0], [10, 0], [10, 10], [0, 10]],
        "b": [[10, 0], [20, 0], [20, 10], [10, 10]],
        "intersects": True,
        "why": "boundary contact counts - stated so the two languages cannot disagree",
    },
    {
        "label": "isect:nested",
        "a": [[0, 0], [100, 0], [100, 100], [0, 100]],
        "b": [[10, 10], [20, 10], [20, 20], [10, 20]],
        "intersects": True,
        "why": "containment has no edge crossing; an edge-only test would answer False",
    },
    {
        "label": "isect:disjoint",
        "a": [[0, 0], [10, 0], [10, 10], [0, 10]],
        "b": [[50, 50], [60, 50], [60, 60], [50, 60]],
        "intersects": False,
    },
    {
        "label": "isect:staircase-notch",
        "a": STAIRCASE,
        "b": [[210, 130], [280, 130], [280, 138], [210, 138]],
        "intersects": False,
        "why": "the probe sits in the staircase's notch. Bounding boxes DO overlap here.",
    },
    {
        "label": "isect:staircase-hit",
        "a": STAIRCASE,
        "b": [[210, 110], [280, 110], [280, 118], [210, 118]],
        "intersects": True,
    },
    {
        "label": "isect:crossing-no-vertex-inside",
        "a": [[0, 4], [10, 4], [10, 6], [0, 6]],
        "b": [[4, 0], [6, 0], [6, 10], [4, 10]],
        "intersects": True,
        "why": "a plus sign: no vertex of either is inside the other, only edges cross",
    },
]

LINE_UNION_VECTORS: list[dict[str, Any]] = [
    {
        "label": "union:two-column-selection",
        "why": "THE named operation. A selection spanning both columns returns TWO polygons, so "
        "nothing is ever painted across the gutter (findings.md highlight bleed).",
        "rects": [
            [54, 100, 292, 112],
            [54, 114, 292, 126],
            [54, 128, 200, 140],
            [320, 100, 558, 112],
            [320, 114, 400, 126],
        ],
        "options": {"vertical_gap_tolerance": 2, "horizontal_overlap_tolerance": 0},
        # column 1: band edges 100, (112+114)/2=113, (126+128)/2=127, 140. The 113 vertices are
        # collinear with their neighbours on both sides and are dropped.
        # column 2: band edges 100, 113, 126.
        "polygons": [
            [[292, 100], [292, 127], [200, 127], [200, 140], [54, 140], [54, 100]],
            [[558, 100], [558, 113], [400, 113], [400, 126], [320, 126], [320, 100]],
        ],
    },
    {
        "label": "union:single-rect",
        "rects": [[10, 20, 30, 40]],
        "options": {"vertical_gap_tolerance": 2, "horizontal_overlap_tolerance": 0},
        "polygons": [[[30, 20], [30, 40], [10, 40], [10, 20]]],
        "why": "one line is a rectangle, wound clockwise on screen starting at the top-right",
    },
    {
        "label": "union:paragraph-gap-splits",
        "rects": [[54, 100, 292, 112], [54, 130, 292, 142]],
        "options": {"vertical_gap_tolerance": 2, "horizontal_overlap_tolerance": 0},
        "polygons": [
            [[292, 100], [292, 112], [54, 112], [54, 100]],
            [[292, 130], [292, 142], [54, 142], [54, 130]],
        ],
        "why": "an 18 pt vertical gap exceeds the 2 pt tolerance, so these are two regions",
    },
    {
        "label": "union:same-band-fragments-merge",
        "rects": [[54, 100, 150, 112], [140, 101, 292, 113]],
        "options": {"vertical_gap_tolerance": 2, "horizontal_overlap_tolerance": 0},
        "polygons": [[[292, 100], [292, 113], [54, 113], [54, 100]]],
        "why": "two word runs on one line: same run, overlapping y -> one band [54,100,292,113]",
    },
    {
        "label": "union:short-last-line-still-joins",
        "rects": [[54, 100, 292, 112], [54, 113, 90, 125]],
        "options": {"vertical_gap_tolerance": 2, "horizontal_overlap_tolerance": 0},
        "polygons": [[[292, 100], [292, 112.5], [90, 112.5], [90, 125], [54, 125], [54, 100]]],
        "why": "band edge (112+113)/2 = 112.5; the short line joins by x-overlap of 36 pt",
    },
    {
        "label": "union:degenerate-rects-dropped",
        "rects": [[54, 100, 292, 112], [54, 120, 54, 130], [10, 200, 30, 200]],
        "options": {"vertical_gap_tolerance": 2, "horizontal_overlap_tolerance": 0},
        "polygons": [[[292, 100], [292, 112], [54, 112], [54, 100]]],
        "why": "zero-width and zero-height rects are not regions and are dropped",
    },
    {
        "label": "union:empty",
        "rects": [],
        "options": {"vertical_gap_tolerance": 2, "horizontal_overlap_tolerance": 0},
        "polygons": [],
    },
]


def main() -> None:
    HERE.mkdir(parents=True, exist_ok=True)
    fixture_records: list[dict[str, Any]] = []
    for fx in FIXTURES:
        pdf = build_pdf(fx)
        (HERE / fx["file"]).write_bytes(pdf)
        uu = fx["user_unit"] if fx["user_unit"] is not None else 1.0
        oracle = mupdf_oracle(pdf, uu)
        fixture_records.append(
            {
                "label": "fixture:" + fx["file"].removesuffix(".pdf"),
                "file": fx["file"],
                "sha256": hashlib.sha256(pdf).hexdigest(),
                "why": fx["why"],
                "raw": {
                    "media_box": fx["media_box"],
                    "crop_box": fx["crop_box"],
                    "rotate": fx["rotate"],
                    "user_unit": fx["user_unit"],
                },
                "marker_rects_raw_pdf_space": [
                    [x, y, x + w, y + h] for (x, y, w, h) in fx["markers"]
                ],
                "expected_page_size": oracle["page_size"],
                "expected_marker_bboxes": oracle["marker_bboxes"],
                "mupdf_page_rect_unadjusted": oracle["page_rect_as_mupdf_reports_it"],
            }
        )

    doc = {
        "$schema_note": (
            "The CONTRACT for PaperTree geometry. Consumed by document-ir/geometry.spec in BOTH "
            "TypeScript and Python, so the two languages are checked against one recording rather "
            "than against each other. Regenerate with "
            "`uv run --python 3.12 --with pymupdf python "
            "packages/document-ir/test/fixtures-pdf/generate.py`."
        ),
        "contract_version": CONTRACT_VERSION,
        "generated_by": "packages/document-ir/test/fixtures-pdf/generate.py",
        "oracles": {
            "fixture_vectors": (
                "MuPDF. Markers are painted by a raw PDF content stream, read back with "
                "page.get_drawings(), divided by /UserUnit and mapped with page.rotation_matrix - "
                "a second, independently implemented coordinate pipeline."
            ),
            "everything_else": (
                "hand arithmetic, written as literals in generate.py with the working shown in the "
                "comment beside each entry. Nothing here was produced by running geometry.ts or "
                "geometry.py."
            ),
        },
        "spec": {
            "ir_space": (
                "PDF DEFAULT USER SPACE units (1/72 in); origin TOP-LEFT of the page's "
                "post-rotation CROP rect; y grows DOWNWARD; /Rotate already applied; coordinates "
                "relative to the crop rect's own origin so a CropBox offset cannot leak in; "
                "/UserUnit DELIBERATELY NOT APPLIED. Identical to ADR-001 Amendment 1 "
                "'COORDINATE FRAME', which is what the block id is computed in."
            ),
            "normalise": (
                "u = raw_x - crop.x0 ; v = crop.y1 - raw_y ; then rotate clockwise inside cw x ch: "
                "rot 0 -> (u, v) [cw x ch]; rot 90 -> (ch - v, u) [ch x cw]; "
                "rot 180 -> (cw - u, ch - v) [cw x ch]; rot 270 -> (v, cw - u) [ch x cw]. "
                "The effective crop box is CropBox INTERSECT MediaBox, corner-ordered "
                "(PDF 1.7 14.11.2); an absent /CropBox defaults to the MediaBox."
            ),
            "viewport": (
                "s = zoom * user_unit ; W = page_width * s ; H = page_height * s ; "
                "rot 0 -> (x*s, y*s) on a W x H surface; rot 90 -> (H - y*s, x*s) on H x W; "
                "rot 180 -> (W - x*s, H - y*s) on W x H; rot 270 -> (y*s, W - x*s) on H x W. "
                "`rotation` here is the VIEWER's extra rotation on top of the page's own /Rotate, "
                "which is already baked into page_width/page_height and every stored polygon."
            ),
            "user_unit_boundary": (
                "/UserUnit is RECORDED in the IR and APPLIED ONLY in the viewport transform. "
                "Amendment 1 pins it out of the id's coordinate frame; geometry.spec requires the "
                "viewport transform to handle it. Both hold at once because they are different "
                "spaces. MEASURED CAVEAT: Amendment 1 justifies the rule with 'it is what MuPDF's "
                "page.rect gives' - that is FALSE as of PyMuPDF 1.28 / MuPDF 1.29, which scales "
                "page.rect and every extracted coordinate by /UserUnit while leaving "
                "page.rotation_matrix unscaled. The rule stands; the justification does not, and a "
                "PyMuPDF-based parser must divide /UserUnit out exactly once before storing."
            ),
            "polygon_conventions": (
                "bbox == polygon extent, ALWAYS (schema + semantic validator rule 1); rings are "
                "NOT closed (do not repeat the first vertex); signed area is the shoelace sum "
                "halved, positive for a ring that reads clockwise on screen in this y-down frame; "
                "point-in-polygon is even-odd with the boundary tested explicitly first and "
                "INCLUSIVE by default; polygon intersection and bbox intersection both count "
                "boundary contact as intersecting."
            ),
            "union_of_line_rects": (
                "Two line rects join one run iff their x-extents overlap by more than "
                "horizontal_overlap_tolerance AND their y-intervals overlap or are separated by at "
                "most vertical_gap_tolerance; connectivity is transitive. Each run becomes ONE "
                "staircase polygon whose horizontal band edges sit at the midpoint of each "
                "inter-line gap. A selection spanning two columns therefore returns TWO polygons "
                "and never a bounding box across the gutter. Rects with non-positive width or "
                "height are dropped. Output is sorted by (top, left)."
            ),
        },
        "how_to_use": [
            "1. `page_frames`: normalise_page_frame(raw) MUST equal `frame` field for field.",
            "2. `normalisation_vectors` / `normalise_rect_vectors`: the named frame's "
            "normalise_point / normalise_rect MUST equal `expected` exactly (these are all "
            "exact binary64 values), and denormalise_point MUST return the raw point.",
            "3. `viewport_vectors`: pdf_to_viewport MUST equal `viewport_point`, viewport_size "
            "MUST equal `surface`, and viewport_to_pdf MUST invert.",
            "4. `roundtrip_grid`: every (page, zoom, rotation, user_unit, point) combination must "
            "round-trip with max abs error < max_abs_error_pt. This is the acceptance criterion.",
            "5. `polygon_vectors` / `intersection_vectors` / `line_union_vectors`: exact match.",
            "6. `fixture_vectors`: open the PDF in `test/fixtures-pdf/`, read /MediaBox, /CropBox, "
            "/Rotate and /UserUnit from the page dictionary, build the frame, normalise each raw "
            "marker rect, and compare with `expected_marker_bboxes` - which came from MuPDF.",
        ],
        "page_frames": PAGE_FRAMES,
        "normalisation_vectors": NORMALISATION_VECTORS,
        "normalise_rect_vectors": NORMALISE_RECT_VECTORS,
        "viewport_vectors": VIEWPORT_VECTORS,
        "roundtrip_grid": ROUNDTRIP_GRID,
        "polygon_vectors": POLYGON_VECTORS,
        "intersection_vectors": INTERSECTION_VECTORS,
        "line_union_vectors": LINE_UNION_VECTORS,
        "fixture_vectors": fixture_records,
        "counts": {
            "page_frames": len(PAGE_FRAMES),
            "normalisation_vectors": len(NORMALISATION_VECTORS),
            "normalise_rect_vectors": len(NORMALISE_RECT_VECTORS),
            "viewport_vectors": len(VIEWPORT_VECTORS),
            "roundtrip_combinations": (
                len(ROUNDTRIP_GRID["zooms"])
                * len(ROUNDTRIP_GRID["rotations"])
                * len(ROUNDTRIP_GRID["user_units"])
                * len(ROUNDTRIP_GRID["pages"])
                * len(ROUNDTRIP_GRID["points"])
            ),
            "polygon_vectors": len(POLYGON_VECTORS),
            "polygon_point_tests": sum(len(v["points"]) for v in POLYGON_VECTORS),
            "intersection_vectors": len(INTERSECTION_VECTORS),
            "line_union_vectors": len(LINE_UNION_VECTORS),
            "fixture_vectors": len(fixture_records),
        },
        "pymupdf_version": pymupdf.__doc__.splitlines()[0] if pymupdf.__doc__ else "unknown",
    }

    VECTORS.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {VECTORS.relative_to(PKG.parents[1])}")
    for record in fixture_records:
        size = record["expected_page_size"]
        print(f"  {record['file']:<32} {record['sha256'][:16]}  size={size}")


if __name__ == "__main__":
    main()
