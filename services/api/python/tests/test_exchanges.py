"""#201 (S4a): the thread list's ``ask`` / ``last_status``, citation ``locator``, ``coverage``.

* pure units for ``ask_excerpt`` and ``message_coverage``;
* a GOLDEN coverage test on the real stored Attention answer
  (``data/attention_explain_answer.json``, copied from the demo database);
* locator goldens on the committed Attention parse AND, corpus-gated (skips loudly), on a fresh
  real parse of the corpus PDF: the four frame-04 tabs ``p.1 ¶1 Abstract``, ``p.2 ¶2/¶3/¶4``;
* the routes: ask, truncation, last_status, owner isolation, and a stored answer read back.
"""

from __future__ import annotations

import json
import re
import sqlite3
import tempfile
import uuid
from pathlib import Path
from typing import Any

import pytest
from ai_support import ai_harness, alice_with_paper, contract_errors, events, explain, read_sse
from ai_support import paragraph_anchor as fixture_anchor
from api_support import auth, harness, register, seed_paper
from fake_agent import Script
from papertree_anchoring import capture_citation
from papertree_api.evidence import DocumentCache, PassageLocators, load_index, passage_key
from papertree_api.exchanges import answer_paragraphs, ask_excerpt, message_coverage
from papertree_api.schemas import Message, Thread
from papertree_api.worker import run as run_worker
from papertree_db import PaperTreeDb
from papertree_retrieval import PaperIndexCache

DATA = Path(__file__).resolve().parent / "data"
CORPUS = Path(__file__).resolve().parents[4] / "research" / "benchmarks" / "corpus"
ATTENTION_PDF = CORPUS / "attention-is-all-you-need.pdf"
requires_attention_pdf = pytest.mark.skipif(
    not ATTENTION_PDF.is_file(),
    reason=(
        f"{ATTENTION_PDF} is absent: fetched, not committed. Run ./research/benchmarks/"
        "fetch_corpus.sh to test passage locators on a real parse."
    ),
)

#: The frame-04 tabs: (text the block starts with, page_index, para_index, section heading ends).
FRAME_04_TABS = [
    ("The dominant sequence transduction models", 0, 1, "Abstract"),
    ("Recurrent models typically factor computation", 1, 2, "Introduction"),
    ("Attention mechanisms have become an integral part", 1, 3, "Introduction"),
    ("In this work we propose the Transformer", 1, 4, "Introduction"),
]


# ── ask_excerpt ──────────────────────────────────────────────────────────────────────────────


def test_ask_excerpt_keeps_short_text_and_collapses_whitespace() -> None:
    assert ask_excerpt("Explain this passage.") == "Explain this passage."
    assert ask_excerpt("  why\n\n does   it work ? ") == "why does it work ?"
    assert ask_excerpt(None) == ""


def test_ask_excerpt_cuts_on_a_word_boundary_within_160_characters() -> None:
    text = " ".join(f"word{i:03d}" for i in range(60))
    cut = ask_excerpt(text)
    assert cut.endswith("…") and len(cut) <= 160
    assert text.startswith(cut[:-1]) and text[len(cut) - 1] == " ", "ended on a whole word"
    assert ask_excerpt("x" * 160) == "x" * 160  # exactly the limit is not cut
    long_word = ask_excerpt("y" * 400)
    assert long_word == "y" * 159 + "…"


# ── message_coverage ─────────────────────────────────────────────────────────────────────────


def test_coverage_counts_handles_paragraphs_and_skips_a_bare_heading() -> None:
    content = "# Summary\n\nOne [b1, b2].\n\nTwo [b1].\n\nNo claim here."
    assert answer_paragraphs(content) == ["One [b1, b2].", "Two [b1].", "No claim here."]
    coverage = message_coverage(content, [("g1:a", True), ("g1:b", False), ("g1:a", None)])
    assert coverage == {
        "passages": 2,
        "citations": 3,
        "paragraphs": 3,
        "uncited_paragraphs": [2],
        "not_verified": 1,
    }


def test_coverage_of_an_answer_with_no_markers() -> None:
    assert message_coverage("Plain.", []) == {
        "passages": 0,
        "citations": 0,
        "paragraphs": 1,
        "uncited_paragraphs": [0],
        "not_verified": 0,
    }


def test_coverage_of_the_real_stored_attention_answer() -> None:
    """Golden: the real explain answer of the demo database (see the fixture's ``_source``)."""
    stored = json.loads((DATA / "attention_explain_answer.json").read_text(encoding="utf-8"))
    citations = [
        (passage_key(c["generation"], c["block_id"]), c["supported"]) for c in stored["citations"]
    ]
    coverage = message_coverage(stored["content"], citations)
    assert [c["marker"] for c in stored["citations"]] == ["b1", "b6", "b7", "b8"]
    assert coverage["citations"] == 11
    assert coverage["passages"] == 4
    assert coverage["paragraphs"] == 5
    assert coverage["uncited_paragraphs"] == [4]
    assert coverage["not_verified"] == sum(
        1 for c in stored["citations"] if c["supported"] is False
    )
    # "cited 5× / once / 2× / 3×": per handle occurrences, in order of first use.
    handles = re.findall(r"b\d+", " ".join(re.findall(r"\[(b\d+(?:, b\d+)*)\]", stored["content"])))
    assert [handles.count(m) for m in ("b1", "b6", "b7", "b8")] == [5, 1, 2, 3]


# ── passage locators ─────────────────────────────────────────────────────────────────────────


def _locate_tabs(settings: Any, user_id: str, paper_id: str) -> list[dict[str, Any] | None]:
    """Mint a citation per frame-04 passage the way a run's ``done`` does, then locate each."""
    db = PaperTreeDb(settings.database_file)
    try:
        owner = db.owner_for(user_id)
        generation = db.promoted_generation(owner, paper_id)  # type: ignore[arg-type]
        assert generation is not None
        doc = DocumentCache().get(db, owner, user_id, paper_id, generation)
        assert doc is not None
        index = load_index(PaperIndexCache(), db, owner, user_id, paper_id, generation)
        locators = PassageLocators(index)
        found: list[dict[str, Any] | None] = []
        for start, *_ in FRAME_04_TABS:
            matches = [b for b in doc.blocks if b.text.strip().startswith(start)]
            assert len(matches) == 1, (start, [b.block.block_id for b in matches])
            anchor = dict(
                capture_citation(
                    doc,
                    matches[0].block.block_id,
                    citation_id=f"cit_{uuid.uuid4().hex[:26].upper()}",
                    at="2026-09-26T05:00:00.000Z",
                )
            )
            found.append(locators.locate(anchor))
        return found
    finally:
        db.close()


def _assert_frame_04(found: list[dict[str, Any] | None]) -> None:
    for (start, page, para, heading), locator in zip(FRAME_04_TABS, found, strict=True):
        assert locator is not None, start
        assert (locator["page_index"], locator["para_index"]) == (page, para), (start, locator)
        assert (locator["section_heading"] or "").endswith(heading), (start, locator)
        assert locator["passage_key"].startswith("g1:blk_")
    assert len({loc["passage_key"] for loc in found if loc}) == 4


def test_locators_on_the_committed_attention_parse() -> None:
    with tempfile.TemporaryDirectory() as tmp, harness(Path(tmp)) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "attention-is-all-you-need")
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        found = _locate_tabs(h.settings, user_id, paper_id)
    _assert_frame_04(found)


@requires_attention_pdf
def test_locators_on_a_fresh_real_parse_of_the_attention_pdf(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        response = h.client.post(
            "/papers",
            files={"file": ("attention.pdf", ATTENTION_PDF.read_bytes(), "application/pdf")},
            headers=auth(token),
        )
        assert response.status_code == 202, response.text
        paper_id = response.json()["paper_id"]
        assert run_worker(h.settings, max_jobs=5) >= 1
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        found = _locate_tabs(h.settings, user_id, paper_id)
    print(f"\n[exchanges] real parse locators: {found}")
    _assert_frame_04(found)


def test_a_banner_paragraph_before_the_abstract_and_a_typed_heading_are_not_counted() -> None:
    """The two rules of ¶ numbering, shown against the parse's own blocks (non-vacuity for the
    goldens above): the p. 1 attribution banner is a ``paragraph`` before the abstract, and would
    make the abstract ¶2 if counted."""
    with tempfile.TemporaryDirectory() as tmp, harness(Path(tmp)) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "attention-is-all-you-need")
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        db = PaperTreeDb(h.settings.database_file)
        owner = db.owner_for(user_id)
        index = load_index(PaperIndexCache(), db, owner, user_id, paper_id, 1)
        db.close()
    locators = PassageLocators(index)
    page_one = [index.block(b) for b in index.reading_order]
    banner = next(b for b in page_one if b and b.text.startswith("Provided proper attribution"))
    assert banner.type == "paragraph" and banner.page_index == 0
    abstract = next(b for b in page_one if b and b.type == "abstract")
    assert index.rank(banner.block_id) < index.rank(abstract.block_id)
    para_of = locators._para_of  # noqa: SLF001 (white-box on purpose: the banner is simply absent)
    assert banner.block_id not in para_of and para_of[abstract.block_id] == 1
    headings = {s.heading_block_id for s in index.sections}
    assert headings and not headings & set(para_of)


# ── the routes ───────────────────────────────────────────────────────────────────────────────


def test_thread_list_carries_ask_and_last_status_for_explain_and_ask_threads(
    tmp_path: Path,
) -> None:
    long_question = " ".join(f"question{i}" for i in range(60))
    with ai_harness(
        tmp_path, [Script("explain-ok"), Script("explain-ok"), Script("explain-ok")]
    ) as h:
        token, paper_id = alice_with_paper(h)
        explain_run = events(read_sse(explain(h, token, paper_id, fixture_anchor()))[0], "run")[0]
        asked = h.client.post(
            f"/papers/{paper_id}/threads",
            json={"kind": "ask", "question": "What is a residual block?"},
            headers=auth(token),
        )
        read_sse(asked)
        long_run = events(
            read_sse(
                h.client.post(
                    f"/papers/{paper_id}/threads",
                    json={"kind": "ask", "question": long_question},
                    headers=auth(token),
                )
            )[0],
            "run",
        )[0]
        listed = h.client.get(f"/papers/{paper_id}/threads", headers=auth(token)).json()
        by_id = {t["thread_id"]: t for t in listed}
        assert by_id[explain_run["thread_id"]]["ask"] == "Explain this passage."
        assert {t["ask"] for t in listed} >= {"What is a residual block?"}
        cut = by_id[long_run["thread_id"]]["ask"]
        assert cut.endswith("…") and len(cut) <= 160 and long_question.startswith(cut[:-1])
        assert {t["last_status"] for t in listed} == {"complete"}
        # newest-first by updated_at is unchanged (canvas code relies on it)
        assert [t["updated_at"] for t in listed] == sorted(
            (t["updated_at"] for t in listed), reverse=True
        )
        for thread in listed:
            assert contract_errors(thread, "api/threads.schema.json", "Thread", Thread) == []


def test_a_thread_with_no_assistant_message_has_a_null_last_status(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        read_sse(explain(h, token, paper_id, fixture_anchor()))
        h.rows("SELECT 1")
        conn_rows = h.rows("SELECT message_id FROM ai_messages WHERE role = 'assistant'")
        assert conn_rows
        conn = sqlite3.connect(h.settings.database_file)
        conn.execute("DELETE FROM ai_messages WHERE role = 'assistant'")
        conn.commit()
        conn.close()
        (thread,) = h.client.get(f"/papers/{paper_id}/threads", headers=auth(token)).json()
        assert thread["last_status"] is None and thread["ask"] == "Explain this passage."


def test_another_users_threads_never_appear_in_the_list(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        alice, paper_id = alice_with_paper(h)
        read_sse(explain(h, alice, paper_id, fixture_anchor()))
        bob = register(h.client, "bob@example.com")
        bobs_paper = seed_paper(h.settings, h.client, bob, "attention-is-all-you-need")
        assert h.client.get(f"/papers/{bobs_paper}/threads", headers=auth(bob)).json() == []
        assert len(h.client.get(f"/papers/{paper_id}/threads", headers=auth(alice)).json()) == 1


def test_a_stored_answer_reads_back_with_locators_and_coverage(tmp_path: Path) -> None:
    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        run = events(read_sse(explain(h, token, paper_id, fixture_anchor()))[0], "run")[0]
        detail = h.client.get(
            f"/papers/{paper_id}/threads/{run['thread_id']}", headers=auth(token)
        ).json()
        user, answer = detail["messages"]
        assert "coverage" not in user and all("locator" not in c for c in user["citations"])
        assert answer["citations"], "the replay cites the seed"
        for citation in answer["citations"]:
            locator = citation["locator"]
            assert locator["passage_key"].startswith("g1:blk_")
            assert locator["page_index"] == citation["page_index"]
            assert locator["para_index"] is None or locator["para_index"] >= 1
        assert contract_errors(answer, "api/threads.schema.json", "Message", Message) == []
        coverage = answer["coverage"]
        assert coverage["passages"] == len(
            {c["locator"]["passage_key"] for c in answer["citations"]}
        )
        assert coverage["paragraphs"] >= 1 and coverage["not_verified"] >= 0
