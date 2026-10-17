"""Where a paper gets its topic offer from (#193, #242): the deterministic rule, then the model.

The deterministic half is `papertree_db.suggest_by_category` (the person's own topic that already
holds the most papers of the paper's arXiv category). When it has nothing to say, and only for a
paper the person has never decided about, `model_suggestion` asks the Flash `topic` run
(`topic_run.py`, #242: title + abstract excerpt + category + the person's topic names -> one of
them, or a new name). Whatever is returned is stored as an OFFER (`status: suggested`): a
suggestion never shelves a paper, and the model is reached at most once per paper because the
stored row, a rejection, or a recorded run all stop a second call.
"""

from __future__ import annotations

from collections.abc import Callable

from papertree_db import LibraryRow, PaperId, PaperTopicRow, TopicRow, TopicSuggestion

from .deps import Caller
from .topic_run import TopicRunDeps, run_topic


async def model_suggestion(
    call: Caller,
    row: LibraryRow,
    topics: Callable[[], list[TopicRow]],
    deps: TopicRunDeps,
) -> TopicSuggestion | None:
    """A model's offer when the deterministic rule has none (the seam #193 left for #242).

    Args:
        call: The authenticated request.
        row: The paper (title, category, generation: what the model may be shown).
        topics: LAZY. Called (one query) only if the model run actually happens.
        deps: Settings, agent client and index cache.

    Returns:
        A suggestion with `source='model'`, or None: not configured, over the daily cap, a run
        already made for this paper, the agent down, or an answer that did not validate.
    """
    return await run_topic(call, row, topics, deps)


async def offer_topic(call: Caller, paper_id: str, deps: TopicRunDeps) -> PaperTopicRow:
    """The paper's topic state, storing a first offer if there is none yet (idempotent).

    A paper that already has a row (offered, accepted or rejected) is returned as it is. With no
    row (a rejected paper has one, so a decision sticks), the deterministic suggestion is stored if
    there is one, else the model's; if neither has an offer nothing is written, so a later read
    (after the paper parses, or after the person shelves more papers) tries the cheap rule again.
    The model is asked once per paper (`topic_run.may_run`), on the first read after the parse.

    Args:
        call: The authenticated request.
        paper_id: The paper; the caller's, else `PaperNotFound` (a 404).
        deps: Settings, agent client and index cache for the model run.

    Returns:
        The paper's `PaperTopicRow`.
    """
    pid = PaperId(paper_id)
    current = call.db.get_paper_topic(call.db_owner, pid)
    if current.status != "none":
        return current
    offer = call.db.deterministic_suggestion(call.db_owner, pid)
    if offer is None:
        row = call.db.library_row(call.db_owner, pid)
        if row is not None:
            offer = await model_suggestion(
                call, row, lambda: call.db.list_topics(call.db_owner), deps
            )
    if offer is None:
        return current
    return call.db.record_suggestion(call.db_owner, pid, offer)
