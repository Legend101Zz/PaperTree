"""v0.3 #337: the spread's "At a glance" sheet over HTTP, with a scripted agent.

The agent is a scripted `httpx.MockTransport` that speaks the §3.2 stream (run, usage, done) and
records every request it was sent; each request is held to `run-request.schema.json` and the
pydantic `AgentRunRequest`. What is asserted is what only the API could have produced: that a
library read starts the run for a paper that is read in (once, in the background), what was put in
front of the model (the summary's digest, with its handles), the sheet stored (every cap applied,
every cited handle turned into the page it is on), that a read is served from the cache with no
new run, that another user's paper is a 404, that the daily cap and a missing agent are "no sheet"
and never an error, and the `ai_runs` row and the usage it counts.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from ai_support import contract_errors
from api_support import assert_envelope, auth, harness, register, seed_paper
from fake_agent import RUN_REQUEST_SCHEMA
from jsonschema_lite import validate
from papertree_api import glance
from papertree_api.schemas import AgentRunRequest, GlanceStatus
from papertree_api.settings import Settings
from pydantic import ValidationError
from test_ingest_helpers import UNCOUNTABLE_PDF, upload

SECRET = "test-agent-secret-not-a-real-one"
FLASH = "MiniMax-M3.1-Flash"
SLUG = "resnet-cvpr-2col"


def _usage(cost: float = 0.0004) -> dict[str, Any]:
    return {
        "input": 6120,
        "output": 700,
        "cache_read": 0,
        "cache_write": 0,
        "reasoning": 300,
        "cost_usd_est": cost,
    }


def _stream(
    run_id: str, final_text: str, *, status: str = "complete", cost: float = 0.0004
) -> bytes:
    """The agent's §3.2 frames for one glance run."""
    done: dict[str, Any] = {
        "status": status,
        "stop_reason": "stop",
        "error": None
        if status == "complete"
        else {"code": "internal", "message": "Something went wrong.", "retryable": False},
        "final_text": final_text,
        "handles_seen": [],
        "markers": [],
        "usage_totals": _usage(cost),
        "tool_calls": 0,
        "turns": 1,
        "retries": 0,
        "first_text_ms": 800,
        "latency_ms": 9000,
        "entries": [],
    }
    run = {"run_id": run_id, "model": f"minimax/{FLASH}", "sdk": "pi-coding-agent@0.87.1"}
    frames = [("run", run), ("usage", _usage(cost)), ("done", done)]
    return "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in frames).encode()


class GlanceAgent:
    """A scripted agent: `answer(request body)` -> the model's text, or an exception to raise."""

    def __init__(self, answer: Callable[[dict[str, Any]], str | Exception], cost: float = 0.0004):
        self.answer = answer
        self.cost = cost
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
            content=_stream(body["run_id"], result, cost=self.cost),
            headers={"content-type": "text/event-stream"},
        )

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)


def _passage_page(passage: dict[str, Any]) -> int:
    """The page a seed passage is on, from its label (`p. 3 · 2. Method · paragraph`)."""
    return int(passage["label"].split(" ")[1])


def _sheet(body: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """A valid sheet that cites the first, a middle and the last passage of the digest."""
    handles = [p["handle"] for p in body["seed"]["passages"]]
    first, middle, last = handles[0], handles[len(handles) // 2], handles[-1]
    sheet: dict[str, Any] = {
        "gist": "Treat layers as steps of a continuous process.",
        "problem": {"text": "A deep net is a fixed stack of layers.", "cite": first},
        "idea": {"text": "Let $dh/dt = f(h, t)$ define the hidden state.", "cite": middle},
        "how": {"text": "A black-box ODE solver runs the forward pass.", "cite": None},
        "results": {
            "numbers": [
                {"value": "0.42%", "measures": "test error, MNIST"},
                {"value": "0.22M", "measures": "parameters"},
            ],
            "note": "Also: continuous normalizing flows.",
            "cite": last,
        },
        "limits": {"text": "You must choose solver tolerances.", "cite": "b999"},
        "read_first": "§1 and Figure 1, then §3.",
        "words": [
            {"term": "ODE", "gloss": "an equation for change"},
            {"term": "Euler method", "gloss": "the simplest step"},
            {"term": "adjoint method", "gloss": "gradients backwards"},
            {"term": "normalizing flow", "gloss": "invertible steps"},
            {"term": "Lipschitz", "gloss": "a bound on change"},
        ],
    }
    sheet.update(overrides)
    return sheet


def _says_sheet(**overrides: Any) -> Callable[[dict[str, Any]], str]:
    return lambda body: json.dumps(_sheet(body, **overrides))


def _settings(tmp_path: Path, *, budget: float = 1.0, secret: str = SECRET) -> Settings:
    return Settings(
        root=tmp_path / "data",
        agent_secret=secret,
        agent_url="http://agent.test",
        daily_budget_usd=budget,
        api_internal_url="http://127.0.0.1:8000",
    )


def _rows(h: Any, sql: str, *params: Any) -> list[dict[str, Any]]:
    conn = sqlite3.connect(h.settings.database_file)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params)]
    finally:
        conn.close()


def _runs(h: Any) -> list[dict[str, Any]]:
    return _rows(h, "SELECT * FROM ai_runs WHERE kind = 'glance' ORDER BY started_at")


def _wait_idle(h: Any) -> None:
    """Waits for the background glance runs to settle (no `running` row), at most 20 s."""
    deadline = time.monotonic() + 20
    while any(r["status"] == "running" for r in _runs(h)):
        assert time.monotonic() < deadline, "a glance run is still running"
        time.sleep(0.02)


def _library(h: Any, token: str) -> list[dict[str, Any]]:
    response = h.client.get("/papers", headers=auth(token))
    assert response.status_code == 200, response.text
    return list(response.json())


def _glance(h: Any, token: str, paper: str) -> Any:
    return h.client.get(f"/papers/{paper}/glance", headers=auth(token))


def _made(h: Any, token: str, paper: str) -> Any:
    """A library read (which starts the run), the wait for it to settle, then the sheet."""
    _library(h, token)
    _wait_idle(h)
    return _glance(h, token, paper)


# ── the run, when the paper is added ─────────────────────────────────────────────────────────


def test_a_library_read_starts_one_run_and_the_sheet_is_served_from_the_cache(
    tmp_path: Path,
) -> None:
    agent = GlanceAgent(_says_sheet())
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, SLUG)

        rows = _library(h, token)
        assert [r["paper_id"] for r in rows] == [paper]  # the read answers at once, unchanged
        _wait_idle(h)
        assert len(agent.requests) == 1
        assert agent.contract_errors == []

        response = _glance(h, token, paper)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["state"] == "ready"
        assert contract_errors(body, "api/glance.schema.json", "GlanceStatus", GlanceStatus) == []
        sheet = body["glance"]
        assert (sheet["model"], sheet["generation"]) == (FLASH, 1)

        # What was put in front of the model: the summary's digest, with handles b1.., no tools.
        request = agent.requests[0]
        assert request["kind"] == "glance" and request["prompt_version"] == "glance-v1"
        assert request["question"] == glance.QUESTION and request["history"] is None
        assert request["limits"] == {
            "deadline_ms": 60000,
            "idle_ms": 30000,
            "max_tool_calls": 0,
            "max_turns": 2,
            "max_output_tokens": 3072,
            "max_retries": 1,
        }
        passages = request["seed"]["passages"]
        assert len(passages) >= 4 and passages[0]["label"].startswith("p. 1 · Abstract")
        assert [p["handle"] for p in passages] == [f"b{n}" for n in range(1, len(passages) + 1)]
        assert all(p["text"].startswith(request["datamark"]) for p in passages)

        # Every cited handle became the page it is on; "no cite" and an invented handle have none.
        assert sheet["problem"] == {
            "text": "A deep net is a fixed stack of layers.",
            "page": _passage_page(passages[0]),
        }
        assert sheet["idea"]["page"] == _passage_page(passages[len(passages) // 2])
        assert sheet["how"]["page"] is None
        assert sheet["limits"]["page"] is None, "a handle the run was never given links nowhere"
        assert sheet["results"]["page"] == _passage_page(passages[-1])
        assert [n["value"] for n in sheet["results"]["numbers"]] == ["0.42%", "0.22M"]
        assert sheet["idea"]["text"] == "Let $dh/dt = f(h, t)$ define the hidden state."
        assert len(sheet["words"]) == 5
        assert "cite" not in json.dumps(sheet) and "stands" not in json.dumps(sheet).lower()

        (run,) = _runs(h)
        assert (run["status"], run["model"], run["provider"]) == ("done", FLASH, "minimax")
        assert run["code_path"].startswith("api.glance>") and run["error_code"] is None
        assert (run["input_tokens"], run["output_tokens"], run["cost_usd_est"]) == (
            6120,
            700,
            0.0004,
        )
        assert run["thread_id"] is None and run["message_id"] is None
        (stored,) = _rows(h, "SELECT * FROM paper_glance")
        assert (stored["model"], stored["prompt_version"], stored["run_id"]) == (
            FLASH,
            "glance-v1",
            run["run_id"],
        )
        # The stored sheet is the served one, caps applied: never the model's raw text.
        assert json.loads(stored["content_json"]) == {
            k: v for k, v in sheet.items() if k not in ("model", "generation")
        }

        # A reload, another library read and another GET start nothing and ask nothing.
        before = (len(agent.requests), len(_runs(h)))
        _library(h, token)
        _wait_idle(h)
        again = _glance(h, token, paper)
        assert again.status_code == 200 and again.json() == body
        assert (len(agent.requests), len(_runs(h))) == before

        # It is counted like any run.
        usage = h.client.get("/usage", headers=auth(token)).json()
        assert usage["by_kind"]["glance"]["runs"] == 1
        assert usage["by_kind"]["glance"]["output_tokens"] == 700


def test_a_read_that_finds_no_sheet_and_no_run_starts_it_and_answers_making(
    tmp_path: Path,
) -> None:
    agent = GlanceAgent(_says_sheet())
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, SLUG)
        first = _glance(h, token, paper)  # no library read first: the glance read starts it
        assert first.status_code == 202, first.text
        assert first.json() == {"state": "making", "glance": None}
        assert (
            contract_errors(first.json(), "api/glance.schema.json", "GlanceStatus", GlanceStatus)
            == []
        )
        _wait_idle(h)
        second = _glance(h, token, paper)
        assert second.status_code == 200 and second.json()["state"] == "ready"
        assert len(agent.requests) == 1


def test_two_reads_in_a_row_start_one_run(tmp_path: Path) -> None:
    agent = GlanceAgent(_says_sheet())
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, SLUG)
        _library(h, token)
        assert _glance(h, token, paper).status_code in (200, 202)
        _library(h, token)
        _wait_idle(h)
        assert len(agent.requests) == 1 and len(_runs(h)) == 1


def test_a_paper_not_read_in_yet_gets_no_run(tmp_path: Path) -> None:
    agent = GlanceAgent(_says_sheet())
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        queued = upload(h.client, token, UNCOUNTABLE_PDF, name="queued.pdf")
        assert queued.status_code == 202, queued.text
        _library(h, token)
        response = _glance(h, token, queued.json()["paper_id"])
        assert response.status_code == 200
        assert response.json() == {"state": "none", "glance": None}
        assert agent.requests == [] and _runs(h) == []


# ── another user's paper, no agent, the cap ──────────────────────────────────────────────────


def test_another_users_paper_is_a_404_and_starts_nothing(tmp_path: Path) -> None:
    agent = GlanceAgent(_says_sheet())
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper = seed_paper(h.settings, h.client, alice, SLUG)
        assert _made(h, alice, paper).status_code == 200
        runs_before = len(_runs(h))
        stranger = _glance(h, bob, paper)
        assert_envelope(stranger, 404, "not_found")
        assert_envelope(_glance(h, bob, "ppr_" + "0" * 26), 404, "not_found")
        assert h.client.get(f"/papers/{paper}/glance").status_code == 401
        assert len(_runs(h)) == runs_before and len(agent.requests) == 1
        # Bob's library is empty, and reading it starts nothing for Alice's paper.
        assert _library(h, bob) == []


def test_with_no_agent_configured_there_is_no_sheet_and_no_error(tmp_path: Path) -> None:
    agent = GlanceAgent(_says_sheet())
    settings = _settings(tmp_path, secret="")
    with harness(tmp_path, agent_transport=agent.transport(), settings=settings) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, SLUG)
        _library(h, token)
        response = _glance(h, token, paper)
        assert response.status_code == 200
        assert response.json() == {"state": "none", "glance": None}
        assert agent.requests == [] and _runs(h) == []


def test_the_daily_cap_applies_to_the_glance_run_and_is_never_an_error(tmp_path: Path) -> None:
    """The first sheet costs $0.0004 against a $0.0004 budget: the next paper gets none."""
    agent = GlanceAgent(_says_sheet(), cost=0.0004)
    with harness(
        tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path, budget=0.0004)
    ) as h:
        token = register(h.client, "reader@example.com")
        first = seed_paper(h.settings, h.client, token, SLUG)
        assert _made(h, token, first).json()["state"] == "ready"
        second = seed_paper(h.settings, h.client, token, "attention-is-all-you-need")
        _library(h, token)
        _wait_idle(h)
        response = _glance(h, token, second)
        assert response.status_code == 200
        assert response.json() == {"state": "none", "glance": None}
        assert len(agent.requests) == 1 and len(_runs(h)) == 1, "no run row for a refused start"


def test_a_library_read_starts_at_most_two_runs(tmp_path: Path) -> None:
    agent = GlanceAgent(_says_sheet())
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        for slug in ("resnet-cvpr-2col", "attention-is-all-you-need", "neural-odes-mathheavy"):
            seed_paper(h.settings, h.client, token, slug)
        _library(h, token)
        _wait_idle(h)
        assert len(agent.requests) == glance.STARTS_PER_LIBRARY_READ
        _library(h, token)  # the next read catches the third one up
        _wait_idle(h)
        assert len(agent.requests) == 3


# ── a bad answer, a lost agent ───────────────────────────────────────────────────────────────


def test_a_bad_answer_is_no_sheet_and_the_paper_is_not_asked_again(tmp_path: Path) -> None:
    agent = GlanceAgent(lambda _body: "Sure! Here is your sheet: {}")
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, SLUG)
        response = _made(h, token, paper)
        assert response.status_code == 200
        assert response.json() == {"state": "none", "glance": None}
        (run,) = _runs(h)
        assert (run["status"], run["error_code"]) == ("error", "internal")
        assert run["cost_usd_est"] == 0.0004, "the spend of a bad answer is still recorded"
        assert _rows(h, "SELECT * FROM paper_glance") == []
        _library(h, token)
        _glance(h, token, paper)
        _wait_idle(h)
        assert len(agent.requests) == 1, "one call per paper"


def test_an_agent_that_is_down_is_no_sheet_and_not_asked_again_at_once(tmp_path: Path) -> None:
    agent = GlanceAgent(lambda _body: httpx.ConnectError("agent is down"))
    with harness(tmp_path, agent_transport=agent.transport(), settings=_settings(tmp_path)) as h:
        token = register(h.client, "reader@example.com")
        paper = seed_paper(h.settings, h.client, token, SLUG)
        response = _made(h, token, paper)
        assert response.status_code == 200
        assert response.json()["state"] == "none"
        (run,) = _runs(h)
        assert (run["status"], run["error_code"]) == ("error", "agent_unavailable")
        _library(h, token)
        _wait_idle(h)
        assert len(agent.requests) == 1, "the cooldown holds a second try back"


# ── the caps, in the API's own checker ───────────────────────────────────────────────────────


def _answer(**overrides: Any) -> str:
    body = {"seed": {"passages": [{"handle": "b1", "label": "p. 1 · x", "text": "t"}]}}
    return json.dumps(_sheet(body, **overrides))


def test_a_text_over_its_cap_is_trimmed_not_refused() -> None:
    long = " ".join(f"w{n}" for n in range(60))
    answer = glance.parse_answer(
        _answer(
            gist=long,
            problem={"text": long, "cite": "b1"},
            results={"numbers": [], "note": long, "cite": None},
        )
    )
    assert answer is not None
    assert glance.word_count(answer.gist) == glance.GIST_WORDS and answer.gist.endswith("…")
    assert glance.word_count(answer.problem.text) == glance.BLOCK_WORDS
    assert answer.results.note is not None
    assert glance.word_count(answer.results.note) == glance.BLOCK_WORDS


def test_at_most_two_numbers_and_five_words_are_kept() -> None:
    numbers = [{"value": str(n), "measures": "m"} for n in range(4)]
    terms = [{"term": f"t{n}", "gloss": "g"} for n in range(8)]
    answer = glance.parse_answer(
        _answer(results={"numbers": numbers, "note": None, "cite": None}, words=terms)
    )
    assert answer is not None
    assert [n.value for n in answer.results.numbers] == ["0", "1"]
    assert [w.term for w in answer.words] == ["t0", "t1", "t2", "t3", "t4"]


@pytest.mark.parametrize(
    "text",
    [
        "not json",
        "[]",
        "Sure! " + _answer(),
        _answer(stands_on=6),
        _answer(gist="  "),
        _answer(idea={"text": "x", "cite": "[b1]"}),
        _answer(idea={"text": "x"}),
        _answer(idea={"text": "x", "cite": None, "p": 3}),
        _answer(results={"numbers": [], "note": None, "cite": None}),
        _answer(
            results={"numbers": [{"value": "x" * 13, "measures": "m"}], "note": None, "cite": None}
        ),
        _answer(words=[{"term": "a", "gloss": "b"}] * 4),
        _answer(words=[{"term": "t" * 41, "gloss": "g"}] * 5),
        _answer(gist=5),
    ],
    ids=[
        "prose",
        "an array",
        "prose around it",
        "an extra key",
        "an empty gist",
        "a cite that is not a handle",
        "a cite left out",
        "a block with an extra key",
        "results with nothing in it",
        "a value over its bound",
        "four words to know",
        "a term over its bound",
        "a wrong type",
    ],
)
def test_anything_else_is_no_answer(text: str) -> None:
    assert glance.parse_answer(text) is None


def test_a_fence_is_tolerated_and_a_maths_span_is_never_cut() -> None:
    fenced = "```json\n" + _answer() + "\n```"
    assert glance.parse_answer(fenced) is not None
    assert glance.word_count("Let $h(t)$ evolve as $dh / dt = f$.") == 5
    assert glance.trim_words("Let $a b c d$ be big and so on", 2) == "Let $a b c d$…"
    assert glance.trim_words("Let $a b c d$ be big and so on", 1) == "Let…"
    assert glance.trim_words("one two three four", 2) == "one two…"
    assert glance.trim_words("one, two, three", 2) == "one, two…"
    assert glance.trim_words("One two. Three four", 2) == "One two."
    assert glance.trim_words("  one   two ", 2) == "one two"


def test_the_committed_glance_example_fits_both_checkers_of_the_request() -> None:
    path = Path(__file__).resolve().parents[4] / "contracts/agent/examples/run-request-glance.json"
    body = json.loads(path.read_text("utf-8"))
    assert validate(body, RUN_REQUEST_SCHEMA) == []
    request = AgentRunRequest.model_validate(body)
    assert (request.kind, request.prompt_version) == ("glance", "glance-v1")
    assert request.question == glance.QUESTION
    assert request.limits.max_tool_calls == 0
