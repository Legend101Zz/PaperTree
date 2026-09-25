"""papertree_prompts — the datamark layer of the injection defence (EPIC-03 F3.8).

One function wraps untrusted paper content, one mints the per-run datamark, one decides whether a
text's ORIGIN may carry authority. It is stdlib-only and it imports nothing from PaperTree.

WHERE THIS SITS

  The injection defence is structural first: in the reader release the model runs inside
  ``services/agent`` (Pi, ADR-002 §3.4) with four READ-ONLY paper tools and nothing else — no
  filesystem, no shell, no egress but the model — and the tools read through a run token that
  authorises one paper of one user for one run. This package is the second layer: every piece of
  paper text the API hands the agent (the seed passages in ``POST /v1/runs``, every internal tool
  response) is datamarked with the run's own datamark, which ``services/api`` mints here and sends
  in the run request so the agent's system prompt can name it (contracts.md §3.2, §3.4, §4).

  The correctness standard is that every claim is TRUE OF THE OUTPUT BYTES: content cannot contain
  the closing delimiter, content cannot contain the datamark, and every datamark-shaped sequence in
  the output IS the datamark. None of that is a claim about a model's behaviour.

THE PIECES

  1. ``render_untrusted`` / ``render_untrusted_with_datamark``  —  ``untrusted.py``
     §13.6(a)'s four steps: strip control/invisible characters, strip tag-ish sequences, strip
     datamark-shaped sequences from the source, interleave the datamark at every whitespace gap
     (Hines et al., arXiv 2403.14720), inside ``<untrusted_document … trust="untrusted">``.
  2. ``datamark_text``  —  the same four steps without the wrapper, for the run request's seed
     passages, whose record already says they are document text.
  3. ``mint_datamark``  —  one per RUN; stored on ``ai_runs.datamark``.
  4. ``channels.py``  —  whether a text's origin may be treated as the author speaking.
     ``HIGH_PRIVILEGE_CHANNELS`` is ``{"text_layer", "toc"}``; metadata and every ``*_ocr`` channel
     are denied before the membership test is reached.

WHAT LEFT, AND WHY (slice-plan §R R11)

  ``system.py`` (the Python system prompt), ``caps.py`` (the Rule-of-Two capability triple and the
  seven-toolset matrix) and ``advisory.py`` (fail-open injection signals, 0 runtime importers) were
  the Python agent loop's; the loop and its eighteen-tool registry are gone (R10), and the system
  prompt is the agent's (``services/agent``). The Rule of Two is now enforced by construction in
  the agent: its tool allowlist is exactly the four read-only paper tools and boot refuses to start
  otherwise (contracts.md §3.1).

WHAT THIS PACKAGE DELIBERATELY DOES NOT DO
  - It does not decide anything: it does not drop a low-privilege chunk or refuse to render one.
  - It cannot verify that ``UntrustedChunk.text`` came from ``resolved_text(block,
    apply_proposed=False)`` rather than a hand-rolled concatenation of ``text`` and ``repairs``
    (deviation D4). That obligation is the caller's.
  - It does not detect invisible-render attacks (``Tr 3``, sub-point fonts, background-coloured
    fills). Those need the PDF's graphics state.

THE COST, MEASURED (``tests/test_untrusted.py``): a 131-character sentence renders to 506
characters (3.86x), a 25-character caption to 240 (9.60x); the wrapper is a flat 165 characters.
"""

from __future__ import annotations

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
from .untrusted import (
    DATAMARK_ENTROPY_BYTES,
    DATAMARK_PATTERN,
    DATAMARK_SHAPE,
    OPEN_TAG_NAME,
    RenderedUntrusted,
    UntrustedChunk,
    UntrustedRenderError,
    datamark_text,
    is_datamark,
    mint_datamark,
    render_untrusted,
    render_untrusted_with_datamark,
)

__all__ = [
    "CONTROL_AND_INVISIBLE",
    "DATAMARK_ENTROPY_BYTES",
    "DATAMARK_PATTERN",
    "DATAMARK_SHAPE",
    "HIGH_PRIVILEGE_CHANNELS",
    "KNOWN_CHANNELS",
    "NEVER_HIGH_PRIVILEGE",
    "NEVER_HIGH_PRIVILEGE_SUFFIXES",
    "OPEN_TAG_NAME",
    "TAGISH",
    "RenderedUntrusted",
    "UntrustedChunk",
    "UntrustedRenderError",
    "datamark_text",
    "is_datamark",
    "is_high_privilege_channel",
    "is_valid_channel",
    "low_privilege_channels",
    "mint_datamark",
    "render_untrusted",
    "render_untrusted_with_datamark",
    "sanitise",
]
