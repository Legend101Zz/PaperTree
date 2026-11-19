"""v0.3 (#348): a rectangle of a page as an image.

    GET /papers/{id}/crop?page=&x0=&y0=&x1=&y1=[&gen=]        PNG
    GET /papers/{id}/crop-url?page=&x0=&y0=&x1=&y1=           {url, expires_at, dpi, width, height}

``page`` is 0-based; the box is in the page's PDF space (points, origin top-left: the space of an IR
``bbox`` and of an image anchor's quad). The DPI is chosen from the box so the long side comes out
about 1,400 px (``region_crops``), and the PNG is cached on disk under the data root.

AUTH is the asset route's (contracts.md §2.3): a Bearer, OR ``?gen=&exp=&sig=`` from ``crop-url``,
which names ONE paper, generation, page and box, so an ``<img src>`` can load it. Another user's
paper is 404 either way; a bad or expired signature with no Bearer is 401.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, Response
from papertree_db import SQLITE_INTEGER_MAX, PaperId, PaperTreeDb
from starlette.concurrency import run_in_threadpool

from .. import assets
from ..deps import AuthConnDep, CallerDep, SettingsDep, open_database
from ..errors import ApiError
from ..figures import stable_exp
from ..image_anchor import BBox
from ..logging import user_ref
from ..region_crops import CropError, RenderedCrop, canonical_box, render_crop
from ..security import user_for_token
from ..settings import Settings
from ..wiretime import format_moment
from ._shared import GenParam

router = APIRouter()

#: The bytes of a crop of one generation never change, but the URL is per session.
CACHE_CONTROL: Final = "private, max-age=3600"

_Coord = Annotated[float, Query(allow_inf_nan=False, ge=-1e6, le=1e6)]
_Page = Annotated[int, Query(ge=0, le=SQLITE_INTEGER_MAX)]


def box_of(x0: float, y0: float, x1: float, y1: float) -> BBox:
    """The query's box, or 422 when it has no area."""
    if not (x1 > x0 and y1 > y0):
        raise ApiError("validation_failed", "box: x1 must exceed x0 and y1 must exceed y0")
    return (x0, y0, x1, y1)


async def render_for(
    settings: Settings, paper_id: str, generation: int, page: int, box: BBox
) -> RenderedCrop:
    """The crop, drawn off the event loop; a ``CropError`` becomes the API's envelope."""
    try:
        return await run_in_threadpool(
            render_crop,
            pdf=settings.upload_root / f"{paper_id}.pdf",
            asset_root=settings.asset_root,
            paper_id=paper_id,
            generation=generation,
            page=page,
            box=box,
        )
    except CropError as exc:
        raise ApiError(exc.code, exc.detail) from exc  # type: ignore[arg-type]


@router.get(
    "/papers/{paper_id}/crop",
    responses={200: {"content": {"image/png": {}}, "description": "the crop, PNG"}},
)
async def crop(
    request: Request,
    settings: SettingsDep,
    auth_conn: AuthConnDep,
    db: Annotated[PaperTreeDb, Depends(open_database)],
    paper_id: str,
    page: _Page,
    x0: _Coord,
    y0: _Coord,
    x1: _Coord,
    y1: _Coord,
    gen: GenParam,
) -> Response:
    """A crop PNG for a Bearer OR a signed URL. 404 for a paper that is not this user's."""
    box = box_of(x0, y0, x1, y1)
    query = request.query_params
    user_id: str | None = None
    signed = ("sig" in query or "exp" in query) and assets.verify(
        settings.signing_secret,
        paper_id=paper_id,
        gen=gen,
        kind=assets.CROP_KIND,
        block_id=canonical_box(page, box),
        exp=query.get("exp"),
        sig=query.get("sig"),
        now=time.time(),
    )
    if signed:
        user_id = db.asset_grant(PaperId(paper_id))
        if user_id is None:  # signed, and the paper is gone since
            raise ApiError("not_found", "no such paper")
    if user_id is None:
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() == "bearer" and token.strip():
            user_id = user_for_token(auth_conn, token.strip())
    if user_id is None:
        raise ApiError(
            "auth_required",
            "a signed crop URL or a session token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    request.state.user_ref = user_ref(user_id)
    owner = db.owner_for(user_id)
    if db.owned_paper(owner, PaperId(paper_id)) is None:
        raise ApiError("not_found", "no such paper")
    generation = gen if gen is not None else db.promoted_generation(owner, PaperId(paper_id))
    if generation is None:
        raise ApiError("not_parsed", "this paper has not been parsed yet", retryable=True)
    rendered = await render_for(settings, paper_id, generation, page, box)
    return Response(
        rendered.png,
        media_type="image/png",
        headers={
            "Cache-Control": CACHE_CONTROL,
            "X-Crop-Dpi": str(rendered.plan.dpi),
            "X-Crop-Size": f"{rendered.width_px}x{rendered.height_px}",
            "X-Crop-Cache": "hit" if rendered.cached else "miss",
        },
    )


@router.get("/papers/{paper_id}/crop-url")
async def crop_url(
    request: Request,
    call: CallerDep,
    settings: SettingsDep,
    paper_id: str,
    page: _Page,
    x0: _Coord,
    y0: _Coord,
    x1: _Coord,
    y1: _Coord,
    gen: GenParam,
) -> Response:
    """Mint the signed URL of a crop (an hour or so ahead, stable for ten minutes).

    The body also says what the image is: the dpi and the pixel size, so a card can reserve its
    space before the image loads. The crop is drawn here (and cached), which is also the check that
    the box lies on the page.
    """
    box = box_of(x0, y0, x1, y1)
    if call.db.owned_paper(call.db_owner, PaperId(paper_id)) is None:
        raise ApiError("not_found", "no such paper")
    generation = (
        gen if gen is not None else call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    )
    if generation is None:
        raise ApiError("not_parsed", "this paper has not been parsed yet", retryable=True)
    rendered = await render_for(settings, paper_id, generation, page, box)
    exp = stable_exp(time.time())
    body: dict[str, Any] = {
        "url": assets.signed_crop_url(
            str(request.base_url),
            settings.signing_secret,
            paper_id=paper_id,
            gen=generation,
            page=page,
            box=box,
            exp=exp,
        ),
        "expires_at": format_moment(datetime.fromtimestamp(exp, UTC)),
        "dpi": rendered.plan.dpi,
        "width": rendered.width_px,
        "height": rendered.height_px,
    }
    return JSONResponse(body)
