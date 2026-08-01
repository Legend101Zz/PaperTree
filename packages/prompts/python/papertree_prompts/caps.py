"""The Rule of Two, enforced in code rather than in review. §13.6(b).

`research/synthesis-13-memory.md` §13.6(b) states the invariant and then states how it is to
be held: "**Rule of Two, enforced in code, not in review.**" The distinction is the whole
content of this module. A rule enforced in review is a rule that holds until the reviewer is
tired; a rule enforced in a `__post_init__` is a rule that holds until someone deletes the
`__post_init__`, which is a change nobody makes by accident.

THE THREE PROPERTIES, IN THE BRIEF'S OWN WORDS
    A  untrusted_input   the turn has document text in context
    B  sensitive_scope   the user's library beyond the open paper
    C  state_or_egress   write, share, export, outbound HTTP

A turn may hold at most two. All three together is the shape of every exfiltration chain in
§13.6(e): attacker-controlled instructions, private data to read, and a way to send it out.

WHY THE FORBIDDEN TURN IS UNREPRESENTABLE RATHER THAN REJECTED LATER
  `TurnCaps` raises during construction, so there is no interval — not one statement — in
  which a `TurnCaps(True, True, True)` object exists and could be passed onward. This is why
  `toolset_for` needs no error branch and why `TOOLSETS` has seven entries rather than eight
  with one mapped to `None`: the eighth key cannot be produced from a valid `TurnCaps`, so a
  mapping that contained it would be dead code that a future reader might mistake for a
  supported configuration.

  §13.6(a)'s reference `__post_init__` raises `RuleOfTwoViolation()` and does not say what it
  derives from. It derives from `Exception`, not from `ValueError`. Call sites wrap coercion
  and config parsing in `except ValueError`, and a Rule-of-Two violation swallowed by a
  `try` around a settings parse is a security control that fails silently and green.

WHY THERE ARE SEVEN TOOLSETS WHEN §13.6(a) LISTS THREE
  The brief's `TOOLSETS` maps three of the eight triples:

      (True,  True,  False) -> READ_ONLY_MULTI_PAPER
      (True,  False, False) -> READ_ONLY_SINGLE_PAPER
      (False, True,  True ) -> PRIVILEGED_NO_DOCUMENT_TEXT

  Those three are reproduced verbatim. The other four legal triples are named here rather
  than left out, and the reason is the same reason the module exists: a call site that looks
  up its triple and gets a `KeyError` will not stop, it will pick a toolset by hand at the
  call site, and picking a toolset by hand is exactly the review-enforced arrangement the
  Rule of Two is supposed to replace. A partial mapping does not prevent the four missing
  turns; it only prevents them from being audited. Each addition is annotated below with the
  turn it corresponds to.

  Note in particular `(True, False, True) -> WRITE_SINGLE_PAPER_NO_LIBRARY`. It looks
  alarming — untrusted input plus write — and it is legal and necessary: it is §13.6(b)'s
  PAPER-memory row, "Autonomous agent write: Yes", and F3.7 has no other path. It is safe
  for the reason the Rule of Two is a rule about THREE properties: there is no sensitive
  scope in the turn, so the attacker who fully controls the model can write into the
  provenance-stamped memory of the very paper they already control, and reach nothing else.

  `TOOLSETS` values are NAMES. The tool registry is `packages/agent-tools`' to own — this
  package is stdlib-only and has no business holding tool objects — so the contract across
  the package boundary is a string enum that both sides can spell.

WHAT IS NOT HERE
  Plan-Then-Execute. §13.6(b) requires a turn that genuinely needs all three properties to
  run as a fixed plan derived from the user's clean instruction before document text enters
  context (Beurer-Kellner et al., arXiv 2506.08837). That is a runtime shape, not a
  capability triple, and it belongs to the agent runtime. What this module contributes is
  that such a turn cannot be expressed as a single `TurnCaps` and therefore cannot be
  reached by forgetting to implement the plan step.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

#: `(untrusted_input, sensitive_scope, state_or_egress)` — the audit key from §13.6(d),
#: which logs "Per turn: the `TurnCaps` triple".
CapabilityTriple = tuple[bool, bool, bool]


class RuleOfTwoViolation(Exception):
    """A turn was asked to hold untrusted input, sensitive scope and state/egress at once.

    Not a `ValueError`, for the reason argued in the module docstring: it must not be
    catchable by a generic coercion handler.
    """


class Toolset(StrEnum):
    """The filtered tool list a turn is handed. Resolved to real tools by packages/agent-tools."""

    #: (F, F, F) — no document text, no library, no writes. A turn about the UI itself.
    NO_TOOLS = "NO_TOOLS"
    #: (F, F, T) — writes or exports confined to the turn's own target, with no paper text
    #: in context and no library read. Renaming the open paper; exporting a user's own note.
    WRITE_NO_DOCUMENT_TEXT_NO_LIBRARY = "WRITE_NO_DOCUMENT_TEXT_NO_LIBRARY"
    #: (F, T, F) — library-wide reads with no document text in context. The dashboard's
    #: "which of my papers mention X" over stored metadata, answered without opening one.
    READ_ONLY_LIBRARY_METADATA = "READ_ONLY_LIBRARY_METADATA"
    #: (F, T, T) — §13.6(a) verbatim.
    PRIVILEGED_NO_DOCUMENT_TEXT = "PRIVILEGED_NO_DOCUMENT_TEXT"
    #: (T, F, F) — §13.6(a) verbatim. The ordinary reading turn, and §13.6(e) Attack 2's
    #: stopping point: the cross-paper retrieval tool is not in the list, so it cannot be called.
    READ_ONLY_SINGLE_PAPER = "READ_ONLY_SINGLE_PAPER"
    #: (T, F, T) — PAPER-memory and artefact writes scoped to the paper already in context.
    #: §13.6(b) row 1. No library reach, which is what keeps this inside the Rule of Two.
    WRITE_SINGLE_PAPER_NO_LIBRARY = "WRITE_SINGLE_PAPER_NO_LIBRARY"
    #: (T, T, F) — §13.6(a) verbatim. Cross-paper comparison the user asked for in that turn,
    #: read-only, and per §13.6(b) run as Map-Reduce with tool-less quarantined readers.
    READ_ONLY_MULTI_PAPER = "READ_ONLY_MULTI_PAPER"


#: Every legal capability triple, mapped to its toolset. Seven entries, not eight:
#: `(True, True, True)` is absent because `TurnCaps` cannot construct it.
TOOLSETS: Final[dict[CapabilityTriple, Toolset]] = {
    (False, False, False): Toolset.NO_TOOLS,
    (False, False, True): Toolset.WRITE_NO_DOCUMENT_TEXT_NO_LIBRARY,
    (False, True, False): Toolset.READ_ONLY_LIBRARY_METADATA,
    (False, True, True): Toolset.PRIVILEGED_NO_DOCUMENT_TEXT,
    (True, False, False): Toolset.READ_ONLY_SINGLE_PAPER,
    (True, False, True): Toolset.WRITE_SINGLE_PAPER_NO_LIBRARY,
    (True, True, False): Toolset.READ_ONLY_MULTI_PAPER,
}


@dataclass(frozen=True, slots=True)
class TurnCaps:
    """What one turn is allowed to be. §13.6(a)'s dataclass, with its field names kept.

    Positional construction is kept — unlike `UntrustedChunk`, which is keyword-only —
    because §13.6(a) writes these as an ordered triple, the audit log in §13.6(d) records
    them as an ordered triple, and `TOOLSETS` is keyed by one. Three `bool`s in a fixed,
    documented order is the shape the rest of the design already speaks in.
    """

    untrusted_input: bool  # A
    sensitive_scope: bool  # B — user's library beyond the open paper
    state_or_egress: bool  # C — write, share, export, outbound HTTP

    def __post_init__(self) -> None:
        if self.untrusted_input and self.sensitive_scope and self.state_or_egress:
            raise RuleOfTwoViolation(
                "a turn may hold at most two of {untrusted_input, sensitive_scope, "
                "state_or_egress}; all three is the shape of every exfiltration chain in "
                "synthesis-13-memory.md §13.6(e). A turn that genuinely needs all three runs "
                "Plan-Then-Execute with the plan fixed before document text enters context."
            )

    @property
    def triple(self) -> CapabilityTriple:
        """The audit key logged per turn by §13.6(d)."""
        return (self.untrusted_input, self.sensitive_scope, self.state_or_egress)


def toolset_for(caps: TurnCaps) -> Toolset:
    """The toolset a turn may be handed. Total: no `TurnCaps` exists whose triple is missing."""
    return TOOLSETS[caps.triple]
