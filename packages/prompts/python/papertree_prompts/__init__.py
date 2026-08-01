"""papertree_prompts — the prompt layer of F3.8's injection defence (EPIC-03).

One function wraps untrusted paper content, one function builds the system prompt, one
dataclass makes the Rule of Two unrepresentable when violated, and one module produces
signals nothing depends on. That is the whole package. It is stdlib-only and it imports
nothing from PaperTree.

WHERE THIS SITS, AND WHY THAT DETERMINES HOW IT IS WRITTEN
  EPIC-03's workflow prompt is blunt about the ordering: "The injection defence must be
  structural, not textual. Detection-based defence is measurably broken (>90% attack success
  under adaptive attack) and uploaded PDFs are attacker-controlled. ... Prompt-level
  delimiting and spotlighting are a second layer, never the only one."

  This package is that second layer. The first is a sibling's: the agent's database handle
  physically cannot write user-learning memory, and the turn's toolset physically lacks the
  cross-paper and egress tools. So the correctness standard here is NOT "the model does not
  fall for it" — the model falling for it completely is the assumed case, and §13.6(e)'s
  closing note is why: Prompt-in-Content (arXiv 2508.19287, NSS 2025) tested seven platforms
  against four attack classes and Grok 3, DeepSeek R1 and Kimi executed all four. PaperTree
  routes through OpenRouter. "Fully complied with the attacker" is a state this system will
  be in on some requests.

  The standard is therefore: every claim this package makes must be TRUE OF THE OUTPUT
  BYTES and checkable by reading the returned string. Content cannot contain the closing
  delimiter. Content cannot contain the datamark. A forbidden capability triple cannot be
  constructed. Those are the things the tests assert, and none of them is a claim about a
  model's behaviour.

THE FOUR PIECES

  1. `render_untrusted(chunks) -> (token, text)`  —  `untrusted.py`
     §13.6(a)'s four steps: strip control/invisible characters, strip tag-ish sequences,
     strip datamark-shaped sequences from the source, interleave a fresh per-request datamark
     at every whitespace gap (Hines et al., arXiv 2403.14720). The orders are load-bearing in
     two places and both are argued where they are implemented. Emits
     `<untrusted_document paper_id=… block_id=… page=… channel=… trust="untrusted">`.

  2. `build_system_prompt(*, datamark, caps) -> str`  —  `system.py`
     The instruction hierarchy stated explicitly (Wallace et al., arXiv 2404.13208), §13.6(a)'s
     text kept close to verbatim, plus the turn's capability triple and toolset. It has no
     parameter through which document text could reach the top of the hierarchy.

  3. `TurnCaps` / `TOOLSETS` / `toolset_for`  —  `caps.py`
     The Rule of Two "enforced in code, not in review" (§13.6(b)). `TurnCaps(True, True,
     True)` raises `RuleOfTwoViolation` during construction, so the forbidden turn has no
     representation and `toolset_for` needs no error branch.

  4. `advisory_injection_signals(text, *, channel)`  —  `advisory.py`
     §13.6(c), fail-open and advisory. Nothing else in this package imports it, and a test
     audits every sibling module's AST to keep it that way.

  Plus `channels.py`, which answers whether a piece of text's ORIGIN may carry authority.
  `HIGH_PRIVILEGE_CHANNELS` is `{"text_layer", "toc"}`; metadata and every `*_ocr` channel are
  denied before the membership test is even reached, so a future edit that adds an OCR channel
  to the allow-list still does not grant it privilege.

WHAT THIS PACKAGE DELIBERATELY DOES NOT DO
  - It does not decide anything. It does not drop a low-privilege chunk, refuse to render a
    flagged one, or pick a toolset. It reports (`low_privilege_channels`, `is_high_privilege`,
    `advisory_injection_signals`) and enforces the one thing that is unconditional (the Rule
    of Two). Policy differs between a QA turn, an ingest pass and a memory proposal, and a
    policy baked in here would be a policy those three call sites route around.
  - It has no dependency, not even on `papertree_document_ir`. The consequence is stated
    rather than hidden: it cannot verify that `UntrustedChunk.text` came from
    `resolved_text(block, apply_proposed=False)` rather than from a hand-rolled concatenation
    of `text` and `repairs` (deviation D4). That obligation is the caller's.
  - It does not detect invisible-render attacks (`Tr 3`, sub-point font sizes, fill colour
    within dE 5 of the background). Those need the PDF's graphics state and belong to
    `services/document-worker`.

THE COST, MEASURED, BECAUSE F3.2 HAS TO BUDGET AGAINST IT
  Datamarking every whitespace gap is not free, and the cost is not one number. Measured in
  `tests/test_untrusted.py`: a 131-character sentence renders to 506 characters (3.86x), a
  25-character caption to 240 (9.60x). The difference is a flat 165-character wrapper per
  chunk that dominates small blocks. The evidence-package budget must be computed on
  RENDERED length PER CHUNK; an average expansion factor applied to raw block text overruns
  a token ceiling on caption-heavy evidence with no error raised anywhere.

RESIDUAL RISK THIS PACKAGE DOES NOT CLOSE
  Spotlighting's headline numbers (>50% ASR to <2%) are Microsoft-authored, self-reported,
  GPT-family, March 2024, unreplicated, and predate adaptive-attack results (§13.8). Assume
  they degrade. Nothing here is sized as though they hold. Semicolon-less HTML entities
  (`&lt` with no `;`) survive sanitisation by choice — the argument, and where they are
  actually contained, is in `sanitise.py`.
"""

from __future__ import annotations

from .advisory import (
    ADVISORY_RULES,
    EXCERPT_LIMIT,
    RULE_BASE64,
    RULE_CHANNEL_ANOMALY,
    RULE_CONTROL_CHARS,
    RULE_HOMOGLYPH,
    RULE_IMPERATIVE,
    AdvisorySignal,
    advisory_injection_signals,
)
from .caps import (
    TOOLSETS,
    CapabilityTriple,
    RuleOfTwoViolation,
    Toolset,
    TurnCaps,
    toolset_for,
)
from .channels import (
    HIGH_PRIVILEGE_CHANNELS,
    KNOWN_CHANNELS,
    NEVER_HIGH_PRIVILEGE,
    NEVER_HIGH_PRIVILEGE_SUFFIXES,
    is_high_privilege_channel,
    is_valid_channel,
    low_privilege_channels,
)
from .sanitise import CONTROL_AND_INVISIBLE, TAGISH, sanitise
from .system import SYSTEM_PROMPT_VERSION, build_system_prompt, prompt_hash
from .untrusted import (
    DATAMARK_ENTROPY_BYTES,
    DATAMARK_PATTERN,
    OPEN_TAG_NAME,
    RenderedUntrusted,
    UntrustedChunk,
    UntrustedRenderError,
    is_datamark,
    mint_datamark,
    render_untrusted,
    render_untrusted_with_datamark,
)

__all__ = [
    "ADVISORY_RULES",
    "CONTROL_AND_INVISIBLE",
    "DATAMARK_ENTROPY_BYTES",
    "DATAMARK_PATTERN",
    "EXCERPT_LIMIT",
    "HIGH_PRIVILEGE_CHANNELS",
    "KNOWN_CHANNELS",
    "NEVER_HIGH_PRIVILEGE",
    "NEVER_HIGH_PRIVILEGE_SUFFIXES",
    "OPEN_TAG_NAME",
    "RULE_BASE64",
    "RULE_CHANNEL_ANOMALY",
    "RULE_CONTROL_CHARS",
    "RULE_HOMOGLYPH",
    "RULE_IMPERATIVE",
    "SYSTEM_PROMPT_VERSION",
    "TAGISH",
    "TOOLSETS",
    "AdvisorySignal",
    "CapabilityTriple",
    "RenderedUntrusted",
    "RuleOfTwoViolation",
    "Toolset",
    "TurnCaps",
    "UntrustedChunk",
    "UntrustedRenderError",
    "advisory_injection_signals",
    "build_system_prompt",
    "is_datamark",
    "is_high_privilege_channel",
    "is_valid_channel",
    "low_privilege_channels",
    "mint_datamark",
    "prompt_hash",
    "render_untrusted",
    "render_untrusted_with_datamark",
    "sanitise",
    "toolset_for",
]
