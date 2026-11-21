"""v0.3 #337: the spread's "At a glance" sheet.

    GET /papers/{id}/glance  -> 200 GlanceStatus {state: ready, glance}
                             |  202 GlanceStatus {state: making, glance: null}
                             |  200 GlanceStatus {state: none,   glance: null}

The sheet is made in the BACKGROUND when a paper is added (`GET /papers` starts the ones a library
read finds missing; see `glance.start_missing`) and cached (`paper_glance`, 0013), so the spread
that opens on it finds it made. A read that finds none and none running starts the run too, and
answers 202 `making`: ask again. `none` means nothing is coming (the model is not configured, the
daily cap is reached, the run failed or the paper is not read in yet): the spread shows the
abstract alone. Another owner's paper, like one that does not exist, is a 404.

Each block carries `page`, the 1-based page of the passage it cites, for the quiet `p. 3 ›` link;
Results carries one for its note. A block that cited nothing has none. No regenerate yet.
"""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse, Response
from papertree_db import PaperId

from ..deps import AgentClientDep, CallerDep, IndexCacheDep, SettingsDep, TopicTasksDep
from ..errors import ApiError, ErrorEnvelope
from ..glance import GlanceRunDeps, glance_status
from ..schemas import GlanceStatus

router = APIRouter()


@router.get(
    "/papers/{paper_id}/glance",
    response_model=GlanceStatus,
    responses={
        status.HTTP_202_ACCEPTED: {
            "model": GlanceStatus,
            "description": "A run is writing the sheet; ask again",
        },
        404: {"model": ErrorEnvelope, "description": "Not this caller's paper"},
    },
)
async def get_glance(
    call: CallerDep,
    paper_id: str,
    settings: SettingsDep,
    client: AgentClientDep,
    index_cache: IndexCacheDep,
    tasks: TopicTasksDep,
) -> Response:
    """The paper's "At a glance" sheet, or the state it is in. A read never waits for the model."""
    row = call.db.library_row(call.db_owner, PaperId(paper_id))
    if row is None:
        raise ApiError("not_found", "no such paper")
    body = glance_status(call, row, GlanceRunDeps(settings, client, index_cache, tasks))
    code = status.HTTP_202_ACCEPTED if body["state"] == "making" else status.HTTP_200_OK
    return JSONResponse(GlanceStatus.model_validate(body).model_dump(mode="json"), status_code=code)
