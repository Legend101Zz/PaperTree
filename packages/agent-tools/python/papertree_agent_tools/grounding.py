"""F3.5's grounding verifier: deterministic, offline, and explicit about what it cannot do.

EPIC-03 §4, the rule this module implements: *"When grounding verification fails, the claim is
**flagged**, not deleted and not silently emitted."*

Three outcomes, one shape. A ``bool`` on each claim is the only representation that can express
all three; a filtered list expresses exactly one of them and it is the wrong one. **The tempting
wrong implementation is a verifier that drops unsupported claims**, and it is tempting because
its output looks better: every claim in it is grounded. ``tests/test_grounding_verifier.py``
asserts that a fabricated claim is STILL PRESENT in the output AND is marked — both halves,
because the "is it marked" half passes for the filtering implementation too.

═══ NO MODEL CALL, EVER ════════════════════════════════════════════════════════════════════════

``verify_answer_grounding`` runs on EVERY answer. A verifier that needed a model would (a) double
the cost and latency of every turn, (b) make the check non-deterministic, so the same answer
could pass and then fail, and (c) put the grounding guarantee behind the same component whose
output it exists to check — the thing being verified would be verifying itself. So this is pure
text matching over the cited blocks' resolved text, in process, with no network.

Determinism is checkable rather than asserted: no set is iterated anywhere in this module, every
returned sequence is built in the order the input gave, and the token bag is a ``frozenset`` used
only for membership. Two runs on one input produce byte-identical output.

═══ WHAT THIS CAN AND CANNOT DETECT — THE HONEST POSITION ══════════════════════════════════════

**Lexical overlap is not entailment.** Saying so is the whole of the honest position, and the
specific consequences are worth writing down because each one is a wrong answer this check will
pass:

  * **Negation is invisible.** "the method improves accuracy" and "the method does NOT improve
    accuracy" differ by one stopword. ``not`` is in :data:`STOPWORDS` — deliberately, because
    keeping it would make every claim containing "not" unsupported against text that does not —
    so the two claims score IDENTICALLY. ``tests/test_grounding_verifier.py`` measures exactly
    this pair and asserts they get the same coverage, so the limitation is a fact in the suite
    rather than a caveat in a docstring nobody re-reads.
  * **Quantifier and comparator swaps are invisible.** "outperforms" vs "underperforms" is one
    token, and neither is in the cited text unless the paper used that word.
  * **Causal inversion is invisible.** "A because B" and "B because A" are the same bag.
  * **A correct paraphrase can be FLAGGED.** A claim that restates the paper in different
    vocabulary scores low and comes back unsupported. That is a false positive, and it is the
    direction to fail in: the claim is still shown, marked, with a reason the reader can judge.

**What it does catch, which is the failure mode that matters:** a claim whose distinctive
content — names, numbers, technical terms — is not in any block it cites. That is fabrication,
and fabrication with a citation attached is the specific trust failure this epic exists to
prevent (findings.md C4: v1's response schema had no block ids at all, so nothing in it could be
checked and nothing was).

So: **a necessary condition, not a sufficient one.** A supported verdict from this module means
"the claim's vocabulary is present in the blocks it cites", and nothing more. It is a floor.

═══ THE NUMBER RULE, AND WHY IT IS SEPARATE FROM COVERAGE ══════════════════════════════════════

A numeric token in a claim is checked INDIVIDUALLY and its absence fails the claim outright,
regardless of overall coverage. Two reasons, both about the shape of the error rather than about
elegance:

  1. A fabricated number is the most damaging hallucination in a research-paper reader ("the
     method achieves 94.2% accuracy" when the paper says 84.2%) and the most cheaply detectable,
     because numbers are rare tokens and an exact-match test on them has almost no false-positive
     rate.
  2. Coverage alone cannot catch it. A twelve-word claim with one wrong digit scores 11/12 —
     comfortably over any threshold that does not also flag every honest claim.

Normalisation is deliberately shallow: ``94.2%`` and ``94.2`` are the same token because the
percent sign is stripped as punctuation, but ``94.2`` and ``94.20`` are DIFFERENT tokens. That is
the conservative direction (a flagged claim a human resolves) rather than the dangerous one.

═══ THE THRESHOLD ══════════════════════════════════════════════════════════════════════════════

:data:`DEFAULT_COVERAGE_THRESHOLD` is 0.6 of a claim's content tokens. It is a judgement, not a
calibration, and there is no calibrated alternative available: EPIC-03 §7 records that the 120
Tier C questions the grounding criterion evaluates against **do not exist** — "Tier C" appears in
four prose documents and zero data files. Inventing a precise-looking number against a set that
does not exist is the defect AGENTS.md §2 names. What IS measured, in
``tests/test_grounding_verifier.py`` against a real parsed document:

    a claim quoted verbatim from a cited block            coverage 1.00
    a claim paraphrasing a cited block in its own words   coverage 0.125 (flagged — FALSE POSITIVE)
    a fabricated claim about a different subject          coverage 0.00
    the same claim with one digit changed (152 → 999)     coverage 0.83  (flagged by the NUMBER
                                                                          rule, not by coverage)

Two things that row of numbers makes concrete. First, 0.6 sits between the paraphrase and the
quotation, which is the honest description of what it separates: it distinguishes "this claim
reuses the paper's vocabulary" from "this claim does not". It does not distinguish true from
false. Second, the fabricated-number case scores 0.83 — comfortably ABOVE any threshold that
does not also flag every honest claim — which is why the number rule is separate from coverage
rather than folded into it.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Final

from papertree_agent_tools.answer import GroundedAnswer, VerifiedClaim

__all__ = [
    "DEFAULT_COVERAGE_THRESHOLD",
    "STOPWORDS",
    "ClaimEvidence",
    "claim_coverage",
    "content_tokens",
    "verify_grounding",
]

#: Fraction of a claim's content tokens that must appear in the cited blocks. See the module
#: docstring's threshold section for the three measured coverages it sits between.
DEFAULT_COVERAGE_THRESHOLD: Final = 0.6

#: Words carrying no evidential content. Small and explicit rather than an imported list: a
#: dependency for 60 English words would be a lockfile change (see ``schema.py``), and a list
#: nobody can see is a list nobody can argue with.
#:
#: ``not`` / ``no`` / ``never`` ARE IN HERE, and that is the single most consequential entry in
#: the file. Keeping them would flag every claim containing "not" against text that does not use
#: the word — a false-positive rate high enough that a reader learns to ignore the flag, which is
#: worse than no flag. The cost is that negation is invisible to this check, which the module
#: docstring states and a test measures. Making negation detectable needs entailment, not a word
#: list, and entailment needs a model — which the first section rules out.
#:
#: Held as a whitespace-joined string and split through a NAME rather than written as a set
#: literal. Two reasons, both about being readable: ``ruff format`` explodes a 110-element set
#: literal to one word per line, and a 110-line constant is a constant nobody re-reads; and
#: ``ruff``'s SIM905 rewrites a literal ``"...".split()`` back into that same exploded list, so
#: the indirection through :data:`_STOPWORD_TEXT` is what keeps the prose form stable.
_STOPWORD_TEXT: Final = (
    "a about above after all also an and any are as at be because been before being below "
    "between both but by can did do does doing during each few for from further had has "
    "have having he her here hers him his how i if in into is it its itself just me more "
    "most my never no nor not now of off on once only or other our out over own same she "
    "should so some such than that the their them then there these they this those through "
    "to too under until up very was we were what when where which while who whom why will "
    "with would you your"
)

STOPWORDS: Final[frozenset[str]] = frozenset(_STOPWORD_TEXT.split())

#: A token is a maximal run of letters, digits, ``.``, ``-`` or ``_``. Keeping ``.`` and ``-``
#: inside a token is what makes ``94.2``, ``ResNet-50`` and ``self-attention`` single tokens
#: rather than three each — and those are precisely the distinctive tokens the check depends on.
_TOKEN = re.compile(r"[0-9A-Za-z][0-9A-Za-z._\-]*")

#: A token that is a number, possibly decimal, possibly signed by an adjacent minus that the
#: tokeniser kept. ``94.2``, ``3``, ``1e-5``. Checked individually — see the module docstring.
_NUMERIC = re.compile(r"^-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$")


def content_tokens(text: str) -> tuple[str, ...]:
    """Lower-cased content tokens, in order, with stopwords and bare punctuation removed.

    Returns a TUPLE and not a set: order is preserved so a reason string can name the missing
    tokens in the order the reader will meet them in the claim, and so nothing in this module
    ever iterates a set (determinism — ``expansion.py``'s rule 1).

    Case folding is ``str.lower`` rather than ``papertree_document_ir.normalise_text``. That is a
    deliberate narrowing and worth stating: ``normalise_text`` is the identity normalisation —
    NFC-pinned, ligature-expanded, table-folded — and it is the right function for a content hash
    or a block id, where two spellings must be one value. Here the input on one side is a MODEL's
    prose, which never came out of the PDF and carries none of the PDF's ligatures, so the extra
    steps buy nothing on that side and cost a strict-mode dependency edge for a comparison that
    is approximate by design. The block side is already ``resolved_text``'s output.
    """
    tokens = [match.group(0).lower().strip("._-") for match in _TOKEN.finditer(text)]
    return tuple(token for token in tokens if token and token not in STOPWORDS)


class ClaimEvidence:
    """The token bag of everything one claim cites, and which blocks contributed it.

    A class rather than a dict so ``blocks_containing`` reads as a question about evidence and
    not as a dictionary lookup, and so the per-block bags stay available for
    :attr:`supported_by` — a claim supported by one of three cited blocks should say WHICH one.
    """

    __slots__ = ("_by_block", "_missing")

    def __init__(self, by_block: Mapping[str, frozenset[str]], missing: tuple[str, ...]) -> None:
        self._by_block = dict(by_block)
        self._missing = missing

    @property
    def missing_blocks(self) -> tuple[str, ...]:
        """Cited block ids this paper generation does not contain. Never silently dropped."""
        return self._missing

    @property
    def resolved_blocks(self) -> tuple[str, ...]:
        return tuple(self._by_block)

    def blocks_containing(self, token: str) -> tuple[str, ...]:
        return tuple(block for block, bag in self._by_block.items() if token in bag)

    def contains(self, token: str) -> bool:
        return any(token in bag for bag in self._by_block.values())


def claim_coverage(claim_text: str, evidence: ClaimEvidence) -> tuple[float, tuple[str, ...]]:
    """``(coverage, missing_tokens)`` for one claim against its cited blocks.

    ``coverage`` is 1.0 for a claim with no content tokens at all — a claim that is entirely
    stopwords ("it does not") has nothing to check, and reporting 0.0 would flag it for a reason
    the reader cannot act on. It is still flagged, by the number rule or by having no resolvable
    citation; if neither fires, an all-stopword claim is genuinely unfalsifiable by this method
    and saying so is more useful than a number.
    """
    tokens = content_tokens(claim_text)
    if not tokens:
        return 1.0, ()
    missing = tuple(token for token in tokens if not evidence.contains(token))
    return (len(tokens) - len(missing)) / len(tokens), missing


def verify_grounding(
    answer: GroundedAnswer,
    resolved_text: Mapping[str, str],
    *,
    threshold: float = DEFAULT_COVERAGE_THRESHOLD,
) -> GroundedAnswer:
    """Returns the SAME answer with every claim's verdict filled in. Never drops a claim.

    ``resolved_text`` maps ``block_id -> resolved text``. It MUST come from
    ``papertree_document_ir.resolved_text`` — ``PaperView`` builds it that way, via
    ``IndexedBlock.text`` — and never from hand concatenation of ``text`` and ``repairs``
    (DESIGN.md D4). A block id absent from the mapping is treated as a block that does not exist,
    which is the correct reading: a claim citing a block this paper generation does not contain
    is ungrounded whether the id is a typo or a survivor from a stale generation.

    The output ``claims`` tuple has the same length and the same order as the input's. That is
    asserted here rather than left to inspection, because "the verifier filtered my claims" is a
    silent data loss and the assertion costs one comparison.
    """
    verified = tuple(
        _verify_claim(claim, answer, resolved_text, threshold) for claim in answer.claims
    )
    if len(verified) != len(answer.claims):  # pragma: no cover - structurally impossible
        raise AssertionError(
            "the verifier changed the number of claims. Unsupported claims are FLAGGED, never "
            "deleted — EPIC-03 §4."
        )
    return GroundedAnswer(
        states=answer.states,
        interpretation=answer.interpretation,
        supporting_block_ids=answer.supporting_block_ids,
        source_pages=answer.source_pages,
        source_regions=answer.source_regions,
        confidence=answer.confidence,
        unresolved_ambiguities=answer.unresolved_ambiguities,
        claims=verified,
    )


def _verify_claim(
    claim: VerifiedClaim,
    answer: GroundedAnswer,
    resolved_text: Mapping[str, str],
    threshold: float,
) -> VerifiedClaim:
    # A claim citing nothing falls back to the answer's own supporting blocks. Without this, a
    # model that puts its citations only at the answer level gets every claim flagged, and a
    # verifier that flags everything is a verifier the reader turns off.
    cited = claim.supported_by or answer.supporting_block_ids
    evidence = _gather(cited, resolved_text)

    if not evidence.resolved_blocks:
        return VerifiedClaim(
            text=claim.text,
            supported_by=(),
            supported=False,
            reason=(
                f"cites {list(cited)}, none of which is a block in this paper generation"
                if cited
                else "cites no block, and the answer names no supporting blocks either"
            ),
        )

    coverage, missing = claim_coverage(claim.text, evidence)
    fabricated = tuple(token for token in missing if _NUMERIC.fullmatch(token) is not None)
    if fabricated:
        return VerifiedClaim(
            text=claim.text,
            supported_by=(),
            supported=False,
            reason=(
                f"the number(s) {list(fabricated)} appear in the claim and in none of the cited "
                f"blocks {list(evidence.resolved_blocks)}. A number that is not in the source is "
                "the failure mode this check exists for; verify it against the paper."
            ),
        )

    if coverage < threshold:
        return VerifiedClaim(
            text=claim.text,
            supported_by=(),
            supported=False,
            reason=(
                f"only {coverage:.0%} of this claim's content words appear in the cited blocks "
                f"{list(evidence.resolved_blocks)} (threshold {threshold:.0%}); missing "
                f"{list(missing[:8])}. Lexical overlap is not entailment — a correct paraphrase "
                "can land here, so this is a flag for a human, not a verdict."
            )
            + _missing_note(evidence),
        )

    contributing = tuple(
        block
        for block in evidence.resolved_blocks
        if any(token in _bag(resolved_text[block]) for token in content_tokens(claim.text))
    )
    reason = _missing_note(evidence).strip() or None
    return VerifiedClaim(
        text=claim.text,
        supported_by=contributing or evidence.resolved_blocks,
        supported=True,
        reason=reason,
    )


def _gather(cited: tuple[str, ...], resolved_text: Mapping[str, str]) -> ClaimEvidence:
    by_block: dict[str, frozenset[str]] = {}
    missing: list[str] = []
    for block_id in cited:
        text = resolved_text.get(block_id)
        if text is None:
            missing.append(block_id)
            continue
        by_block[block_id] = _bag(text)
    return ClaimEvidence(by_block, tuple(missing))


def _bag(text: str) -> frozenset[str]:
    """A block's content tokens as a membership set. Never iterated — see the determinism note."""
    return frozenset(content_tokens(text))


def _missing_note(evidence: ClaimEvidence) -> str:
    if not evidence.missing_blocks:
        return ""
    return (
        f" Note: {list(evidence.missing_blocks)} were cited and do not exist in this paper "
        "generation — a stale block id survives a re-parse and resolves to nothing."
    )
