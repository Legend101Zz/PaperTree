"""v0.3 (#343): asking the AI on the board, and keeping words as a note.

    POST /boards/{bid}/nodes/{nid}/asks    AskCreate  -> 200 SSE: `node`, `run`, `text`, … `done`
    POST /boards/{bid}/nodes/{nid}/notes   NoteCreate -> 201 CanvasNode (no AI call)

An ask grows a BRANCH from the card it is asked about. It reuses the thread machinery (a thread of
kind ``ask`` with one user message and one streaming answer, so the answer card keeps its
``source_message_id`` and the answer is stored, cited and counted like any ask), but the agent's
history is the board PATH (``board_path``), never the thread's stored state, and the card is
created up front: the stream's first event, ``node``, carries it.

THE RULES THIS ROUTE ENFORCES (spec §1; the store enforces the same on every write):

* rule 3, the branch. ``down`` exists only under an ANSWER card: an ask with no span and no
  ``ask_differently`` on an answer that has no ``down`` child is ``down`` ("Follow up"). Every other
  ask is ``right``: every ask on a passage, "Ask differently", every span ask.
* rule 4, a span stores ``{start, end, quote}`` and its words must be the words at those UTF-16
  offsets of the parent's stored answer (422 otherwise; the parent must have finished).
* rule 5, what is sent: the root passage, the ancestors' turns (the parent and grandparent in
  full, older ones as their TL;DR), the selected words, the attached cards; never a sibling.
  ``uses.paper``: ``page`` the root's page ±1 through the seed planner with no tools, ``whole`` the
  usual seed with tools, ``off`` the root's words only with no tools.
* rule 6, frozen: a retry or re-level (``redo_of``) of an answer that has children makes a ``right``
  sibling; a retry of a FAILED answer with no children replaces it in place; a finished answer is
  never rewritten.
* rule 7: Keep as note makes no agent call.
* rule 8: ``check`` is always false; the quick asks are fixed questions.
* an IMAGE ROOT (v0.3 #348: an ``excerpt`` whose anchor is a ``figure`` or ``figure_region``): the
  tree is about a picture, so EVERY ask down the path (the root's, an answer's, a branch's) runs as
  an ``image`` run: the root's crop is rendered and sent with the new question, with the figure's
  caption (and, unless ``uses.paper`` is ``off``, the paragraph that first mentions it) as the seed;
  the ancestors' turns are the history as usual and carry no bytes. ``uses.paper`` ``whole`` allows
  the tools, any other value none.

Errors, in order, all before a row is written: 404 (not this owner's board or card), 503
``not_configured``, 409 ``not_parsed``, 422, 409 ``busy`` (the answer being asked about is still
streaming), 429 ``budget_exhausted``; then the agent is opened (503 ``agent_unavailable`` removes
what this request wrote).
"""

from __future__ import annotations

import time
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from papertree_db import (
    CanvasRejected,
    NodeAnswer,
    NodeRow,
    PaperId,
    new_id,
)
from papertree_db.canvas import check_span
from papertree_prompts import mint_datamark

from .. import agent_client as runs
from .. import board_path, evidence, image_run
from ..agent_client import RunBroker, RunKind, RunSpec, sse
from ..deps import (
    AgentClientDep,
    Caller,
    CallerDep,
    DocumentsDep,
    IndexCacheDep,
    LiveRunsDep,
    SettingsDep,
)
from ..errors import ApiError
from ..image_anchor import is_image_anchor
from ..schemas import (
    AgentHistory,
    AgentPaper,
    AgentRunRequest,
    AgentSeed,
    AskCreate,
    NodeUses,
    NoteCreate,
    ParentSpan,
)
from . import threads
from ._shared import json_body
from .boards import node_wire, wire_nodes

router = APIRouter()

QUICK_QUESTIONS: Final = {
    "simpler": "Explain this more simply.",
    "example": "Give me a concrete example of this.",
    "diagram": "Draw a diagram of this.",
}
#: Where a new card is first put (the web's Tidy layout moves it; these only keep it off its
#: parent): to the right of the parent, or below it.
CARD_W: Final = 360.0
CARD_H: Final = 220.0
GAP: Final = 48.0
BOARD_ERRORS: Final[dict[int | str, dict[str, Any]]] = {**threads.EVENT_STREAM}


def _board_nodes(
    call: Caller, board_id: str
) -> tuple[Any, dict[str, NodeRow], dict[str, NodeAnswer]]:
    """The owner's board with every card and answer, or 404 (another owner's board is the same)."""
    snapshot = call.db.get_board_by_id(call.db_owner, board_id)
    if snapshot.board is None or snapshot.board.paper_id is None:
        raise ApiError("not_found", "no such board")
    return snapshot, {n.node_id: n for n in snapshot.nodes}, dict(snapshot.answers)


def _card(nodes: dict[str, NodeRow], node_id: str) -> NodeRow:
    node = nodes.get(node_id)
    if node is None:
        raise ApiError("not_found", "no such node on this board")
    return node


def _place(parent: NodeRow, branch: str, nodes: dict[str, NodeRow]) -> tuple[float, float]:
    """A first position for a child, which the web's Tidy layout then replaces.

    Right of the parent (below any sibling already there), or below it for a ``down`` child.
    """
    if branch == "down":
        return parent.x, parent.y + parent.h + GAP
    siblings = [n for n in nodes.values() if n.parent_id == parent.node_id and n.branch == "right"]
    below = max((n.y + n.h for n in siblings), default=None)
    return parent.x + parent.w + GAP, parent.y if below is None else below + GAP


def _has_down_child(nodes: dict[str, NodeRow], parent_id: str) -> bool:
    return any(n.parent_id == parent_id and n.branch == "down" for n in nodes.values())


def _children(nodes: dict[str, NodeRow], parent_id: str) -> bool:
    return any(n.parent_id == parent_id for n in nodes.values())


def decide_branch(
    parent: NodeRow, nodes: dict[str, NodeRow], *, span: bool, ask_differently: bool
) -> str:
    """Rule 3: which way a new card leaves its parent.

    ``down`` only under an answer card, only for a plain ask, only while the answer has no
    ``down`` child; everything else branches ``right``.
    """
    if parent.kind != "explanation" or span or ask_differently:
        return "right"
    return "down" if not _has_down_child(nodes, parent.node_id) else "right"


# ── POST /boards/{bid}/nodes/{nid}/asks ──────────────────────────────────────────────────────


@router.post("/boards/{board_id}/nodes/{node_id}/asks", responses=BOARD_ERRORS)
async def ask_on_board(
    request: Request,
    call: CallerDep,
    settings: SettingsDep,
    client: AgentClientDep,
    index_cache: IndexCacheDep,
    documents: DocumentsDep,
    live_runs: LiveRunsDep,
    board_id: str,
    node_id: str,
    body: Annotated[AskCreate, Depends(json_body(AskCreate))],
) -> Response:
    """Ask about a card as a branch of it: `node`, then the answer's events (module docstring)."""
    accepted = time.monotonic()
    db, owner = call.db, call.db_owner
    snapshot, nodes, answers = _board_nodes(call, board_id)
    assert snapshot.board is not None and snapshot.board.paper_id is not None
    paper_id = snapshot.board.paper_id
    target = _card(nodes, node_id)
    paper = threads.owned_paper(call, paper_id)
    runs.require_configured(settings)
    generation = threads.promoted_generation(call, paper_id)
    runs.sweep_orphans(db)

    # ── what is being asked, and from where (rules 3, 4, 6) ──
    redo: NodeRow | None = None
    replaces = False
    parent = target
    span = body.span
    ask_differently = body.ask_differently
    question = body.question
    if body.redo_of is not None:
        redo = _card(nodes, body.redo_of)
        if redo.kind != "explanation" or redo.parent_id is None or redo.parent_id not in nodes:
            raise ApiError(
                "validation_failed", "redo_of: only an answer with a card above it is re-asked"
            )
        if redo.node_id != node_id and redo.parent_id != node_id:
            raise ApiError("validation_failed", "redo_of: not an answer of that card")
        parent = nodes[redo.parent_id]
        old = answers.get(redo.node_id)
        if old is not None and old.status == "streaming":
            raise ApiError("busy", "That answer is still being written; wait for it or cancel it.")
        failed = old is not None and old.status in ("error", "partial", "aborted")
        # Rule 6: a failed answer with no children is replaced in place; any other is never
        # rewritten, its re-ask is a `right` sibling.
        replaces = failed and not _children(nodes, redo.node_id)
        span = ParentSpan(**redo.parent_span) if redo.parent_span is not None else None
        question = redo.question or question
        ask_differently = True
    elif target.kind not in ("excerpt", "explanation"):
        raise ApiError("validation_failed", "node: only a passage or an answer can be asked about")
    if question is None:
        question = QUICK_QUESTIONS[body.quick] if body.quick is not None else None
    if question is None:
        raise ApiError("validation_failed", "question: required")
    if body.quick is not None and body.question is None and redo is None:
        question = QUICK_QUESTIONS[body.quick]

    parent_answer = answers.get(parent.node_id)
    if parent.kind == "explanation" and (
        parent_answer is None or parent_answer.status == "streaming"
    ):
        raise ApiError("busy", "That answer is still being written; wait for it or cancel it.")
    if span is not None:
        if parent.kind != "explanation" or parent_answer is None:
            raise ApiError("validation_failed", "span: only an answer has words to branch from")
        try:
            check_span(span.model_dump(), parent_answer.final_text)
        except CanvasRejected as exc:
            raise ApiError(exc.code, exc.detail) from exc
    if redo is not None:
        branch = (redo.branch or "right") if replaces else "right"  # else: a sibling (rule 6)
    else:
        branch = decide_branch(
            parent, nodes, span=span is not None, ask_differently=ask_differently
        )
    level = body.level or body.uses.level
    diagram = body.uses.diagram
    if body.quick == "simpler":
        level = "new"
    if body.quick == "diagram":
        diagram = "always"
    uses = NodeUses(
        path=body.uses.path,
        paper=body.uses.paper,
        level=level,
        diagram=diagram,
        extra_node_ids=body.uses.extra_node_ids,
    )
    for extra in uses.extra_node_ids:
        if extra not in nodes:
            raise ApiError("validation_failed", "uses.extra_node_ids: not a card on this board")
    new_id_ = body.node_id or new_id("cn")
    if (not replaces) and new_id_ in nodes:
        raise ApiError("validation_failed", "node_id: already in use")

    # ── the path, the seed and the request (rule 5) ──
    plan = board_path.build_path(nodes, answers, parent.node_id, path=uses.path)
    runs.require_budget(db, owner, settings)
    index = evidence.load_index(index_cache, db, owner, call.user_id, paper_id, generation)
    anchor = dict(plan.root_anchor) if plan.root_anchor is not None else None
    if anchor is not None:
        threads.check_anchor(anchor, paper_id, str(paper["source_hash"]))
    datamark = mint_datamark()
    seed_plan: evidence.SeedPlan | None = None
    run_kind: RunKind = "ask"
    prepared: image_run.ImageRun | None = None
    if anchor is not None and is_image_anchor(anchor):
        run_kind = "image"
        prepared = await image_run.prepare_image_run(
            settings,
            index,
            anchor,
            paper_id=paper_id,
            generation=generation,
            datamark=datamark,
            question=question,
            include_nearby=uses.paper != "off",
        )
        seed_plan = prepared.seed
    elif anchor is not None:
        if uses.paper == "page":
            seed_plan = evidence.plan_page_seed(index, anchor, datamark=datamark)
        elif uses.paper == "whole":
            seed_plan = evidence.plan_seed(index, anchor, datamark=datamark)
        else:
            seed_plan = evidence.plan_quote_seed(index, anchor)
    history = board_path.history_entries(plan, datamark)
    attached = [
        board_path.attached_text(nodes, answers, extra, datamark) for extra in uses.extra_node_ids
    ]
    agent_question = board_path.compose_question(
        question, span.quote if span is not None else None, attached
    )
    limits = runs.LIMITS[run_kind]
    if uses.paper != "whole":
        limits = limits.model_copy(update={"max_tool_calls": 0})

    thread_id, user_message_id = new_id("thr"), new_id("msg")
    message_id, run_id = new_id("msg"), new_id("run")
    token, token_sha256 = runs.mint_run_token()
    quote_for_title = seed_plan.quote if seed_plan is not None and seed_plan.quote else question
    if prepared is not None:
        quote_for_title = prepared.title
    old_message = redo.source_message_id if redo is not None else None
    old_uses = dict(redo.uses) if redo is not None and redo.uses is not None else None

    with db.transaction():
        db.create_thread(
            owner,
            PaperId(paper_id),
            thread_id=thread_id,
            kind="ask",
            title=threads.title_of(quote_for_title),
            origin_anchor=anchor,
            board_id=board_id,  # the board path's record, not one of the reader's threads
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
            level=uses.level,
        )
        threads.create_run_row(
            db, owner, request, paper_id, generation, run_kind, thread_id, message_id, run_id,
            token_sha256, datamark,
        )  # fmt: skip
        handles = (
            db.assign_run_handles(owner, run_id, generation, seed_plan.block_ids)
            if seed_plan is not None
            else []
        )
        uses_wire = uses.model_dump()
        try:
            if replaces and redo is not None:
                stored = db.swap_answer(
                    owner, board_id, redo.node_id, message_id=message_id, uses=uses_wire
                )
                assert stored is not None
            else:
                x, y = _place(parent, branch, nodes)
                stored = db.create_node(
                    owner,
                    PaperId(paper_id),
                    {
                        "node_id": new_id_,
                        "kind": "explanation",
                        "x": x,
                        "y": y,
                        "w": CARD_W,
                        "h": CARD_H,
                        "source_message_id": message_id,
                        "parent_id": parent.node_id,
                        "branch": branch,
                        "parent_span": span.model_dump() if span is not None else None,
                        "question": question,
                        "uses": uses_wire,
                    },
                )
        except CanvasRejected as exc:
            raise ApiError(exc.code, exc.detail) from exc

    run_body = AgentRunRequest(
        run_id=run_id,
        request_id=threads.request_id_of(request) or new_id("req"),
        kind=run_kind,
        prompt_version=runs.PROMPT_VERSIONS[run_kind],
        tool=threads.tool_access(settings, run_id, token),
        datamark=datamark,
        paper=AgentPaper(
            title=runs.paper_title(db, owner, paper_id, generation),
            page_count=paper.get("page_count"),
            generation=generation,
        ),
        seed=_seed_wire(seed_plan, handles),
        question=agent_question,
        history=AgentHistory(session_id=thread_id, entries=history) if history else None,
        limits=limits,
        level=uses.level,
        check=False,  # the board never carries a Check-yourself block (rule 8)
        diagram=uses.diagram,
        **threads.run_extras(prepared),
    )
    fresh = db.node_answers(owner, (stored,))
    preface = sse("node", node_wire(stored, None, fresh.get(stored.node_id)))
    broker = RunBroker(
        spec=RunSpec(
            user_id=call.user_id,
            paper_id=paper_id,
            generation=generation,
            kind=run_kind,
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
        preface=preface,
    )

    def undo() -> None:
        """The agent refused: this request's rows go again, and the card is as it was."""
        if replaces and redo is not None:
            if old_message is not None:
                db.swap_answer(
                    owner, board_id, redo.node_id, message_id=old_message, uses=old_uses,
                    restore=True,
                )  # fmt: skip
        else:
            db.delete_node(owner, board_id, stored.node_id)
        db.delete_thread(owner, PaperId(paper_id), thread_id)

    return await runs.launch(broker, db=db, owner=owner, on_refused=undo)


def _seed_wire(plan: evidence.SeedPlan | None, handles: list[str]) -> AgentSeed | None:
    return plan.to_wire(handles) if plan is not None else None


# ── POST /boards/{bid}/nodes/{nid}/notes ─────────────────────────────────────────────────────


@router.post("/boards/{board_id}/nodes/{node_id}/notes", status_code=201)
async def keep_as_note(
    call: CallerDep,
    board_id: str,
    node_id: str,
    body: Annotated[NoteCreate, Depends(json_body(NoteCreate))],
) -> Response:
    """Keep as note (rule 7): the selected words become a `note` card to the right of the answer.

    Branch `right`, with the span; no agent call, no usage.
    """
    snapshot, nodes, answers = _board_nodes(call, board_id)
    assert snapshot.board is not None and snapshot.board.paper_id is not None
    parent = _card(nodes, node_id)
    if parent.kind != "explanation" or parent.node_id not in answers:
        raise ApiError("validation_failed", "node: only an answer has words to keep")
    note_id = body.node_id or new_id("cn")
    if note_id in nodes:
        raise ApiError("validation_failed", "node_id: already in use")
    x, y = _place(parent, "right", nodes)
    try:
        stored = call.db.create_node(
            call.db_owner,
            PaperId(snapshot.board.paper_id),
            {
                "node_id": note_id,
                "kind": "note",
                "x": x,
                "y": y,
                "w": CARD_W,
                "h": 120.0,
                "body": body.text,
                "parent_id": parent.node_id,
                "branch": "right",
                "parent_span": body.span.model_dump(),
            },
        )
    except CanvasRejected as exc:
        raise ApiError(exc.code, exc.detail) from exc
    return JSONResponse(wire_nodes(call, (stored,))[0], status_code=201)
