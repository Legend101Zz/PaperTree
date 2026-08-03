"""#62's harness, and the guard that is the point of shipping it before the questions exist.

THE STANDARD THESE TESTS ARE HELD TO is `test_scoring.py:264`, which documents a guard test that
STAYED GREEN UNDER MUTATION and says so in its own docstring. So every assertion below names the
mutation that turns it red, and each was applied to the source and run. The results are recorded
in the PR body; the mutations themselves are named here so the next reader can repeat them.

RUN THE MUTATIONS WITH `PYTHONDONTWRITEBYTECODE=1`, and delete `__pycache__` between them. The
mutate/revert protocol has a silent failure mode that cost this session a red gate: `return 1` ->
`return 0` is byte-identical in LENGTH, and `git checkout HEAD -- <file>` restored the file inside
the same mtime second the `.pyc` was written, so CPython's (mtime, size) validity check passed and
it kept executing the MUTATED bytecode. `inspect.getsource` showed the correct `return 1` while
`_grounding.__code__.co_consts` held only `0`. Five tests here failed for a defect that was not in
the source. A same-length mutation is the common case, not the exotic one.

WHAT IS AND IS NOT PROVEN HERE. The inputs are authored by this file, so they prove the harness
RUNS and refuses what it must; they prove nothing about a producer. There is no producer of Tier
C answers in this repository to assert against - `EPIC-03-RESULT.md` §2 records F3.4 as making no
live provider call anywhere in the suite - and saying so is more useful than a fixture dressed up
as one. The one producer-side assertion available is geometric, and it runs against a REAL PARSE
of a real two-column corpus paper: `test_the_column_rule_fires_on_a_real_two_column_parse`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from papertree_evaluation.__main__ import main
from papertree_evaluation.grounding import (
    QUESTION_TYPES,
    GroundingHarnessError,
    NothingScored,
    QuestionSetEmpty,
    QuestionSetHasNoQuestions,
    QuestionSetInvalid,
    QuestionSetMissing,
    load_answers,
    load_question_set,
    render_grounding_report,
    score_grounding,
    validate_question_set,
)

REPO = Path(__file__).resolve().parents[5]
CORPUS = REPO / "research" / "benchmarks" / "corpus"
README = REPO / "research" / "benchmarks" / "README.md"
TEMPLATE = REPO / "research" / "benchmarks" / "questions" / "EMPTY-TEMPLATE.tier-c-questions.json"
FETCH = "./research/benchmarks/fetch_corpus.sh"


def _question(question_id: str = "q1", **over: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "question_id": question_id,
        "paper_id": "bert-2col",
        "question_type": "overview",
        "question": "TEST FIXTURE - not a Tier C question. See the module docstring.",
        "answer_text": "TEST FIXTURE.",
        "gold_evidence_block_ids": ["b1"],
        "gold_pages": [0],
        "gold_object_block_id": None,
    }
    record.update(over)
    return record


def _set(*questions: dict[str, Any]) -> dict[str, Any]:
    return {"version": 1, "questions": list(questions)}


def _answer(blocks: tuple[str, ...] = ("b1",), pages: tuple[int, ...] = (0,), **over: Any) -> Any:
    payload: dict[str, Any] = {
        "states": "TEST FIXTURE.",
        "interpretation": None,
        "supporting_block_ids": list(blocks),
        "source_pages": list(pages),
        "source_regions": [],
        "confidence": 0.5,
        "unresolved_ambiguities": [],
        "claims": [],
    }
    payload.update(over)
    return payload


def _region(block_id: str, page: int, x0: float, x1: float) -> dict[str, Any]:
    return {"block_id": block_id, "page_index": page, "bbox": [x0, 10.0, x1, 40.0]}


def _write(path: Path, payload: Any) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _load(tmp_path: Path, questions: dict[str, Any], answers: dict[str, Any]) -> Any:
    return score_grounding(
        load_question_set(_write(tmp_path / "q.json", questions)),
        load_answers(_write(tmp_path / "a.json", answers)),
    )


# ── the three shapes of nothing, each refused by its own name ────────────────────────────────
#
# MUTATION for all three: replace the bodies of `load_question_set`'s three guards with
# `return TierCQuestionSet(source=str(path), version=1, notes="", questions=())` - i.e. the
# vacuous green, a harness that reports 0 questions and exits 0.


class TestTheHarnessRefusesAnEmptyOrAbsentSet:
    """`AGENTS.md` §2's vacuous green, refused three ways because they are three different facts.

    #86 is the same shape one layer down: a PRESENCE check written as a TRUTHINESS check turned a
    legitimate zero into "no data" and printed a reason that was untrue of the papers it fired on.
    Here the danger is the mirror image - collapsing three absences into one message, so a dataset
    that was never written looks like one that was written empty.
    """

    def test_an_absent_file_names_the_path_and_who_may_write_it(self, tmp_path: Path) -> None:
        with pytest.raises(QuestionSetMissing) as caught:
            load_question_set(tmp_path / "tier-c-questions.json")
        message = str(caught.value)
        assert "tier-c-questions.json" in message
        assert "NOTHING IS SCORED" in message
        assert "EMPTY-TEMPLATE" in message

    def test_an_empty_file_is_not_a_set_with_no_questions(self, tmp_path: Path) -> None:
        """Zero bytes is a half-finished write. `{"questions": []}` is a deliberate empty set."""
        blank = tmp_path / "q.json"
        blank.write_text("   \n", encoding="utf-8")
        with pytest.raises(QuestionSetEmpty) as empty_file:
            load_question_set(blank)
        with pytest.raises(QuestionSetHasNoQuestions) as no_questions:
            load_question_set(_write(tmp_path / "z.json", _set()))
        assert "EMPTY" in str(empty_file.value)
        assert "0 questions" in str(no_questions.value)
        assert "not a result" in str(no_questions.value)
        assert str(empty_file.value) != str(no_questions.value)

    def test_questions_present_and_nothing_answered_is_its_own_failure(
        self, tmp_path: Path
    ) -> None:
        """MUTATION: `if not scored:` -> `if False:`. Goes red - every metric divides by zero
        or reports 0.000 over an empty run, which is the number a broken key mapping produces."""
        question_set = load_question_set(_write(tmp_path / "q.json", _set(_question("q1"))))
        answers = load_answers(_write(tmp_path / "a.json", {"a-different-id": _answer()}))
        with pytest.raises(NothingScored) as caught:
            score_grounding(question_set, answers)
        assert "NONE of them has an answer" in str(caught.value)
        assert "q1" in str(caught.value)


class TestTheCommandExitsNonZero:
    """The guard has to survive the CLI, not just the loader. MUTATION: `return 1` -> `return 0`
    in `_grounding`'s except clause. Every case below goes red."""

    @pytest.mark.parametrize(
        ("shape", "expected"),
        [
            ("absent", "QuestionSetMissing"),
            ("empty file", "QuestionSetEmpty"),
            ("zero questions", "QuestionSetHasNoQuestions"),
        ],
    )
    def test_each_shape_of_nothing(
        self, shape: str, expected: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = tmp_path / "q.json"
        if shape == "empty file":
            path.write_text("", encoding="utf-8")
        elif shape == "zero questions":
            _write(path, _set())
        assert main(["grounding", "--questions", str(path)]) == 1, shape
        assert expected in capsys.readouterr().err, shape

    def test_the_committed_template_is_valid_and_still_refused(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """Both halves, because the file has to be BOTH. It documents the format, so it must
        validate; it is not data, so pointing the harness at it must fail."""
        payload = json.loads(TEMPLATE.read_text(encoding="utf-8"))
        assert validate_question_set(payload, source=str(TEMPLATE)).questions == ()
        assert "MUST NOT BE USED AS DATA" in payload["notes"]
        assert main(["grounding", "--questions", str(TEMPLATE)]) == 1
        assert "QuestionSetHasNoQuestions" in capsys.readouterr().err

    def test_a_loaded_set_with_no_answer_file_is_not_a_run(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = _write(tmp_path / "q.json", _set(_question()))
        assert main(["grounding", "--questions", str(path)]) == 1
        assert "Loading the gold is not scoring it" in capsys.readouterr().err


# ── #86's shape, applied to this harness ─────────────────────────────────────────────────────


class TestALegitimateZeroIsANumberAndAnAbsentDenominatorIsAReason:
    """#86 in one sentence: a presence check written as a truthiness check converts the
    legitimate zero into "no data", and the report looks identical to a healthy one."""

    def test_zero_contaminated_answers_prints_the_count_not_a_reason(self, tmp_path: Path) -> None:
        """The exact #86 mutation, transposed: `if score.contamination_evaluable == 0:` ->
        `if not score.contamination_columns:`. Under it this test goes RED - the report loses
        `0/1` and gains `contamination_columns: NOT EVALUABLE`, which is untrue of an answer
        whose two cited regions were measured and found to be in the same column."""
        score = _load(
            tmp_path,
            _set(_question("q1")),
            {"q1": _answer(source_regions=[_region("b1", 0, 50, 200), _region("b2", 0, 60, 210)])},
        )
        assert score.contamination_evaluable == 1
        assert score.contamination_columns == 0
        report = render_grounding_report(score)
        assert "0/1" in report
        assert "contamination_columns: NOT EVALUABLE" not in report

    def test_no_answer_citing_two_regions_on_a_page_is_a_reason_not_a_zero(
        self, tmp_path: Path
    ) -> None:
        score = _load(tmp_path, _set(_question("q1")), {"q1": _answer()})
        assert score.contamination_evaluable == 0
        report = render_grounding_report(score)
        assert "contamination_columns: NOT EVALUABLE" in report
        assert "Absent, not zero" in score.not_evaluable["contamination_columns"]

    def test_no_object_questions_and_no_recorded_object_are_different_reasons(
        self, tmp_path: Path
    ) -> None:
        """MUTATION: collapse the two branches to one string. Red - the two facts ask the reader
        to do different things (write equation questions / go back and record the object)."""
        none_asked = _load(tmp_path, _set(_question("q1")), {"q1": _answer()})
        asked_unlabelled = _load(
            tmp_path,
            _set(_question("q1", question_type="equation interpretation")),
            {"q1": _answer()},
        )
        first = none_asked.not_evaluable["equation_figure_identification"]
        second = asked_unlabelled.not_evaluable["equation_figure_identification"]
        assert "0 equation-interpretation" in first
        assert "0 of them carry a `gold_object_block_id`" in second
        assert asked_unlabelled.object_unlabelled == 1
        assert first != second

    def test_support_validity_is_never_a_number(self, tmp_path: Path) -> None:
        """§4.2 requires human adjudication on a 30-item sample. No proxy is substituted, and
        `verify_grounding`'s claim coverage is not quietly printed under this name."""
        score = _load(tmp_path, _set(_question("q1")), {"q1": _answer()})
        reason = score.not_evaluable["support_validity"]
        assert "adjudicated by a human" in reason
        assert "no proxy is substituted" in reason
        assert "coverage" not in render_grounding_report(score).lower().split("§4.2")[0]


def test_no_metric_prints_a_value_and_a_reason_at_once(tmp_path: Path) -> None:
    """`scoring.py:601`'s rule, asserted over four shapes: A METRIC IS EITHER A NUMBER OR A
    REASON, NEVER BOTH IN ONE REPORT. That contradiction is #86's second half, printed three
    lines apart on `a3c`."""
    labels = {
        "equation_figure_identification": "equation/figure id",
        "contamination_columns": "contamination (cols)",
    }
    shapes = {
        "nothing cited twice": ({}, _answer()),
        "two regions, one column": (
            {},
            _answer(source_regions=[_region("b1", 0, 50, 200), _region("b2", 0, 60, 210)]),
        ),
        "equation asked, unlabelled": ({"question_type": "equation interpretation"}, _answer()),
        "equation asked and labelled": (
            {"question_type": "equation interpretation", "gold_object_block_id": "eq7"},
            _answer(blocks=("b1", "eq7")),
        ),
    }
    for name, (over, answer) in shapes.items():
        score = _load(tmp_path, _set(_question("q1", **over)), {"q1": answer})
        report = render_grounding_report(score)
        for metric, label in labels.items():
            if metric in score.not_evaluable:
                assert f"{metric}: NOT EVALUABLE" in report, name
                assert label not in report, f"{name}: {label} has a value while {metric} is not"


# ── the loader, and the ten types ────────────────────────────────────────────────────────────


class TestTheLoaderNamesTheOffendingRecord:
    """MUTATION for all three: pass a constant `"<question set>"` as `validate_arguments`'
    first argument instead of the per-record label. Red - the message names the file and not
    the record, which on a 30-question set is a hunt rather than a fix."""

    def test_a_type_outside_the_ten_names_the_record_and_the_field(self, tmp_path: Path) -> None:
        payload = _set(_question("q1"), _question("q-bad", question_type="summarisation"))
        with pytest.raises(QuestionSetInvalid) as caught:
            load_question_set(_write(tmp_path / "q.json", payload))
        message = str(caught.value)
        assert "q-bad" in message and "questions[1]" in message and "question_type" in message

    def test_a_missing_field_names_the_record(self, tmp_path: Path) -> None:
        broken = _question("q-bad")
        del broken["gold_pages"]
        with pytest.raises(QuestionSetInvalid) as caught:
            load_question_set(_write(tmp_path / "q.json", _set(broken)))
        assert "q-bad" in str(caught.value) and "gold_pages" in str(caught.value)

    def test_a_duplicate_id_is_refused_because_ids_key_the_answers(self, tmp_path: Path) -> None:
        with pytest.raises(QuestionSetInvalid) as caught:
            load_question_set(_write(tmp_path / "q.json", _set(_question("q1"), _question("q1"))))
        assert "duplicate question_id" in str(caught.value)

    def test_a_broken_answer_names_its_question(self, tmp_path: Path) -> None:
        with pytest.raises(GroundingHarnessError) as caught:
            load_answers(_write(tmp_path / "a.json", {"q1": _answer(supporting_block_ids=[])}))
        assert "q1" in str(caught.value)


def test_the_ten_question_types_are_the_readmes_ten() -> None:
    """Re-derived from `research/benchmarks/README.md` §4.4 at run time rather than trusted.

    MUTATION: drop `"symbol definition"` from `QUESTION_TYPES`. Red, naming the missing type -
    which is the point: a hand-copied enum drifting from the spec it claims to implement is
    invisible in review and silently narrows what the set is allowed to contain.
    """
    body = README.read_text(encoding="utf-8").split("### 4.4")[1].split("\n\n")[1]
    derived = tuple(re.sub(r"\s+", " ", part).strip() for part in body.rstrip(".\n").split("·"))
    assert derived == QUESTION_TYPES


# ── the one producer-side assertion available: real geometry from a real parse ───────────────

_missing = not (CORPUS / "bert-2col.pdf").is_file()
requires_corpus = pytest.mark.skipif(
    _missing,
    reason=(
        f"the corpus is gitignored and bert-2col.pdf is absent from {CORPUS}. Fetch it with "
        f"`{FETCH}` to run this. CI has no corpus, so this skips there BY DESIGN and is not "
        "evidence of anything on a clean checkout."
    ),
)


#: Minimum block width, in PDF points, for a block to stand for a COLUMN rather than for a
#: marginal note. A US-letter two-column body column is ~240 pt; the arXiv side stamp is ~27.
_COLUMN_WIDTH_PT = 150.0


@requires_corpus
def test_the_column_rule_fires_on_a_real_two_column_parse(tmp_path: Path) -> None:
    """The contamination rule's premise, checked against PaperIR rather than against my fixtures.

    The rule is "two cited regions on one page whose x-ranges are disjoint". Everything else in
    this file feeds it bboxes I typed, which proves the arithmetic and nothing about whether a
    real two-column paper produces x-disjoint blocks at all. So: parse `bert-2col.pdf`, take a
    genuinely x-disjoint pair and a genuinely x-overlapping pair off one real page, and assert
    the rule separates them.

    MUTATIONS, and the first is recorded because it FAILED to be a mutation. I first named
    `hi <= other_lo or other_hi <= lo` -> `hi < other_hi` and it STAYED GREEN: on the two pairs
    this test selects, x=[89.0,273.3] vs [307.3,525.5] and [116.5,481.0] vs [220.9,376.7], the
    weakened predicate happens to agree with the real one in both directions. That is
    `test_scoring.py:264`'s defect exactly - a probe that changes nothing proves nothing - so it
    is replaced rather than reported as evidence. What DOES bite, measured:

      * invert the rule to fire on OVERLAP instead of disjointness (`if not (...)`) - RED in
        both directions, which is the sense error worth defending against;
      * read `bbox[1]`/`bbox[3]` instead of `bbox[0]`/`bbox[2]` - the copy-paste that measures
        rows instead of columns - RED;
      * and on this file rather than the source, raise `_COLUMN_WIDTH_PT` to 1000: the
        `disjoint is not None` assertion goes RED, which is what shows the search reads real
        geometry rather than passing vacuously.

    Only blocks at least `_COLUMN_WIDTH_PT` wide are paired. Without that filter the first
    x-disjoint pair found on `bert-2col` is the 27 pt arXiv stamp in the left margin against the
    body text - genuinely disjoint, and evidence about margins rather than about columns.
    """
    from papertree_evaluation.adapters import DeterministicAdapter

    outcome = DeterministicAdapter(tmp_path).parse(str(CORPUS / "bert-2col.pdf"))
    assert outcome.status == "ok" and outcome.document is not None
    by_page: dict[int, list[dict[str, Any]]] = {}
    for block in outcome.document["blocks"]:
        box = block.get("bbox")
        if box and float(box[2]) - float(box[0]) >= _COLUMN_WIDTH_PT:
            by_page.setdefault(int(block["page_index"]), []).append(block)

    disjoint: tuple[int, dict[str, Any], dict[str, Any]] | None = None
    overlapping: tuple[int, dict[str, Any], dict[str, Any]] | None = None
    for page, blocks in sorted(by_page.items()):
        for i, left in enumerate(blocks):
            for right in blocks[i + 1 :]:
                a, b = left["bbox"], right["bbox"]
                if a[2] <= b[0] or b[2] <= a[0]:
                    disjoint = disjoint or (page, left, right)
                else:
                    overlapping = overlapping or (page, left, right)
        if disjoint and overlapping:
            break
    assert disjoint is not None, (
        f"a real 2-column parse produced no pair of >= {_COLUMN_WIDTH_PT} pt blocks with "
        "disjoint x-ranges, so the column rule cannot fire on real output at all"
    )
    assert overlapping is not None

    for label, pair, expected in (("cross-column", disjoint, 1), ("same-column", overlapping, 0)):
        page, left, right = pair
        regions = [
            _region(str(b["block_id"]), page, float(b["bbox"][0]), float(b["bbox"][2]))
            for b in (left, right)
        ]
        score = _load(
            tmp_path,
            _set(_question("q1", paper_id="bert-2col")),
            {"q1": _answer(source_regions=regions)},
        )
        print(
            f"\n[eval/grounding {label}] bert-2col p{page} "
            f"x=[{left['bbox'][0]:.1f},{left['bbox'][2]:.1f}] vs "
            f"[{right['bbox'][0]:.1f},{right['bbox'][2]:.1f}] -> "
            f"{score.contamination_columns}/{score.contamination_evaluable}"
        )
        assert score.contamination_evaluable == 1
        assert score.contamination_columns == expected, label
