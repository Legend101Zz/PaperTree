"""Rendering the crops that are the GROUND TRUTH for every equation and figure.

WHY THIS IS NOT OPTIONAL. ADR-001: "Equations and figures always retain the rendered source
region." The schema says it exactly - `payload.image` is **required and nullable**: nullable
while the render step is outstanding, and semantic rule **36** makes it an ERROR to be null once
`status == "complete"`. So a parse without crops is a `partial` parse, by construction.

The reason is §11 residual risk 4. `EquationPayload.latex` and `TablePayload.html` accept
arbitrary strings; they are *declared interpretations*, and what makes that acceptable is that
the crop sits beside them as the thing the page actually says. Drop the crop and the
interpretation becomes the only record - which is the failure the whole `source` design exists
to prevent.

findings.md B4 is the same defect in the code being replaced: `ExtractedImage.data` never left
the extractor, `images_dict_carries_pixel_bytes` measured **false for all 8 papers**, and every
`FigureBlock.image_id` was therefore a dangling reference.

THE URI SCHEME IS CONFIGURABLE AND DEFAULTS TO OPAQUE

The project owner's decision. `ImageRef.uri` requires a scheme (`^[a-z][a-z0-9+.\\-]*://`), so a
bare path is schema-invalid, and the schema's own description asks for an opaque storage URI -
"resolution is the storage layer's business".

Default: `asset://<paper_id>/<generation>/<kind>/<block_id>@<scale>x.png`.

**Epic 2 must add a handler for it.** `apps/web/.../assetSrc.ts` resolves only `fixture://` and
passes everything else untouched into `<img src>`, where an unknown scheme renders as nothing,
silently. That is filed rather than worked around, because the alternative - baking an
`https://host/...` into an immutable, content-addressed document - makes every stored generation
wrong the day the host changes.

PNG AT 3x, AND WHY NOT THE WEBP THE EPIC ASKS FOR

`EPIC-01-ingest.md` F1.5 says "render each region to WebP at 2-3x". This writes **PNG**, and the
deviation is recorded in `EPIC-01-RESULT.md`. Three reasons, in order of weight:

1. **MuPDF cannot encode WebP.** `Pixmap.tobytes` offers png/pnm/pgm/ppm/pbm/pam/tga/psd/ps/jpg
   and nothing else at 1.29. WebP would need Pillow - a new runtime dependency for a container
   format change, against an epic rule of "no new dependency without justification".
2. **The lossy alternative is disqualified on principle and loses on size anyway.** These crops
   are the GROUND TRUTH that makes `latex` and `html` acceptable as interpretations; a lossy
   re-encoding of the evidence is the wrong trade at any ratio. Measured on a 720x360 ResNet
   crop: **PNG 83 kB, JPEG 119 kB**. Text is flat high-contrast regions, which PNG's filters
   compress well and JPEG compresses badly - the usual WebP-beats-PNG intuition comes from
   photographs, and a page region is not one.
3. **PNG is already the repo's convention.** Epic 0's committed fixture assets are
   `fixtures/assets/<slug>/figures/blk_...@3x.png`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from papertree_document_ir import BBox

from papertree_document_worker.pdf import pymupdf

__all__ = ["CropStore", "DEFAULT_SCHEME", "crop_uri"]

DEFAULT_SCHEME = "asset"
#: 3x is the epic's stated range ("render each region to WebP at 2-3x"). At 72 dpi nominal that
#: is 216 dpi, which keeps a 6 pt subscript legible when zoomed.
DEFAULT_SCALE = 3.0
#: A crop is padded so glyph antialiasing and rule ends are not clipped at the boundary.
PADDING_PT = 2.0


def crop_uri(
    *,
    scheme: str,
    paper_id: str,
    generation: int,
    kind: str,
    block_id: str,
    scale: float,
) -> str:
    """The opaque storage URI. Path segments are ids, so nothing needs escaping."""
    return f"{scheme}://{paper_id}/{generation}/{kind}/{block_id}@{scale:g}x.png"


@dataclass(slots=True)
class CropStore:
    """Writes crops under `root` and returns the `ImageRef` that names them.

    `root` defaults OUTSIDE the repository. Anything written inside it turns the CI codegen-drift
    step - a whole-tree `git status --porcelain --untracked-files=all` - red, and `.gitignore`
    covers none of these paths.
    """

    root: Path
    paper_id: str
    generation: int = 1
    scheme: str = DEFAULT_SCHEME
    scale: float = DEFAULT_SCALE
    written: int = 0

    def _path_for(self, kind: str, block_id: str) -> Path:
        return (
            self.root
            / self.paper_id
            / str(self.generation)
            / kind
            / f"{block_id}@{self.scale:g}x.png"
        )

    def render(
        self,
        page: Any,
        bbox: BBox,
        *,
        kind: str,
        block_id: str,
        rendered_from: str,
    ) -> dict[str, Any]:
        """Render one region and return its `ImageRef` as plain JSON data.

        `page` is a raw `pymupdf.Page`. This is the ONE place outside `pdf.py` that touches
        pymupdf, and it does so because rendering needs the live page object rather than the
        typed primitives - a deliberate, documented exception rather than a leak.
        """
        clip = (
            pymupdf.Rect(
                bbox[0] - PADDING_PT,
                bbox[1] - PADDING_PT,
                bbox[2] + PADDING_PT,
                bbox[3] + PADDING_PT,
            )
            & page.rect
        )
        pixmap = page.get_pixmap(clip=clip, matrix=pymupdf.Matrix(self.scale, self.scale))
        destination = self._path_for(kind, block_id)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(pixmap.tobytes("png"))
        self.written += 1
        return {
            "uri": crop_uri(
                scheme=self.scheme,
                paper_id=self.paper_id,
                generation=self.generation,
                kind=kind,
                block_id=block_id,
                scale=self.scale,
            ),
            "scale": self.scale,
            "dpi": 72.0 * self.scale,
            "rendered_from": rendered_from,
        }

    def read(self, kind: str, block_id: str) -> bytes:
        """The rendered bytes, for the VLM. Reads back rather than caching in memory: a 75-page
        paper's crops are hundreds of megabytes and only a handful are ever sent."""
        return self._path_for(kind, block_id).read_bytes()
