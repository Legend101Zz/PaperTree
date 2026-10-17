"""Where a paper gets its topic offer from (#193, #242): the deterministic rule, then the model.

The deterministic half is `papertree_db.suggest_by_category` (the person's own topic that already
holds the most papers of the paper's arXiv category). When it has nothing to say, and only for a
paper the person has never decided about, the Flash `topic` run is started in the background
(`topic_run.py`, #242: title + abstract excerpt + category + the person's topic names -> one of
them, or a new name). Whatever is returned is stored as an OFFER (`status: suggested`): a
suggestion never shelves a paper, and the model is reached at most once per paper because the
stored row, a rejection, or a recorded run all stop a second call.
"""

from __future__ import annotations

from papertree_db import PaperId, PaperTopicRow

from .deps import Caller
from .topic_run import TopicRunDeps, start_topic_run


def offer_topic(call: Caller, paper_id: str, deps: TopicRunDeps) -> PaperTopicRow:
    """The paper's topic state, storing a first offer if there is none yet (idempotent).

    A paper that already has a row (offered, accepted or rejected) is returned as it is (a
    rejected paper has one, so a decision sticks). With no row, the deterministic suggestion is
    stored if there is one. Otherwise the model run is STARTED IN THE BACKGROUND (once per paper,
    `topic_run.start_topic_run`) and the state is returned unchanged (`none`): the suggestion
    appears on a later read. Nothing is written when there is no offer, so a later read (after the
    paper parses, or after the person shelves more papers) tries the cheap rule again.

    Args:
        call: The authenticated request.
        paper_id: The paper; the caller's, else `PaperNotFound` (a 404).
        deps: Settings, agent client, index cache and the app's background task set.

    Returns:
        The paper's `PaperTopicRow`.
    """
    pid = PaperId(paper_id)
    current = call.db.get_paper_topic(call.db_owner, pid)
    if current.status != "none":
        return current
    offer = call.db.deterministic_suggestion(call.db_owner, pid)
    if offer is not None:
        return call.db.record_suggestion(call.db_owner, pid, offer)
    row = call.db.library_row(call.db_owner, pid)
    if row is not None:
        start_topic_run(call, row, lambda: call.db.list_topics(call.db_owner), deps)
    return current
