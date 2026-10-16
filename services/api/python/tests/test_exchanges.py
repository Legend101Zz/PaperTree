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
from papertree_api import paragraph_shape as shape
from papertree_api.evidence import (
    DocumentCache,
    PassageLocators,
    load_index,
    passage_key,
    section_display_title,
)
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
    coverage = message_coverage(
        content, [("b1", "g1:a", True), ("b2", "g1:b", False), ("b3", "g1:a", None)]
    )
    assert coverage == {
        "passages": 2,
        "citations": 3,
        "unresolved_markers": 0,
        "paragraphs": 3,
        "uncited_paragraphs": [2],
        "not_verified": 1,
    }


def test_a_dropped_handle_is_unresolved_not_a_citation() -> None:
    """A hallucinated ``[b99]`` has no stored row (the run dropped it): never a citation."""
    coverage = message_coverage(
        "A [b1]. B [b1, b99].\n\nC [b99].", [("b1", "g1:x", True), ("b2", "g1:y", None)]
    )
    assert (coverage["citations"], coverage["unresolved_markers"]) == (2, 2)
    assert coverage["uncited_paragraphs"] == []  # the paragraph holds a marker, resolved or not
    assert coverage["not_verified"] == 0, "supported=None (never checked) is not 'not verified'"


def test_the_paragraph_rule_is_exactly_blank_line_split_minus_bare_headings() -> None:
    text = "## H\n\n**Bold head**\n\n- a [b1]\n- b\n   \nlast"
    assert answer_paragraphs(text) == ["**Bold head**", "- a [b1]\n- b", "last"]
    assert answer_paragraphs("") == []


def test_coverage_of_an_answer_with_no_markers() -> None:
    assert message_coverage("Plain.", []) == {
        "passages": 0,
        "citations": 0,
        "unresolved_markers": 0,
        "paragraphs": 1,
        "uncited_paragraphs": [0],
        "not_verified": 0,
    }


def test_coverage_of_the_real_stored_attention_answer() -> None:
    """Golden: the real explain answer of the demo database (see the fixture's ``_source``)."""
    stored = json.loads((DATA / "attention_explain_answer.json").read_text(encoding="utf-8"))
    citations = [
        (c["marker"], passage_key(c["generation"], c["block_id"]), c["supported"])
        for c in stored["citations"]
    ]
    coverage = message_coverage(stored["content"], citations)
    assert [c["marker"] for c in stored["citations"]] == ["b1", "b6", "b7", "b8"]
    assert coverage["citations"] == 11 and coverage["unresolved_markers"] == 0
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
        assert locator["section_heading"] == heading, (start, locator)
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


# What each rule does to the real parses (measured on fresh parses of the corpus PDFs, then
# checked against counting the page by eye): (page_index, text the block starts with, expected ¶).
# `None` is a block the rules refuse to number: the UI shows its page only.
PARAGRAPHS: dict[str, list[tuple[int, str, int | None]]] = {
    "attention-is-all-you-need": [
        (0, "Provided proper attribution", None),  # front matter before the abstract
        (0, "The dominant sequence", 1),
        (1, "Recurrent neural networks", 1),
        (1, "Recurrent models typically", 2),
        (1, "Attention mechanisms have", 3),
        (1, "In this work we propose", 4),
        (1, "The goal of reducing", 5),
        (1, "Self-attention, sometimes", 6),
        (1, "End-to-end memory", 7),
        (1, "To the best of our knowledge", 8),
        (1, "Model Architecture", None),  # a heading the parser typed paragraph and never sectioned
        (1, "Most competitive neural", 9),
    ],
    "resnet-cvpr-2col": [
        (0, "Deeper neural networks", 1),
        (0, "The depth of representations", None),  # the abstract's second block
        (0, "Deep convolutional neural", 2),
        (0, "greatly beneﬁted", None),  # tail of the paragraph above, across the column break
        (0, "Driven by the signiﬁcance", 3),
        (0, "This problem, however", None),  # one paragraph split in two (blocks overlap)
        (0, "When deeper networks", 4),
        (0, "Unexpectedly, such", None),
        (0, "The degradation (of training", 5),
        (1, "F(x)", None),  # a figure label
        (1, "identity F(x)", None),  # label plus caption
        (1, "are comparably good", None),  # tail from the previous page
        (1, "In this paper, we address", 1),
        (1, "In- stead of hoping", None),
        (1, "The formulation of F(x)+x", 2),
        (1, "We present comprehensive", 3),
        (1, "Similar phenomena", 4),
        (1, "On the ImageNet classiﬁcation", 5),
        (1, "Our ensemble has", None),
        # KNOWN MISS: "ImageNet test set, and won…" is the right column's continuation of the
        # paragraph above, which no text or geometry rule here can see; it is numbered ¶6 and the
        # paragraphs after it are one too high. Not asserted, so nobody mistakes it for a golden.
    ],
    "bert-2col": [
        (0, "We introduce a new language", 1),
        (0, "It obtains new state-of-the-art", None),
        (0, "Language model pre-training", 2),
        (0, "There are two existing", 3),
        (0, "We argue that current", 4),
        (0, "The ma- jor limitation", None),
        (0, "In this paper, we improve", 5),
        (0, "Transformers. from BERT", None),
        (0, "The masked language model", None),
        (1, "word based only on its context", None),
        (1, "Unlike left-to- right", 1),
        (1, "• We demonstrate", 2),
        (1, "• We show that", 3),
        (1, "• BERT advances", 4),
        (1, "The code and pre-trained", 5),
        (1, "There is a long history", 6),
        (1, "Learning widely applicable", 7),
        (1, "Pre-trained word embeddings", None),
        (1, "These approaches have been", 8),
        (1, "To train sentence", None),
        (1, "ELMo and its predecessor", 9),
        (1, "As with the feature-based", 10),
        (1, "(Col- lobert", None),
        (1, "More recently, sentence", 11),
        (1, "At least partly", None),
        (1, "Left-to-right language model-", None),
    ],
}
SECTION_TITLES: dict[str, list[tuple[int, str, str | None]]] = {
    "attention-is-all-you-need": [
        (0, "Provided proper attribution", None),  # the parser's section "scholarly works."
        (1, "Recurrent models typically", "Introduction"),  # "1 Introduction" in the heading
    ],
    "bert-2col": [(0, "Language model pre-training", "Introduction")],  # heading "1\nIntroduction"
    "resnet-cvpr-2col": [(1, "In this paper, we address", "Introduction")],  # "1. Introduction"
}


def _fresh_index(tmp_path: Path, name: str) -> Any:
    """The index of a FRESH parse (upload plus the real worker) of a corpus PDF."""
    pdf = CORPUS / f"{name}.pdf"
    if not pdf.is_file():
        pytest.skip(f"{pdf} is absent: run ./research/benchmarks/fetch_corpus.sh")
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        response = h.client.post(
            "/papers",
            files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")},
            headers=auth(token),
        )
        assert response.status_code == 202, response.text
        paper_id = response.json()["paper_id"]
        assert run_worker(h.settings, max_jobs=5) >= 1
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        db = PaperTreeDb(h.settings.database_file)
        try:
            owner = db.owner_for(user_id)
            generation = db.promoted_generation(owner, paper_id)
            assert generation is not None
            return load_index(PaperIndexCache(), db, owner, user_id, paper_id, generation)
        finally:
            db.close()


def _block_starting(index: Any, page: int, prefix: str) -> Any:
    found = [
        b
        for b in (index.block(i) for i in index.reading_order)
        if b is not None and b.page_index == page and " ".join(b.text.split()).startswith(prefix)
    ]
    assert len(found) == 1, (page, prefix, len(found))
    return found[0]


@pytest.mark.parametrize("name", sorted(PARAGRAPHS))
def test_paragraph_numbers_on_a_fresh_parse_match_counting_by_eye(
    tmp_path: Path, name: str
) -> None:
    index = _fresh_index(tmp_path, name)
    locators = PassageLocators(index)
    wrong = []
    for page, prefix, expected in PARAGRAPHS[name]:
        block = _block_starting(index, page, prefix)
        got = locators.locate({"selectors": [{"type": "BlockSelector", "blockId": block.block_id}]})
        assert got is not None
        if got["para_index"] != expected:
            wrong.append((page + 1, prefix, expected, got["para_index"]))
    assert wrong == [], wrong


@pytest.mark.parametrize("name", sorted(SECTION_TITLES))
def test_section_titles_drop_the_number_and_refuse_sentence_fragments(
    tmp_path: Path, name: str
) -> None:
    index = _fresh_index(tmp_path, name)
    for page, prefix, expected in SECTION_TITLES[name]:
        block = _block_starting(index, page, prefix)
        assert section_display_title(index, block.block_id) == expected, (prefix, expected)


def test_a_banner_paragraph_before_the_abstract_is_not_counted_on_the_committed_parse() -> None:
    """Non-vacuity for the goldens: the p. 1 attribution banner is a ``paragraph`` before the
    abstract and would make the abstract ¶2 if counted."""
    with tempfile.TemporaryDirectory() as tmp, harness(Path(tmp)) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "attention-is-all-you-need")
        user_id = h.client.get("/auth/me", headers=auth(token)).json()["user_id"]
        db = PaperTreeDb(h.settings.database_file)
        owner = db.owner_for(user_id)
        index = load_index(PaperIndexCache(), db, owner, user_id, paper_id, 1)
        db.close()
    para_of = PassageLocators(index)._para_of  # noqa: SLF001 (white-box: the banner is absent)
    banner = _block_starting(index, 0, "Provided proper attribution")
    abstract = next(b for b in map(index.block, index.reading_order) if b and b.type == "abstract")
    assert banner.type == "paragraph" and index.rank(banner.block_id) < index.rank(
        abstract.block_id
    )
    assert banner.block_id not in para_of and para_of[abstract.block_id] == 1
    assert not {s.heading_block_id for s in index.sections} & set(para_of)


# ── the text-shape rules, on strings taken from the real parses ───────────────────────────────


def test_shape_rules_on_real_block_texts() -> None:
    assert shape.is_heading_shaped("Model Architecture")  # Attention p. 2
    assert shape.is_heading_shaped("3.2 Scaled Dot-Product Attention")
    assert not shape.is_heading_shaped("Self-attention, sometimes called intra-attention is a.")
    assert not shape.is_heading_shaped("Left-to-right models are strong.")
    assert shape.is_label_shaped("F(x)") and shape.is_label_shaped("Left-to-right language model-")
    assert not shape.is_label_shaped("In this paper, we address")
    assert shape.is_caption_shaped("Figure 2. Residual learning: a building block.")
    assert shape.is_caption_shaped("identity\nF(x)+x\nFigure 2. Residual learning: a block.")
    assert shape.is_caption_shaped("Table 1: Results on GLUE.")
    body = "As Figure 2. shows " + "word " * 60  # a long block that mentions a figure is body text
    assert not shape.is_caption_shaped(body)
    assert shape.starts_as_continuation("word based only on its context.")
    assert shape.starts_as_continuation("(Col-\nlobert and Weston, 2008).")
    assert not shape.starts_as_continuation("Unlike left-to-right language models")
    assert shape.ends_unfinished("have also") and not shape.ends_unfinished("very deep models.")


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


def test_a_parse_that_cannot_be_loaded_degrades_to_page_only_citations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Any failure loading the parse (not only a missing generation) must not fail the read."""
    from papertree_api import evidence

    def broken(*_: Any, **__: Any) -> Any:
        raise RuntimeError("corrupt parse")

    with ai_harness(tmp_path, Script("explain-ok")) as h:
        token, paper_id = alice_with_paper(h)
        run = events(read_sse(explain(h, token, paper_id, fixture_anchor()))[0], "run")[0]
        monkeypatch.setattr(evidence, "load_index", broken)
        response = h.client.get(
            f"/papers/{paper_id}/threads/{run['thread_id']}", headers=auth(token)
        )
        assert response.status_code == 200
        answer = response.json()["messages"][1]
        assert answer["citations"] and all("locator" not in c for c in answer["citations"])
        assert answer["coverage"]["passages"] >= 1, "coverage falls back to the anchor's block"
