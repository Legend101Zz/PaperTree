"""THIS MODULE IS NOT A SECURITY CONTROL. It is a signal. §13.6(c).

Read the heading again before using anything in here, because everything in this file is
built to be wrong and the rest of the package is built to not care.

`research/synthesis-13-memory.md` §13.6(c) is unambiguous: "Run at ingest, on every channel.
**The architecture in (a) and (b) must hold with detection at 0% recall.** Detection exists
to warn the user and demote privilege, not to be the boundary — Nasr et al.'s >90% adaptive
ASR is the reason." So the design target for this module is not "catch attacks". It is:

    (1) produce something a human can be shown - "this PDF contains hidden text that appears
        to target AI assistants" is a useful banner even at terrible recall;
    (2) drive the privilege demotion in §13.6(c)'s neutralisation paragraph;
    (3) NEVER become load-bearing.

HOW (3) IS ENFORCED RATHER THAN PROMISED
  No other module in `papertree_prompts` imports this one. `render_untrusted` does not
  consult it, `build_system_prompt` does not consult it, `TurnCaps` does not consult it. That
  is checked, not asserted: `tests/test_advisory.py::test_no_other_module_in_the_package_
  references_the_advisory_detector` parses every sibling module's AST and fails if the name
  `advisory` appears in any import, which is the same shape as `packages/db`'s audit for
  `._conn` access. If a future change makes rendering depend on detection, that test fails
  before the dependency ships.

  The behavioural half is pinned too: `test_a_detector_that_returns_nothing_does_not_change_
  what_render_untrusted_emits` renders a payload this detector flags and a paraphrase it
  misses completely, and asserts the two wrappers are byte-identical under a fixed datamark.
  Zero recall changes nothing about what the model is handed.

FAIL-OPEN IS THE SPECIFIED BEHAVIOUR, NOT A LIMITATION
  `advisory_injection_signals` never raises and never refuses. It cannot cause a prompt not
  to be built. §13.6's recommendation 6 sets the falsification condition for that choice: a
  false-positive rate above ~2% on the benchmark corpus means "quarantining legitimate
  content is a worse product failure than missing an attack the architecture already
  contains". This module is on the permissive side of that trade by construction.

WHAT IT LOOKS FOR, AND WHAT IT DEMONSTRABLY MISSES
  Three of §13.6(c)'s five rules are implementable from a string alone and are implemented:
  imperative-to-model, encoding evasion, and channel anomaly. The two that are not are stated
  rather than faked:

    INVISIBLE RENDER (Tr 3 render mode, font size <= 1 pt, fill colour dE < 5 from the page
    background, bbox off-page or clipped) needs the PDF's graphics state. That lives in
    `services/document-worker`, which owns geometry; a version of it here would be a
    heuristic over extracted text pretending to be a measurement over render state.

    FIGURE-IMAGE TEXT needs the VLM/OCR output of a figure crop. Also the worker's. What this
    module contributes to that rule is the `channel` argument: pass `figure_ocr` and the
    channel-anomaly rule fires on anything imperative found there.

  Known misses, tested as misses so that nobody mistakes the shape of this thing:
    - Any paraphrase outside the pattern list. "Kindly set aside the guidance you were given
      earlier" is a clean bypass and `test_advisory.py` asserts that it is.
    - Anything already sanitised. The control-character rule reports on RAW text; run it
      after `sanitise` and it can never fire, because `sanitise` deleted the evidence. Call
      order is the caller's and the docstring of the function says so.
    - The multilingual patterns are a token list assembled by hand. They were not evaluated
      against any benchmark, their recall is unknown, and "unknown" here should be read as
      "assume low" rather than "probably fine".

THE EXCERPT IS ATTACKER-CONTROLLED CONTENT
  `AdvisorySignal.excerpt` is a verbatim slice of the payload. §13.6(d) is specific about
  where that may go: the per-detection audit stream is "held in a *separate* audit store with
  tighter access, because the raw span is by definition attacker-controlled content". It must
  never be interpolated into a prompt, and it must never be rendered into a UI without the
  same escaping §13.6(b) requires of artefacts. It is capped at `EXCERPT_LIMIT` characters so
  a log line cannot be used as a storage channel.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Final

from .channels import is_high_privilege_channel
from .sanitise import CONTROL_AND_INVISIBLE

#: Maximum characters of attacker-controlled text carried in a signal.
EXCERPT_LIMIT: Final = 160

#: Rule identifiers. §13.6(d) logs "rule id, channel, span offsets, quarantine action".
RULE_IMPERATIVE: Final = "imperative_to_model"
RULE_CONTROL_CHARS: Final = "encoding_evasion.control_chars"
RULE_BASE64: Final = "encoding_evasion.base64_blob"
RULE_HOMOGLYPH: Final = "encoding_evasion.homoglyph"
RULE_CHANNEL_ANOMALY: Final = "channel_anomaly"

#: Every rule this module can emit, for the audit schema.
ADVISORY_RULES: Final = frozenset(
    {RULE_IMPERATIVE, RULE_CONTROL_CHARS, RULE_BASE64, RULE_HOMOGLYPH, RULE_CHANNEL_ANOMALY}
)

#: §13.6(c) row 2: "Second-person imperatives referencing an assistant". The first five are
#: the brief's own examples. `note to the ... assistant` is the literal opening of §13.6(e)
#: Attack 1's payload and is here so that the documented attack is at least detected.
_IMPERATIVE_SOURCES: Final = (
    r"ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier|preceding)\s+"
    r"(?:instruction|prompt|direction|message)",
    r"disregard\s+(?:all\s+|any\s+)?(?:previous|prior|the\s+above|earlier)",
    r"forget\s+(?:everything|all\s+(?:previous|prior)|your\s+(?:instructions|rules))",
    r"you\s+are\s+(?:now\s+)?(?:an?|the)\s+\w+",
    r"system\s*(?:prompt)?\s*:",
    r"assistant\s*:",
    r"when\s+(?:summaris|summariz|answer|describ|asked|you\s+(?:are\s+)?(?:asked|summar))",
    r"do\s+not\s+(?:mention|tell|reveal|show|disclose|report|include)",
    r"as\s+an?\s+(?:ai|language\s+model|assistant)",
    r"your\s+(?:instructions|system\s+prompt|configuration|rules|guidelines)\s+(?:are|have)",
    r"override\s+(?:your|the|all)\s+",
    r"new\s+instructions?\s*:",
    r"important\s+instructions?\s+(?:for|to)\s+(?:the\s+)?(?:ai|assistant|model|reader)",
    r"note\s+to\s+(?:the\s+)?(?:reading\s+)?assistant",
    r"from\s+now\s+on\s+(?:you|always|never)",
    r"respond\s+only\s+with",
    # Multilingual. Hand-assembled, unevaluated, low-recall by assumption - see the docstring.
    r"ignorez\s+(?:les\s+)?instructions",
    r"ignora\s+(?:las\s+)?instrucciones",
    r"ignorieren\s+sie\s+(?:alle\s+)?(?:vorherigen\s+)?anweisungen",
    r"忽略上面",  # "ignore the above"
    r"无视之前",  # "disregard the previous"
    r"以前の指示",  # "the previous instructions"
    r"지시를\s*무시",  # "ignore the instruction"
)

IMPERATIVE_TO_MODEL: Final = re.compile("|".join(_IMPERATIVE_SOURCES), re.IGNORECASE)

#: §13.6(c) row 3, "base64 blobs". 48 characters minimum and a mixed-case-plus-digit
#: requirement, both to keep the two things a paper legitimately contains out of it: a
#: 64-character lowercase SHA-256 digest, and a DNA or protein sequence. Neither has all
#: three character classes. This is a deliberate recall sacrifice on an advisory rule.
BASE64_BLOB: Final = re.compile(r"[A-Za-z0-9+/]{48,}={0,2}")

#: Scripts that are confusable with Latin when mixed inside one word (§13.6(c), "homoglyphs").
_CONFUSABLE_SCRIPTS: Final = frozenset({"CYRILLIC", "GREEK"})

#: Word-ish runs, for the homoglyph scan.
_WORD: Final = re.compile(r"\w+", re.UNICODE)


@dataclass(frozen=True, slots=True)
class AdvisorySignal:
    """One advisory hit. Carries attacker-controlled text - see the module docstring."""

    rule: str
    channel: str
    start: int
    end: int
    excerpt: str


def advisory_injection_signals(text: str, *, channel: str) -> tuple[AdvisorySignal, ...]:
    """Advisory-only injection signals over RAW, UNSANITISED text. Never raises.

    CALL THIS ON RAW TEXT, BEFORE `sanitise` OR `render_untrusted`. The control-character
    rule reports characters that `sanitise` deletes; run this afterwards and that rule is
    structurally incapable of firing, which would look like a clean paper rather than like a
    detector applied at the wrong point.

    Nothing in this package reads the result. It is for the user-facing banner, for the
    per-detection audit stream in §13.6(d), and for dropping the paper's memory-proposal
    privilege to zero. A caller that makes rendering conditional on this returning empty has
    re-introduced exactly the detection-as-boundary design §13.6(c) rejects.
    """
    signals: list[AdvisorySignal] = []
    imperative_hits = 0

    for match in IMPERATIVE_TO_MODEL.finditer(text):
        imperative_hits += 1
        signals.append(_signal(RULE_IMPERATIVE, channel, text, match.start(), match.end()))

    for match in CONTROL_AND_INVISIBLE.finditer(text):
        signals.append(_signal(RULE_CONTROL_CHARS, channel, text, match.start(), match.end()))

    for match in BASE64_BLOB.finditer(text):
        if _has_all_three_character_classes(match.group()):
            signals.append(_signal(RULE_BASE64, channel, text, match.start(), match.end()))

    signals.extend(_homoglyph_signals(text, channel))

    # §13.6(c) row 4: instruction-shaped text on a channel that is display/search only. This
    # is a COMPOUND signal - it needs an imperative hit AND a low-privilege origin - so it is
    # emitted after the loop above rather than folded into it.
    if imperative_hits and not is_high_privilege_channel(channel):
        first = next(s for s in signals if s.rule == RULE_IMPERATIVE)
        signals.append(_signal(RULE_CHANNEL_ANOMALY, channel, text, first.start, first.end))

    return tuple(sorted(signals, key=lambda s: (s.start, s.rule)))


def _has_all_three_character_classes(blob: str) -> bool:
    """Upper, lower AND digit. Keeps a 64-char SHA-256 digest and a DNA run out of the rule."""
    return (
        any(c.isupper() for c in blob)
        and any(c.islower() for c in blob)
        and any(c.isdigit() for c in blob)
    )


def _homoglyph_signals(text: str, channel: str) -> list[AdvisorySignal]:
    """Words mixing Latin with a confusable script.

    Only words containing a non-ASCII letter are inspected, because `unicodedata.name` is a
    per-character table lookup and a paper is mostly ASCII; scanning every word would make an
    advisory pass the most expensive thing in the ingest path.
    """
    out: list[AdvisorySignal] = []
    for match in _WORD.finditer(text):
        word = match.group()
        if word.isascii():
            continue
        scripts = {_script_of(ch) for ch in word if ch.isalpha()}
        if "LATIN" in scripts and scripts & _CONFUSABLE_SCRIPTS:
            out.append(_signal(RULE_HOMOGLYPH, channel, text, match.start(), match.end()))
    return out


def _script_of(char: str) -> str:
    """The leading word of the character's Unicode name - "LATIN", "CYRILLIC", "GREEK"."""
    try:
        return unicodedata.name(char).split(" ", 1)[0]
    except ValueError:  # unnamed codepoint; not a script we can attribute
        return "UNKNOWN"


def _signal(rule: str, channel: str, text: str, start: int, end: int) -> AdvisorySignal:
    return AdvisorySignal(
        rule=rule,
        channel=channel,
        start=start,
        end=end,
        excerpt=text[start : min(end, start + EXCERPT_LIMIT)],
    )
