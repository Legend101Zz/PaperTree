"""contracts.md §2.5: the paper summary (S5).

    GET   /papers/{id}/summary                     -> SummaryStatus
    POST  /papers/{id}/summary   SummaryRequest    -> 200 SSE (§2.6), or 200 JSON SummaryStatus
                                                      when a cached summary exists and
                                                      `regenerate` is not set

A SUMMARY IS A DERIVATION, cached per (paper, promoted generation, prompt version, model): 0005's
unique index on ``derivations(kind='paper_summary')``. So a reload, or a second POST without
``regenerate``, is served from the store and starts no run (``ai_runs`` unchanged). A summary run
has no thread and no ``ai_messages`` row; its browser events carry a minted ``msg_`` id for the
run's output (``ai_runs.message_id``) so the §2.6 event shapes stay one set.

``state``: ``running`` while a summary run for this generation is live; else ``ready`` or
``partial`` (a bullet without a valid ``[bN]``) from the cached summary; else ``failed`` when the
latest summary run of this generation ended without one; else ``none``.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from papertree_db import PaperId, new_id
from papertree_db.ai import normalise_time
from papertree_prompts import mint_datamark

from .. import agent_client as runs
from ..agent_client import RunBroker, RunSpec
from ..deps import (
    AgentClientDep,
    CallerDep,
    DocumentsDep,
    IndexCacheDep,
    LiveRunsDep,
    SettingsDep,
)
from ..errors import ApiError, ErrorEnvelope
from ..schemas import AgentPaper, AgentRunRequest, SummaryRequest, SummaryStatus
from ._shared import json_body
from .threads import EVENT_STREAM, owned_paper, promoted_generation, tool_access

router = APIRouter()

SUMMARY_QUESTION: Final = "Summarise this paper."


def _cached(call: Any, paper_id: str, generation: int) -> dict[str, Any] | None:
    row = call.db.get_summary(
        call.db_owner,
        PaperId(paper_id),
        generation,
        runs.PROMPT_VERSIONS["summary"],
        runs.MODEL,
    )
    return None if row is None else dict(row["content"])


def _live(run: dict[str, Any] | None) -> bool:
    return (
        run is not None
        and run["status"] == "running"
        and normalise_time(run["expires_at"]) > normalise_time(datetime.now(UTC))
    )


def summary_status(call: Any, paper_id: str, generation: int | None) -> dict[str, Any]:
    if generation is None:
        return {"state": "none", "summary": None}
    cached = _cached(call, paper_id, generation)
    latest = call.db.latest_run(
        call.db_owner, PaperId(paper_id), kind="summary", generation=generation
    )
    if _live(latest):
        return {"state": "running", "summary": cached}
    if cached is not None:
        return {
            "state": "ready" if cached["status"] == "complete" else "partial",
            "summary": cached,
        }
    if latest is not None and latest["status"] in ("error", "aborted", "done"):
        return {"state": "failed", "summary": None}
    return {"state": "none", "summary": None}


@router.get(
    "/papers/{paper_id}/summary",
    response_model=SummaryStatus,
    responses={404: {"model": ErrorEnvelope, "description": "Not this caller's paper"}},
)
async def get_summary(call: CallerDep, paper_id: str) -> Response:
    owned_paper(call, paper_id)
    generation = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    return JSONResponse(summary_status(call, paper_id, generation))


@router.post(
    "/papers/{paper_id}/summary",
    response_model=SummaryStatus,
    responses={
        200: {
            "description": "contracts.md §2.6 events, or the cached summary as JSON",
            "content": {"text/event-stream": {}},
        },
        **{k: v for k, v in EVENT_STREAM.items() if k != 200},
    },
)
async def create_summary(
    request: Request,
    call: CallerDep,
    settings: SettingsDep,
    client: AgentClientDep,
    index_cache: IndexCacheDep,
    documents: DocumentsDep,
    live_runs: LiveRunsDep,
    paper_id: str,
    body: Annotated[SummaryRequest, Depends(json_body(SummaryRequest))],
) -> Response:
    accepted = time.monotonic()
    paper = owned_paper(call, paper_id)
    generation = promoted_generation(call, paper_id)
    if not body.regenerate:
        cached = _cached(call, paper_id, generation)
        if cached is not None:
            state = "ready" if cached["status"] == "complete" else "partial"
            return JSONResponse({"state": state, "summary": cached})
    runs.require_configured(settings)
    db, owner = call.db, call.db_owner
    if _live(db.latest_run(owner, PaperId(paper_id), kind="summary", generation=generation)):
        raise ApiError("busy", "A summary of this paper is already being written.")
    runs.require_budget(db, owner, settings)

    run_id, message_id = new_id("run"), new_id("msg")
    datamark = mint_datamark()
    token, token_sha256 = runs.mint_run_token()
    request_id = getattr(request.state, "request_id", None)
    db.create_run(
        owner,
        run_id=run_id,
        paper_id=PaperId(paper_id),
        generation=generation,
        kind="summary",
        thread_id=None,
        message_id=message_id,
        token_sha256=token_sha256,
        datamark=datamark,
        expires_at=runs.token_expiry("summary"),
        code_path=runs.CODE_PATHS["summary"],
        request_id=request_id,
        prompt_version=runs.PROMPT_VERSIONS["summary"],
    )
    run_body = AgentRunRequest(
        run_id=run_id,
        request_id=request_id or new_id("req"),
        kind="summary",
        prompt_version=runs.PROMPT_VERSIONS["summary"],
        tool=tool_access(settings, run_id, token),
        datamark=datamark,
        paper=AgentPaper(
            title=runs.paper_title(db, owner, paper_id, generation),
            page_count=paper.get("page_count"),
            generation=generation,
        ),
        seed=None,
        question=SUMMARY_QUESTION,
        history=None,
        limits=runs.LIMITS["summary"],
    )
    broker = RunBroker(
        spec=RunSpec(
            user_id=call.user_id,
            paper_id=paper_id,
            generation=generation,
            kind="summary",
            run_id=run_id,
            thread_id=None,
            user_message_id=None,
            message_id=message_id,
            request_id=run_body.request_id,
            body=run_body,
            accepted_at=accepted,
        ),
        settings=settings,
        client=client,
        index_cache=index_cache,
        documents=documents,
        registry=live_runs,
    )
    return await runs.launch(broker, db=db, owner=owner)
