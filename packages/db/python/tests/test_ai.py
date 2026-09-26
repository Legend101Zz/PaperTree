"""``papertree_db/ai.py`` (S5): threads, messages, citations, runs, run handles, usage, summaries.

Every AI table is owner-keyed (0005), so every method here is tested twice: once doing its job for
alice, and once refusing bob. The refusals are the point — isolation that has never been observed
failing has not been tested (AGENTS.md §4) — so each ``bob`` assertion is paired with an ``alice``
one on the SAME row, which is what makes "bob sees nothing" mean "bob is refused" rather than
"there was nothing to see".
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from papertree_db import PaperNotFound, PaperTreeDb, generation, open_database
from papertree_db.ai import (
    AiRecordNotFound,
    CitationIn,
    UsageBucket,
    normalise_time,
)
from papertree_db.ids import OwnerId, PaperId

from .fixtures import block_id_for, make_anchor, make_paper

GEN = generation(1)
TOKEN_HASH = hashlib.sha256(b"a run token").hexdigest()
OTHER_HASH = hashlib.sha256(b"another token").hexdigest()


@dataclass(frozen=True, slots=True)
class Tenant:
    owner: OwnerId
    user_id: str
    paper_id: PaperId
    source_hash: str


@dataclass(frozen=True, slots=True)
class Env:
    db: PaperTreeDb
    alice: Tenant
    bob: Tenant


def _tenant(db: PaperTreeDb, email: str, paper_id: str, fill: str) -> Tenant:
    created = db.create_user(email)
    source_hash = "sha256:" + fill * 64
    db.put_paper(created.owner, make_paper(paper_id, source_hash, 1, block_count=12))
    db.promote_generation(created.owner, PaperId(paper_id), GEN)
    return Tenant(created.owner, created.user_id, PaperId(paper_id), source_hash)


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    db = open_database(tmp_path / "papertree.sqlite")
    db.migrate()
    alice = _tenant(db, "alice@papertree.test", "ppr_0000000000000000000000ALIC", "a")
    bob = _tenant(db, "bob@papertree.test", "ppr_00000000000000000000000BOB", "b")
    yield Env(db, alice, bob)
    db.close()


def _in_an_hour() -> str:
    return (datetime.now(UTC) + timedelta(hours=1)).isoformat()


def _thread(env: Env, t: Tenant, thread_id: str = "thr_01K63A9W4XJ7Q2N8R5T0V3Y6ZB") -> str:
    env.db.create_thread(
        t.owner,
        t.paper_id,
        thread_id=thread_id,
        kind="explain",
        title="Explain: a passage",
        origin_anchor=make_anchor(t.paper_id, t.source_hash, block_id_for(3), "anc_0000000001"),
    )
    return thread_id


def _run(
    env: Env,
    t: Tenant,
    run_id: str = "run_01K63AE8M4Q2T7V9X3B5N6R0C1",
    *,
    thread_id: str | None = None,
    kind: str = "explain",
    token_sha256: str = TOKEN_HASH,
    expires_at: str | None = None,
) -> str:
    env.db.create_run(
        t.owner,
        run_id=run_id,
        paper_id=t.paper_id,
        generation=GEN,
        kind=kind,
        thread_id=thread_id,
        message_id=None,
        token_sha256=token_sha256,
        datamark="^7f3a91c2",
        expires_at=expires_at or _in_an_hour(),
        code_path=f"api.threads.{kind}>agent.v1.runs>pi.createAgentSession>minimax.anthropic-messages",
        request_id="req_01K63AE8M4Q2T7V9X3B5N6R0C2",
        prompt_version=f"{kind}-v1",
    )
    return run_id


# ── threads and messages ─────────────────────────────────────────────────────────────────────


def test_a_thread_holds_its_messages_in_order(env: Env) -> None:
    a = env.alice
    thread_id = _thread(env, a)
    first = env.db.append_message(
        a.owner,
        thread_id,
        message_id="msg_01K63AE8M4Q2T7V9X3B5N6R0C3",
        role="user",
        generation=GEN,
        content="Explain this passage.",
        status="complete",
    )
    second = env.db.append_message(
        a.owner,
        thread_id,
        message_id="msg_01K63AE8M4Q2T7V9X3B5N6R0C4",
        role="assistant",
        generation=GEN,
        content="",
        status="streaming",
        run_id="run_01K63AE8M4Q2T7V9X3B5N6R0C1",
    )
    assert (first["ordinal"], second["ordinal"]) == (0, 1)
    assert first["completed_at"] is not None and second["completed_at"] is None
    env.db.update_message(a.owner, second["message_id"], content="It means")
    env.db.update_message(
        a.owner,
        second["message_id"],
        content="It means YOLO regresses boxes.",
        status="complete",
        completed_at="2026-09-26T04:00:00Z",
    )
    messages = env.db.list_messages(a.owner, thread_id)
    assert [m["content"] for m in messages] == [
        "Explain this passage.",
        "It means YOLO regresses boxes.",
    ]
    assert messages[1]["status"] == "complete"
    assert messages[1]["completed_at"] == "2026-09-26T04:00:00.000000+00:00"
    thread = env.db.get_thread(a.owner, a.paper_id, thread_id)
    assert thread is not None and thread["message_count"] == 2
    assert "owner_id" not in thread
    assert [t["thread_id"] for t in env.db.list_threads(a.owner, a.paper_id)] == [thread_id]


def test_threads_list_most_recently_active_first(env: Env) -> None:
    a = env.alice
    older = _thread(env, a, "thr_01K63A9W4XJ7Q2N8R5T0V3Y6Z1")
    newer = _thread(env, a, "thr_01K63A9W4XJ7Q2N8R5T0V3Y6Z2")
    assert [t["thread_id"] for t in env.db.list_threads(a.owner, a.paper_id)] == [newer, older]
    env.db.append_message(
        a.owner,
        older,
        message_id="msg_01K63AE8M4Q2T7V9X3B5N6R0C9",
        role="user",
        generation=GEN,
        content="again",
        status="complete",
    )
    assert [t["thread_id"] for t in env.db.list_threads(a.owner, a.paper_id)] == [older, newer]


def test_a_thread_is_read_through_its_own_paper_only(env: Env) -> None:
    a = env.alice
    thread_id = _thread(env, a)
    assert env.db.get_thread(a.owner, PaperId("ppr_00000000000000000000000BOB"), thread_id) is None


def test_bad_input_is_refused_before_any_sql(env: Env) -> None:
    a = env.alice
    with pytest.raises(PaperNotFound):
        env.db.create_thread(
            a.owner,
            PaperId("ppr_000000000000000000000NOPE"),
            thread_id="thr_01K63A9W4XJ7Q2N8R5T0V3Y6Z9",
            kind="ask",
            title="t",
            origin_anchor=None,
        )
    with pytest.raises(ValueError, match="kind"):
        env.db.create_thread(
            a.owner, a.paper_id, thread_id="thr_x", kind="summary", title="t", origin_anchor=None
        )
    thread_id = _thread(env, a)
    with pytest.raises(ValueError, match="role"):
        env.db.append_message(
            a.owner,
            thread_id,
            message_id="m",
            role="system",
            generation=GEN,
            content="",
            status="complete",
        )
    with pytest.raises(ValueError, match="status"):
        env.db.update_message(a.owner, "m", status="done")


def test_the_origin_anchor_is_stored_without_its_resolution(env: Env) -> None:
    a = env.alice
    anchor: dict[str, Any] = make_anchor(
        a.paper_id, a.source_hash, block_id_for(3), "anc_0000000002"
    )
    anchor["resolution"] = {"tier": 1}
    env.db.create_thread(
        a.owner,
        a.paper_id,
        thread_id="thr_01K63A9W4XJ7Q2N8R5T0V3Y6Z3",
        kind="explain",
        title="t",
        origin_anchor=anchor,
    )
    thread = env.db.get_thread(a.owner, a.paper_id, "thr_01K63A9W4XJ7Q2N8R5T0V3Y6Z3")
    assert thread is not None
    assert '"resolution"' not in thread["origin_anchor_json"]
    assert '"anc_0000000002"' in thread["origin_anchor_json"]


def test_agent_state_round_trips(env: Env) -> None:
    a = env.alice
    thread_id = _thread(env, a)
    env.db.set_agent_state(a.owner, thread_id, [{"type": "message", "id": "a1"}])
    thread = env.db.get_thread(a.owner, a.paper_id, thread_id)
    assert thread is not None and thread["agent_state_json"] == '[{"type":"message","id":"a1"}]'


# ── citations ────────────────────────────────────────────────────────────────────────────────


def _citation(t: Tenant, ordinal: int, *, supported: bool | None) -> CitationIn:
    return CitationIn(
        citation_id=f"cit_01K63AE8M4Q2T7V9X3B5N6R0C{ordinal}",
        ordinal=ordinal,
        marker=f"b{ordinal + 1}",
        anchor=make_anchor(
            t.paper_id,
            t.source_hash,
            block_id_for(ordinal),
            f"cit_01K63AE8M4Q2T7V9X3B5N6R0C{ordinal}",
        ),
        generation=GEN,
        block_id=block_id_for(ordinal),
        page_index=0,
        supported=supported,
    )


def _assistant_message(env: Env, t: Tenant, thread_id: str) -> str:
    return str(
        env.db.append_message(
            t.owner,
            thread_id,
            message_id="msg_01K63AE8M4Q2T7V9X3B5N6R0C5",
            role="assistant",
            generation=GEN,
            content="x [b1] y [b2]",
            status="complete",
        )["message_id"]
    )


def test_citations_are_stored_per_message_and_replaced_whole(env: Env) -> None:
    a = env.alice
    message_id = _assistant_message(env, a, _thread(env, a))
    env.db.put_citations(
        a.owner, message_id, [_citation(a, 0, supported=True), _citation(a, 1, supported=None)]
    )
    rows = env.db.list_citations(a.owner, [message_id])
    assert [(r["marker"], r["supported"]) for r in rows] == [("b1", True), ("b2", None)]
    assert rows[0]["anchor"]["id"] == "cit_01K63AE8M4Q2T7V9X3B5N6R0C0"
    env.db.put_citations(a.owner, message_id, [_citation(a, 0, supported=False)])
    rows = env.db.list_citations(a.owner, [message_id])
    assert [(r["marker"], r["supported"]) for r in rows] == [("b1", False)]


# ── runs, grants, handles ────────────────────────────────────────────────────────────────────


def test_a_run_token_grants_its_run_while_running_and_unexpired(env: Env) -> None:
    a = env.alice
    run_id = _run(env, a)
    grant = env.db.run_grant(run_id, TOKEN_HASH)
    assert grant is not None
    assert (grant.user_id, grant.paper_id, grant.generation, grant.kind) == (
        a.user_id,
        a.paper_id,
        1,
        "explain",
    )
    assert grant.datamark == "^7f3a91c2"
    assert grant.live_at(datetime.now(UTC))
    assert not grant.live_at(datetime.now(UTC) + timedelta(hours=2)), "an expired token is dead"
    assert env.db.run_grant(run_id, OTHER_HASH) is None
    assert env.db.run_grant("run_01K63AE8M4Q2T7V9X3B5N6R0ZZ", TOKEN_HASH) is None
    env.db.finish_run(a.owner, run_id, status="done")
    finished = env.db.run_grant(run_id, TOKEN_HASH)
    assert finished is not None and finished.status == "done"
    assert not finished.live_at(datetime.now(UTC)), "the token dies with the run"


def test_the_run_record_never_carries_the_token_hash_or_the_datamark(env: Env) -> None:
    a = env.alice
    run = env.db.get_run(a.owner, _run(env, a))
    assert run is not None
    assert "token_sha256" not in run and "datamark" not in run and "owner_id" not in run
    assert run["status"] == "running" and run["code_path"].startswith("api.threads.explain>")


def test_finish_run_records_usage_once_and_refuses_what_it_cannot_store(env: Env) -> None:
    a = env.alice
    run_id = _run(env, a)
    with pytest.raises(TypeError, match="unknown"):
        env.db.finish_run(a.owner, run_id, status="done", tokens=5)
    with pytest.raises(ValueError, match="status"):
        env.db.finish_run(a.owner, run_id, status="complete")
    with pytest.raises(TypeError):
        env.db.finish_run(a.owner, run_id, status="done", input_tokens=True)
    with pytest.raises(ValueError):
        env.db.finish_run(a.owner, run_id, status="done", input_tokens=2**63)
    with pytest.raises(ValueError):
        env.db.finish_run(a.owner, run_id, status="done", cost_usd_est=float("nan"))
    env.db.finish_run(
        a.owner,
        run_id,
        status="done",
        provider="minimax",
        model="MiniMax-M3",
        agent_sdk="pi-coding-agent@0.87.1",
        stop_reason="stop",
        input_tokens=4279,
        output_tokens=311,
        cache_read_tokens=1664,
        cache_write_tokens=0,
        reasoning_tokens=99,
        cost_usd_est=0.001553,
        first_text_ms=3812,
        latency_ms=7694,
        retries=0,
        tool_calls=1,
    )
    env.db.finish_run(a.owner, run_id, status="aborted", error_code="aborted")  # no-op now
    run = env.db.get_run(a.owner, run_id)
    assert run is not None
    assert (run["status"], run["error_code"], run["input_tokens"]) == ("done", None, 4279)
    assert run["cost_usd_est"] == pytest.approx(0.001553) and run["finished_at"] is not None


def test_handles_are_assigned_first_seen_and_never_repointed(env: Env) -> None:
    a = env.alice
    run_id = _run(env, a)
    blocks = [block_id_for(i) for i in range(4)]
    assert env.db.assign_run_handles(
        a.owner, run_id, GEN, [blocks[0], blocks[1], blocks[0], blocks[2]]
    ) == [
        "b1",
        "b2",
        "b1",
        "b3",
    ]
    assert env.db.assign_run_handles(a.owner, run_id, GEN, [blocks[2], blocks[3]]) == ["b3", "b4"]
    assert env.db.run_handles(a.owner, run_id) == {
        "b1": blocks[0],
        "b2": blocks[1],
        "b3": blocks[2],
        "b4": blocks[3],
    }
    env.db.put_run_handles(a.owner, run_id, GEN, [("b1", blocks[0])])  # idempotent
    with pytest.raises(ValueError, match="another block"):
        env.db.put_run_handles(a.owner, run_id, GEN, [("b1", blocks[3])])
    with pytest.raises(ValueError, match="handle"):
        env.db.put_run_handles(a.owner, run_id, GEN, [("x1", blocks[3])])


def test_a_follow_up_inherits_the_threads_handles(env: Env) -> None:
    a = env.alice
    thread_id = _thread(env, a)
    first = _run(env, a, "run_01K63AE8M4Q2T7V9X3B5N6R0A1", thread_id=thread_id)
    env.db.assign_run_handles(a.owner, first, GEN, [block_id_for(i) for i in range(3)])
    env.db.finish_run(a.owner, first, status="done")
    second = _run(env, a, "run_01K63AE8M4Q2T7V9X3B5N6R0A2", thread_id=thread_id)
    inherited = env.db.thread_handles(a.owner, thread_id)
    assert inherited == [("b1", block_id_for(0)), ("b2", block_id_for(1)), ("b3", block_id_for(2))]
    env.db.put_run_handles(a.owner, second, GEN, inherited)
    assert env.db.assign_run_handles(a.owner, second, GEN, [block_id_for(1), block_id_for(5)]) == [
        "b2",
        "b4",
    ]


def test_the_tool_request_cap_is_one_atomic_count(env: Env) -> None:
    a = env.alice
    run_id = _run(env, a)
    counts = [
        env.db.record_tool_request(a.owner, run_id, {"route": "outline", "n": n}, cap=16)
        for n in range(17)
    ]
    assert counts[:16] == list(range(1, 17))
    assert counts[16] is None, "the 17th request of a run is refused"
    run = env.db.get_run(a.owner, run_id)
    assert run is not None and run["tool_calls_json"].count('"route"') == 16


def test_a_live_run_makes_the_thread_busy_until_it_finishes(env: Env) -> None:
    a = env.alice
    thread_id = _thread(env, a)
    run_id = _run(env, a, thread_id=thread_id)
    live = env.db.live_run_for_thread(a.owner, thread_id)
    assert live is not None and live["run_id"] == run_id
    env.db.finish_run(a.owner, run_id, status="done")
    assert env.db.live_run_for_thread(a.owner, thread_id) is None
    expired = _run(
        env,
        a,
        "run_01K63AE8M4Q2T7V9X3B5N6R0A3",
        thread_id=thread_id,
        expires_at="2026-01-01T00:00:00Z",
    )
    assert expired and env.db.live_run_for_thread(a.owner, thread_id) is None, (
        "an expired run is not busy"
    )


# ── spend and usage ──────────────────────────────────────────────────────────────────────────


def test_cost_and_usage_count_runs_started_since_the_cut(env: Env) -> None:
    a = env.alice
    old = _run(env, a, "run_01K63AE8M4Q2T7V9X3B5N6R0B1")
    env.db.finish_run(
        a.owner, old, status="done", input_tokens=100, output_tokens=10, cost_usd_est=0.5
    )
    started = env.db.get_run(a.owner, old)
    assert started is not None
    cut = (datetime.fromisoformat(started["started_at"]) + timedelta(microseconds=1)).isoformat()
    new = _run(env, a, "run_01K63AE8M4Q2T7V9X3B5N6R0B2", kind="summary")
    env.db.finish_run(
        a.owner, new, status="done", input_tokens=7, output_tokens=3, cost_usd_est=0.25
    )
    _run(env, a, "run_01K63AE8M4Q2T7V9X3B5N6R0B3", kind="ask")  # still running: no cost yet
    assert env.db.cost_since(a.owner, "2000-01-01T00:00:00Z") == pytest.approx(0.75)
    assert env.db.cost_since(a.owner, cut) == pytest.approx(0.25)
    usage = env.db.usage_since(a.owner, cut)
    assert (usage.runs, usage.input_tokens, usage.output_tokens) == (2, 7, 3)
    assert usage.by_kind["summary"] == UsageBucket(1, 7, 3, 0.25)
    assert usage.by_kind["ask"] == UsageBucket(1, 0, 0, 0.0)
    assert usage.by_kind["explain"] == UsageBucket(0, 0, 0, 0.0)


def test_times_are_normalised_to_one_comparable_shape() -> None:
    assert normalise_time("2026-09-25T15:09:25.123Z") == "2026-09-25T15:09:25.123000+00:00"
    assert normalise_time("2026-09-25T20:39:25+05:30") == "2026-09-25T15:09:25.000000+00:00"
    with pytest.raises(ValueError, match="zone"):
        normalise_time("2026-09-25T15:09:25")


# ── summaries ────────────────────────────────────────────────────────────────────────────────


def test_a_summary_is_one_cached_derivation_per_key(env: Env) -> None:
    a = env.alice
    content = {"status": "complete", "bullets": [{"text": "x [b1]"}]}
    first = env.db.put_summary(
        a.owner,
        a.paper_id,
        GEN,
        prompt_hash="summary-v1",
        model_id="MiniMax-M3",
        content=content,
        derived_from=[block_id_for(0), block_id_for(0), block_id_for(1)],
    )
    cached = env.db.get_summary(a.owner, a.paper_id, GEN, "summary-v1", "MiniMax-M3")
    assert cached is not None and cached["derivation_id"] == first
    assert cached["content"] == content and cached["derived_from"] == [
        block_id_for(0),
        block_id_for(1),
    ]
    second = env.db.put_summary(
        a.owner,
        a.paper_id,
        GEN,
        prompt_hash="summary-v1",
        model_id="MiniMax-M3",
        content={"status": "partial", "bullets": []},
        derived_from=[block_id_for(2)],
    )
    cached = env.db.get_summary(a.owner, a.paper_id, GEN, "summary-v1", "MiniMax-M3")
    assert cached is not None and cached["derivation_id"] == second != first
    assert env.db.get_summary(a.owner, a.paper_id, GEN, "summary-v2", "MiniMax-M3") is None
    with pytest.raises(ValueError, match="cite"):
        env.db.put_summary(
            a.owner,
            a.paper_id,
            GEN,
            prompt_hash="summary-v1",
            model_id="MiniMax-M3",
            content={},
            derived_from=[],
        )


# ── owner isolation, one table at a time ─────────────────────────────────────────────────────


def test_bob_cannot_see_or_touch_alices_threads_and_messages(env: Env) -> None:
    a, b = env.alice, env.bob
    thread_id = _thread(env, a)
    message_id = _assistant_message(env, a, thread_id)
    # alice sees them ...
    assert env.db.get_thread(a.owner, a.paper_id, thread_id) is not None
    assert len(env.db.list_messages(a.owner, thread_id)) == 1
    # ... bob does not, even naming alice's paper and ids exactly.
    assert env.db.get_thread(b.owner, a.paper_id, thread_id) is None
    assert env.db.list_threads(b.owner, a.paper_id) == []
    assert env.db.list_messages(b.owner, thread_id) == []
    assert env.db.get_message(b.owner, message_id) is None
    with pytest.raises(PaperNotFound):
        env.db.create_thread(
            b.owner, a.paper_id, thread_id="thr_bobs", kind="ask", title="t", origin_anchor=None
        )
    with pytest.raises(AiRecordNotFound):
        env.db.append_message(
            b.owner,
            thread_id,
            message_id="msg_bob",
            role="user",
            generation=GEN,
            content="x",
            status="complete",
        )
    with pytest.raises(AiRecordNotFound):
        env.db.update_message(b.owner, message_id, content="bob was here")
    with pytest.raises(AiRecordNotFound):
        env.db.set_agent_state(b.owner, thread_id, [])
    assert env.db.delete_thread(b.owner, a.paper_id, thread_id) == 0
    assert env.db.delete_messages(b.owner, [message_id]) == 0
    assert [m["content"] for m in env.db.list_messages(a.owner, thread_id)] == ["x [b1] y [b2]"]


def test_bob_cannot_see_or_write_alices_citations(env: Env) -> None:
    a, b = env.alice, env.bob
    message_id = _assistant_message(env, a, _thread(env, a))
    env.db.put_citations(a.owner, message_id, [_citation(a, 0, supported=True)])
    assert len(env.db.list_citations(a.owner, [message_id])) == 1
    assert env.db.list_citations(b.owner, [message_id]) == []
    with pytest.raises(AiRecordNotFound):
        env.db.put_citations(b.owner, message_id, [_citation(b, 1, supported=True)])
    assert len(env.db.list_citations(a.owner, [message_id])) == 1


def test_bob_cannot_see_finish_or_spend_through_alices_runs(env: Env) -> None:
    a, b = env.alice, env.bob
    thread_id = _thread(env, a)
    run_id = _run(env, a, thread_id=thread_id)
    env.db.assign_run_handles(a.owner, run_id, GEN, [block_id_for(0)])
    assert env.db.get_run(b.owner, run_id) is None
    env.db.finish_run(b.owner, run_id, status="aborted")  # bob's finish touches nothing
    alices = env.db.get_run(a.owner, run_id)
    assert alices is not None and alices["status"] == "running"
    assert env.db.live_run_for_thread(b.owner, thread_id) is None
    assert env.db.live_run_for_thread(a.owner, thread_id) is not None
    assert env.db.run_handles(b.owner, run_id) == {}
    assert env.db.thread_handles(b.owner, thread_id) == []
    with pytest.raises(AiRecordNotFound):
        env.db.assign_run_handles(b.owner, run_id, GEN, [block_id_for(1)])
    with pytest.raises(AiRecordNotFound):
        env.db.put_run_handles(b.owner, run_id, GEN, [("b9", block_id_for(1))])
    assert env.db.record_tool_request(b.owner, run_id, {"route": "outline"}, cap=16) is None
    assert env.db.record_tool_request(a.owner, run_id, {"route": "outline"}, cap=16) == 1
    with pytest.raises(PaperNotFound):
        env.db.create_run(
            b.owner,
            run_id="run_01K63AE8M4Q2T7V9X3B5N6R0D1",
            paper_id=a.paper_id,
            generation=GEN,
            kind="ask",
            thread_id=None,
            message_id=None,
            token_sha256=OTHER_HASH,
            datamark="^00000000",
            expires_at=_in_an_hour(),
            code_path="x",
            request_id=None,
            prompt_version=None,
        )
    env.db.finish_run(a.owner, run_id, status="done", cost_usd_est=0.9, input_tokens=5)
    assert env.db.cost_since(a.owner, "2000-01-01T00:00:00Z") == pytest.approx(0.9)
    assert env.db.cost_since(b.owner, "2000-01-01T00:00:00Z") == 0.0
    assert env.db.usage_since(b.owner, "2000-01-01T00:00:00Z").runs == 0


def test_bob_cannot_read_or_overwrite_alices_summary(env: Env) -> None:
    a, b = env.alice, env.bob
    env.db.put_summary(
        a.owner,
        a.paper_id,
        GEN,
        prompt_hash="summary-v1",
        model_id="MiniMax-M3",
        content={"status": "complete"},
        derived_from=[block_id_for(0)],
    )
    assert env.db.get_summary(a.owner, a.paper_id, GEN, "summary-v1", "MiniMax-M3") is not None
    assert env.db.get_summary(b.owner, a.paper_id, GEN, "summary-v1", "MiniMax-M3") is None
    with pytest.raises(PaperNotFound):
        env.db.put_summary(
            b.owner,
            a.paper_id,
            GEN,
            prompt_hash="summary-v1",
            model_id="MiniMax-M3",
            content={"status": "complete", "by": "bob"},
            derived_from=[block_id_for(0)],
        )
    cached = env.db.get_summary(a.owner, a.paper_id, GEN, "summary-v1", "MiniMax-M3")
    assert cached is not None and cached["content"] == {"status": "complete"}
