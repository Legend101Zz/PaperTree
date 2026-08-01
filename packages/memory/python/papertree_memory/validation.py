"""§13.6(b)'s proposal validator — a POLICY layer, sitting on top of a STRUCTURAL one.

READ THIS PARAGRAPH BEFORE TRUSTING ANYTHING BELOW. Every rule in this module is pattern
matching over attacker-influenced text, and §13.6(c) is unambiguous about what that is worth:
*"The architecture in (a) and (b) must hold with detection at 0% recall."* Nasr et al. measured
>90% attack success against detection-based defences under adaptive attack. So this file is
**not** the reason an injected preference cannot be written to user-learning memory. The reason
is `guard.py`: the agent's connection is ``mode=ro`` with an authorizer, and the promotion path
requires a ``UserConfirmation`` the agent has no object to call. If every rule here returned
"clean" on every input, `security/injection.spec` would still pass.

What this layer is FOR, then. §13.6(b) ends with: *"Proposals are additionally rejected at
validation if they contain imperative language, URLs, tool names, or exceed the length cap."*
That is a quality gate on what a HUMAN is asked to approve. A proposal that reaches the
confirmation UI carrying an imperative sentence or a URL is a proposal whose whole purpose is
to be rubber-stamped, and §13.7 rec. 3's falsification condition — users approving >90% of
proposals without reading — is the failure this reduces the surface of. It buys fewer, cleaner
things in front of the user. It buys no security by itself, and saying otherwise is how a
detector ends up load-bearing.

WHY THE RULES RUN OVER ``content`` AND NOT OVER ``evidence_quote``
    The evidence quote is attacker-controlled BY DEFINITION — it is a span from the PDF, and
    `memory_proposals`' own header says it "is rendered as quoted evidence and never as
    instruction". Running an imperative detector over it would auto-reject every proposal
    derived from a paper containing the words "do not" or a DOI, which is most of them, and
    §13.7 rec. 6's falsification condition is a false-positive rate above ~2%. The quote is
    displayed; the content is what gets stored and acted on. Only the content is validated.

WHY ``tool_names`` IS A REQUIRED CONSTRUCTOR ARGUMENT WITH NO DEFAULT
    The tool vocabulary lives in ``packages/agent-tools``, which depends on this package —
    importing it back would be a cycle. So the names arrive as data. They are REQUIRED because
    a default of ``()`` makes rule ``tool_name`` silently inert: the validator would still run,
    still return "clean", and still look exactly like a working control. This epic's brief
    quotes the Epic 2 post-mortem — four of five unreachable-feature defects involved an
    optional prop, and none would have survived being mandatory — and an empty default here is
    that defect with a security label on it. Passing ``frozenset()`` deliberately is fine; it
    is being unable to tell whether anyone did that is the problem.

RULE ORDER IS FIXED AND DOCUMENTED
    A proposal can violate several rules at once, and the stored ``rejection_rule`` is a single
    string that a user-facing message and an alert query are both written against. The order
    below is cheapest-and-most-objective first, so the reported rule is stable across runs and
    across refactors: ``length_cap`` -> ``oversized_key`` -> ``embedded_url`` ->
    ``tool_name`` -> ``imperative_language``.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal, final

from .records import MAX_CONTENT_KEY_LENGTH, MAX_PROPOSAL_CONTENT_BYTES, canonical_json

#: The rule names `memory_proposals.rejection_rule` may hold. ``evidence_not_verbatim`` is in
#: this list but is NOT produced here: it needs the block text, so
#: :meth:`~papertree_memory.store.MemoryStore.create_proposal` produces it. It is declared here
#: so that the set of values the column can hold has exactly one definition.
RejectionRule = Literal[
    "length_cap",
    "oversized_key",
    "embedded_url",
    "tool_name",
    "imperative_language",
    "evidence_not_verbatim",
]

#: §13.6(c)'s "Imperative-to-model" row, made executable: *"Second-person imperatives
#: referencing an assistant: `ignore previous`, `you are`, `system:`, `when summarising`,
#: `do not mention`, multilingual variants."*
#:
#: The multilingual entries are a token gesture and are labelled as one. There are ~7,000
#: languages and this covers four; §13.6(c) is fail-open by design and this is the clearest
#: illustration of why it must be. Anyone who reads this list and concludes the channel is
#: closed has misread it.
_IMPERATIVE_PATTERNS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = tuple(
    (label, re.compile(pattern, re.IGNORECASE | re.MULTILINE))
    for label, pattern in (
        ("ignore-previous", r"\bignore\s+(?:all\s+|any\s+|the\s+)*(?:previous|prior|above)\b"),
        ("disregard", r"\bdisregard\s+(?:all\s+|any\s+|the\s+)*(?:previous|prior|above|earlier)\b"),
        ("role-assignment", r"\byou\s+are\s+(?:a|an|the|now)\b"),
        # NOT anchored with `^`, and that was a bug in the first version of this pattern that
        # `test_each_rule_fires_on_the_input_it_names` caught. The rules run over the CANONICAL
        # JSON of the content, so "system: …" inside a string value is never at the start of a
        # line — it is always preceded by `{"note":"`. The negative lookahead is what keeps a
        # legitimate JSON KEY named "system" from matching: `canonical_json` emits `"system":`
        # with the colon immediately followed by a quote and no space, while an injected role
        # marker is followed by anything else.
        ("role-marker", r"\b(?:system|assistant)\s*:(?!\")"),
        ("conditional-instruction", r"\bwhen\s+(?:summari[sz]ing|asked|responding|explaining)\b"),
        ("suppression", r"\bdo\s+not\s+(?:mention|reveal|tell|disclose|explain|show)\b"),
        ("always-never", r"\b(?:always|never)\s+(?:respond|answer|say|assume|explain|mention)\b"),
        ("new-instructions", r"\bnew\s+instructions?\b"),
        # Multilingual variants — four languages out of thousands. See the note above.
        ("fr-ignore", r"\bignore[zr]?\s+les\s+instructions\b"),
        ("es-ignore", r"\bignora\s+(?:las\s+)?instrucciones\b"),
        ("de-ignore", r"\b(?:ignoriere|vergiss)\s+(?:alle\s+)?(?:vorherigen\s+)?anweisungen\b"),
        ("zh-ignore", r"忽略(?:之前|以上|上述)?(?:的)?指令"),
    )
)

#: §13.6(c)'s "Channel anomaly" and attack 3 (EchoLeak, CVE-2025-32711): a URL in stored
#: memory is an exfiltration channel the moment anything renders it. Markdown image syntax is
#: listed separately because EchoLeak specifically used reference-style Markdown to dodge link
#: redaction, and an auto-fetched image was the transport.
_URL_PATTERNS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = tuple(
    (label, re.compile(pattern, re.IGNORECASE))
    for label, pattern in (
        ("scheme", r"\b[a-z][a-z0-9+.\-]*://"),
        ("data-uri", r"\bdata:[a-z]+/"),
        ("www", r"\bwww\.[a-z0-9\-]+\.[a-z]{2,}"),
        ("markdown-image", r"!\[[^\]]*\]\([^)]*\)"),
        ("markdown-link", r"\[[^\]]*\]\([^)]*\)"),
        ("markdown-reference", r"!?\[[^\]]*\]\[[^\]]*\]"),
        ("bare-domain", r"\b[a-z0-9\-]+\.(?:com|net|org|io|ru|cn|tld|xyz|top)\b"),
    )
)


@dataclass(frozen=True, slots=True)
class ValidationOutcome:
    """The validator's answer. ``rule is None`` means "nothing matched", not "safe"."""

    rule: RejectionRule | None
    #: Which pattern fired, for the audit row. `memory_proposals.rejection_rule` stores only
    #: the rule name — a column value an alert can group by — while the audit `detail` carries
    #: this, so a security reviewer can tell "ignore-previous" from "always-never" without
    #: re-running the validator against a proposal that may since have been deleted.
    detail: str

    @property
    def rejected(self) -> bool:
        return self.rule is not None


@final
class ProposalValidator:
    """§13.6(b)'s four validation rules, plus a key-length rule §13.4's schema implies.

    Stateless and reusable; one per process is the intended lifetime. It holds no connection
    and reaches no database — it is pure text policy, which is what makes it cheap to test
    exhaustively and impossible to make load-bearing by accident.
    """

    __slots__ = ("_max_content_bytes", "_tool_pattern", "_tool_names")

    def __init__(
        self,
        *,
        tool_names: Collection[str],
        max_content_bytes: int = MAX_PROPOSAL_CONTENT_BYTES,
    ) -> None:
        self._tool_names = frozenset(tool_names)
        self._max_content_bytes = max_content_bytes
        # One alternation rather than N searches: a proposal is validated on the hot path of a
        # user-visible confirmation, and ~20 tool names is ~20 scans of the same string.
        # `sorted` so the compiled pattern is deterministic across runs; longest-first so
        # `get_block_text` matches before `get_block`.
        if self._tool_names:
            alternatives = "|".join(
                re.escape(name) for name in sorted(self._tool_names, key=lambda n: (-len(n), n))
            )
            self._tool_pattern: re.Pattern[str] | None = re.compile(
                rf"\b(?:{alternatives})\b", re.IGNORECASE
            )
        else:
            self._tool_pattern = None

    @property
    def tool_names(self) -> frozenset[str]:
        """The vocabulary this validator was built with. Exposed so a test can prove it is
        non-empty — a validator constructed with no names still returns "clean" for rule
        ``tool_name``, and an assertion on the outcome alone cannot tell the two apart."""
        return self._tool_names

    def check(self, content: Mapping[str, Any]) -> ValidationOutcome:
        """Applies the five rules in the documented order and reports the FIRST that fires.

        ``content`` is the structured proposal body — §13.4's ``value``, which is
        enum-constrained or a short capped string in every ``ul_kind``. It is serialised with
        :func:`~papertree_memory.records.canonical_json`, the same function the store writes
        with, so the byte count measured here is the byte count stored.
        """
        rendered = canonical_json(dict(content))

        # 1. length_cap — §13.4's `length(value::text) <= 512`. Measured in UTF-8 BYTES, not
        #    characters: a 400-character CJK payload is 1,200 bytes on disk, and the cap
        #    exists to keep 200 records inside ~100 KB.
        size = len(rendered.encode("utf-8"))
        if size > self._max_content_bytes:
            return ValidationOutcome(
                "length_cap", f"content is {size} bytes, cap is {self._max_content_bytes}"
            )

        # 2. oversized_key — §13.4's `key text NOT NULL CHECK (length(key) <= 64)`. The SQLite
        #    schema stores the whole record as one JSON blob and so cannot express this.
        oversized = self._oversized_keys(content)
        if oversized is not None:
            return ValidationOutcome(
                "oversized_key",
                f"key {oversized[:32]!r} is longer than {MAX_CONTENT_KEY_LENGTH} characters",
            )

        # 3. embedded_url — attack 3's transport.
        for label, pattern in _URL_PATTERNS:
            match = pattern.search(rendered)
            if match is not None:
                return ValidationOutcome("embedded_url", f"{label}: {match.group(0)[:64]!r}")

        # 4. tool_name — a stored preference that names a tool is a stored instruction.
        if self._tool_pattern is not None:
            match = self._tool_pattern.search(rendered)
            if match is not None:
                return ValidationOutcome("tool_name", f"names the tool {match.group(0)!r}")

        # 5. imperative_language — the weakest rule, listed last for that reason.
        for label, pattern in _IMPERATIVE_PATTERNS:
            match = pattern.search(rendered)
            if match is not None:
                return ValidationOutcome("imperative_language", f"{label}: {match.group(0)[:64]!r}")

        return ValidationOutcome(None, "no rule matched (this is not a safety claim — see §13.6c)")

    def _oversized_keys(self, value: object) -> str | None:
        """Depth-first walk for any object key longer than §13.4's 64-character bound.

        Recursive because ``content`` is arbitrary JSON and a nested object is exactly where a
        long key would hide. Bounded implicitly by the length cap already applied above: a
        512-byte document cannot nest deeply enough to matter.
        """
        if isinstance(value, Mapping):
            for key, nested in value.items():
                text = str(key)
                if len(text) > MAX_CONTENT_KEY_LENGTH:
                    return text
                found = self._oversized_keys(nested)
                if found is not None:
                    return found
        elif isinstance(value, list):
            for item in value:
                found = self._oversized_keys(item)
                if found is not None:
                    return found
        return None
