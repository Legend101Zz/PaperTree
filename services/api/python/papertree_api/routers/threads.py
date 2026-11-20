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

AN IMAGE THREAD (v0.3 #348) is about a figure or a region the reader selected: ``kind: "image"``
with an IMAGE anchor (``image_anchor``: ``figure`` or ``figure_region``, a page and one quad, no
words). The API renders the crop (``region_crops``), finds the figure's caption and the paragraph
that first mentions it (``image_context``), and runs the ``image`` kind: the crop goes to the model
as a picture, those words as passages, the answer is the tutor shape and streams like any other.
``with_text_anchor`` adds a paragraph the reader selected with the figure. It is stored as an
``ask`` thread and read back as ``image``; a follow-up (and a relevel) re-attaches the crop to ITS
turn (the stored history keeps the turn, not the bytes). The default question is "Explain this
figure."

A DIAGRAM THREAD (v0.2 S7a, #216) starts like an explain (an anchor is required; the default
question is "Explain with a diagram."). It is not continued by a question: its only next turn is a
Redraw (``FollowUp.redraw_of``, a finished diagram answer of the same thread), which appends a new
user turn and a new plate; ``redraw_of`` on any other thread, or a diagram follow-up without it,
is 422. Its assistant messages read back with ``diagram: {title, status, parts, links}``.

LEVEL, CHECK AND SIBLINGS (v0.3, #339; contracts.md §2.5). ``level`` (``new`` / ``familiar`` /
``expert``, default ``familiar``) is on ``ThreadCreate`` and ``FollowUp``, stored on the assistant
message (``ai_messages.level``, 0014) and sent to the agent. ``check`` is decided HERE, never by the
web: true only for a ``new`` answer of an explain or ask thread when no earlier answer of the thread
carried a ```check fence (at most one exercise per thread). ``FollowUp.relevel_of`` answers the same
question again at ``level``: no user turn is written, the new answer is a sibling of the one it
re-answers (``ai_messages.sibling_of`` = the group's first answer), and the thread read gives each
assistant message its ``level`` and ``sibling_group``.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any, Final, cast

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import JSONResponse, Response
from papertree_db import OwnerId, PaperId, PaperTreeDb, new_id
from papertree_db.ai import normalise_time
from papertree_prompts import mint_datamark
from pydantic_core import from_json

from .. import agent_client as runs
from .. import diagrams, evidence, image_run
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
from ..exchanges import ask_excerpt
from ..logging import log_event
from ..schemas import (
    DIAGRAM_QUESTION,
    IMAGE_QUESTION,
    AgentHistory,
    AgentPaper,
    AgentRunRequest,
    AgentToolAccess,
    AnswerLevel,
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
#: A ```check fence on its own line: an answer that carries one has used the thread's exercise.
CHECK_FENCE: Final = re.compile(r"^```check\s*$", re.MULTILINE)


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


def title_of(text: str) -> str:
    title = evidence.header_text(text, limit=TITLE_CHARS)
    return title or "Untitled"


def tool_access(settings: Settings, run_id: str, token: str) -> AgentToolAccess:
    return AgentToolAccess(
        base_url=f"{settings.api_internal_url}/internal/agent/runs/{run_id}", token=token
    )


def wants_check(
    db: PaperTreeDb, owner: OwnerId, thread_id: str | None, kind: RunKind, level: str
) -> bool:
    """Decision E: the answer ends with a self-check only at ``new`` (New to this), only on an
    explain or ask thread, and at most once per thread (no earlier answer carried one)."""
    if kind not in ("explain", "ask") or level != "new":
        return False
    if thread_id is None:
        return True
    return not any(
        message["role"] == "assistant" and CHECK_FENCE.search(message["content"]) is not None
        for message in db.list_messages(owner, thread_id)
    )


def stored_level(kind: RunKind, level: str) -> str | None:
    """Only an explain, ask or image answer has a level; a diagram's is not stored."""
    return level if kind in ("explain", "ask", "image") else None


def stored_kind(kind: RunKind) -> str:
    """The ``ai_threads.kind`` of a thread of this run kind: an image thread is an ``ask`` thread
    (0017 does not rebuild the thread table); the store reads it back as ``image`` by its run."""
    return "ask" if kind == "image" else kind


def run_extras(prepared: image_run.ImageRun | None) -> dict[str, Any]:
    """The run request's ``images`` for an image run, and nothing at all for any other kind (an
    omittable field is absent, never null)."""
    return {} if prepared is None else {"images": prepared.images}


def request_id_of(request: Request) -> str | None:
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
    kind: RunKind = body.kind
    question = body.question
    if kind == "diagram" and "question" not in body.model_fields_set:
        question = DIAGRAM_QUESTION
    if kind == "image" and "question" not in body.model_fields_set:
        question = IMAGE_QUESTION
    prepared: image_run.ImageRun | None = None
    if kind == "image":
        assert anchor is not None  # ThreadCreate requires an image anchor for this kind
        with_text: dict[str, Any] | None = None
        if body.with_text_anchor is not None:
            with_text = {
                k: v for k, v in dict(raw["with_text_anchor"]).items() if k != "resolution"
            }
            check_anchor(with_text, paper_id, str(paper["source_hash"]))
        prepared = await image_run.prepare_image_run(
            settings,
            index,
            anchor,
            paper_id=paper_id,
            generation=generation,
            datamark=datamark,
            question=question,
            with_text_anchor=with_text,
        )
        plan: evidence.SeedPlan | None = prepared.seed
    else:
        plan = evidence.plan_seed(index, anchor, datamark=datamark) if anchor is not None else None
    thread_id, user_message_id = new_id("thr"), new_id("msg")
    message_id, run_id = new_id("msg"), new_id("run")
    token, token_sha256 = runs.mint_run_token()
    if prepared is not None:
        title = prepared.title
    else:
        title = title_of(plan.quote if plan is not None and plan.quote else question)

    db, owner = call.db, call.db_owner
    with db.transaction():
        db.create_thread(
            owner,
            PaperId(paper_id),
            thread_id=thread_id,
            kind=stored_kind(kind),
            title=title,
            origin_anchor=anchor,
        )
        db.append_message(
            owner,
            thread_id,
            message_id=user_message_id,
            role="user",
            generation=generation,
            content=question,
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
            level=stored_level(kind, body.level),
        )
        create_run_row(
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
        request_id=request_id_of(request) or new_id("req"),
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
        question=question,
        history=None,
        limits=runs.LIMITS[kind],
        level=body.level,
        check=wants_check(db, owner, None, kind, body.level),
        **run_extras(prepared),
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


def create_run_row(
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
        request_id=request_id_of(request),
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
    user_message_id: str | None = None
    _check_redraw(db, owner, thread, body.redraw_of, retry=body.retry_of is not None)
    releveled = _relevel_target(db, owner, thread, body) if body.relevel_of is not None else None
    level: AnswerLevel = body.level
    if body.retry_of is not None:
        user_message_id = _retry_target(db, owner, thread_id, body.retry_of)
        if "level" not in body.model_fields_set:  # a retry keeps the level it was asked at
            level = _message_level(db, owner, body.retry_of) or level
    if db.live_run_for_thread(owner, thread_id) is not None:
        raise ApiError("busy", "This conversation is still answering; wait for it or cancel it.")
    runs.require_budget(db, owner, settings)

    kind: RunKind = thread["kind"]
    question = body.question
    sibling_of: str | None = None
    if releveled is not None:
        question, user_message_id, sibling_of = (
            releveled.question,
            releveled.question_id,
            releveled.group,
        )
    index = evidence.load_index(index_cache, db, owner, call.user_id, paper_id, generation)
    datamark = mint_datamark()
    origin = from_json(thread["origin_anchor_json"]) if thread["origin_anchor_json"] else None
    prepared: image_run.ImageRun | None = None
    if kind == "image" and origin is not None:
        # The picture goes with THIS turn too (the stored history keeps no bytes).
        prepared = await image_run.prepare_image_run(
            settings,
            index,
            origin,
            paper_id=paper_id,
            generation=generation,
            datamark=datamark,
            question=question,
        )
        plan: evidence.SeedPlan | None = prepared.seed
    else:
        plan = evidence.plan_seed(index, origin, datamark=datamark) if origin is not None else None
    state = from_json(thread["agent_state_json"]) if thread["agent_state_json"] else []
    if releveled is not None and releveled.is_last_question:
        state = _before_last_question(state)  # the model re-answers it, not "as above"
    message_id, run_id = new_id("msg"), new_id("run")
    token, token_sha256 = runs.mint_run_token()
    appended: list[str] = []
    check = wants_check(db, owner, thread_id, kind, level)

    with db.transaction():
        if user_message_id is None:
            user_message_id = new_id("msg")
            db.append_message(
                owner,
                thread_id,
                message_id=user_message_id,
                role="user",
                generation=generation,
                content=question,
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
            level=stored_level(kind, level),
            sibling_of=sibling_of,
        )
        appended.append(message_id)
        create_run_row(
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
        request_id=request_id_of(request) or new_id("req"),
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
        question=question,
        history=(
            None  # a first question re-asked: a first turn again (the quote is in the user turn)
            if releveled is not None and not state
            else AgentHistory(session_id=thread_id, entries=list(state))
        ),
        limits=runs.LIMITS[kind],
        level=level,
        check=check,
        **run_extras(prepared),
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


@dataclass(frozen=True, slots=True)
class _Relevel:
    """What a relevel answers: the stored question, and the group it joins."""

    question: str
    question_id: str
    group: str
    #: No later question exists, so the thread's stored history ends with this one's turn.
    is_last_question: bool


def _message_level(db: PaperTreeDb, owner: OwnerId, message_id: str) -> AnswerLevel | None:
    message = db.get_message(owner, message_id)
    return None if message is None else cast("AnswerLevel | None", message["level"])


def _relevel_target(
    db: PaperTreeDb, owner: OwnerId, thread: dict[str, Any], body: FollowUp
) -> _Relevel:
    """``relevel_of`` must be a finished assistant answer of THIS explain or ask thread, alone (not
    with a retry or a redraw); the new answer re-answers the user turn before the group's first
    answer, so no user message is written."""
    if body.retry_of is not None or body.redraw_of is not None:
        raise ApiError("validation_failed", "relevel_of: not combined with retry_of or redraw_of")
    if thread["kind"] not in ("explain", "ask", "image"):
        raise ApiError(
            "validation_failed", "relevel_of: only an explain, ask or image answer is re-leveled"
        )
    messages = db.list_messages(owner, thread["thread_id"])
    by_id = {message["message_id"]: message for message in messages}
    target = by_id.get(str(body.relevel_of))
    if target is None or target["role"] != "assistant":
        raise ApiError("validation_failed", "relevel_of: not an answer of this thread")
    if target["status"] != "complete":
        raise ApiError("validation_failed", "relevel_of: only a finished answer is re-leveled")
    group = by_id.get(str(target["sibling_of"] or target["message_id"]), target)
    previous = next(
        (m for m in reversed(messages) if m["ordinal"] < group["ordinal"] and m["role"] == "user"),
        None,
    )
    if previous is None:
        raise ApiError("validation_failed", "relevel_of: that answer has no question to re-ask")
    return _Relevel(
        question=str(previous["content"]),
        question_id=str(previous["message_id"]),
        group=str(group["message_id"]),
        is_last_question=not any(
            m["role"] == "user" and m["ordinal"] > group["ordinal"] for m in messages
        ),
    )


def _before_last_question(state: list[Any]) -> list[Any]:
    """The agent's stored entries up to (not including) the last user message."""
    for index in range(len(state) - 1, -1, -1):
        message = state[index].get("message") if isinstance(state[index], dict) else None
        if isinstance(message, dict) and message.get("role") == "user":
            return list(state[:index])
    return list(state)


def _check_redraw(
    db: PaperTreeDb, owner: OwnerId, thread: dict[str, Any], redraw_of: str | None, *, retry: bool
) -> None:
    """A diagram thread takes a Redraw (of one of its own answers) and nothing else; no other
    thread takes one (422). A plate still drawing is not refused here: its live run makes the
    thread 409 ``busy`` (the check after this one), and a run that died is swept, so its plate can
    be redrawn."""
    if thread["kind"] != "diagram":
        if redraw_of is not None:
            raise ApiError("validation_failed", "redraw_of: only a diagram answer is redrawn")
        return
    if retry or redraw_of is None:
        raise ApiError(
            "validation_failed", "redraw_of: a diagram thread is redrawn, not continued or retried"
        )
    message = db.get_message(owner, redraw_of)
    if (
        message is None
        or message["thread_id"] != thread["thread_id"]
        or message["role"] != "assistant"
    ):
        raise ApiError("validation_failed", "redraw_of: not a diagram answer of this thread")


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
        "ask": ask_excerpt(row["first_ask"]),
        "last_status": row["last_status"],
    }


def run_is_live(run: dict[str, Any] | None) -> bool:
    return (
        run is not None
        and run["status"] == "running"
        and normalise_time(run["expires_at"]) > normalise_time(datetime.now(UTC))
    )


def _citation_wire(c: dict[str, Any], locators: evidence.PassageLocators | None) -> dict[str, Any]:
    """One stored citation as the wire shape, with its derived ``locator`` when one can be had."""
    item: dict[str, Any] = {
        "citation_id": c["citation_id"],
        "ordinal": c["ordinal"],
        "marker": c["marker"],
        "page_index": c["page_index"],
        "anchor": c["anchor"],
    }
    locator = locators.locate(c["anchor"]) if locators is not None else None
    if locator is not None:
        item["locator"] = locator
    return item


def _level_wire(row: dict[str, Any], thread_kind: str | None) -> str | None:
    if row["role"] != "assistant":
        return None
    if row["level"] is not None:
        return str(row["level"])
    return "familiar" if thread_kind in ("explain", "ask", "image") else None


def message_wire(
    row: dict[str, Any],
    run: dict[str, Any] | None,
    citations: list[dict[str, Any]],
    locators: evidence.PassageLocators | None = None,
    parts: list[dict[str, Any]] | None = None,
    thread_kind: str | None = None,
) -> dict[str, Any]:
    """One stored message as the wire shape. ``locators`` (the parse of the message's generation,
    None when that parse can no longer be loaded) adds each citation's ``locator``; an assistant
    ``parts`` (a diagram thread's assistant message only, possibly empty) makes it a plate:
    ``diagram``. There is no coverage readout (#341). ``level`` and ``sibling_group`` are an
    assistant message's (0014): an answer stored before v0.3 has no level and reads ``familiar``
    on an explain or ask thread."""
    status, error_code = row["status"], row["error_code"]
    if status == "streaming" and not run_is_live(run):
        # An answer whose run can no longer finish (the API process stopped mid-stream, so no
        # `done` was ever persisted, and the token has expired): shown as ended, with its text,
        # not as a stream a reader would wait on forever. The stored row is not rewritten.
        status = "partial" if row["content"] else "error"
        error_code = "agent_unavailable"
    failed = status in ("error", "partial", "aborted")
    cited = [_citation_wire(c, locators) for c in citations]
    wire: dict[str, Any] = {
        "message_id": row["message_id"],
        "thread_id": row["thread_id"],
        "ordinal": row["ordinal"],
        "role": row["role"],
        "content": row["content"],
        "status": status,
        "error": runs.error_wire(error_code) if failed and error_code else None,
        "generation": row["generation"],
        "run": runs.run_summary(run) if run is not None else None,
        "citations": cited,
        "level": _level_wire(row, thread_kind),
        "sibling_group": row["sibling_of"] or row["message_id"]
        if row["role"] == "assistant"
        else None,
        "created_at": wire_time(row["created_at"]),
        "completed_at": wire_time(row["completed_at"]) if row["completed_at"] else None,
    }
    if parts is not None:
        wire["diagram"] = diagrams.diagram_wire(row["diagram"], status, parts, locators)
    return wire


# RESPONSES ARE BUILT, NOT RE-VALIDATED (the highlight routes' rule): the wire shape is written
# field by field and returned as JSON; `response_model` is what the OpenAPI document says, and
# `test_threads_api.py` holds every response to `contracts/api/threads.schema.json` and the model.


def _locators(
    call: Caller, cache: IndexCacheDep, paper_id: str, generation: int
) -> evidence.PassageLocators | None:
    """The locators of one generation's parse, None if it can no longer be loaded (the citations
    are then shown by page only, the same as a caption)."""
    try:
        index = evidence.load_index(
            cache, call.db, call.db_owner, call.user_id, paper_id, generation
        )
        return evidence.PassageLocators(index)
    except Exception as error:  # a missing or unreadable parse must not fail the thread read
        log_event(
            "thread.locators_unavailable",
            level="warning",
            paper_id=paper_id,
            error_type=type(error).__name__,
        )
        return None


@router.get("/papers/{paper_id}/threads", response_model=list[Thread], responses=ERRORS)
async def list_threads(
    call: CallerDep,
    paper_id: str,
    include_board: Annotated[bool, Query()] = False,
) -> Response:
    """The reader's threads. A board answer's thread is not one of them (0016); the board reads its
    own answers' sources with ``include_board=true``."""
    owned_paper(call, paper_id)
    runs.sweep_orphans(call.db)
    rows = call.db.list_threads(call.db_owner, PaperId(paper_id), board_threads=include_board)
    return JSONResponse([thread_wire(row) for row in rows])


@router.get("/papers/{paper_id}/threads/{thread_id}", response_model=ThreadDetail, responses=ERRORS)
async def get_thread(
    call: CallerDep, paper_id: str, thread_id: str, cache: IndexCacheDep
) -> Response:
    owned_paper(call, paper_id)
    db, owner = call.db, call.db_owner
    runs.sweep_orphans(db)
    thread = db.get_thread(owner, PaperId(paper_id), thread_id)
    if thread is None:
        raise ApiError("not_found", "no such thread")
    messages = db.list_messages(owner, thread_id)
    citations: dict[str, list[dict[str, Any]]] = {}
    for citation in db.list_citations(owner, [m["message_id"] for m in messages]):
        citations.setdefault(citation["message_id"], []).append(citation)
    plates: dict[str, list[dict[str, Any]]] | None = None
    if thread["kind"] == "diagram":
        answers = [m["message_id"] for m in messages if m["role"] == "assistant"]
        plates = {message_id: [] for message_id in answers}
        for part in db.list_diagram_parts(owner, answers):
            plates[part["message_id"]].append(part)
    parses: dict[int, evidence.PassageLocators | None] = {}  # one parse per generation read
    out = []
    for message in messages:
        run = db.get_run(owner, message["run_id"]) if message["run_id"] else None
        mine = citations.get(message["message_id"], [])
        parts = plates.get(message["message_id"]) if plates is not None else None
        anchored = any(part["anchor"] is not None for part in parts or [])
        generation = int(message["generation"])
        if (mine or anchored) and generation not in parses:
            parses[generation] = _locators(call, cache, paper_id, generation)
        out.append(message_wire(message, run, mine, parses.get(generation), parts, thread["kind"]))
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
            await client.cancel(run_id, request_id=request_id_of(request))
    return Response(status_code=status.HTTP_202_ACCEPTED)
