"""Migration 0011 and the diagram parts it adds (v0.2 S7a, #216).

0011 rebuilds ``ai_threads`` and ``ai_runs`` (their ``kind`` CHECKs gain ``diagram`` and ``topic``)
together with their children, adds ``ai_messages.diagram_json`` and creates ``ai_diagram_parts``.
The migration tests run it over a real database with every AI table filled, column by column, at
two bases (v0.2's 0008, and every migration below 11, which on release puts 0009's topics first),
and check every row, every FK, the cascades and the triggers survive; and the row-count guard is
made to fire. The parts
tests hold the three states a part can be in (cited, not verified, inferred) to the table's CHECKs
from Python AND from raw SQL, and bob to nothing.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest
from papertree_db import OwnerId, PaperId, PaperTreeDb, generation, open_database
from papertree_db.ai import AiRecordNotFound, DiagramPartIn

from .saved_shapes import (
    MIGRATIONS_DIR,
    load_capture_anchor,
    load_fixture_paper,
    migrations_through,
)

NOW = "2026-10-01T00:00:00.000000+00:00"
LATER = "2026-10-01T00:00:05.000000+00:00"
#: The five tables 0011 rebuilds, each read in a stable order.
REBUILT = {
    "ai_threads": "SELECT * FROM ai_threads ORDER BY thread_id",
    "ai_messages": "SELECT * FROM ai_messages ORDER BY message_id",
    "ai_citations": "SELECT * FROM ai_citations ORDER BY citation_id",
    "ai_runs": "SELECT * FROM ai_runs ORDER BY run_id",
    "ai_run_handles": "SELECT * FROM ai_run_handles ORDER BY run_id, handle",
}
TRIGGERS = "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name"


def _rows(conn: sqlite3.Connection, sql: str) -> list[tuple[Any, ...]]:
    return [tuple(r) for r in conn.execute(sql).fetchall()]


def _fill_ai_tables(conn: sqlite3.Connection, owner_id: str, paper_id: str) -> None:
    """Every AI table of 0005, with every nullable column set, so a dropped column would show."""
    anchor = '{"doc":{"paperId":"p"},"id":"anc_1"}'
    conn.execute(
        "INSERT INTO ai_threads VALUES ('thr_1', ?, ?, 'explain', 'Té', ?, '[{\"id\":1}]', ?, ?)",
        (owner_id, paper_id, anchor, NOW, LATER),
    )
    conn.execute(
        "INSERT INTO ai_threads VALUES ('thr_2', ?, ?, 'ask', 'Ask', NULL, NULL, ?, ?)",
        (owner_id, paper_id, NOW, NOW),
    )
    for message_id, thread_id, ordinal, role, status in (
        ("msg_u1", "thr_1", 0, "user", "complete"),
        ("msg_a1", "thr_1", 1, "assistant", "partial"),
        ("msg_u2", "thr_2", 0, "user", "complete"),
    ):
        conn.execute(
            "INSERT INTO ai_messages VALUES (?, ?, ?, ?, ?, 1, 'x [b1] y', ?, 'timeout', 'run_1', "
            "?, ?)",
            (message_id, owner_id, thread_id, ordinal, role, status, NOW, LATER),
        )
    for citation_id, ordinal, supported in (("cit_1", 0, 1), ("cit_2", 1, None)):
        conn.execute(
            "INSERT INTO ai_citations VALUES (?, ?, 'msg_a1', ?, 'b1', ?, 1, 'blk_1', 2, ?)",
            (citation_id, owner_id, ordinal, anchor, supported),
        )
    runs: tuple[tuple[str, str, str | None, str | None], ...] = (
        ("run_1", "explain", "thr_1", "msg_a1"),
        ("run_2", "summary", None, None),
    )
    for run_id, kind, run_thread, run_message in runs:
        conn.execute(
            "INSERT INTO ai_runs VALUES (?, ?, ?, 1, ?, ?, ?, ?, '^7f3a91c2', ?, 'done', 'cp', "
            "'minimax', 'MiniMax-M3', 'pi@0.87.1', 'explain-v1', 'req_1', 'stop', 'timeout', 1, "
            '2, \'[{"tool":"get_section"}]\', 10, 20, 30, 40, 50, 0.0125, 600, 700, ?, ?)',
            (
                run_id,
                owner_id,
                paper_id,
                kind,
                run_thread,
                run_message,
                "a" * 64,
                LATER,
                NOW,
                LATER,
            ),
        )
    for handle, block_id in (("b1", "blk_1"), ("b2", "blk_2")):
        conn.execute(
            "INSERT INTO ai_run_handles VALUES (?, 'run_1', ?, ?, 1)", (owner_id, handle, block_id)
        )
    # A group with two members on a board: 0005/0008's ungroup trigger must survive 0011.
    conn.execute(
        "INSERT INTO canvas_boards VALUES ('brd_1', ?, ?, 'Canvas', NULL, ?, ?)",
        (owner_id, paper_id, NOW, NOW),
    )
    for node_id, kind in (("cn_g", "group"), ("cn_n", "note")):
        conn.execute(
            "INSERT INTO canvas_nodes (node_id, owner_id, board_id, kind, x, y, w, h, created_at, "
            "updated_at) VALUES (?, ?, 'brd_1', ?, 1, 2, 3, 4, ?, ?)",
            (node_id, owner_id, kind, NOW, NOW),
        )
    conn.execute("UPDATE canvas_nodes SET group_id = 'cn_g' WHERE node_id = 'cn_n'")


def _populated(tmp_path: Path, base: int) -> tuple[Path, str, str]:
    """A database at migration ``base`` (every file numbered up to it) with the AI tables filled."""
    file = tmp_path / "old.sqlite"
    with open_database(file, migrations_through(base, tmp_path / f"m{base}")) as db:
        db.migrate()
        owner = db.create_user("reader@papertree.test").owner
        document = load_fixture_paper()
        db.put_paper(owner, document)
        db.promote_generation(owner, PaperId(document["paper_id"]), generation(1))
        owner_id, paper_id = db._resolve(owner), str(document["paper_id"])
    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    _fill_ai_tables(conn, owner_id, paper_id)
    conn.commit()
    conn.close()
    return file, owner_id, paper_id


@pytest.mark.parametrize("base", [8, 10], ids=["from 0008", "from everything below 0011"])
def test_0011_carries_every_ai_row_fk_cascade_and_trigger(tmp_path: Path, base: int) -> None:
    file, owner_id, paper_id = _populated(tmp_path, base)
    conn = sqlite3.connect(file)
    before = {table: _rows(conn, sql) for table, sql in REBUILT.items()}
    triggers = _rows(conn, TRIGGERS)
    conn.close()
    assert all(before.values()), "every rebuilt table held rows before"

    with open_database(file) as db:
        result = db.migrate()
        assert result.applied[-1] == 11, "0011 applies after every migration below it"
        if base == 10:
            assert result.applied == (11,)
        assert any(path.name.endswith(".pre-0011.bak") for path in result.backups)

    conn = sqlite3.connect(file)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        for table, sql in REBUILT.items():
            after = _rows(conn, sql)
            width = len(before[table][0])
            assert [r[:width] for r in after] == before[table], table  # every old column
            if table == "ai_messages":
                assert {r[width:] for r in after} == {(None,)}, "diagram_json appended, NULL"
            else:
                assert all(len(r) == width for r in after), table
        assert _rows(conn, "PRAGMA foreign_key_check") == []
        assert _rows(conn, "PRAGMA integrity_check") == [("ok",)]
        assert _rows(conn, "SELECT name FROM sqlite_master WHERE name LIKE '%_new'") == []
        # Every trigger survives (from 0008, a later migration such as 0009 adds its own).
        assert set(triggers) <= set(_rows(conn, TRIGGERS))
        if base == 10:
            assert _rows(conn, TRIGGERS) == triggers
        indexes = {r[0] for r in _rows(conn, "SELECT name FROM sqlite_master WHERE type='index'")}
        assert {"ai_threads_by_paper", "ai_runs_by_owner", "ai_diagram_parts_by_message"} <= indexes
        # The widened CHECKs are live, and still refuse what they refused.
        for kind in ("diagram", "topic"):
            conn.execute(
                "INSERT INTO ai_threads VALUES (?, ?, ?, ?, 't', NULL, NULL, ?, ?)",
                (f"thr_{kind}", owner_id, paper_id, kind, NOW, NOW),
            )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO ai_threads VALUES ('thr_s', ?, ?, 'summary', 't', NULL, NULL, ?, ?)",
                (owner_id, paper_id, NOW, NOW),
            )
        conn.execute("UPDATE ai_runs SET kind = 'diagram' WHERE run_id = 'run_2'")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE ai_runs SET kind = 'chat' WHERE run_id = 'run_2'")
        # The cascades still cascade through the renamed tables.
        conn.execute("DELETE FROM ai_threads WHERE thread_id = 'thr_1'")
        assert _rows(conn, "SELECT message_id FROM ai_messages ORDER BY message_id") == [
            ("msg_u2",)
        ]
        assert _rows(conn, "SELECT COUNT(*) FROM ai_citations") == [(0,)]
        conn.execute("DELETE FROM ai_runs WHERE run_id = 'run_1'")
        assert _rows(conn, "SELECT COUNT(*) FROM ai_run_handles") == [(0,)]
        # 0008's ungroup trigger.
        conn.execute("DELETE FROM canvas_nodes WHERE node_id = 'cn_g'")
        assert _rows(conn, "SELECT group_id FROM canvas_nodes") == [(None,)]
    finally:
        conn.close()


def test_the_row_count_guard_aborts_0011_and_leaves_the_database_as_it_was(
    tmp_path: Path,
) -> None:
    """Non-vacuity for the guard: a copy of 0011 that loses one citation row in the copy must
    fail on the guard's CHECK, and the rollback must leave every table and the record unchanged."""
    file, _owner, _paper = _populated(tmp_path, 10)
    broken = migrations_through(10, tmp_path / "broken")
    source = MIGRATIONS_DIR / "0011_diagrams.sql"
    sql = source.read_text(encoding="utf-8")
    lossy = "    FROM ai_citations;\n"
    assert sql.count(lossy) == 1
    (broken / source.name).write_text(
        sql.replace(lossy, "    FROM ai_citations WHERE ordinal > 0;\n")
    )
    conn = sqlite3.connect(file)
    schema = _rows(conn, "SELECT type, name, sql FROM sqlite_master ORDER BY name")
    rows = {table: _rows(conn, sql) for table, sql in REBUILT.items()}
    conn.close()
    with open_database(file, broken) as db, pytest.raises(sqlite3.IntegrityError, match="ok = 1"):
        db.migrate()
    conn = sqlite3.connect(file)
    try:
        assert _rows(conn, "SELECT type, name, sql FROM sqlite_master ORDER BY name") == schema
        assert {table: _rows(conn, sql) for table, sql in REBUILT.items()} == rows
        assert 11 not in {v for (v,) in _rows(conn, "SELECT version FROM schema_migrations")}
    finally:
        conn.close()


def test_0011_on_a_fresh_database(tmp_path: Path) -> None:
    with open_database(tmp_path / "fresh.sqlite") as db:
        result = db.migrate()
        assert 11 in result.applied and result.backups == ()
        assert db.migrate().applied == ()


# ── the parts ────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Env:
    db: PaperTreeDb
    owner: OwnerId
    other: OwnerId
    message_id: str
    file: Path


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    file = tmp_path / "parts.sqlite"
    db = open_database(file)
    db.migrate()
    owner = db.create_user("alice@papertree.test").owner
    other = db.create_user("bob@papertree.test").owner
    document = load_fixture_paper()
    paper_id = PaperId(document["paper_id"])
    db.put_paper(owner, document)
    db.promote_generation(owner, paper_id, generation(1))
    db.create_thread(
        owner, paper_id, thread_id="thr_d", kind="diagram", title="Plate", origin_anchor=None
    )
    db.append_message(
        owner,
        "thr_d",
        message_id="msg_d",
        role="assistant",
        generation=1,
        content="",
        status="streaming",
    )
    yield Env(db, owner, other, "msg_d", file)
    db.close()


def _part(ordinal: int, **fields: Any) -> DiagramPartIn:
    base = DiagramPartIn(
        part_id=f"dp_{ordinal:02d}",
        ordinal=ordinal,
        label=f"Part {ordinal}",
        text="one line",
        kind="step",
        after=[],
        edge=[],
        quote=None,
        anchor=None,
        supported=None,
        generation=1,
        block_id=None,
        page_index=None,
    )
    return replace(base, **fields)


def _cited(ordinal: int, supported: bool, **fields: Any) -> DiagramPartIn:
    anchor = load_capture_anchor()
    return _part(
        ordinal,
        quote="queries and keys of dimension",
        anchor={**anchor, "resolution": {"tier": 1}},
        supported=supported,
        block_id="blk_hint",
        page_index=3,
        **fields,
    )


def test_the_three_states_of_a_part_round_trip_in_letter_order(env: Env) -> None:
    db, owner = env.db, env.owner
    db.put_diagram_part(owner, env.message_id, _part(2, after=["A", "B"], edge=["feeds", None]))
    db.put_diagram_part(owner, env.message_id, _cited(0, True, kind="input"))
    db.put_diagram_part(
        owner,
        env.message_id,
        _part(1, after=["A"], edge=[None], quote="not in it", supported=False),
    )
    parts = db.list_diagram_parts(owner, [env.message_id])
    assert [p["letter"] for p in parts] == ["A", "B", "C"]
    cited, unresolved, inferred = parts
    assert (cited["supported"], cited["part_kind"], cited["page_index"]) == (True, "input", 3)
    assert "resolution" not in cited["anchor"], "the T0 cache is never stored"
    assert (unresolved["supported"], unresolved["anchor"], unresolved["cite_quote"]) == (
        False,
        None,
        "not in it",
    )
    assert (inferred["supported"], inferred["cite_quote"], inferred["anchor"]) == (None, None, None)
    assert (inferred["after"], inferred["edge"], inferred["note"]) == (
        ["A", "B"],
        ["feeds", None],
        "one line",
    )


def test_the_plate_title_and_links_ride_on_the_message(env: Env) -> None:
    plate = {"title": "Scaled dot-product attention", "links": []}
    env.db.set_message_diagram(env.owner, env.message_id, plate)
    message = env.db.get_message(env.owner, env.message_id)
    assert message is not None and message["diagram"] == plate
    (listed,) = env.db.list_messages(env.owner, "thr_d")
    assert listed["diagram"] == plate
    with pytest.raises(AiRecordNotFound):
        env.db.set_message_diagram(env.other, env.message_id, {"title": "bob's"})
    assert env.db.get_message(env.owner, env.message_id)["diagram"] == plate  # type: ignore[index]


@pytest.mark.parametrize(
    "part",
    [
        _part(12),  # a thirteenth part
        _part(1, after=["B"], edge=[None]),  # an edge from itself
        _part(1, after=["C"], edge=[None]),  # from a later letter
        _part(1, after=["A"], edge=[]),  # an edge label missing
        _part(0, kind="box"),
        _part(0, label=" "),
        _part(0, quote="q"),  # a quote with no verdict
        _part(0, quote="q", supported=True),  # "cited" with no anchor
        _part(0, quote="q", supported=False, block_id="blk_1"),  # a hint with no anchor
    ],
)
def test_a_part_0011_would_refuse_is_refused_in_words_before_any_sql(
    env: Env, part: DiagramPartIn
) -> None:
    with pytest.raises(ValueError):
        env.db.put_diagram_part(env.owner, env.message_id, part)
    assert env.db.list_diagram_parts(env.owner, [env.message_id]) == []


@pytest.mark.parametrize(
    ("columns", "values"),
    [
        ("letter, ordinal", "'B', 0"),  # the letter is A + ordinal
        ("letter, ordinal", "'M', 12"),
        ("cite_quote, supported", "'q', NULL"),
        ("supported, cite_quote", "1, 'q'"),  # supported without an anchor
        ("after_json, edge_json", "'[\"A\"]', '[]'"),
    ],
)
def test_the_table_itself_refuses_a_bad_part(env: Env, columns: str, values: str) -> None:
    """The CHECKs hold without the Python layer (a raw writer cannot store a wrong part)."""
    owner_id = env.db._resolve(env.owner)
    defaults = {
        "letter": "'A'",
        "ordinal": "0",
        "after_json": "'[]'",
        "edge_json": "'[]'",
        "cite_quote": "NULL",
        "supported": "NULL",
    }
    for name, value in zip(columns.split(", "), values.split(", "), strict=True):
        defaults[name] = value
    sql = (
        "INSERT INTO ai_diagram_parts (part_id, owner_id, message_id, label, part_kind, "
        f"generation, {', '.join(defaults)}) VALUES ('dp_x', ?, 'msg_d', 'L', 'step', 1, "
        f"{', '.join(defaults.values())})"
    )
    good = sql.replace(f"{', '.join(defaults.values())})", "'A', 0, '[]', '[]', NULL, NULL)")
    conn = sqlite3.connect(env.file)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(sql, (owner_id,))
        conn.execute(good, (owner_id,))  # the same row with the defaults is taken: not vacuous
    finally:
        conn.close()


def test_bob_cannot_write_or_read_alices_parts(env: Env) -> None:
    env.db.put_diagram_part(env.owner, env.message_id, _part(0))
    with pytest.raises(AiRecordNotFound):
        env.db.put_diagram_part(env.other, env.message_id, _part(1))
    assert env.db.list_diagram_parts(env.other, [env.message_id]) == []
    assert len(env.db.list_diagram_parts(env.owner, [env.message_id])) == 1


def test_a_part_goes_with_its_message(env: Env) -> None:
    env.db.put_diagram_part(env.owner, env.message_id, _part(0))
    assert env.db.delete_messages(env.owner, [env.message_id]) == 1
    assert env.db.list_diagram_parts(env.owner, [env.message_id]) == []
