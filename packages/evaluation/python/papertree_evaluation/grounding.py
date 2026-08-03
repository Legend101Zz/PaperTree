"""The Tier C grounding harness: `research/benchmarks/README.md` §4.2's five metrics, §4.4's set.

README.md §4.2, quoted because this module implements it and a paraphrase drifts:

    - **Block-level evidence F1** - do the cited block IDs cover the gold evidence spans?
      (Metric adapted from QASPER's evidence selection.)
    - **Page accuracy** - is the cited page correct?
    - **Equation/figure identification** - for equation and figure questions, is the right
      object cited?
    - **Support validity** - does the cited region *actually contain* the claim? Judged by
      a rubric, adjudicated by a human on a 30-item sample to calibrate the judge.
    - **Contamination rate** - fraction of answers whose evidence mixes text from two
      different columns, or a caption with unrelated body text.

§4.4 fixes the dataset: ten question types, and each gold record carrying "the answer text, the
**gold evidence block set**, and the gold page(s)".

THERE IS NO QUESTION SET, AND THIS MODULE WILL NOT INVENT ONE
    §4.4: questions are *"written from the paper, by someone who has read it, before seeing any
    parser output"*. `AGENTS.md` §4 names that prohibition for agents specifically. #62's ruling
    of 2026-08-02 reduced the QUANTITY owed to a 20-30 question subset and changed nothing about
    who may produce it. So the harness ships, `load_question_set` FAILS on the absent file, and
    #62 stays open. `research/benchmarks/questions/EMPTY-TEMPLATE.tier-c-questions.json` is the
    format, with zero questions in it, and is not data.

WHY THE FAILURE IS THE GRADED PART, AND WHAT #86 TAUGHT ABOUT ITS SHAPE
    A harness that reports "0 questions scored, all metrics pass" is `AGENTS.md` §2's *"a metric
    that is never called reports nothing, and nothing looks a lot like a pass"*. #86 is the same
    shape one layer down: `scoring.py:404,409` guarded on `any(r.get(field))` - TRUTHINESS, not
    PRESENCE - so an all-raster paper, whose `is_vector: false` on every figure is a COMPLETE
    annotation, was declared not evaluable over gold that fully supported the metric, on 2 of 6
    papers. **A presence check written as a truthiness check silently converts a legitimate zero
    into "no data", and the resulting report looks identical to a healthy one.**

    Everything below therefore separates, by hand and with a distinct message for each:

      * no question FILE                       -> `QuestionSetMissing`
      * an EMPTY file (zero bytes)              -> `QuestionSetEmpty`
      * a schema-valid file holding 0 questions -> `QuestionSetHasNoQuestions`
      * questions present, 0 of them ANSWERED   -> `NothingScored`
      * a metric whose DENOMINATOR is 0         -> "NOT EVALUABLE - <reason>", never 0.0
      * a metric whose NUMERATOR is 0           -> the number, because that is a measurement

    The last two are the pair #86 collapsed. `test_grounding_harness.py` mutates each guard and
    records what the mutation did, because a guard nobody has watched go red is a guard nobody
    knows bites - `test_scoring.py:264` documents an attempted guard test that stayed green.

AND THE REPORT FOLLOWS `scoring.py::render_report`
    Counts beside rates, denominators in the row, and "A METRIC IS EITHER A NUMBER OR A REASON,
    NEVER BOTH IN ONE REPORT" (scoring.py:601). §4.2's *"contamination rate"* is consequently
    split in two: its column half is computable from `SourceRegion.bbox` and its caption half is
    not, because `answer.py:100-108` buckets `caption` and `paragraph` both into `target_type:
    "text"`. Reporting the column half alone under §4.2's name would be rounding a PARTIAL up.

SCOPING CORRECTION, CARRIED FROM `EPIC-03-RESULT.md` §3
    README §1.2 sizes Tier C at 12 papers x 10 questions. `fetch_corpus.sh` provides 8. "120" is
    quoted in four documents and is NOT REACHABLE; 80 is the ceiling of the corpus as fetched.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

from papertree_agent_tools.answer import (
    AnswerContractError,
    GroundedAnswer,
    answer_from_mapping,
)
from papertree_agent_tools.schema import ToolArgumentError, check_schema, validate_arguments

__all__ = [
    "QUESTION_SCHEMA",
    "QUESTION_SET_SCHEMA",
    "QUESTION_TYPES",
    "GroundingHarnessError",
    "GroundingScore",
    "NothingScored",
    "QuestionSetEmpty",
    "QuestionSetHasNoQuestions",
    "QuestionSetInvalid",
    "QuestionSetMissing",
    "TierCQuestion",
    "TierCQuestionSet",
    "load_answers",
    "load_question_set",
    "render_grounding_report",
    "score_grounding",
    "validate_question_set",
]

#: §4.4's ten question types, verbatim and in its order. `test_grounding_harness.py` re-derives
#: this list from README.md at run time rather than trusting this tuple.
QUESTION_TYPES: Final[tuple[str, ...]] = (
    "overview",
    "methodology",
    "equation interpretation",
    "symbol definition",
    "figure interpretation",
    "result comparison",
    "limitation identification",
    "citation lookup",
    "cross-section reasoning",
    "contradiction detection",
)

#: The two types §4.2's "equation/figure identification" is defined over. A set containing
#: neither says NOTHING about that metric, which is different from a set that contains them and
#: forgot to record which object is right - see :func:`score_grounding`.
OBJECT_TYPES: Final[frozenset[str]] = frozenset(
    {"equation interpretation", "figure interpretation"}
)

QUESTION_SCHEMA: Final[Mapping[str, Any]] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "question_id",
        "paper_id",
        "question_type",
        "question",
        "answer_text",
        "gold_evidence_block_ids",
        "gold_pages",
        "gold_object_block_id",
    ],
    "properties": {
        "question_id": {"type": "string", "minLength": 1},
        "paper_id": {
            "type": "string",
            "minLength": 1,
            "description": "A corpus PDF stem, e.g. `bert-2col`. 8 are fetched; README §1.2's 12 "
            "are not, so §1.2's 120 is not reachable (EPIC-03-RESULT.md §3).",
        },
        "question_type": {"type": "string", "enum": list(QUESTION_TYPES)},
        "question": {"type": "string", "minLength": 1},
        "answer_text": {"type": "string", "minLength": 1},
        "gold_evidence_block_ids": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string", "minLength": 1},
            "description": "§4.4's gold evidence block set. Non-empty: a question with no "
            "evidence cannot score evidence F1 and would silently widen the denominator.",
        },
        "gold_pages": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "integer", "minimum": 0},
            "description": "Zero-based, matching PaperIR's `page_index` and the answer "
            "contract's `source_pages`.",
        },
        "gold_object_block_id": {
            "type": ["string", "null"],
            "description": "For an equation/figure question, the ONE object §4.2 asks whether "
            "the answer cited. Required-and-nullable rather than optional so there is exactly "
            "one encoding of absence, and so `null` on an equation question is a recorded gap "
            "rather than an omission indistinguishable from a non-object question.",
        },
    },
}

QUESTION_SET_SCHEMA: Final[Mapping[str, Any]] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["version", "questions"],
    "properties": {
        "version": {"type": "integer", "minimum": 1, "maximum": 1},
        "notes": {"type": "string"},
        # Validated a second time, per record, so the message names the record. See
        # `validate_question_set`.
        "questions": {"type": "array", "items": {"type": "object"}},
    },
}

# REGISTRATION-TIME, not call-time. `check_schema` refuses any keyword its validator does not
# implement, because an unimplemented keyword is SILENTLY IGNORED and reads in review as an
# enforced constraint (schema.py's own load-bearing rule). At module import this is an
# ImportError; deferred to a call site it would be a bound nobody notices is absent.
check_schema(QUESTION_SCHEMA, where="<tier-c question>")
check_schema(QUESTION_SET_SCHEMA, where="<tier-c question set>")


class GroundingHarnessError(RuntimeError):
    """A grounding run that cannot be scored. Always names what is missing, never returns 0."""


class QuestionSetMissing(GroundingHarnessError):
    """There is no file at all."""


class QuestionSetEmpty(GroundingHarnessError):
    """The file exists and holds no bytes. Distinct from a file holding `"questions": []`."""


class QuestionSetInvalid(GroundingHarnessError):
    """The file is not JSON, or a record violates the schema. Names the offending record."""


class QuestionSetHasNoQuestions(GroundingHarnessError):
    """Schema-valid, and zero questions in it. THE VACUOUS GREEN, refused by name."""


class NothingScored(GroundingHarnessError):
    """Questions exist and not one of them was answered. Not the same as having no questions."""


@dataclass(frozen=True, slots=True)
class TierCQuestion:
    """One §4.4 gold record."""

    question_id: str
    paper_id: str
    question_type: str
    question: str
    answer_text: str
    gold_evidence_block_ids: tuple[str, ...]
    gold_pages: tuple[int, ...]
    gold_object_block_id: str | None


@dataclass(frozen=True, slots=True)
class TierCQuestionSet:
    """A loaded set. Non-empty by construction - `load_question_set` refuses the empty one."""

    source: str
    version: int
    notes: str
    questions: tuple[TierCQuestion, ...]

    @property
    def papers(self) -> tuple[str, ...]:
        return tuple(sorted({q.paper_id for q in self.questions}))


def validate_question_set(payload: Any, *, source: str) -> TierCQuestionSet:
    """Schema-checks a decoded payload and builds the set. Zero questions is NOT refused here.

    The split matters for exactly one file: the committed EMPTY TEMPLATE must be schema-VALID
    (it documents the format) and must still be refused as DATA. So validity and non-emptiness
    are two questions with two answers, and `load_question_set` asks both.
    """
    if not isinstance(payload, Mapping):
        raise QuestionSetInvalid(
            f"{source}: the top level is {type(payload).__name__}, not a JSON object. A question "
            f"set is {{'version': 1, 'questions': [...]}}."
        )
    try:
        envelope = validate_arguments(source, QUESTION_SET_SCHEMA, payload)
    except ToolArgumentError as exc:
        raise QuestionSetInvalid(str(exc)) from exc

    records: list[TierCQuestion] = []
    seen: set[str] = set()
    for index, raw in enumerate(envelope["questions"]):
        # The record is named by INDEX and by ID, because a record missing `question_id` has only
        # the first and a reader chasing a duplicate has only the second.
        label = f"{source}: questions[{index}] (question_id={raw.get('question_id', '<absent>')!r})"
        try:
            record = validate_arguments(label, QUESTION_SCHEMA, raw)
        except ToolArgumentError as exc:
            raise QuestionSetInvalid(str(exc)) from exc
        if record["question_id"] in seen:
            raise QuestionSetInvalid(
                f"{label}: duplicate question_id. Ids key the answer file, so a duplicate makes "
                "one of the two questions unscoreable and silently shrinks the denominator."
            )
        seen.add(record["question_id"])
        records.append(
            TierCQuestion(
                question_id=record["question_id"],
                paper_id=record["paper_id"],
                question_type=record["question_type"],
                question=record["question"],
                answer_text=record["answer_text"],
                gold_evidence_block_ids=tuple(record["gold_evidence_block_ids"]),
                gold_pages=tuple(record["gold_pages"]),
                gold_object_block_id=record["gold_object_block_id"],
            )
        )
    return TierCQuestionSet(
        source=source,
        version=envelope["version"],
        notes=str(envelope.get("notes", "")),
        questions=tuple(records),
    )


def load_question_set(path: Path) -> TierCQuestionSet:
    """Reads, validates, and REFUSES the three shapes of nothing, each by its own name.

    Absent, empty and zero-question are three different facts about the world and three different
    things for the reader to do about them. Collapsing them into one "no questions" message is
    how a missing dataset gets mistaken for an empty one and quietly waited on.
    """
    if not path.exists():
        raise QuestionSetMissing(
            f"no Tier C question file at {path}. NOTHING IS SCORED and this is not a pass.\n"
            "  There is no question set anywhere in this repository (#62, open). README §4.4 "
            "requires the questions written from the paper, by a human, BEFORE seeing any parser "
            "output, so no agent may author them - AGENTS.md §4.\n"
            "  The format, with zero questions in it, is "
            "research/benchmarks/questions/EMPTY-TEMPLATE.tier-c-questions.json."
        )
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        raise QuestionSetEmpty(
            f"the question file at {path} is EMPTY ({path.stat().st_size} bytes). A file that "
            "exists and holds nothing is a half-finished write or a bad copy, not a question set "
            "with no questions in it - see EMPTY-TEMPLATE.tier-c-questions.json for the latter."
        )
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise QuestionSetInvalid(f"{path}: not valid JSON - {exc}") from exc

    question_set = validate_question_set(payload, source=str(path))
    if not question_set.questions:
        raise QuestionSetHasNoQuestions(
            f"the question file at {path} is schema-valid and holds 0 questions. Zero questions "
            "scored is not a result: every §4.2 metric would print over an empty denominator, "
            "and a report of nothing is indistinguishable from a report of success (AGENTS.md "
            "§2). #62's ruling asks for 20-30 questions; write them into this schema."
        )
    return question_set


def load_answers(path: Path) -> dict[str, GroundedAnswer]:
    """`{question_id: answer}` from a JSON object, decoded through the REAL answer contract.

    Through `answer_from_mapping` rather than by reading the keys here, deliberately: a harness
    that re-implements the contract scores a copy of it, and a contract change (a renamed field,
    a tightened invariant) would then reach the product and not the measurement.
    """
    if not path.exists():
        raise GroundingHarnessError(
            f"no answer file at {path}. The harness scores predicted answers against gold and "
            "has none.\n  Nothing in this repository produces Tier C answers - EPIC-03-RESULT.md "
            "§2 records F3.4 as making no live provider call anywhere in the suite - so this file "
            "comes from a run you did yourself, as {question_id: <GroundedAnswer>}."
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise GroundingHarnessError(f"{path}: not valid JSON - {exc}") from exc
    if not isinstance(payload, Mapping):
        raise GroundingHarnessError(
            f"{path}: the top level is {type(payload).__name__}; expected an object keyed by "
            "question_id."
        )
    answers: dict[str, GroundedAnswer] = {}
    for question_id, raw in payload.items():
        try:
            answers[str(question_id)] = answer_from_mapping(raw)
        except (AnswerContractError, TypeError, AttributeError) as exc:
            raise GroundingHarnessError(f"{path}: answer for {question_id!r}: {exc}") from exc
    return answers


@dataclass(slots=True)
class GroundingScore:
    """§4.2 over one question set, as counts. Rates are derived; denominators are carried."""

    source: str
    papers: tuple[str, ...]
    questions: int
    #: Questions with an answer. Reported beside `questions` because an unanswered question is
    #: coverage, not a zero, and dropping it silently would shrink the denominator.
    scored: int
    #: Every one of §4.4's ten types, including the ones with 0 questions. An unrepresented type
    #: is the finding a 20-30 question subset exists to expose; printing only the present ones
    #: would hide it.
    by_type: dict[str, int] = field(default_factory=dict)
    evidence_gold: int = 0
    evidence_predicted: int = 0
    evidence_hit: int = 0
    page_exact: int = 0
    page_any: int = 0
    object_questions: int = 0
    object_hit: int = 0
    object_unlabelled: int = 0
    #: Answers citing two or more regions on one page - the only answers that CAN mix columns.
    contamination_evaluable: int = 0
    contamination_columns: int = 0
    not_evaluable: dict[str, str] = field(default_factory=dict)

    @property
    def evidence_precision(self) -> float:
        return self.evidence_hit / self.evidence_predicted if self.evidence_predicted else 0.0

    @property
    def evidence_recall(self) -> float:
        return self.evidence_hit / self.evidence_gold if self.evidence_gold else 0.0

    @property
    def evidence_f1(self) -> float:
        p, r = self.evidence_precision, self.evidence_recall
        return 2 * p * r / (p + r) if p + r else 0.0


def _cites_two_regions_on_one_page(answer: GroundedAnswer) -> bool:
    pages = [region.page_index for region in answer.source_regions]
    return any(pages.count(page) >= 2 for page in set(pages))


def _mixes_columns(answer: GroundedAnswer) -> bool:
    """Two cited regions on ONE page whose x-ranges do not overlap at all.

    The definition is stated rather than tuned: in a two-column paper the columns' x-ranges are
    disjoint and every same-column pair overlaps, so disjointness IS the column test without a
    page width, a gutter estimate or a column count. Its known blind spots, so nobody reads the
    number as more than it is: a full-width float overlaps both columns and never trips it, and
    two x-disjoint blocks inside one column of a single-column paper (a marginal note beside a
    narrow table) trip it without any column being crossed.
    """
    by_page: dict[int, list[tuple[float, float]]] = {}
    for region in answer.source_regions:
        by_page.setdefault(region.page_index, []).append((region.bbox[0], region.bbox[2]))
    for spans in by_page.values():
        for i, (lo, hi) in enumerate(spans):
            for other_lo, other_hi in spans[i + 1 :]:
                if hi <= other_lo or other_hi <= lo:
                    return True
    return False


def score_grounding(
    question_set: TierCQuestionSet, answers: Mapping[str, GroundedAnswer]
) -> GroundingScore:
    """§4.2's five metrics over `question_set`, refusing an empty denominator everywhere."""
    scored = [q for q in question_set.questions if q.question_id in answers]
    if not scored:
        gold_ids = [q.question_id for q in question_set.questions][:5]
        raise NothingScored(
            f"{question_set.source} holds {len(question_set.questions)} question(s) and NONE of "
            "them has an answer. This is not 'no questions' and it is not a score of 0 - it is a "
            f"key mismatch or an empty run. Gold ids: {gold_ids}; answered: "
            f"{sorted(answers)[:5]}"
        )

    score = GroundingScore(
        source=question_set.source,
        papers=question_set.papers,
        questions=len(question_set.questions),
        scored=len(scored),
        by_type={kind: 0 for kind in QUESTION_TYPES},
    )
    for question in question_set.questions:
        score.by_type[question.question_type] += 1

    object_asked = 0
    for question in scored:
        answer = answers[question.question_id]
        gold_blocks = set(question.gold_evidence_block_ids)
        predicted_blocks = set(answer.supporting_block_ids)
        score.evidence_gold += len(gold_blocks)
        score.evidence_predicted += len(predicted_blocks)
        score.evidence_hit += len(gold_blocks & predicted_blocks)

        gold_pages, predicted_pages = set(question.gold_pages), set(answer.source_pages)
        score.page_exact += int(bool(predicted_pages) and predicted_pages == gold_pages)
        score.page_any += int(bool(predicted_pages & gold_pages))

        if question.question_type in OBJECT_TYPES:
            object_asked += 1
            if question.gold_object_block_id is None:
                score.object_unlabelled += 1
            else:
                score.object_questions += 1
                cited = predicted_blocks | {r.block_id for r in answer.source_regions}
                score.object_hit += int(question.gold_object_block_id in cited)

        if _cites_two_regions_on_one_page(answer):
            score.contamination_evaluable += 1
            score.contamination_columns += int(_mixes_columns(answer))

    # THE TWO REASONS AN OBJECT METRIC HAS NO DENOMINATOR ARE DIFFERENT FACTS. #86's shape: one
    # says the SET asks nothing about equations or figures (complete data, nothing to measure);
    # the other says it asks and the annotator never recorded which object is right (missing
    # data). A single "not evaluable" would send the reader to fix the wrong one.
    if score.object_questions == 0:
        score.not_evaluable["equation_figure_identification"] = (
            f"{object_asked} of {len(scored)} scored questions are equation- or "
            "figure-interpretation, and 0 of them carry a `gold_object_block_id`"
            if object_asked
            else f"the scored set holds 0 equation-interpretation and 0 figure-interpretation "
            f"questions (of {len(scored)}); a set that asks neither says nothing about this "
            "metric. That is coverage, not a score"
        )
    if score.contamination_evaluable == 0:
        score.not_evaluable["contamination_columns"] = (
            f"no answer of {len(scored)} cites two regions on one page, so no pair exists that "
            "could mix columns. Absent, not zero - a 0 here would be a claim about the answers"
        )
    # NOT AUTOMATABLE, AND NO PROXY IS SUBSTITUTED. §4.2 defines support validity as "judged by a
    # rubric, adjudicated by a human on a 30-item sample to calibrate the judge". Every candidate
    # proxy in this repo measures something else: `verify_grounding`'s claim coverage is token
    # overlap against DEFAULT_COVERAGE_THRESHOLD = 0.6, which #62's ruling records as a judgement
    # and not a calibration. Printing it under this name would be exactly the rounding-up
    # AGENTS.md §2 forbids.
    score.not_evaluable["support_validity"] = (
        "§4.2 defines it as judged by a rubric and adjudicated by a human on a 30-item sample; "
        "no human adjudication exists and no proxy is substituted for one"
    )
    # The caption half of §4.2's contamination rate. `answer.py:100-108` maps `caption` AND
    # `paragraph` (and footnote, list, code, abstract) to target_type "text", so the answer
    # contract cannot express "a caption mixed with unrelated body text" at all.
    score.not_evaluable["contamination_caption_body"] = (
        '`SourceRegion.target_type` buckets `caption` and `paragraph` both into "text" '
        "(answer.py:100-108), so the answer contract cannot distinguish them"
    )
    return score


def render_grounding_report(score: GroundingScore) -> str:
    """`scoring.py::render_report`'s conventions: counts beside rates, n in the row, or a reason.

    "A METRIC IS EITHER A NUMBER OR A REASON, NEVER BOTH IN ONE REPORT" (scoring.py:601). Each
    metric below prints its value line only when its denominator is non-zero, and its reason
    otherwise - never both, and never a rate over zero.
    """
    lines = [f"\ngrounding (§4.2)  ·  {score.source}"]
    lines.append(
        f"  {'scored':22s} {f'{score.scored}/{score.questions} questions':>28s}"
        f"    over {len(score.papers)} paper(s): {', '.join(score.papers) or 'none'}"
    )
    if score.scored < score.questions:
        lines.append(
            f"  {'unanswered':22s} {f'{score.questions - score.scored} questions':>28s}"
            "    coverage, not a zero - they are outside every denominator below"
        )
    represented = sum(1 for n in score.by_type.values() if n)
    lines.append(f"  {'coverage by type':22s} {f'{represented}/10 types represented':>28s}")
    for kind in QUESTION_TYPES:
        count = score.by_type[kind]
        lines.append(f"      {kind:28s} {count:3d}{'' if count else '   <-- unrepresented'}")

    # No denominator guard here, and that is deliberate rather than an omission: both
    # denominators are non-zero by construction - `gold_evidence_block_ids` has minItems 1,
    # `supporting_block_ids` is refused empty by the answer contract, and `scored` is >= 1 or
    # `NothingScored` fired. A guard that cannot fire is the belt-and-braces that
    # `test_scoring.py:264` records as untestable.
    lines.append(
        f"  {'evidence F1':22s} {score.evidence_f1:>28.3f}"
        f"    (hit {score.evidence_hit}/{score.evidence_gold} gold, "
        f"{score.evidence_hit}/{score.evidence_predicted} predicted; "
        f"P {score.evidence_precision:.3f} R {score.evidence_recall:.3f})"
    )
    lines.append(
        f"  {'page accuracy':22s} {f'{score.page_exact}/{score.scored} exact':>28s}"
        f"    ({score.page_any}/{score.scored} any-overlap; both printed because §4.2 says "
        '"is the cited page correct?" and does not say which)'
    )
    if score.object_questions:
        excluded = score.object_unlabelled
        unlabelled = f"; {excluded} unlabelled and excluded" if excluded else ""
        lines.append(
            f"  {'equation/figure id':22s} "
            f"{f'{score.object_hit}/{score.object_questions} cited':>28s}"
            f"    (over {score.object_questions} of {score.scored} scored questions{unlabelled})"
        )
    if score.contamination_evaluable:
        lines.append(
            f"  {'contamination (cols)':22s} "
            f"{f'{score.contamination_columns}/{score.contamination_evaluable}':>28s}"
            "    answers citing two x-disjoint regions on one page"
        )
    # The pointer must track which half actually printed. When no answer cites two regions on one
    # page the column half is a REASON below, not a number above, and a hard-coded "above" sends
    # the reader hunting for a figure that is not in the report - #86's defect in navigational
    # form, and on today's empty set it is the branch that always runs.
    column_half = (
        "above" if score.contamination_evaluable else "below, as a reason and not a number"
    )
    lines.append(
        "  §4.2's single `contamination rate` is NOT reported as one number: its column half is "
        f"{column_half} and its caption half is not expressible - see below."
    )
    for metric, reason in sorted(score.not_evaluable.items()):
        lines.append(f"  {metric}: NOT EVALUABLE - {reason}")
    return "\n".join(lines)
