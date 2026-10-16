"""Where a paper gets its topic offer from (#193): the deterministic rule, then the model seam.

The deterministic half is `papertree_db.suggest_by_category` (the person's own topic that already
holds the most papers of the paper's arXiv category). When it has nothing to say, `model_suggestion`
is asked. In part 1 it always answers "no suggestion"; part 2 (#242) replaces its body with the
Flash `topic` run (title + abstract + category -> one of the person's topics, or a new name) and
nothing else in the call chain changes. Whatever is returned is stored as an OFFER: a suggestion
never shelves a paper.
"""

from __future__ import annotations

from papertree_db import LibraryRow, PaperId, PaperTopicRow, TopicRow, TopicSuggestion

from .deps import Caller


def model_suggestion(row: LibraryRow, topics: list[TopicRow]) -> TopicSuggestion | None:
    """THE SEAM for part 2 (#242): a model's offer when the deterministic rule has none.

    Args:
        row: The paper (title, authors, category: what the model may be shown).
        topics: The person's topics, to choose from or to name a new one beside.

    Returns:
        A suggestion with `source='model'`, or None. Part 1 has no model call: always None.
    """
    return None


def offer_topic(call: Caller, paper_id: str) -> PaperTopicRow:
    """The paper's topic state, storing a first offer if there is none yet (idempotent).

    A paper that already has a row (offered, accepted or rejected) is returned as it is. With no
    row, the deterministic suggestion is stored if there is one, else the model seam's; if neither
    has an offer nothing is written, so a later read (after the paper parses, or after the person
    shelves more papers) tries again.

    Args:
        call: The authenticated request.
        paper_id: The paper; the caller's, else `PaperNotFound` (a 404).

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
            offer = model_suggestion(row, call.db.list_topics(call.db_owner))
    if offer is None:
        return current
    return call.db.record_suggestion(call.db_owner, pid, offer)
