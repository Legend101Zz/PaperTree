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
    a claim paraphrasing a cited block in its own words   coverage 0.167 (flagged — FALSE POSITIVE)
    a fabricated claim about a different subject          coverage 0.00
    the same claim with one digit changed (152 → 999)     coverage 0.83  (flagged by the NUMBER
                                                                          rule, not by coverage)

Two things that row of numbers makes concrete. First, 0.6 sits between the paraphrase and the
quotation, which is the honest description of what it separates: it distinguishes "this claim
reuses the paper's vocabulary" from "this claim does not". It does not distinguish true from
false. Second, the fabricated-number case scores 0.83 — comfortably ABOVE any threshold that
does not also flag every honest claim — which is why the number rule is separate from coverage
rather than folded into it.


═══ THREE VERDICTS, AND WHAT A CITATION'S FLAG IS MADE OF (S5F, 2026-10-15) ═══════════════════

The first live journey (YOLO, MiniMax-M3) marked 6 of 6 citations of a well-grounded explanation
"not verified". Causes, found and measured on two hand-labelled sets (one labeller, small; the rule
was chosen on the first, the second found three defects in it, listed below, so after the fixes
neither is held out; ``services/api``'s ``test_grounding_labelled.py`` re-derives every number
here):

  FIRST  88 (claim, cited blocks) pairs: 53 genuine (S), 17 interpretive (I), 18 not supported (N:
         2 live misattributions and 16 fabrications written to cite real blocks), from 11 live
         answers on one YOLO paragraph.
  HOLDOUT  50 pairs read off the post-change live journey (YOLO and DDPM, 45 S, 5 I) BEFORE any
         verdict was computed.

  1. TYPESETTING. The PDF says ``classiﬁer`` and ``prob- lem``; the model says ``classifier`` and
     ``problem``. Folding (ligatures expanded, line-break hyphens joined, plurals stemmed, a
     hyphenated compound covered by its words) fixes that. NFKC would be wrong: it folds the
     ``σ²₁`` of a formula to ``σ21`` and invents the number 21 (a HOLDOUT defect).
  2. THINGS THAT ARE NOT CONTENT. ``Section 4.2``, ``Eq. (14)``, ``Table 2`` name a place, and the
     cited block rarely carries the number; "the authors also note several choices" talks about the
     paper instead of saying what is in it. Neither counts as missing (two HOLDOUT defects). A real
     statistic is still checked.
  3. AGGREGATION. A citation was supported only if EVERY claim citing it passed, so one interpretive
     sentence ("This framing is a deliberate departure from …"), which reuses some of the passage's
     words and adds its own, took the citation down. The verdict is now one of THREE
     (:func:`assess_claim`): ``supported`` (coverage >= 0.6 and no missing number), ``unsupported``
     (a stated number is in no cited block, or coverage < 0.15 over 3+ content words) and
     ``neutral`` (everything between, and claims too short to check). A citation is supported when
     at least one claim carrying it is ``supported`` and none is ``unsupported``.

Measured with the OLD code (4a29bc7) and this one:

                                              old                  new
    FIRST   genuine claims judged supported   13 / 53              31 / 53
            N claims judged supported (leaks) 2 / 18 (F09, F10)    3 / 18 (F09, F10, F15)
            I claims judged unsupported       17 / 17              5 / 17  (12 are neutral)
            truly supported citations marked  6 / 46  (0.13)       30 / 46 (0.65)
            unsupported citations marked      0 / 9                0 / 9   (precision 1.00 both)
    HOLDOUT genuine claims judged supported   27 / 45              38 / 45   (bullets 11->14 of 14)
            truly supported citations marked  14 / 30 (0.47)       23 / 30 (0.77)
            unsupported citations marked      0 / 4                0 / 4   (precision 1.00 both)

The three leaks are the kind this module has always said it cannot see: a comparator swap ("the
slowest" for "the fastest"), a half-true claim with a wrong tail, and a role swap that reuses the
passage's words. The new leak (F15, a role swap, coverage 0.56 -> 0.78) came from the stemming,
which also lifted faithful claims; the threshold stays 0.6 so that no claim is easier to support
than before except by being closer to the passage's own words. A fabricated number, an invented
entity or an invented finding is ``unsupported`` in 9 of the 10 such fabrications in the set (all 4
fabricated numbers; the one miss, F12, an invented finding that reuses some of the passage's words,
is ``neutral``), and so are the 2 live misattributions. Lowering the threshold to 0.5 would lift
the FIRST recall further and let one more role swap through; it was not shipped. A fabricated
claim that merely shares a marker with an honest one reads ``neutral`` (and so keeps the citation
supported) when it is a negation, a role swap, a comparator swap or a half-true claim: 5 of 13 such
mixed cases in the set. Those are the limits of a lexical check, not a tuning gap.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, Literal

from papertree_agent_tools.answer import GroundedAnswer, VerifiedClaim

__all__ = [
    "CONTRADICTION_FLOOR",
    "DEFAULT_COVERAGE_THRESHOLD",
    "MIN_ASSESSABLE_TOKENS",
    "STOPWORDS",
    "ClaimAssessment",
    "ClaimEvidence",
    "PaperVocabulary",
    "Verdict",
    "assess_claim",
    "claim_coverage",
    "content_tokens",
    "named_entities",
    "paper_vocabulary",
    "structure_refs",
    "verify_grounding",
]

#: Fraction of a claim's content tokens that must appear in the cited blocks. See the module
#: docstring's threshold section for the three measured coverages it sits between.
DEFAULT_COVERAGE_THRESHOLD: Final = 0.6

#: Below this share of a claim's content words in the cited blocks, the claim is not merely
#: unverified but UNSUPPORTED: it is built from words the passage does not contain (invented
#: entities, invented findings). Between this floor and the threshold the claim is NEUTRAL:
#: commentary and interpretation reuse some of the passage's words and add their own, and that is
#: not evidence against the citation. See :func:`assess_claim` and the measurements in the section
#: "THREE VERDICTS" of the module docstring.
CONTRADICTION_FLOOR: Final = 0.15

#: A claim with fewer content words than this has too little to check ("Why that matters."): it is
#: NEUTRAL, never unsupported, unless it carries a number the cited blocks lack.
MIN_ASSESSABLE_TOKENS: Final = 3

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

#: Words that talk ABOUT a paper instead of saying what is in it: "the authors also note several
#: choices". They are in the claim's sentence and not in the cited passage, so counting them made
#: every framing sentence ("The authors ablate several choices in Section 4.2") look invented.
#: Reporting verbs and meta nouns only; no word with a technical sense is here.
_DISCOURSE_TEXT: Final = (
    "author authors paper papers passage passages excerpt text reader study section sections "
    "also several various following however therefore thus hence moreover furthermore overall "
    "state states stated note notes noted argue argues argued describe describes described "
    "present presents presented propose proposes proposed introduce introduces introduced report "
    "reports reported discuss discusses discussed mention mentions mentioned say says said claim "
    "claims claimed explain explains explained show shows shown call calls called"
)

STOPWORDS: Final[frozenset[str]] = frozenset(_STOPWORD_TEXT.split()) | frozenset(
    _DISCOURSE_TEXT.split()
)

#: A token is a maximal run of letters, digits, ``.``, ``-`` or ``_``. Keeping ``.`` and ``-``
#: inside a token is what makes ``94.2``, ``ResNet-50`` and ``self-attention`` single tokens
#: rather than three each — and those are precisely the distinctive tokens the check depends on.
_TOKEN = re.compile(r"[0-9A-Za-z][0-9A-Za-z._\-]*")

#: A token that is a number, possibly decimal, possibly signed by an adjacent minus that the
#: tokeniser kept. ``94.2``, ``3``, ``1e-5``. Checked individually — see the module docstring.
_NUMERIC = re.compile(r"^-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$")


#: Dashes a PDF text layer or a model may use for a hyphen: hyphen, non-breaking hyphen, figure
#: dash, en dash, minus sign, soft hyphen.
_DASHES = dict.fromkeys(map(ord, "\u2010\u2011\u2012\u2013\u2212\u00ad"), "-")
#: Typographic ligatures of a PDF text layer. NOT NFKC: it also folds the superscript and subscript
#: digits of a formula (``σ²₁`` -> ``σ21``), which invents a number the paper never wrote.
_LIGATURES = {
    ord(ch): letters
    for ch, letters in (
        ("\ufb00", "ff"),
        ("\ufb01", "fi"),
        ("\ufb02", "fl"),
        ("\ufb03", "ffi"),
        ("\ufb04", "ffl"),
        ("\ufb05", "st"),
        ("\ufb06", "st"),
    )
}
#: A reference to the paper's own structure: ``Section 4.2``, ``Eq. (14)``, ``Table 2``. The number
#: names a place, not a finding, and the cited block usually does not carry it (the heading does).
_STRUCTURE_REF = re.compile(
    r"\b(?:sections?|sec\.|eqs?\.?|equations?|fig(?:ure)?s?\.?|tables?|algorithms?|"
    r"appendix|appendices|chapters?|pages?|pp?\.)\s*\(?[0-9]+(?:\.[0-9]+)*[a-z]?\)?",
    re.IGNORECASE,
)
#: A word broken across lines by the typesetter: ``prob- lem``.
_LINE_BREAK_HYPHEN = re.compile(r"(?<=[A-Za-z])-\s+(?=[a-z])")
_SUFFIXES: Final = (("ies", "y"), ("sses", "ss"), ("ing", ""), ("ed", ""), ("es", ""), ("s", ""))


def _fold(text: str) -> str:
    """The comparison form of paper or model text: ligatures expanded (``ﬁ`` is ``fi``), every dash
    a hyphen, typesetter line-break hyphens joined, and references to the paper's own structure
    (``Section 4.2``) removed. A claim says ``classifier`` and the PDF's text layer says
    ``classiﬁer``; ``prob- lem`` and ``problem`` are one word."""
    folded = text.translate(_LIGATURES).translate(_DASHES)
    return _STRUCTURE_REF.sub(" ", _LINE_BREAK_HYPHEN.sub("", folded))


#: The kind a structure-reference word names: ``Fig.`` and ``Figures`` are one kind.
_REF_KINDS: Final = {
    "section": "section",
    "sections": "section",
    "sec": "section",
    "eq": "equation",
    "eqs": "equation",
    "equation": "equation",
    "equations": "equation",
    "fig": "figure",
    "figs": "figure",
    "figure": "figure",
    "figures": "figure",
    "table": "table",
    "tables": "table",
    "algorithm": "algorithm",
    "algorithms": "algorithm",
    "appendix": "appendix",
    "appendices": "appendix",
    "chapter": "chapter",
    "chapters": "chapter",
    "page": "page",
    "pages": "page",
    "p": "page",
    "pp": "page",
}
_REF_PARTS = re.compile(r"([A-Za-z]+)\.?\s*\(?([0-9]+(?:\.[0-9]+)*[a-z]?)\)?")
#: A numbered heading: ``4.2 Training`` is section 4.2; ``A. Details`` / ``B.1 Proofs`` an appendix.
_HEADING_NUMBER = re.compile(r"^\s*(?:appendix\s+)?([0-9]+(?:\.[0-9]+)*|[A-Z](?:\.[0-9]+)*)[.:]?\s")
#: An equation's tag in running text: ``(14)``.
_EQUATION_TAG = re.compile(r"\(([0-9]{1,3})\)")


def structure_refs(text: str) -> frozenset[str]:
    """The references to the paper's own structure in ``text``, normalised: ``Table 9`` is
    ``table 9``, ``Fig. 3`` is ``figure 3``, ``pp. 4`` is ``page 4``, ``Section 4.2`` is
    ``section 4.2`` (W2API item 3, 2026-10-15). Coverage still ignores them (:func:`_fold`); this
    is what lets a reference to a table the paper does not have be called out."""
    out: set[str] = set()
    for match in _STRUCTURE_REF.finditer(text.translate(_DASHES)):
        parts = _REF_PARTS.match(match.group(0))
        if parts is None:
            continue
        kind = _REF_KINDS.get(parts.group(1).lower())
        if kind is not None:
            out.add(f"{kind} {parts.group(2).lower()}")
    return frozenset(out)


#: A capitalised word run that opens a sentence, a bullet, a quote or a bold span is just
#: capitalised for grammar; one inside a sentence names something.
_CAPITAL = re.compile(r"[A-Z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*")
#: ``K-fold``, ``T-step``: a math variable bolted to a word, not a name.
_VARIABLE_COMPOUND = re.compile(r"^[A-Z]-")
_AFTER_BOUNDARY = re.compile(r"(?:^|[.!?:;\u2014\u2013(\"\u201c\u2018*\-\n]\s*|\*\*)\s*$")


def named_entities(text: str) -> tuple[str, ...]:
    """Proper nouns and names in a claim: runs of capitalised words inside a sentence
    (``Google Brain``, ``Geoffrey Hinton``) and single names such as ``ImageNet`` or ``BERT``;
    never the capital that merely opens a sentence, a bullet or a bold span. Structure words
    (``Section``, ``Table``) are not names."""
    folded = text.translate(_DASHES)
    entities: list[str] = []
    run: list[str] = []
    cursor = 0
    for match in _CAPITAL.finditer(folded):
        word = match.group(0)
        between = folded[cursor : match.start()]
        starts_sentence = _AFTER_BOUNDARY.search(folded[: match.start()]) is not None
        continues = bool(run) and between.strip() == "" and "\n" not in between
        if continues:
            run.append(word)
        else:
            if run:
                entities.append(" ".join(run))
            run = [] if starts_sentence else [word]
        cursor = match.end()
    if run:
        entities.append(" ".join(run))
    kept = []
    for entity in entities:
        # A two-letter acronym ("ML", "AI") is a way of saying a longer phrase, not a name.
        words = [
            w
            for w in entity.split()
            if w.lower() not in _STRUCTURE_WORDS
            and len(w) > 2
            and _VARIABLE_COMPOUND.match(w) is None
        ]
        if words:
            kept.append(" ".join(words))
    return tuple(dict.fromkeys(kept))


#: Capitalised words that name a part of the paper or are just "I"/"A", never an outside name.
_STRUCTURE_WORDS: Final = frozenset(_REF_KINDS) | frozenset(
    {"i", "a", "abstract", "introduction", "conclusion", "conclusions", "references", "related"}
)


def _stem(token: str) -> str:
    """A deliberately crude suffix strip (``classifiers`` -> ``classifier``, ``boxes`` -> ``box``,
    ``predicts`` -> ``predict``). Numbers and short words are untouched. Both sides of every
    comparison are stemmed alike, so an imperfect stem costs nothing as long as it is the same
    function; it only has to make a plural, a tense and a base form meet."""
    if len(token) <= 3 or _NUMERIC.fullmatch(token) or token.endswith("ss"):
        return token
    for suffix, replacement in _SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)] + replacement
    return token


def content_tokens(text: str) -> tuple[str, ...]:
    """Lower-cased content tokens, in order, with stopwords and bare punctuation removed.

    Returns a TUPLE and not a set: order is preserved so a reason string can name the missing
    tokens in the order the reader will meet them in the claim, and so nothing in this module
    ever iterates a set (determinism — ``expansion.py``'s rule 1).

    The text is folded first (:func:`_fold`) and each token stemmed (:func:`_stem`): without that
    a faithful claim ("classifiers", "problem") reads as missing words against the PDF's own
    ("classiﬁers", "prob- lem"), which is what made well-grounded answers read "not verified".

    Case folding is ``str.lower`` rather than ``papertree_document_ir.normalise_text``. That is a
    deliberate narrowing and worth stating: ``normalise_text`` is the identity normalisation —
    NFC-pinned, ligature-expanded, table-folded — and it is the right function for a content hash
    or a block id, where two spellings must be one value. Here the input on one side is a MODEL's
    prose, which never came out of the PDF and carries none of the PDF's ligatures, so the extra
    steps buy nothing on that side and cost a strict-mode dependency edge for a comparison that
    is approximate by design. The block side is already ``resolved_text``'s output.
    """
    tokens = [match.group(0).lower().strip("._-") for match in _TOKEN.finditer(_fold(text))]
    return tuple(_stem(token) for token in tokens if token and token not in STOPWORDS)


def _parts(token: str) -> tuple[str, ...]:
    """The words of a hyphenated compound (``bounding-box`` -> ``bounding``, ``box``); empty for
    anything else, and for a number."""
    if "-" not in token or _NUMERIC.fullmatch(token):
        return ()
    return tuple(_stem(part) for part in token.split("-") if part and part not in STOPWORDS)


@dataclass(frozen=True, slots=True)
class PaperVocabulary:
    """What the WHOLE paper contains, so that a claim is judged against more than its cited blocks
    where the question is "does this exist at all" (W2API item 3): ``refs`` are the structure
    references the paper has (captions, headings, mentions; ``page n`` for every printed page),
    ``words`` its content tokens. ``None`` fields mean unknown, and unknown never accuses."""

    refs: frozenset[str]
    words: frozenset[str]
    page_count: int | None = None
    #: ``words`` with ``-`` and ``_`` removed (``CIFAR-10`` is the paper's ``CIFAR10``,
    #: ``BERT_BASE`` its flattened ``BERTBASE``); filled in from ``words`` when left empty.
    squashed: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if not self.squashed:
            object.__setattr__(self, "squashed", frozenset(_squash(w) for w in self.words))

    def has_word(self, token: str) -> bool:
        return token in self.words or _squash(token) in self.squashed

    def has_ref(self, ref: str) -> bool:
        if ref in self.refs:
            return True
        kind, _, number = ref.partition(" ")
        if kind == "page" and self.page_count is not None:
            return number.isdigit() and 1 <= int(number) <= self.page_count
        return False


def _squash(token: str) -> str:
    return token.replace("-", "").replace("_", "")


def paper_vocabulary(
    block_texts: Mapping[str, str],
    *,
    heading_ids: frozenset[str] = frozenset(),
    page_count: int | None = None,
) -> PaperVocabulary:
    """The vocabulary of one paper from ``block_id -> text`` (and which of those are headings)."""
    refs: set[str] = set()
    words: set[str] = set()
    tags = 0
    for block_id, text in block_texts.items():
        refs.update(structure_refs(text))
        words.update(content_tokens(text))
        for tag in _EQUATION_TAG.finditer(text):
            refs.add(f"equation {tag.group(1)}")
            tags += 1
        if block_id in heading_ids:
            heading = _HEADING_NUMBER.match(text)
            if heading is not None:
                number = heading.group(1).lower()
                refs.add(f"section {number}")
                refs.add(f"appendix {number}")
                refs.add(f"chapter {number}")
    if tags == 0:  # the text layer carried no equation tags: equations cannot be judged
        refs.update(f"equation {n}" for n in range(1, 1000))
    return PaperVocabulary(frozenset(refs), frozenset(words), page_count)


class ClaimEvidence:
    """The token bag of everything one claim cites, and which blocks contributed it.

    A class rather than a dict so ``blocks_containing`` reads as a question about evidence and
    not as a dictionary lookup, and so the per-block bags stay available for
    :attr:`supported_by` — a claim supported by one of three cited blocks should say WHICH one.
    """

    __slots__ = ("_by_block", "_missing", "_refs")

    def __init__(
        self,
        by_block: Mapping[str, frozenset[str]],
        missing: tuple[str, ...],
        refs: frozenset[str] = frozenset(),
    ) -> None:
        # A block that says ``bounding-box`` also says ``bounding`` and ``box``.
        self._by_block = {
            block: bag.union(*(_parts(token) for token in bag)) for block, bag in by_block.items()
        }
        self._missing = missing
        self._refs = refs

    @property
    def refs(self) -> frozenset[str]:
        """The structure references (``table 2``) the cited blocks themselves carry."""
        return self._refs

    @property
    def missing_blocks(self) -> tuple[str, ...]:
        """Cited block ids this paper generation does not contain. Never silently dropped."""
        return self._missing

    @property
    def resolved_blocks(self) -> tuple[str, ...]:
        return tuple(self._by_block)

    def blocks_containing(self, token: str) -> tuple[str, ...]:
        return tuple(block for block, bag in self._by_block.items() if token in bag)

    def contains_squashed(self, token: str) -> bool:
        """``contains`` ignoring ``-`` and ``_`` (``CIFAR-10`` against the text's ``CIFAR10``)."""
        flat = _squash(token)
        return any(_squash(word) == flat for bag in self._by_block.values() for word in bag)

    def contains(self, token: str) -> bool:
        """Whether the cited blocks have this token, or — for a hyphenated compound the blocks
        write as two words — every word of it (``bounding-box`` is covered by ``bounding box``)."""
        if any(token in bag for bag in self._by_block.values()):
            return True
        parts = _parts(token)
        return bool(parts) and all(self.contains(part) for part in parts)


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


#: What one claim's check says about the citations it carries.
#:
#: ``supported``    enough of its words are in the cited blocks, and none of its numbers is missing;
#: ``neutral``      it reuses some of the passage's words and adds its own (commentary,
#:                  interpretation, a restatement in new vocabulary), or it is too short to check:
#:                  this check cannot call it grounded and has no evidence against the citation;
#: ``unsupported``  a number it states is in none of the cited blocks, or it is built almost
#:                  entirely from words the cited blocks do not contain.
Verdict = Literal["supported", "neutral", "unsupported"]


@dataclass(frozen=True, slots=True)
class ClaimAssessment:
    verdict: Verdict
    coverage: float
    #: The claim's content words the cited blocks lack, in claim order. Never shown to the reader.
    missing: tuple[str, ...]
    #: The claim's numbers the cited blocks lack.
    missing_numbers: tuple[str, ...]
    content_words: int
    #: ``table 9``-style references the claim makes that neither the cited blocks nor the paper has.
    missing_refs: tuple[str, ...] = ()
    #: Names (``Google Brain``) the claim uses that neither the cited blocks nor the paper has.
    missing_entities: tuple[str, ...] = ()


def assess_claim(
    claim_text: str,
    evidence: ClaimEvidence,
    *,
    threshold: float = DEFAULT_COVERAGE_THRESHOLD,
    floor: float = CONTRADICTION_FLOOR,
    paper: PaperVocabulary | None = None,
) -> ClaimAssessment:
    """One claim against its cited blocks, as one of three verdicts (see :data:`Verdict`).

    ``paper``, when given, is what the whole paper contains: a reference the cited blocks lack is
    forgiven when the paper has it (``Section 4.2`` is a heading, not a sentence), a name the
    cited blocks lack is only a (neutral) uncited name when the paper has it. With no ``paper`` the
    cited blocks are all there is, so a table number or a name that is not in them is missing."""
    coverage, missing = claim_coverage(claim_text, evidence)
    words = len(content_tokens(claim_text))
    numbers = tuple(token for token in missing if _NUMERIC.fullmatch(token) is not None)
    refs = tuple(
        ref
        for ref in sorted(structure_refs(claim_text))
        if ref not in evidence.refs and not (paper is not None and paper.has_ref(ref))
    )
    entities = tuple(
        entity for entity in named_entities(claim_text) if _entity_absent(entity, evidence, paper)
    )
    if numbers or refs or entities:
        verdict: Verdict = "unsupported"
    elif coverage >= threshold:
        verdict = "supported"
    elif words >= MIN_ASSESSABLE_TOKENS and coverage < floor:
        verdict = "unsupported"
    else:
        verdict = "neutral"
    return ClaimAssessment(verdict, coverage, missing, numbers, words, refs, entities)


def _entity_absent(entity: str, evidence: ClaimEvidence, paper: PaperVocabulary | None) -> bool:
    """A name is absent when NONE of its words is in the cited blocks (or the paper): ``Google
    Brain`` is, ``Faster R-CNN`` beside a block that says ``Faster`` is not."""
    tokens = content_tokens(entity)
    if not tokens:
        return False
    return all(
        not evidence.contains(token)
        and not evidence.contains_squashed(token)
        and not (paper is not None and paper.has_word(token))
        for token in tokens
    )


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

    A claim is ``supported`` here only on the ``supported`` verdict of :func:`assess_claim`; a
    ``neutral`` one is not (this is the boolean the answer contract carries). The output
    ``claims`` tuple has the same length and the same order as the input's. That is
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

    assessment = assess_claim(claim.text, evidence, threshold=threshold)
    coverage, missing = assessment.coverage, assessment.missing
    if assessment.missing_numbers:
        return VerifiedClaim(
            text=claim.text,
            supported_by=(),
            supported=False,
            reason=(
                f"the number(s) {list(assessment.missing_numbers)} appear in the claim and in none "
                f"of the cited blocks {list(evidence.resolved_blocks)}. A number that is not in "
                "the source is the failure mode this check exists for; verify it against the paper."
            ),
        )

    if assessment.missing_refs or assessment.missing_entities:
        return VerifiedClaim(
            text=claim.text,
            supported_by=(),
            supported=False,
            reason=(
                f"the claim names {list(assessment.missing_refs + assessment.missing_entities)}, "
                f"which appears in none of the cited blocks {list(evidence.resolved_blocks)}. A "
                "table, page or name the source does not carry is where invented detail hides; "
                "verify it against the paper."
            ),
        )

    if assessment.verdict != "supported":
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
    refs: set[str] = set()
    for block_id in cited:
        text = resolved_text.get(block_id)
        if text is None:
            missing.append(block_id)
            continue
        by_block[block_id] = _bag(text)
        refs.update(structure_refs(text))
    return ClaimEvidence(by_block, tuple(missing), frozenset(refs))


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
