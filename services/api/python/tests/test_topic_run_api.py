"""The topic suggestion model run (v0.2 S2b2, #242) over HTTP, with a scripted agent.

The agent is a scripted `httpx.MockTransport` that speaks the §3.2 stream (run, usage, done) and
records every request it was sent; each request is held to `run-request.schema.json` and the
pydantic `AgentRunRequest`. What is asserted is what only the API could have produced: when the
model is asked at all (never when the deterministic rule answers, never twice for a paper), what
was put in front of it (the caller's own topics and the paper's real abstract), the offer stored
(`source: model`, `source_detail` the model id, never shelved) and the `ai_runs` row.

DDPM (cs.LG) and BERT/Attention (cs.CL) are REAL parses of the corpus PDFs; a missing PDF skips
loudly (AGENTS.md §4). The rest use the committed fixture paper, which no topic holds.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from api_support import assert_envelope, auth, harness, register, seed_paper
from fake_agent import RUN_REQUEST_SCHEMA
from jsonschema_lite import validate
from papertree_api import create_app
from papertree_api.schemas import AgentRunRequest
from papertree_api.settings import Settings
from papertree_api.topic_run import parse_answer
from papertree_api.worker import run as run_worker
from papertree_db import TopicRow
from pydantic import ValidationError

BENCHMARKS = Path(__file__).resolve().parents[4] / "research" / "benchmarks"
ATTENTION = "corpus/attention-is-all-you-need.pdf"
BERT = "corpus/bert-2col.pdf"
DDPM = "fresh/pdfs/ddpm-2006.11239.pdf"
SECRET = "test-agent-secret-not-a-real-one"
FLASH = "MiniMax-M3.1-Flash-Preview"
TRANSFORMERS = "Transformers & attention"
VISION = "Vision & detection"


def _usage(cost: float = 0.0004) -> dict[str, Any]:
    return {
        "input": 612,
        "output": 48,
        "cache_read": 0,
        "cache_write": 0,
        "reasoning": 30,
        "cost_usd_est": cost,
    }


def _stream(run_id: str, final_text: str, *, status: str = "complete") -> bytes:
    """The agent's §3.2 frames for one topic run."""
    done: dict[str, Any] = {
        "status": status,
        "stop_reason": "stop",
        "error": None
        if status == "complete"
        else {"code": "internal", "message": "Something went wrong.", "retryable": False},
        "final_text": final_text,
        "handles_seen": [],
        "markers": [],
        "usage_totals": _usage(),
        "tool_calls": 0,
        "turns": 1,
        "retries": 0,
        "first_text_ms": 800,
        "latency_ms": 1200,
        "entries": [],
    }
    run = {
        "run_id": run_id,
        "model": f"minimax/{FLASH}",
        "sdk": "pi-coding-agent@0.87.1",
    }
    frames = [("run", run), ("usage", _usage()), ("done", done)]
    return "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in frames).encode()


class TopicAgent:
    """A scripted agent: `answer(request body)` -> the model's text, or an exception to raise."""

    def __init__(self, answer: Callable[[dict[str, Any]], str | Exception]) -> None:
        self.answer = answer
        self.requests: list[dict[str, Any]] = []
        self.contract_errors: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["x-papertree-agent-secret"] == SECRET
        body = json.loads(request.content)
        self.requests.append(body)
        self.contract_errors += validate(body, RUN_REQUEST_SCHEMA)
        try:
            AgentRunRequest.model_validate(body)
        except ValidationError as exc:  # pragma: no cover - reported by the assertion below
            self.contract_errors.append(str(exc))
        result = self.answer(body)
        if isinstance(result, Exception):
            raise result
        return httpx.Response(
            200,
            content=_stream(body["run_id"], result),
            headers={"content-type": "text/event-stream"},
        )

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)


def _says(name: str, *, new: bool, reason: str = "It fits.") -> Callable[[dict[str, Any]], str]:
    answer = json.dumps({"topic_name": name, "is_new": new, "reason": reason})
    return lambda _body: answer


def _settings(tmp_path: Path, *, budget: float = 1.0, secret: str = SECRET) -> Settings:
    return Settings(
        root=tmp_path / "data",
        agent_secret=secret,
        agent_url="http://agent.test",
        daily_budget_usd=budget,
        api_internal_url="http://127.0.0.1:8000",
    )


def _upload_and_parse(h: Any, token: str, name: str) -> str:
    pdf = BENCHMARKS / name
    if not pdf.is_file():
        pytest.skip(f"corpus PDF {name} is absent (fetched, not committed): topic run NOT checked")
    response = h.client.post(
        "/papers",
        files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")},
        headers=auth(token),
    )
    assert response.status_code == 202, response.text
    assert run_worker(h.settings, max_jobs=5) >= 1
    return str(response.json()["paper_id"])


def _topic(h: Any, token: str, paper: str) -> dict[str, Any]:
    response = h.client.get(f"/papers/{paper}/topic", headers=auth(token))
    assert response.status_code == 200, response.text
    return dict(response.json())


def _make_topics(h: Any, token: str, *names: str) -> dict[str, str]:
    ids = {}
    for name in names:
        made = h.client.post("/topics", json={"name": name}, headers=auth(token))
        assert made.status_code == 201, made.text
        ids[name] = made.json()["topic_id"]
    return ids


def _runs(h: Any, kind: str = "topic") -> list[dict[str, Any]]:
    import sqlite3

    conn = sqlite3.connect(h.settings.database_file)
    conn.row_factory = sqlite3.Row
    try:
        return [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM ai_runs WHERE kind = ? ORDER BY started_at", (kind,)
            )
        ]
    finally:
        conn.close()


# ── the run on a real parse ──────────────────────────────────────────────────────────────────


def test_ddpm_gets_one_model_suggestion_that_is_stored_and_reused(tmp_path: Path) -> None:
    """cs.LG with no matching topic: ONE call, an offer from the model, never shelved."""
    agent = TopicAgent(_says(VISION, new=False, reason="It generates images."))
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        ddpm = _upload_and_parse(h, token, DDPM)
        ids = _make_topics(h, token, TRANSFORMERS, VISION)

        offered = _topic(h, token, ddpm)
        assert offered["status"] == "suggested"
        assert offered["topic"]["topic_id"] == ids[VISION]
        assert (offered["source"], offered["source_detail"]) == ("model", FLASH)
        assert offered["arxiv_category"] == "cs.LG"

        # What the model was shown: this paper's category, THIS person's topic names, and the
        # abstract of the real parse (datamarking is the agent's job, on the quote).
        (request,) = agent.requests
        assert request["kind"] == "topic" and request["prompt_version"] == "topic-v1"
        assert request["question"] == (
            f'Category: cs.LG\nExisting topics: ["{TRANSFORMERS}","{VISION}"]'
        )
        assert "diffusion probabilistic models" in request["seed"]["quote"]
        assert len(request["seed"]["quote"]) <= 1200
        assert request["limits"]["max_tool_calls"] == 0 and request["limits"]["max_retries"] == 0
        assert agent.contract_errors == []

        # One run row, with usage; the offer shelves nothing; a second read is the same row.
        (run,) = _runs(h)
        assert (run["status"], run["model"], run["prompt_version"]) == ("done", FLASH, "topic-v1")
        assert (run["input_tokens"], run["output_tokens"], run["tool_calls"]) == (612, 48, 0)
        assert run["cost_usd_est"] == pytest.approx(0.0004)
        assert _topic(h, token, ddpm) == offered
        assert len(agent.requests) == 1 and len(_runs(h)) == 1
        assert h.client.get(f"/papers/{ddpm}", headers=auth(token)).json()["topic"] is None

        # The person decides: rejecting is final, the model is not asked again.
        h.client.post(f"/papers/{ddpm}/topic/reject", headers=auth(token))
        h.client.delete(f"/papers/{ddpm}/topic", headers=auth(token))
        assert _topic(h, token, ddpm)["status"] == "rejected"
        assert len(agent.requests) == 1


def test_a_matching_topic_is_the_deterministic_offer_and_the_model_is_not_asked(
    tmp_path: Path,
) -> None:
    agent = TopicAgent(_says(VISION, new=False))
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        attention = _upload_and_parse(h, token, ATTENTION)
        bert = _upload_and_parse(h, token, BERT)
        ids = _make_topics(h, token, TRANSFORMERS)
        # Nothing holds cs.CL yet and the model is asked once for the first paper; its answer is
        # not what the person picks.
        agent.answer = _says(TRANSFORMERS, new=False)
        h.client.put(
            f"/papers/{attention}/topic", json={"topic_id": ids[TRANSFORMERS]}, headers=auth(token)
        )
        asked = len(agent.requests)

        offered = _topic(h, token, bert)
        assert offered["status"] == "suggested"
        assert (offered["source"], offered["source_detail"]) == ("arxiv_category", "cs.CL")
        assert len(agent.requests) == asked  # BERT: the rule answered, no model call
        assert all(run["paper_id"] != bert for run in _runs(h))


# ── the run on the committed fixture paper (no topic holds its category) ──────────────────────


def test_a_new_topic_name_is_offered_and_accepting_it_keeps_the_model_source(
    tmp_path: Path,
) -> None:
    agent = TopicAgent(_says("Image recognition", new=True, reason="Residual nets for images."))
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        _make_topics(h, token, TRANSFORMERS)
        offered = _topic(h, token, paper)
        assert (offered["status"], offered["topic"]) == ("suggested", None)
        assert offered["suggested_name"] == "Image recognition"
        assert (offered["source"], offered["source_detail"]) == ("model", FLASH)
        assert h.client.get("/topics", headers=auth(token)).json()[0]["paper_count"] == 0

        accepted = h.client.put(
            f"/papers/{paper}/topic",
            json={"new_topic_name": "Image recognition"},
            headers=auth(token),
        ).json()
        assert (accepted["status"], accepted["source"]) == ("accepted", "model")
        assert accepted["topic"]["name"] == "Image recognition"


def test_a_new_name_the_person_already_has_is_that_topic(tmp_path: Path) -> None:
    agent = TopicAgent(_says("vision & DETECTION", new=True))
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        ids = _make_topics(h, token, VISION)
        offered = _topic(h, token, paper)
        assert (offered["topic"] or {}).get("topic_id") == ids[VISION]
        assert offered["suggested_name"] is None


def test_a_decided_paper_is_never_asked(tmp_path: Path) -> None:
    """Rejected before any read: the row exists, so there is no automatic offer."""
    agent = TopicAgent(_says(VISION, new=False))
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        _make_topics(h, token, VISION)
        h.client.post(f"/papers/{paper}/topic/reject", headers=auth(token))
        assert _topic(h, token, paper)["status"] == "rejected"
        assert agent.requests == [] and _runs(h) == []


def test_a_refused_run_over_the_daily_cap_is_no_suggestion_not_an_error(tmp_path: Path) -> None:
    agent = TopicAgent(_says(VISION, new=False))
    with harness(
        tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path, budget=0.0)
    ) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        _make_topics(h, token, VISION)
        assert _topic(h, token, paper)["status"] == "none"  # a 200, with no offer
        assert agent.requests == [] and _runs(h) == []


def test_without_the_agent_configured_there_is_no_suggestion(tmp_path: Path) -> None:
    agent = TopicAgent(_says(VISION, new=False))
    with harness(
        tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path, secret="")
    ) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        _make_topics(h, token, VISION)
        assert _topic(h, token, paper)["status"] == "none"
        assert agent.requests == [] and _runs(h) == []


@pytest.mark.parametrize(
    "text",
    [
        "Sure! " + json.dumps({"topic_name": VISION, "is_new": False, "reason": "x"}),
        json.dumps({"topic_name": "Nobody has this", "is_new": False, "reason": "x"}),
        json.dumps({"topic_name": VISION, "is_new": False, "reason": "x", "extra": 1}),
        json.dumps({"topic_name": "N" * 61, "is_new": True, "reason": "x"}),
    ],
)
def test_a_bad_answer_is_no_suggestion_and_is_not_retried(tmp_path: Path, text: str) -> None:
    agent = TopicAgent(lambda _body: text)
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        _make_topics(h, token, VISION)
        assert _topic(h, token, paper)["status"] == "none"
        assert _topic(h, token, paper)["status"] == "none"
        assert len(agent.requests) == 1  # one call per paper, even when it failed
        (run,) = _runs(h)
        assert run["status"] == "error" and run["cost_usd_est"] == pytest.approx(0.0004)


def test_an_unreachable_agent_is_no_suggestion_and_the_next_read_tries_again(
    tmp_path: Path,
) -> None:
    agent = TopicAgent(lambda _body: httpx.ConnectError("agent down"))
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")
        _make_topics(h, token, VISION)
        assert _topic(h, token, paper)["status"] == "none"
        (run,) = _runs(h)
        assert (run["status"], run["error_code"]) == ("error", "agent_unavailable")
        agent.answer = _says(VISION, new=False)  # the agent came back: nothing was spent before
        assert _topic(h, token, paper)["status"] == "suggested"
        assert len(_runs(h)) == 2


def test_another_persons_paper_is_a_404_and_asks_nothing(tmp_path: Path) -> None:
    agent = TopicAgent(_says(VISION, new=False))
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper = seed_paper(h.settings, h.client, alice, "resnet-cvpr-2col")
        _make_topics(h, bob, "Bob only")
        assert_envelope(h.client.get(f"/papers/{paper}/topic", headers=auth(bob)), 404, "not_found")
        assert agent.requests == [] and _runs(h) == []


def test_the_app_builds_with_the_scripted_transport(tmp_path: Path) -> None:
    """Guards the harness itself: the app accepts an `httpx.MockTransport` for the agent."""
    assert create_app(
        _settings(tmp_path), agent_transport=TopicAgent(_says("x", new=True)).transport()
    )


# ── the answer check on its own ──────────────────────────────────────────────────────────────


def _row(topic_id: str, name: str) -> TopicRow:
    return TopicRow(topic_id, name, None, 0, "2026-10-17T00:00:00+00:00", 0, 0, ())


TOPICS = [_row("top_1", "Vision & detection"), _row("top_2", "Transformers")]


def test_parse_answer_accepts_a_fence_and_matches_names_without_regard_to_case() -> None:
    fenced = '```json\n{"topic_name":"transformers","is_new":false,"reason":"  Attention.  "}\n```'
    offer = parse_answer(fenced, TOPICS, FLASH)
    assert offer is not None and (offer.topic_id, offer.source, offer.source_detail) == (
        "top_2",
        "model",
        FLASH,
    )


def test_parse_answer_proposes_a_new_name_and_refuses_everything_else() -> None:
    new = parse_answer(
        '{"topic_name":"  Diffusion   models ","is_new":true,"reason":"r"}', TOPICS, FLASH
    )
    assert new is not None and (new.topic_id, new.suggested_name) == (None, "Diffusion models")
    for bad in [
        "not json",
        "[]",
        '{"topic_name":"X","is_new":"false","reason":"r"}',  # not a boolean
        '{"topic_name":"X","is_new":true}',  # no reason
        '{"topic_name":"","is_new":true,"reason":"r"}',
        '{"topic_name":"Unknown","is_new":false,"reason":"r"}',  # claims existing, is not
    ]:
        assert parse_answer(bad, TOPICS, FLASH) is None, bad
