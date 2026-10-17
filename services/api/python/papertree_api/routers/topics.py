"""#193 part 1: topics (the shelf's own groupings) and each paper's place under them.

    GET     /topics                          -> [Topic]
    POST    /topics            TopicCreate   -> 201 Topic | 409 topic_exists
    PATCH   /topics/{topic_id} TopicPatch    -> Topic     | 409 topic_exists
    DELETE  /topics/{topic_id}               -> 204   (its papers become unshelved)
    GET     /papers/{id}/topic               -> PaperTopic   (stores a first OFFER if there is none)
    PUT     /papers/{id}/topic PaperTopicPut -> PaperTopic   (accept; creates the topic if new)
    POST    /papers/{id}/topic/reject        -> PaperTopic
    DELETE  /papers/{id}/topic               -> PaperTopic   (unshelved: status none)

A suggestion never shelves a paper: only PUT does, and only the caller's PUT. Another owner's
paper or topic is a 404, never a 403. `owner_id` never leaves: the wire models are built field
by field from the data layer's rows.
"""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Response, status
from papertree_db import UNSET, PaperId, PaperTopicRow, TopicExists, TopicRow

from ..deps import AgentClientDep, CallerDep, IndexCacheDep, SettingsDep, TopicTasksDep
from ..errors import ApiError
from ..schemas import (
    Cloth,
    PaperTopic,
    PaperTopicPut,
    Topic,
    TopicCreate,
    TopicPatch,
    TopicRef,
)
from ..topic_run import TopicRunDeps
from ..topic_suggestion import offer_topic
from ._shared import json_body

router = APIRouter()


def _topic(row: TopicRow) -> Topic:
    return Topic(
        topic_id=row.topic_id,
        name=row.name,
        cloth=cast(Cloth | None, row.cloth),
        sort_order=row.sort_order,
        paper_count=row.paper_count,
        page_count=row.page_count,
        categories=list(row.categories),
    )


def _paper_topic(row: PaperTopicRow) -> PaperTopic:
    ref = row.topic
    return PaperTopic(
        status=row.status,
        topic=None
        if ref is None
        else TopicRef(topic_id=ref.topic_id, name=ref.name, cloth=cast(Cloth | None, ref.cloth)),
        suggested_name=row.suggested_name,
        source=row.source,
        source_detail=row.source_detail,
        arxiv_category=row.arxiv_category,
    )


def _exists(exc: TopicExists) -> ApiError:
    return ApiError("topic_exists", str(exc))


@router.get("/topics", response_model=list[Topic])
async def list_topics(call: CallerDep) -> list[Topic]:
    """The caller's topics in shelf order, each with its accepted papers' counts and categories."""
    return [_topic(row) for row in call.db.list_topics(call.db_owner)]


@router.post("/topics", response_model=Topic, status_code=status.HTTP_201_CREATED)
async def create_topic(
    call: CallerDep, body: Annotated[TopicCreate, Depends(json_body(TopicCreate))]
) -> Topic:
    """Creates a topic: 201 with it.

    409 `topic_exists` for a name the caller already uses, in any letter case; 422 for an empty or
    over-60-character name.
    """
    try:
        return _topic(call.db.create_topic(call.db_owner, body.name, body.cloth))
    except TopicExists as exc:
        raise _exists(exc) from exc


@router.patch("/topics/{topic_id}", response_model=Topic)
async def patch_topic(
    call: CallerDep,
    topic_id: str,
    body: Annotated[TopicPatch, Depends(json_body(TopicPatch))],
) -> Topic:
    """Renames, recolours or reorders; only the fields sent change. 404 if not the caller's."""
    try:
        return _topic(
            call.db.update_topic(
                call.db_owner,
                topic_id,
                name=body.name,
                # Sent as null clears the colour; left out keeps it.
                cloth=body.cloth if "cloth" in body.model_fields_set else UNSET,
                sort_order=body.sort_order,
            )
        )
    except TopicExists as exc:
        raise _exists(exc) from exc


@router.delete("/topics/{topic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic(call: CallerDep, topic_id: str) -> Response:
    """204. The topic's papers become unshelved; the papers themselves are untouched."""
    call.db.delete_topic(call.db_owner, topic_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/papers/{paper_id}/topic", response_model=PaperTopic)
async def get_paper_topic(
    call: CallerDep,
    paper_id: str,
    settings: SettingsDep,
    client: AgentClientDep,
    index_cache: IndexCacheDep,
    tasks: TopicTasksDep,
) -> PaperTopic:
    """Where the paper sits.

    With no row yet, a first offer is computed and stored: the deterministic rule, else (once per
    paper, never for one the person has decided about) the Flash `topic` run, which starts in the
    BACKGROUND: this read answers `status: "none"` at once and a later read returns the offer. A
    model offer says `source: "model"` and `source_detail` is the model id.
    """
    return _paper_topic(
        offer_topic(call, paper_id, TopicRunDeps(settings, client, index_cache, tasks))
    )


@router.put("/papers/{paper_id}/topic", response_model=PaperTopic)
async def put_paper_topic(
    call: CallerDep,
    paper_id: str,
    body: Annotated[PaperTopicPut, Depends(json_body(PaperTopicPut))],
) -> PaperTopic:
    """Accepts a topic for the paper: an existing `topic_id`, or `new_topic_name`.

    Records `decided_at`. Choosing the offered topic keeps its source ("you accepted").
    """
    if (body.topic_id is None) == (body.new_topic_name is None):
        raise ApiError("validation_failed", "body: send exactly one of topic_id, new_topic_name")
    return _paper_topic(
        call.db.accept_topic(
            call.db_owner,
            PaperId(paper_id),
            topic_id=body.topic_id,
            new_topic_name=body.new_topic_name,
            cloth=body.cloth,
        )
    )


@router.post("/papers/{paper_id}/topic/reject", response_model=PaperTopic)
async def reject_paper_topic(call: CallerDep, paper_id: str) -> PaperTopic:
    """Records that the caller said no to the offer, so it is not made again."""
    return _paper_topic(call.db.reject_topic(call.db_owner, PaperId(paper_id)))


@router.delete("/papers/{paper_id}/topic", response_model=PaperTopic)
async def delete_paper_topic(call: CallerDep, paper_id: str) -> PaperTopic:
    """Unshelves the paper (status `none`).

    The 200 body, not a 204, so the UI has the new state; a later `GET` may offer the
    deterministic suggestion again (an offer, never applied).
    """
    return _paper_topic(call.db.clear_topic(call.db_owner, PaperId(paper_id)))
