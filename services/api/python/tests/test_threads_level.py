"""v0.3 (#339): the level of an answer, the self-check the API decides, and "change level".

contracts.md §2.5: ``level`` on ThreadCreate and FollowUp (default ``familiar``) is stored on the
assistant message and sent to the agent; ``check`` is true only for a ``new`` answer of an explain
or ask thread when no earlier answer carried a ```check fence; ``relevel_of`` answers the same
question again at another level, as a sibling, with no new user turn.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from ai_support import (
    AiHarness,
    ai_harness,
    alice_with_paper,
    contract_errors,
    events,
    paragraph_anchor,
    read_sse,
)
from api_support import assert_envelope, auth, register
from fake_agent import Script
from papertree_api.schemas import ThreadDetail

CHECK_ANSWER = "## TL;DR\nx\n\n```check\nprompt: a ___\naccept: b\nright: r\nhint: h\n```"


def _start(h: AiHarness, token: str, paper_id: str, **extra: Any) -> dict[str, Any]:
    response = h.client.post(
        f"/papers/{paper_id}/threads",
        json={"kind": "explain", "anchor": paragraph_anchor(), **extra},
        headers={**auth(token), "Accept": "text/event-stream"},
    )
    frames, _ = read_sse(response)
    return events(frames, "run")[0]


def _follow(h: AiHarness, token: str, paper_id: str, run: dict[str, Any], **body: Any) -> Any:
    response = h.client.post(
        f"/papers/{paper_id}/threads/{run['thread_id']}/messages",
        json=body,
        headers={**auth(token), "Accept": "text/event-stream"},
    )
    return response


def _detail(h: AiHarness, token: str, paper_id: str, thread_id: str) -> dict[str, Any]:
    response = h.client.get(f"/papers/{paper_id}/threads/{thread_id}", headers=auth(token))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    assert contract_errors(body, "api/threads.schema.json", "ThreadDetail", ThreadDetail) == []
    return body


def _write(h: AiHarness, sql: str, *params: str) -> None:
    conn = sqlite3.connect(h.settings.database_file)
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _plant_check(h: AiHarness, message_id: str) -> None:
    """An earlier answer that carried a check (the replayed fixtures never write one)."""
    _write(h, "UPDATE ai_messages SET content = ? WHERE message_id = ?", CHECK_ANSWER, message_id)


def test_level_defaults_to_familiar_is_stored_and_read_back(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        run = _start(h, token, paper_id)
        request = h.fake.requests[0]
        assert (request["level"], request["check"]) == ("familiar", False)
        assert h.fake.contract_errors == []
        stored = h.rows("SELECT role, level, sibling_of FROM ai_messages ORDER BY ordinal")
        assert [(m["role"], m["level"], m["sibling_of"]) for m in stored] == [
            ("user", None, None),
            ("assistant", "familiar", None),
        ]
        user, answer = _detail(h, token, paper_id, run["thread_id"])["messages"]
        assert (user["level"], user["sibling_group"]) == (None, None)
        assert (answer["level"], answer["sibling_group"]) == ("familiar", answer["message_id"])


def test_an_answer_stored_before_level_existed_reads_familiar(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        run = _start(h, token, paper_id, level="expert")
        _write(h, "UPDATE ai_messages SET level = NULL")
        answer = _detail(h, token, paper_id, run["thread_id"])["messages"][1]
        assert answer["level"] == "familiar"


def test_check_is_true_only_for_the_first_new_to_this_answer_of_a_thread(tmp_path: Path) -> None:
    with ai_harness(
        tmp_path, [Script("explain-ok"), Script("followup-ok"), Script("followup-ok")]
    ) as h:
        token, paper_id = alice_with_paper(h)
        run = _start(h, token, paper_id, level="new")
        assert (h.fake.requests[0]["level"], h.fake.requests[0]["check"]) == ("new", True)
        # The first answer carried no check fence (the replay wrote none): New again may ask one.
        read_sse(_follow(h, token, paper_id, run, question="And then?", level="new"))
        assert h.fake.requests[1]["check"] is True
        # Another level never asks for one.
        read_sse(_follow(h, token, paper_id, run, question="More?", level="expert"))
        assert (h.fake.requests[2]["level"], h.fake.requests[2]["check"]) == ("expert", False)
        # Once an earlier answer carried a check, New does not ask again.
        _plant_check(h, run["message_id"])
    with ai_harness(tmp_path / "again", [Script("explain-ok"), Script("followup-ok")]) as h:
        token, paper_id = alice_with_paper(h)
        run = _start(h, token, paper_id, level="new")
        _plant_check(h, run["message_id"])
        read_sse(_follow(h, token, paper_id, run, question="And then?", level="new"))
        assert h.fake.requests[1]["check"] is False


def test_a_familiar_or_expert_first_answer_never_asks_for_a_check(tmp_path: Path) -> None:
    for level in ("familiar", "expert"):
        with ai_harness(tmp_path / level, Script("explain-ok")) as h:
            token, paper_id = alice_with_paper(h)
            _start(h, token, paper_id, level=level)
            assert h.fake.requests[0]["check"] is False


def test_relevel_makes_a_sibling_answer_to_the_same_question(tmp_path: Path) -> None:
    with ai_harness(
        tmp_path, [Script("explain-ok"), Script("followup-ok"), Script("followup-ok")]
    ) as h:
        token, paper_id = alice_with_paper(h)
        first = _start(h, token, paper_id, level="familiar")
        frames, _ = read_sse(
            _follow(h, token, paper_id, first, level="new", relevel_of=first["message_id"])
        )
        second = events(frames, "run")[0]
        request = h.fake.requests[1]
        assert request["question"] == "Explain this passage.", "the stored question, not a new one"
        assert (request["level"], request["check"]) == ("new", True)
        assert request["history"] is None, "the first question again is a first turn again"
        assert request["seed"]["quote"] != "", "so the selection travels in the user turn"
        assert second["user_message_id"] == first["user_message_id"], "no new user turn"
        roles = [m["role"] for m in h.rows("SELECT role FROM ai_messages ORDER BY ordinal")]
        assert roles == ["user", "assistant", "assistant"]
        # A third level, asked of the SIBLING, joins the same group.
        frames, _ = read_sse(
            _follow(h, token, paper_id, first, level="expert", relevel_of=second["message_id"])
        )
        third = events(frames, "run")[0]
        messages = _detail(h, token, paper_id, first["thread_id"])["messages"]
        answers = [m for m in messages if m["role"] == "assistant"]
        assert [(m["message_id"], m["level"]) for m in answers] == [
            (first["message_id"], "familiar"),
            (second["message_id"], "new"),
            (third["message_id"], "expert"),
        ]
        assert {m["sibling_group"] for m in answers} == {first["message_id"]}
        assert h.fake.requests[2]["check"] is False


def test_relevel_after_a_follow_up_keeps_the_conversation_for_an_earlier_question(
    tmp_path: Path,
) -> None:
    with ai_harness(
        tmp_path, [Script("explain-ok"), Script("followup-ok"), Script("followup-ok")]
    ) as h:
        token, paper_id = alice_with_paper(h)
        first = _start(h, token, paper_id)
        frames, _ = read_sse(_follow(h, token, paper_id, first, question="Why is it faster?"))
        later = events(frames, "run")[0]
        # Re-level the LATEST question: the history before it is kept, the question is its own.
        read_sse(_follow(h, token, paper_id, first, level="new", relevel_of=later["message_id"]))
        request = h.fake.requests[2]
        assert request["question"] == "Why is it faster?"
        assert request["history"] is not None
        assert "Why is it faster?" not in json.dumps(request["history"]["entries"])


def test_relevel_is_refused_for_what_it_cannot_answer_again(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("explain-ok"), Script("auth-error")]) as h:
        token, paper_id = alice_with_paper(h)
        run = _start(h, token, paper_id)
        thread = run["thread_id"]
        url = f"/papers/{paper_id}/threads/{thread}/messages"

        def post(body: dict[str, Any]) -> Any:
            return h.client.post(url, json=body, headers=auth(token))

        known = run["message_id"]
        for body in (
            {"relevel_of": run["user_message_id"], "level": "new"},  # a user turn
            {"relevel_of": "msg_01K63A9W4XJ7Q2N8R5T0V3Y6ZB", "level": "new"},  # not here
            {"relevel_of": known, "retry_of": known, "level": "new"},
            {"relevel_of": known, "level": "wide"},  # not a level
        ):
            assert post(body).status_code == 422, body
        assert post({"level": "new"}).status_code == 422, "no question and no relevel_of"
        assert post({"question": ""}).status_code == 422
        assert h.count("ai_messages") == 2, "nothing was written"


def test_relevel_of_an_unfinished_answer_is_refused(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("auth-error")]) as h:
        token, paper_id = alice_with_paper(h)
        run = _start(h, token, paper_id)
        response = h.client.post(
            f"/papers/{paper_id}/threads/{run['thread_id']}/messages",
            json={"relevel_of": run["message_id"], "level": "new"},
            headers=auth(token),
        )
        assert_envelope(response, 422, "validation_failed")


def test_another_users_thread_is_404_for_a_relevel(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("explain-ok")]) as h:
        token, paper_id = alice_with_paper(h)
        run = _start(h, token, paper_id)
        bob = register(h.client, "bob@example.com")
        response = h.client.post(
            f"/papers/{paper_id}/threads/{run['thread_id']}/messages",
            json={"relevel_of": run["message_id"], "level": "new"},
            headers=auth(bob),
        )
        assert_envelope(response, 404, "not_found")
        assert len(h.fake.requests) == 1


def test_a_retry_keeps_the_level_it_was_asked_at(tmp_path: Path) -> None:
    with ai_harness(tmp_path, [Script("auth-error"), Script("explain-ok")]) as h:
        token, paper_id = alice_with_paper(h)
        run = _start(h, token, paper_id, level="expert")
        read_sse(
            _follow(
                h,
                token,
                paper_id,
                run,
                question="Explain this passage.",
                retry_of=run["message_id"],
            )
        )
        assert h.fake.requests[1]["level"] == "expert"
        levels = [
            m["level"] for m in h.rows("SELECT level FROM ai_messages WHERE role = 'assistant'")
        ]
        assert levels == ["expert", "expert"]
