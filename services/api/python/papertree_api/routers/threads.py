"""contracts.md §2.5: AI threads (explain, ask, follow-up) and run cancellation (S5).

    POST  /papers/{id}/threads                    ThreadCreate      -> 200 SSE (§2.6)
    POST  /papers/{id}/threads/{tid}/messages     FollowUp          -> 200 SSE (§2.6)
    GET   /papers/{id}/threads                                      -> Thread[]
    GET   /papers/{id}/threads/{tid}                                -> ThreadDetail
    POST  /runs/{run_id}/cancel                                     -> 202

PRE-STREAM ERRORS, IN THE ORDER THEY ARE CHECKED, every one before a row is written and as the §0
JSON envelope: 404 ``not_found`` (not this caller's paper or thread), 503 ``not_configured`` (no
``PAPERTREE_AGENT_SECRET``), 409 ``not_parsed`` (no promoted generation to ground in), 422 (a bad
body, or ``anchor_mismatch``: an anchor on another paper or other bytes), 409 ``busy`` (a run is
live on this thread), 429 ``budget_exhausted``. Then the rows are written and the agent is
called; if it cannot be reached (503 ``agent_unavailable``) or refuses (409 ``busy``, 503
``not_configured``), the rows this request wrote are removed again, the run is recorded as an
error, and the answer is still JSON. Only after the agent answered 200 does the SSE start.

WHAT A TURN WRITES, in one transaction: the thread (a new one), the user's message
(``complete``), the assistant message (``streaming``, with the run id), the run (a run-token hash,
the datamark, ``code_path``) and the seed's handles ``b1…``. A follow-up's run first inherits the
thread's earlier handles (``thread_handles``), so a ``[b4]`` the model reads in its own history
still names the same passage, and the explain seed is rebuilt from the thread's origin anchor.
"""

from __future__ import annotations

import time
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse, Response
from papertree_db import OwnerId, PaperId, PaperTreeDb, new_id
from papertree_prompts import mint_datamark
from pydantic_core import from_json

from .. import agent_client as runs
from .. import evidence
from ..agent_client import RunBroker, RunKind, RunSpec
from ..deps import (
    AgentClientDep,
    Caller,
    CallerDep,
    DocumentsDep,
    IndexCacheDep,
    LiveRunsDep,
    SettingsDep,
)
from ..errors import ApiError, ErrorEnvelope
from ..schemas import (
    AgentHistory,
    AgentPaper,
    AgentRunRequest,
    AgentToolAccess,
    FollowUp,
    Thread,
    ThreadCreate,
    ThreadDetail,
)
from ..settings import Settings
from ..wiretime import wire_time
from ._shared import json_body

router = APIRouter()

ERRORS: Final[dict[int | str, dict[str, Any]]] = {
    404: {"model": ErrorEnvelope, "description": "Not this caller's paper or thread"},
}
EVENT_STREAM: Final[dict[int | str, dict[str, Any]]] = {
    200: {"description": "contracts.md §2.6 events", "content": {"text/event-stream": {}}},
    409: {"model": ErrorEnvelope, "description": "not_parsed, busy"},
    422: {"model": ErrorEnvelope, "description": "validation_failed, anchor_mismatch"},
    429: {"model": ErrorEnvelope, "description": "budget_exhausted"},
    503: {"model": ErrorEnvelope, "description": "not_configured, agent_unavailable"},
    **ERRORS,
}
TITLE_CHARS: Final = 80


# ── shared by the two SSE routes ─────────────────────────────────────────────────────────────


def owned_paper(call: Caller, paper_id: str) -> dict[str, Any]:
    paper = call.db.owned_paper(call.db_owner, PaperId(paper_id))
    if paper is None:
        raise ApiError("not_found", "no such paper")
    return paper


def promoted_generation(call: Caller, paper_id: str) -> int:
    generation = call.db.promoted_generation(call.db_owner, PaperId(paper_id))
    if generation is None:
        raise ApiError(
            "not_parsed", "This paper is still being read; explanations start once it is parsed."
        )
    return generation


def check_anchor(anchor: dict[str, Any], paper_id: str, source_hash: str) -> None:
    """contracts.md §2.4's ``anchor_mismatch``, applied to the anchor a thread starts from."""
    doc = anchor.get("doc") or {}
    if doc.get("paperId") != paper_id:
        raise ApiError("anchor_mismatch", "anchor.doc.paperId: the anchor is on another paper")
    if doc.get("pdfSha256") != source_hash:
        raise ApiError("anchor_mismatch", "anchor.doc.pdfSha256: the anchor is on other PDF bytes")


def _title(text: str) -> str:
    title = evidence.header_text(text, limit=TITLE_CHARS)
    return title or "Untitled"


def tool_access(settings: Settings, run_id: str, token: str) -> AgentToolAccess:
    return AgentToolAccess(
        base_url=f"{settings.api_internal_url}/internal/agent/runs/{run_id}", token=token
    )


def _request_id(request: Request) -> str | None:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) else None


# ── POST /papers/{id}/threads ────────────────────────────────────────────────────────────────


@router.post("/papers/{paper_id}/threads", responses=EVENT_STREAM)
async def create_thread(
    request: Request,
    call: CallerDep,
    settings: SettingsDep,
    client: AgentClientDep,
    index_cache: IndexCacheDep,
    documents: DocumentsDep,
    live_runs: LiveRunsDep,
    paper_id: str,
    body: Annotated[ThreadCreate, Depends(json_body(ThreadCreate))],
) -> Response:
    accepted = time.monotonic()
    paper = owned_paper(call, paper_id)
    runs.require_configured(settings)
    generation = promoted_generation(call, paper_id)
    # The anchor as the client sent it (the stored record is the client's JSON, minus the T0
    # cache), after `ThreadCreate` validated it against the Anchor v1 model.
    raw = from_json(await request.body())
    anchor: dict[str, Any] | None = None
    if body.anchor is not None:
        anchor = {k: v for k, v in dict(raw["anchor"]).items() if k != "resolution"}
        check_anchor(anchor, paper_id, str(paper["source_hash"]))
    runs.require_budget(call.db, call.db_owner, settings)

    index = evidence.load_index(
        index_cache, call.db, call.db_owner, call.user_id, paper_id, generation
    )
    datamark = mint_datamark()
    plan = evidence.plan_seed(index, anchor, datamark=datamark) if anchor is not None else None
    kind: RunKind = body.kind
    thread_id, user_message_id = new_id("thr"), new_id("msg")
    message_id, run_id = new_id("msg"), new_id("run")
    token, token_sha256 = runs.mint_run_token()
    title = _title(plan.quote if plan is not None and plan.quote else body.question)

    db, owner = call.db, call.db_owner
    with db.transaction():
        db.create_thread(
            owner,
            PaperId(paper_id),
            thread_id=thread_id,
            kind=kind,
            title=title,
            origin_anchor=anchor,
        )
        db.append_message(
            owner,
            thread_id,
            message_id=user_message_id,
            role="user",
            generation=generation,
            content=body.question,
            status="complete",
        )
        db.append_message(
            owner,
            thread_id,
            message_id=message_id,
            role="assistant",
            generation=generation,
            content="",
            status="streaming",
            run_id=run_id,
        )
        _create_run(
            db,
            owner,
            request,
            paper_id,
            generation,
            kind,
            thread_id,
            message_id,
            run_id,
            token_sha256,
            datamark,
        )
        handles = (
            db.assign_run_handles(owner, run_id, generation, plan.block_ids)
            if plan is not None
            else []
        )

    run_body = AgentRunRequest(
        run_id=run_id,
        request_id=_request_id(request) or new_id("req"),
        kind=kind,
        prompt_version=runs.PROMPT_VERSIONS[kind],
        tool=tool_access(settings, run_id, token),
        datamark=datamark,
        paper=AgentPaper(
            title=runs.paper_title(db, owner, paper_id, generation),
            page_count=paper.get("page_count"),
            generation=generation,
        ),
        seed=plan.to_wire(handles) if plan is not None else None,
        question=body.question,
        history=None,
        limits=runs.LIMITS[kind],
    )
    broker = RunBroker(
        spec=RunSpec(
            user_id=call.user_id,
            paper_id=paper_id,
            generation=generation,
            kind=kind,
            run_id=run_id,
            thread_id=thread_id,
            user_message_id=user_message_id,
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
    return await runs.launch(
        broker,
        db=db,
        owner=owner,
        on_refused=lambda: db.delete_thread(owner, PaperId(paper_id), thread_id),
    )


def _create_run(
    db: PaperTreeDb,
    owner: OwnerId,
    request: Request,
    paper_id: str,
    generation: int,
    kind: RunKind,
    thread_id: str | None,
    message_id: str | None,
    run_id: str,
    token_sha256: str,
    datamark: str,
) -> None:
    db.create_run(
        owner,
        run_id=run_id,
        paper_id=PaperId(paper_id),
        generation=generation,
        kind=kind,
        thread_id=thread_id,
        message_id=message_id,
        token_sha256=token_sha256,
        datamark=datamark,
        expires_at=runs.token_expiry(kind),
        code_path=runs.CODE_PATHS[kind],
        request_id=_request_id(request),
        prompt_version=runs.PROMPT_VERSIONS[kind],
    )


# ── POST /papers/{id}/threads/{tid}/messages ─────────────────────────────────────────────────


@router.post("/papers/{paper_id}/threads/{thread_id}/messages", responses=EVENT_STREAM)
async def follow_up(
    request: Request,
    call: CallerDep,
    settings: SettingsDep,
    client: AgentClientDep,
    index_cache: IndexCacheDep,
    documents: DocumentsDep,
    live_runs: LiveRunsDep,
    paper_id: str,
    thread_id: str,
    body: Annotated[FollowUp, Depends(json_body(FollowUp))],
) -> Response:
    accepted = time.monotonic()
    db, owner = call.db, call.db_owner
    paper = owned_paper(call, paper_id)
    thread = db.get_thread(owner, PaperId(paper_id), thread_id)
    if thread is None:
        raise ApiError("not_found", "no such thread")
    runs.require_configured(settings)
    generation = promoted_generation(call, paper_id)
    user_message_id: str | None
    if body.retry_of is not None:
        user_message_id = _retry_target(db, owner, thread_id, body.retry_of)
    else:
        user_message_id = None
    if db.live_run_for_thread(owner, thread_id) is not None:
        raise ApiError("busy", "This conversation is still answering; wait for it or cancel it.")
    runs.require_budget(db, owner, settings)

    kind: RunKind = thread["kind"]
    index = evidence.load_index(index_cache, db, owner, call.user_id, paper_id, generation)
    datamark = mint_datamark()
    origin = from_json(thread["origin_anchor_json"]) if thread["origin_anchor_json"] else None
    plan = evidence.plan_seed(index, origin, datamark=datamark) if origin is not None else None
    state = from_json(thread["agent_state_json"]) if thread["agent_state_json"] else []
    message_id, run_id = new_id("msg"), new_id("run")
    token, token_sha256 = runs.mint_run_token()
    appended: list[str] = []

    with db.transaction():
        if user_message_id is None:
            user_message_id = new_id("msg")
            db.append_message(
                owner,
                thread_id,
                message_id=user_message_id,
                role="user",
                generation=generation,
                content=body.question,
                status="complete",
            )
            appended.append(user_message_id)
        db.append_message(
            owner,
            thread_id,
            message_id=message_id,
            role="assistant",
            generation=generation,
            content="",
            status="streaming",
            run_id=run_id,
        )
        appended.append(message_id)
        _create_run(
            db,
            owner,
            request,
            paper_id,
            generation,
            kind,
            thread_id,
            message_id,
            run_id,
            token_sha256,
            datamark,
        )
        inherited = [
            (handle, block_id)
            for handle, block_id in db.thread_handles(owner, thread_id)
            if block_id in index
        ]
        db.put_run_handles(owner, run_id, generation, inherited)
        handles = (
            db.assign_run_handles(owner, run_id, generation, plan.block_ids)
            if plan is not None
            else []
        )

    run_body = AgentRunRequest(
        run_id=run_id,
        request_id=_request_id(request) or new_id("req"),
        kind=kind,
        prompt_version=runs.PROMPT_VERSIONS[kind],
        tool=tool_access(settings, run_id, token),
        datamark=datamark,
        paper=AgentPaper(
            title=runs.paper_title(db, owner, paper_id, generation),
            page_count=paper.get("page_count"),
            generation=generation,
        ),
        seed=plan.to_wire(handles) if plan is not None else None,
        question=body.question,
        history=AgentHistory(session_id=thread_id, entries=list(state)),
        limits=runs.LIMITS[kind],
    )
    broker = RunBroker(
        spec=RunSpec(
            user_id=call.user_id,
            paper_id=paper_id,
            generation=generation,
            kind=kind,
            run_id=run_id,
            thread_id=thread_id,
            user_message_id=user_message_id,
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
    return await runs.launch(
        broker, db=db, owner=owner, on_refused=lambda: db.delete_messages(owner, appended)
    )


def _retry_target(db: PaperTreeDb, owner: OwnerId, thread_id: str, retry_of: str) -> str:
    """``retry_of`` must be an assistant answer of THIS thread that did not complete; the retry
    answers the same user turn (the message before it), so no new user message is appended."""
    messages = db.list_messages(owner, thread_id)
    for position, message in enumerate(messages):
        if message["message_id"] != retry_of:
            continue
        if message["role"] != "assistant" or position == 0:
            break
        if message["status"] not in ("error", "partial", "aborted"):
            raise ApiError("validation_failed", "retry_of: only an unfinished answer is retried")
        previous = messages[position - 1]
        if previous["role"] != "user":
            break
        return str(previous["message_id"])
    raise ApiError("validation_failed", "retry_of: not an answer of this thread")


# ── reads ────────────────────────────────────────────────────────────────────────────────────


def thread_wire(row: dict[str, Any]) -> dict[str, Any]:
    anchor = from_json(row["origin_anchor_json"]) if row["origin_anchor_json"] else None
    return {
        "thread_id": row["thread_id"],
        "kind": row["kind"],
        "title": row["title"],
        "origin_anchor": anchor,
        "created_at": wire_time(row["created_at"]),
        "updated_at": wire_time(row["updated_at"]),
        "message_count": int(row["message_count"]),
    }


def message_wire(
    row: dict[str, Any],
    run: dict[str, Any] | None,
    citations: list[dict[str, Any]],
) -> dict[str, Any]:
    failed = row["status"] in ("error", "partial", "aborted")
    return {
        "message_id": row["message_id"],
        "thread_id": row["thread_id"],
        "ordinal": row["ordinal"],
        "role": row["role"],
        "content": row["content"],
        "status": row["status"],
        "error": runs.error_wire(row["error_code"]) if failed and row["error_code"] else None,
        "generation": row["generation"],
        "run": runs.run_summary(run) if run is not None else None,
        "citations": [
            {
                "citation_id": c["citation_id"],
                "ordinal": c["ordinal"],
                "marker": c["marker"],
                "page_index": c["page_index"],
                "anchor": c["anchor"],
                "supported": c["supported"],
            }
            for c in citations
        ],
        "created_at": wire_time(row["created_at"]),
        "completed_at": wire_time(row["completed_at"]) if row["completed_at"] else None,
    }


# RESPONSES ARE BUILT, NOT RE-VALIDATED (the highlight routes' rule): the wire shape is written
# field by field and returned as JSON; `response_model` is what the OpenAPI document says, and
# `test_threads_api.py` holds every response to `contracts/api/threads.schema.json` and the model.


@router.get("/papers/{paper_id}/threads", response_model=list[Thread], responses=ERRORS)
async def list_threads(call: CallerDep, paper_id: str) -> Response:
    owned_paper(call, paper_id)
    rows = call.db.list_threads(call.db_owner, PaperId(paper_id))
    return JSONResponse([thread_wire(row) for row in rows])


@router.get("/papers/{paper_id}/threads/{thread_id}", response_model=ThreadDetail, responses=ERRORS)
async def get_thread(call: CallerDep, paper_id: str, thread_id: str) -> Response:
    owned_paper(call, paper_id)
    db, owner = call.db, call.db_owner
    thread = db.get_thread(owner, PaperId(paper_id), thread_id)
    if thread is None:
        raise ApiError("not_found", "no such thread")
    messages = db.list_messages(owner, thread_id)
    citations: dict[str, list[dict[str, Any]]] = {}
    for citation in db.list_citations(owner, [m["message_id"] for m in messages]):
        citations.setdefault(citation["message_id"], []).append(citation)
    out = []
    for message in messages:
        run = db.get_run(owner, message["run_id"]) if message["run_id"] else None
        out.append(message_wire(message, run, citations.get(message["message_id"], [])))
    return JSONResponse({"thread": thread_wire(thread), "messages": out})


# ── POST /runs/{run_id}/cancel ───────────────────────────────────────────────────────────────


@router.post(
    "/runs/{run_id}/cancel",
    status_code=status.HTTP_202_ACCEPTED,
    responses={404: {"model": ErrorEnvelope, "description": "Not this caller's run"}},
)
async def cancel_run(
    request: Request,
    call: CallerDep,
    client: AgentClientDep,
    live_runs: LiveRunsDep,
    run_id: str,
) -> Response:
    """202; propagates ``DELETE agent /v1/runs/{run_id}`` (§2.5). The streaming response then
    ends with ``done`` ``aborted`` and the partial text persisted. A finished run: 202, no-op."""
    run = call.db.get_run(call.db_owner, run_id)
    if run is None:
        raise ApiError("not_found", "no such run")
    if run["status"] == "running":
        broker = live_runs.get(run_id)
        if broker is not None and broker.spec.user_id == call.user_id:
            broker.request_cancel()
        else:
            await client.cancel(run_id, request_id=_request_id(request))
    return Response(status_code=status.HTTP_202_ACCEPTED)
