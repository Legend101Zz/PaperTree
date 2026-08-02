"""Channels: where a piece of text came from, and whether that origin may carry authority.

A CHANNEL IS NOT A FORMAT, IT IS A PROVENANCE CLAIM. `research/synthesis-13-memory.md`
§13.6(c) draws one line through every string a PDF can yield: text the author wrote into
the body of the paper, and everything else. "Everything else" is `/Title`, `/Author`,
`/Keywords`, XMP packets, annotations, form fields, JavaScript actions, alt text, and every
kind of OCR or VLM reading of a rendered region. Those are display and search material. The
brief's wording is exact and worth keeping: such a channel "is display/search only — never
enters a high-privilege context".

WHY THIS IS A SEPARATE CONCEPT FROM `Block.source`
  PaperIR's `Block.source` is a CLOSED four-value vocabulary — `pdf_text_layer`,
  `pdf_vector`, `pdf_raster`, `ocr` — and it answers "how were these characters obtained",
  which is a parsing question. `channel` answers "may this text be treated as the author
  speaking", which is a trust question. They are correlated and they are not the same: a
  `/Title` string and a body paragraph can both be `pdf_text_layer`, and exactly one of them
  is the author addressing the reader. Collapsing the two would put document metadata — the
  single easiest field in a PDF for an attacker to write — on the same footing as the body.

THE VOCABULARY IS OPEN, THE PRIVILEGE SET IS CLOSED
  Channel strings follow the repo-wide open-vocabulary rule that governs `Block.type` and
  `Relation.type`: any string matching `^[a-z][a-z0-9_]{0,63}$` is a valid channel, and a
  channel this module has never heard of must be renderable rather than dropped. What is
  emphatically NOT open is privilege. `HIGH_PRIVILEGE_CHANNELS` has two members and an
  unknown channel is not one of them, so the failure mode of an unrecognised channel is
  "treated as untrustworthy", never "treated as body text".

THE DENY LIST IS CHECKED FIRST, AND THAT ORDER IS THE POINT
  `is_high_privilege_channel` could be one `in` test. It is not, because the property being
  protected is not "today's set is right" but "no future edit to the set can make an OCR
  channel authoritative". Someone adding `figure_ocr` to `HIGH_PRIVILEGE_CHANNELS` — to fix
  a citation that would not resolve, in a hurry, six months from now — is a plausible
  change that looks correct in review. The suffix and exact-name denials run BEFORE the
  membership test, so that edit produces a channel that is in the set and still returns
  False. `tests/test_channels.py::test_adding_an_ocr_channel_to_the_allow_list_does_not_
  grant_it_privilege` monkeypatches the set to contain `figure_ocr` and asserts False, which
  is a test of the ordering rather than of the current membership.

WHAT THIS MODULE DOES *NOT* DO
  It does not refuse to render low-privilege content, and `render_untrusted` does not
  consult it. §13.6(c)'s rule is about privilege, not about visibility: a user who asks what
  the PDF's title metadata says is entitled to an answer. The mechanism is that
  `render_untrusted` stamps `channel="…"` on every wrapper so the model can see the origin,
  and `low_privilege_channels` hands the caller the same fact in a form it can branch on
  before deciding a toolset. Deciding is the caller's job; this module only reports.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Final, Protocol

#: The identifier shape shared with PaperIR's open vocabularies (`Block.type`, `Relation.type`).
CHANNEL_PATTERN: Final = re.compile(r"[a-z][a-z0-9_]{0,63}")

#: §13.6(a), verbatim: `HIGH_PRIVILEGE_CHANNELS = {"text_layer", "toc"}`.
#: The author's own body text, and the document's own table of contents. Nothing else.
HIGH_PRIVILEGE_CHANNELS: Final = frozenset({"text_layer", "toc"})

#: Channel names that may never be high-privilege whatever `HIGH_PRIVILEGE_CHANNELS` says.
#: `metadata` is named explicitly in the task brief and in §13.6(c)'s channel-anomaly rule.
NEVER_HIGH_PRIVILEGE: Final = frozenset({"metadata", "xmp", "annotation", "form_field", "alt_text"})

#: Suffixes that may never be high-privilege. `*_ocr` covers `figure_ocr`, `page_ocr`,
#: `table_ocr` and any future reading of a rendered region — §13.6(c)'s last row, where a
#: VLM transcribes a figure crop and the transcription is attacker-drawn pixels.
NEVER_HIGH_PRIVILEGE_SUFFIXES: Final = ("_ocr",)

#: Known channels, for documentation and for callers that want to spell one without a typo.
#: NOT a validation set — the vocabulary is open, and an unknown channel is legal and unprivileged.
KNOWN_CHANNELS: Final = frozenset(
    {
        "text_layer",
        "toc",
        "metadata",
        "xmp",
        "annotation",
        "form_field",
        "js_action",
        "alt_text",
        "attachment",
        "figure_ocr",
        "page_ocr",
        "table_ocr",
    }
)


class HasChannel(Protocol):
    """Anything carrying a channel. `UntrustedChunk` satisfies it; so may a caller's own row."""

    @property
    def channel(self) -> str: ...


def is_valid_channel(channel: str) -> bool:
    """True when `channel` matches the open-vocabulary identifier shape."""
    return CHANNEL_PATTERN.fullmatch(channel) is not None


def is_high_privilege_channel(channel: str) -> bool:
    """True only for a channel that may be treated as the paper's author speaking.

    Fails closed on every uncertainty: a malformed channel, an unknown channel and a
    denied channel all return False. See the module docstring for why the two denials are
    evaluated before the membership test rather than after it.
    """
    if not is_valid_channel(channel):
        return False
    if channel in NEVER_HIGH_PRIVILEGE:
        return False
    if channel.endswith(NEVER_HIGH_PRIVILEGE_SUFFIXES):
        return False
    return channel in HIGH_PRIVILEGE_CHANNELS


def low_privilege_channels(items: Iterable[HasChannel]) -> tuple[str, ...]:
    """The distinct non-high-privilege channels present, sorted; empty when there are none.

    This is the fact a caller needs in order to obey §13.6(c) — "never enters a
    high-privilege context" — and it is returned rather than acted on because the action
    (drop the chunk, demote the toolset, banner the paper) belongs to the turn's policy and
    differs between a QA turn and an ingest pass. Sorted so a log line is stable.
    """
    return tuple(sorted({i.channel for i in items if not is_high_privilege_channel(i.channel)}))
