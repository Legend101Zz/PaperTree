"""Shared builders for this package's tests: a real parsed database, built in process.

WHY THERE IS NO ``conftest.py`` HERE. CI runs ``mypy packages/*/python services/*/python`` over
the whole tree, and mypy identifies a module in a non-package directory by its BASENAME.
``services/document-worker/python/tests/conftest.py`` already claims ``conftest``; a second one
aborts the entire run with "Duplicate module named 'conftest'". Every module in this directory
therefore has a repo-unique name, and the builders are plain functions each test module wraps in
its own ``@pytest.fixture``. ``packages/memory/python/tests/_memory_fixtures.py`` hit the same
wall and solved it the same way — the PATTERN is copied, the module is deliberately NOT imported
across the package boundary (a cross-package test import is a dependency edge that neither
pyproject declares).

WHY NOTHING IS A COMMITTED FIXTURE. ``research/benchmarks/corpus/*.pdf`` is **gitignored and
absent on CI**. A test that reads one passes on this machine and fails CI with ENOENT — the
failure this repo has hit three times, and the reason ``ci.yml``'s own header calls a
100 %-skipped suite a pass that measures nothing. So every assertion that matters runs against a
PDF built here with PyMuPDF, in process, and the corpus-backed tests are
:data:`requires_corpus`-marked, skip loudly and print the fetch script.

WHAT THE SYNTHETIC PAPER ACTUALLY YIELDS, MEASURED RATHER THAN INTENDED
    Parsed on this machine, 2026-08-02, ``ParserConfig(vlm_max_calls=0)``, generation 1:

        10 blocks   title 1, author 1, heading 2, paragraph 3, caption 1, figure 1, footnote 1
        3 sections
        2 relations caption_of (caption → figure), continues_in_next_column
        0 references        papers.references_json is NULL
        0 equations, 0 tables
        pages.image is NULL on every page

    Every one of those zeros is load-bearing and is asserted somewhere: they are what make the
    "honest empty" paths reachable in a test rather than only in a docstring. ``resolve_citation``
    on this document returns EMPTY because the bibliography genuinely has no entries, which is
    the same shape as its answer on a real paper (where the entries exist but ``cites`` edges do
    not) and a weaker case than it — hence the corpus layer, which exercises the real one.

    ``get_equation`` and ``get_table`` have NO positive path on this document. That is stated
    rather than worked around: their positive paths are corpus-only
    (``neural-odes-mathheavy.pdf``, ``superglue-tableheavy.pdf``) and therefore skip on CI. The
    negative paths — wrong block type, missing block — run everywhere.
"""

from __future__ import annotations

import asyncio
import glob
from collections.abc import Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from papertree_agent_tools import ToolContext
from papertree_db import BlockId, Generation, PaperId, PaperTreeDb, generation, new_id
from papertree_document_worker.pdf import pymupdf
from papertree_document_worker.pipeline import ParserConfig, parse_document
from papertree_memory import AgentDataHandle
from papertree_prompts import TurnCaps

#: ``parents[4]`` == the repo root from ``packages/agent-tools/python/tests/<this file>``.
REPO = Path(__file__).resolve().parents[4]
CORPUS_DIR = REPO / "research" / "benchmarks" / "corpus"
FETCH_SCRIPT = "./research/benchmarks/fetch_corpus.sh"

#: Two papers, chosen for what they contain rather than for size: ``neural-odes-mathheavy`` is
#: the only corpus paper with a meaningful count of display equations, and ``resnet-cvpr-2col``
#: is the one every measurement in ``index.py``, ``expansion.py`` and issue #66 was taken on.
CORPUS_MATH = CORPUS_DIR / "neural-odes-mathheavy.pdf"
CORPUS_RESNET = CORPUS_DIR / "resnet-cvpr-2col.pdf"
HAVE_CORPUS = bool(glob.glob(str(CORPUS_DIR / "*.pdf")))

requires_corpus = pytest.mark.skipif(
    not (HAVE_CORPUS and CORPUS_MATH.exists() and CORPUS_RESNET.exists()),
    reason=(
        f"corpus PDFs are gitignored and CI does not have them. Fetch with `{FETCH_SCRIPT}`. "
        "Every property these tests assert is also asserted against the synthetic PDF, which "
        "runs everywhere — this layer adds volume and real equations, not coverage."
    ),
)

GEN: Generation = generation(1)


def run[T](coro: Coroutine[Any, Any, T]) -> T:
    """Drives one coroutine to completion.

    ``pytest-asyncio`` is NOT a dependency of this workspace and adding one would move
    ``uv.lock``, which ``uv sync --locked --all-packages`` gates on. ``asyncio.run`` per call is
    the whole of what these tests need: the handlers do no real awaiting (``registry.py`` says
    why they are ``async`` anyway), so there is no event-loop sharing to arrange.
    """
    return asyncio.run(coro)


# ── the synthetic paper ─────────────────────────────────────────────────────────────────


def build_synthetic_paper_pdf(destination: Path) -> Path:
    """A one-page, two-column paper carrying every structure these tests assert on.

    Deliberately contains, and each is used by a named test:

      * a title and an author line, so ``get_paper_metadata`` has metadata to return and
        ``get_parent_section`` has genuinely section-less front matter to answer ``None`` for;
      * two headings in a larger bold face, so the parser emits SECTIONS (it derives them from
        heading blocks — a document with no size contrast yields zero, which is a different
        test);
      * a vector drawing plus a ``Figure 1:`` line under it, so a ``caption_of`` RELATION exists.
        That relation is the working path for ``get_figure``'s caption, because
        ``payload.caption_block`` is populated 0 times by this parser (#66);
      * U+FB01 LATIN SMALL LIGATURE FI, so the text a tool returns has been through
        ``resolved_text`` on real content rather than on ASCII;
      * a bracketed citation marker ``[3]`` in the prose and two bibliography-shaped lines, so
        ``resolve_citation``'s label path has something to look for AND measurably fails to find
        it — the parser produces no ``references_json`` for this document, which is exactly the
        honest-empty case that has to be tested.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text(
        (72, 80), "Deep Residual Learning for Image Recognition", fontsize=17, fontname="hebo"
    )
    page.insert_text((72, 110), "A. Author, B. Author", fontsize=10, fontname="helv")
    page.insert_text((72, 150), "1  Introduction", fontsize=13, fontname="hebo")
    left = (
        "Deep networks are more diﬁcult to train.",
        "We present a residual learning framework",
        "that eases the training of networks that are",
        "substantially deeper than those used before.",
        "We evaluate residual nets with a depth of up",
        "to 152 layers on the ImageNet dataset [3].",
    )
    for index, line in enumerate(left):
        page.insert_text((72, 175 + index * 14), line, fontsize=10, fontname="helv")

    page.insert_text((72, 300), "2  Related Work", fontsize=13, fontname="hebo")
    right = (
        "Residual representations have a long history",
        "in image recognition and computer vision.",
        "VLAD encodes by residual vectors and Fisher",
        "Vector is a probabilistic version of it [22].",
    )
    for index, line in enumerate(right):
        page.insert_text((330, 175 + index * 14), line, fontsize=10, fontname="helv")

    page.draw_rect(pymupdf.Rect(72, 340, 372, 470), color=(0, 0, 0), width=1)
    page.draw_line(pymupdf.Point(90, 450), pymupdf.Point(350, 360))
    page.insert_text(
        (72, 486), "Figure 1: A residual block with identity shortcut.", fontsize=9, fontname="helv"
    )

    page.insert_text((72, 560), "References", fontsize=13, fontname="hebo")
    page.insert_text(
        (72, 585),
        "[3] J. Deng et al. ImageNet: A large-scale hierarchical image database. CVPR 2009.",
        fontsize=8,
        fontname="helv",
    )
    page.insert_text(
        (72, 600),
        "[22] H. Jegou et al. Aggregating local descriptors into a compact image. CVPR 2010.",
        fontsize=8,
        fontname="helv",
    )
    doc.save(destination)
    doc.close()
    return destination


@dataclass(frozen=True, slots=True)
class Seeded:
    """A real SQLite file with a real parsed paper in it, and the ids a test needs."""

    path: Path
    user_id: str
    paper_id: PaperId
    generation: Generation
    #: ``block_id -> type`` for every block, so a test can pick one by type without guessing.
    block_types: dict[str, str]

    def first_of_type(self, block_type: str) -> str:
        for block_id, kind in self.block_types.items():
            if kind == block_type:
                return block_id
        raise AssertionError(
            f"the seeded paper has no {block_type!r} block. Types present: "
            f"{sorted(set(self.block_types.values()))}. This is a fixture bug, not a code bug — "
            "a test asserting on a block type the document does not contain would be vacuous."
        )

    def handle(self) -> AgentDataHandle:
        return AgentDataHandle(self.path, self.user_id)

    def context(
        self,
        handle: AgentDataHandle,
        *,
        session_id: str = "ses_agent_tools_test",
        caps: TurnCaps | None = None,
    ) -> ToolContext:
        return ToolContext(
            handle,
            paper_id=self.paper_id,
            generation=self.generation,
            session_id=session_id,
            # The ordinary reading turn: document text in context, no library reach, no writes.
            # `toolset_for` maps it to READ_ONLY_SINGLE_PAPER, which is §13.6(e) Attack 2's
            # stopping point.
            caps=caps
            or TurnCaps(untrusted_input=True, sensitive_scope=False, state_or_egress=False),
        )


def seed(root: Path, pdf: Path, *, email: str = "reader@papertree.test") -> Seeded:
    """Parses ``pdf`` for real, stores it, closes the writer, and returns the ids.

    ``PaperTreeDb`` is used for seeding and then CLOSED. It is Epic 0's proven write path;
    re-implementing ``put_paper`` here would be testing a second copy of it. Nothing in the
    assertions that follow holds a ``PaperTreeDb`` — the tests open an ``AgentDataHandle`` (and,
    where a write is the point, a ``MemoryStore``) on the same file, which is the real deployment
    shape.

    ``asset_root`` is under ``root``, i.e. under ``tmp_path``, i.e. OUTSIDE the repository. CI's
    codegen-drift step is a whole-tree ``git status --porcelain --untracked-files=all`` and
    ``.gitignore`` covers none of these paths.
    """
    root.mkdir(parents=True, exist_ok=True)
    database_path = root / "papertree.sqlite"
    database = PaperTreeDb(database_path)
    database.migrate()
    created = database.create_user(email)
    paper_id = PaperId(new_id("ppr"))
    try:
        result = parse_document(
            pdf,
            paper_id=paper_id,
            asset_root=root / "assets",
            config=ParserConfig(vlm_max_calls=0),
        )
        document = result.paper.model_dump(mode="json", by_alias=True, exclude_unset=True)
        database.put_paper(created.owner, document)
        block_types = {
            str(row["block_id"]): str(row["type"])
            for page in database.list_pages(created.owner, paper_id, GEN)
            for row in database.list_blocks_on_page(
                created.owner, paper_id, GEN, int(page["page_index"])
            )
        }
    finally:
        database.close()
    return Seeded(
        path=database_path,
        user_id=created.user_id,
        paper_id=paper_id,
        generation=GEN,
        block_types=block_types,
    )


def seed_synthetic(root: Path) -> Seeded:
    """The everywhere-runnable database. Used by every core assertion."""
    root.mkdir(parents=True, exist_ok=True)
    return seed(root, build_synthetic_paper_pdf(root / "synthetic.pdf"))


def write_block_vector(seeded: Seeded, block_id: str, embedding: list[float]) -> None:
    """Writes ONE embedding through the privileged path, so the semantic rung has data.

    Deliberately a separate function called by exactly one test. Epic 0 computes no embeddings
    and nothing else in this repository writes one; a fixture that always seeded vectors would
    make ``search_semantic_blocks``'s honest-empty answer — the answer it gives on every real
    paper — unreachable from the suite.
    """
    database = PaperTreeDb(seeded.path)
    try:
        owner = database.owner_for(seeded.user_id)
        database.put_block_vector(
            owner, seeded.paper_id, seeded.generation, BlockId(block_id), "test-model", embedding
        )
    finally:
        database.close()
