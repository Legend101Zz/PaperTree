"""Real parsed papers in a real SQLite database, for this package's tests. NOT fixtures-on-disk.

Every test in this package runs against PaperIR that `services/document-worker` actually produced
from a PDF and that `papertree_db` actually stored — never a hand-written dict. The reason is the
one AGENTS.md §2 keeps recording: a retriever tested against a hand-written block graph asserts
that the retriever matches the author's mental model of the schema, which is exactly the thing
that was wrong. Three separate load-bearing facts here were discovered by parsing a real paper and
would not have been in a fixture anyone wrote from the spec:

    prev_id / next_id           0 of 974 blocks on resnet. Never emitted. An adjacency rung built
                                on them is dead code that passes its unit test.
    relation types emitted      caption_of, continues_on_next_page, continues_in_next_column.
                                Three of twelve when this was measured; no explains, no parent_of.
    doc_order coverage          207 of 974. Absent on every caption, footnote and table cell.

`cites` IS NOW A FOURTH (#66, 2026-08-03): the parser emits 133 of them on resnet and 1 on the
synthetic PDF below. `explains` and `parent_of` are still never emitted, which is why
`build_augmented_paper` still exists.

THE SYNTHETIC PDF IS THE ONE THAT MATTERS FOR CI. The corpus is gitignored and CI does not have
it (`_retrieval_corpus.py`), so the acceptance assertions run against a two-page PDF built here in
process with PyMuPDF. It is deliberately shaped to carry one of everything the ladder climbs — a
title, two numbered headings (so there are sections and a section path), a paragraph containing an
in-prose citation marker, a display equation, a drawn rectangle with a "Figure 1:" caption under
it (so the parser emits a REAL `caption_of` relation), and a bracketed bibliography on page two.

WHERE THE PARSER'S OUTPUT IS AUGMENTED, AND WHY IT IS SAID OUT LOUD. `build_augmented_paper` adds
two relations to the parsed document before it is stored: an `explains` and a type this schema has
never heard of. They are AUTHORED, not parsed, and they exist because the parser emits neither
today. There used to be a third, an authored `cites`; #66 REMOVED it, because the parser now emits
a real one on this very PDF and `relations` is UNIQUE on (paper, generation, type, from, to). Every
assertion that
depends on an authored relation says so in its own docstring, and the assertions for the epic's
acceptance criterion (`test_expansion.py`) run against the UNAUGMENTED parse, where the
figure-from-caption edge is one the parser really produced — asserted by its provenance string.

COST. The synthetic parse is ~0.35 s and the resnet parse ~1.0 s on this machine, so both are
built ONCE per process and cached here rather than per test. `asset_root` is a system temp
directory, never inside the repo: CI's codegen-drift step is a whole-tree
`git status --porcelain --untracked-files=all` and one stray crop turns it red.
"""

from __future__ import annotations

import atexit
import hashlib
import shutil
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from papertree_db import BlockId, Generation, OwnerId, PaperId, PaperTreeDb, generation, new_id
from papertree_document_worker.pdf import pymupdf
from papertree_document_worker.pipeline import ParserConfig, parse_document

#: The embedding width `block_vectors` declares in 0001_core.sql.
VECTOR_DIMENSIONS = 768

#: A relation type no version of this schema has heard of. `Relation.type` is an OPEN vocabulary
#: (any `^[a-z][a-z0-9_]{0,63}$`), and DESIGN.md D2 requires that an unknown type be PRESERVED.
UNKNOWN_RELATION_TYPE = "reviewer_flagged_as_load_bearing"


@dataclass(frozen=True, slots=True)
class ParsedPaper:
    """A parsed, stored paper plus everything a test needs to reach it again."""

    db: PaperTreeDb
    owner: OwnerId
    user_id: str
    paper_id: PaperId
    generation: Generation
    database_path: Path
    #: The document as stored, so a test can assert against the parser's own output.
    document: dict[str, Any]

    def block_ids_of_type(self, block_type: str) -> tuple[str, ...]:
        out: list[str] = []
        for block in self.document["blocks"]:
            if block["type"] == block_type:
                out.append(str(block["block_id"]))
        return tuple(out)

    def one_block_of_type(self, block_type: str) -> str:
        ids = self.block_ids_of_type(block_type)
        assert ids, f"the synthetic paper produced no {block_type} block; the fixture has drifted"
        return ids[0]


def _scratch() -> Path:
    path = Path(tempfile.mkdtemp(prefix="papertree-retrieval-"))
    atexit.register(shutil.rmtree, path, ignore_errors=True)
    return path


def build_synthetic_pdf(out: Path) -> Path:
    """A two-page paper carrying one of every structure the ladder climbs.

    Built with PyMuPDF at test time rather than committed: no binary in review, no `.gitignore`
    entry, and no chance of the fixture and the parser drifting apart unnoticed.

    NOT a substitute for the corpus and never described as one. It cannot support any statistical
    claim — reading-order accuracy, figure recall, relation yield all need real papers. What it
    proves is that every rung of the ladder EXECUTES against genuine parser output on a machine
    with no corpus, which is what CI is.

    THE RUNNING HEAD AND PAGE NUMBER ARE NOT DECORATION. They are the only way to get blocks with
    `doc_order = None` out of this parser without a table: furniture lands in the `header` and
    `footer` flows and carries no `doc_order`, exactly like the captions and table cells of a real
    paper. Without them every block in this fixture has a `doc_order` and the AGENTS.md trap —
    `sorted(key=lambda b: b.doc_order or 0)` collapsing everything onto position 0 — cannot be
    exercised on CI at all. Verified: the parse yields 4 furniture blocks across 2 pages, 2 in
    `header` and 2 in `footer`, all with `doc_order` absent.
    """
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 46), "Preprint. Under review.", fontsize=8, fontname="helv")
    page.insert_text((300, 756), "1", fontsize=8, fontname="helv")
    y = 90.0
    page.insert_text((72, y), "Residual Learning For Deep Networks", fontsize=18, fontname="hebo")
    y += 40
    page.insert_text((72, y), "1  Introduction", fontsize=13, fontname="hebo")
    y += 22
    for line in (
        "Deep networks are more difficult to train as depth grows.",
        "We present a residual learning framework that eases",
        "training, and we evaluate it on several benchmarks as in",
        "Figure 1 below. See also He et al. [1] for background.",
    ):
        page.insert_text((72, y), line, fontsize=10, fontname="helv")
        y += 14
    y += 12
    page.insert_text((190, y), "y = F(x, {W}) + x", fontsize=12, fontname="hebo")
    y += 30
    page.draw_rect(pymupdf.Rect(80, y, 380, y + 120), color=(0, 0, 0), fill=(0.85, 0.85, 0.85))
    y += 132
    page.insert_text(
        (80, y),
        "Figure 1: A residual block with an identity shortcut.",
        fontsize=9,
        fontname="helv",
    )
    y += 30
    page.insert_text((72, y), "2  Method", fontsize=13, fontname="hebo")
    y += 22
    for line in (
        "The shortcut connection performs identity mapping and",
        "adds no parameters. We stack many such blocks and",
        "train the whole stack end to end with plain SGD.",
    ):
        page.insert_text((72, y), line, fontsize=10, fontname="helv")
        y += 14

    second = doc.new_page(width=612, height=792)
    second.insert_text((72, 46), "Preprint. Under review.", fontsize=8, fontname="helv")
    second.insert_text((300, 756), "2", fontsize=8, fontname="helv")
    y = 90.0
    second.insert_text((72, y), "References", fontsize=13, fontname="hebo")
    y += 22
    for line in (
        "[1] K. He, X. Zhang, S. Ren, J. Sun. Deep residual learning",
        "    for image recognition. CVPR, 2016.",
        "[2] A. Vaswani et al. Attention is all you need. NeurIPS, 2017.",
    ):
        second.insert_text((72, y), line, fontsize=9, fontname="helv")
        y += 13
    doc.save(out)
    doc.close()
    return out


def _parse(pdf: Path, scratch: Path) -> tuple[PaperId, dict[str, Any]]:
    """One parse. `vlm_max_calls=0` disables the VLM entirely, so this makes no network call."""
    paper_id = PaperId(new_id("ppr"))
    result = parse_document(
        pdf,
        paper_id=str(paper_id),
        asset_root=scratch / "assets",
        config=ParserConfig(vlm_max_calls=0),
    )
    document: dict[str, Any] = result.paper.model_dump(
        mode="json", by_alias=True, exclude_unset=True
    )
    return (paper_id, document)


def _persist(paper_id: PaperId, document: dict[str, Any], scratch: Path) -> ParsedPaper:
    database_path = scratch / "papertree.sqlite"
    database = PaperTreeDb(str(database_path))
    database.migrate()
    created = database.create_user("owner@example.test")
    database.put_paper(created.owner, document)
    return ParsedPaper(
        db=database,
        owner=created.owner,
        user_id=created.user_id,
        paper_id=paper_id,
        generation=generation(1),
        database_path=database_path,
        document=document,
    )


def _store(pdf: Path, scratch: Path) -> ParsedPaper:
    paper_id, document = _parse(pdf, scratch)
    return _persist(paper_id, document, scratch)


_SYNTHETIC: ParsedPaper | None = None
_AUGMENTED: ParsedPaper | None = None
_PRE_CITATION: ParsedPaper | None = None
_VECTORISED: ParsedPaper | None = None
_CORPUS: ParsedPaper | None = None


def pre_citation_paper() -> ParsedPaper:
    """The same parse with every ``cites`` relation REMOVED — the shape of a pre-#66 document.

    Not a hypothetical. Relations are written at PARSE time, so every paper stored before #66
    landed has exactly this shape: markers printed in the text, a bibliography, and no edges. The
    `cited-label:` fallback is the only thing that reaches the citation rung on those papers, and
    on the unaugmented fixture the fallback is now UNREACHABLE (the real edge claims the entry
    first, and `_Accumulator` is first-claim-wins). Without this fixture the fallback would keep
    running in production and stop being executed by any test — findings.md §A's defect, arriving
    by improvement rather than by neglect.
    """
    global _PRE_CITATION
    if _PRE_CITATION is None:
        scratch = _scratch()
        paper_id, document = _parse(build_synthetic_pdf(scratch / "synthetic.pdf"), scratch)
        document["relations"] = [
            relation for relation in document.get("relations", ()) if relation["type"] != "cites"
        ]
        _PRE_CITATION = _persist(paper_id, document, scratch)
    return _PRE_CITATION


def synthetic_paper() -> ParsedPaper:
    """The parser's own output, UNAUGMENTED. What the acceptance assertions run against."""
    global _SYNTHETIC
    if _SYNTHETIC is None:
        scratch = _scratch()
        _SYNTHETIC = _store(build_synthetic_pdf(scratch / "synthetic.pdf"), scratch)
    return _SYNTHETIC


def augmented_paper() -> ParsedPaper:
    """The same parse plus two AUTHORED relations. See the module docstring.

    ``explains``  paragraph -> equation      the "related equation" edge the parser cannot emit
    UNKNOWN       paragraph -> figure        a type this schema version has never heard of

    THE AUTHORED ``cites`` WAS REMOVED BY #66 AND ITS ABSENCE IS LOAD-BEARING. The parser now emits
    a real ``cites`` on this very PDF, paragraph -> ``reference_entry``, which is the SAME pair the
    authored one used. `relations` is UNIQUE on (paper, generation, type, from, to) in
    0001_core.sql, so keeping both is not "belt and braces" - it is an `sqlite3.IntegrityError` at
    `put_paper`. The edge-driven citation path is now exercised by genuine parser output instead,
    which is what this module wanted all along.

    Authored so the relation rung's unknown-type handling is EXECUTED rather than merely written.
    Nothing that asserts the acceptance criterion uses this paper.
    """
    global _AUGMENTED
    if _AUGMENTED is None:
        scratch = _scratch()
        paper_id, document = _parse(build_synthetic_pdf(scratch / "synthetic.pdf"), scratch)
        by_type: dict[str, str] = {}
        for block in document["blocks"]:
            by_type.setdefault(str(block["type"]), str(block["block_id"]))
        document["relations"] = list(document.get("relations", ())) + [
            {
                "type": "explains",
                "from": by_type["paragraph"],
                "to": by_type["equation"],
                "confidence": 0.9,
                "provenance": "authored-by-test",
            },
            {
                "type": UNKNOWN_RELATION_TYPE,
                # THE TARGET MOVED figure -> caption, AND THE REASON IS THE SAME ONE THAT DELETED
                # THE AUTHORED `cites` ABOVE. #66's float half emits a real `references` edge
                # paragraph -> figure on this very PDF ("Figure 1 below" against a printed
                # "Figure 1" caption). `_Accumulator` is FIRST-CLAIM-WINS (expansion.py:341), so a
                # real edge and an authored one aimed at the same block means the authored one
                # never names it — and `test_an_unknown_relation_type_is_followed_and_reaches_the
                # _caller_named` silently stops testing unknown-type handling while still passing
                # its `explains` half.
                #
                # `caption` is the target because it is the only sensible block NO rung already
                # claims. Measured on this PDF under the test's isolating policy: SELECTION takes
                # the paragraph, STRUCTURE takes the heading as `section-heading`, RELATED takes
                # the figure (`references`) and the equation (`explains`), CITATIONS takes the
                # reference_entry (`cites`). `heading` was tried first and lost to STRUCTURE,
                # which is why this comment names the rung rather than just the block.
                "from": by_type["paragraph"],
                "to": by_type["caption"],
                "confidence": 0.5,
                "provenance": "authored-by-test",
            },
        ]
        _AUGMENTED = _persist(paper_id, document, scratch)
    return _AUGMENTED


def vectorised_paper() -> ParsedPaper:
    """The same PDF, in its OWN database, with a synthetic vector stored for every block.

    A separate database on purpose. The vectors would otherwise land in the database that
    ``synthetic_paper()`` hands out, and ``test_expansion.py`` asserts a full structural expansion
    on a paper whose ``count_block_vectors`` is 0 — the assertion that proves the structural path
    has not quietly grown an embedding dependency. One shared database would make that assertion
    pass or fail depending on which test module pytest happened to run first, which is the exact
    shape of a test that reports something other than what it claims.
    """
    global _VECTORISED
    if _VECTORISED is None:
        scratch = _scratch()
        paper = _store(build_synthetic_pdf(scratch / "synthetic.pdf"), scratch)
        for block in paper.document["blocks"]:
            paper.db.put_block_vector(
                paper.owner,
                paper.paper_id,
                paper.generation,
                BlockId(str(block["block_id"])),
                "synthetic/sha256-expansion",
                deterministic_embedding(str(block["block_id"])),
            )
        _VECTORISED = paper
    return _VECTORISED


def corpus_paper(pdf: Path) -> ParsedPaper:
    """A real corpus paper, parsed and stored. Only reachable behind ``requires_corpus``."""
    global _CORPUS
    if _CORPUS is None or _CORPUS.document["source_hash"] != _source_hash(pdf):
        _CORPUS = _store(pdf, _scratch())
    return _CORPUS


def _source_hash(pdf: Path) -> str:
    """Matches `SourceDocument`'s digest form, so the cache key compares like with like."""
    return "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()


def deterministic_embedding(block_id: str) -> list[float]:
    """A reproducible 768-vector for a block id. NOT a semantic embedding and never called one.

    SHA-256 of the block id, expanded by repeated hashing into 768 little-endian float32 values in
    [-1, 1). Deterministic across processes and machines — unlike anything seeded from ``hash()``,
    which is randomised per process by default and would make a "deterministic" vector test pass
    inside one run and disagree with the next.

    What a test built on these CAN show: that the semantic rung fires, that it adds blocks the
    structural rungs missed, and that its ordering is stable. What it CANNOT show, and what no
    test in this repository currently can: whether real embeddings improve retrieval quality.
    """
    raw = b""
    counter = 0
    seed = block_id.encode("utf-8")
    while len(raw) < VECTOR_DIMENSIONS * 4:
        raw += hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
        counter += 1
    words = struct.unpack(f"<{VECTOR_DIMENSIONS}I", raw[: VECTOR_DIMENSIONS * 4])
    return [(word / 2**31) - 1.0 for word in words]
