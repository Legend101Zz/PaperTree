"""Channels: privilege fails closed, and the deny list wins over the allow list."""

from __future__ import annotations

import pytest
from papertree_prompts import (
    HIGH_PRIVILEGE_CHANNELS,
    KNOWN_CHANNELS,
    UntrustedChunk,
    is_high_privilege_channel,
    is_valid_channel,
    low_privilege_channels,
)
from papertree_prompts import channels as channels_module


def test_the_high_privilege_set_is_exactly_the_two_the_brief_names() -> None:
    """§13.6(a): `HIGH_PRIVILEGE_CHANNELS = {"text_layer", "toc"}`."""
    assert set(HIGH_PRIVILEGE_CHANNELS) == {"text_layer", "toc"}
    assert is_high_privilege_channel("text_layer")
    assert is_high_privilege_channel("toc")


@pytest.mark.parametrize(
    "channel",
    [
        "metadata",
        "xmp",
        "annotation",
        "form_field",
        "alt_text",
        "figure_ocr",
        "page_ocr",
        "table_ocr",
        "js_action",
        "attachment",
    ],
)
def test_metadata_and_ocr_channels_are_never_high_privilege(channel: str) -> None:
    """The task brief's wording: "metadata and `*_ocr` NEVER qualify"."""
    assert not is_high_privilege_channel(channel)


def test_adding_an_ocr_channel_to_the_allow_list_does_not_grant_it_privilege(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The ordering test, and the reason `is_high_privilege_channel` is not one `in` check.

    The change being simulated is plausible and would look correct in review: six months from
    now a citation to a figure does not resolve, and `figure_ocr` gets added to the allow set
    to fix it. Because the suffix denial runs BEFORE the membership test, the edit produces a
    channel that is in `HIGH_PRIVILEGE_CHANNELS` and still is not privileged.

    Reordering the two checks in `channels.py` makes this test fail and leaves every other
    test in this file passing — which is what makes it a test of the ordering rather than of
    today's membership.
    """
    monkeypatch.setattr(
        channels_module,
        "HIGH_PRIVILEGE_CHANNELS",
        frozenset({"text_layer", "toc", "figure_ocr", "metadata"}),
    )
    assert "figure_ocr" in channels_module.HIGH_PRIVILEGE_CHANNELS  # the edit really took
    assert not is_high_privilege_channel("figure_ocr")
    assert not is_high_privilege_channel("metadata")
    assert is_high_privilege_channel("text_layer")  # non-vacuous: the function still works


def test_an_unknown_channel_is_valid_but_unprivileged() -> None:
    """Open vocabulary, closed privilege. An unrecognised origin fails closed, never open."""
    assert is_valid_channel("holographic_margin_note")
    assert "holographic_margin_note" not in KNOWN_CHANNELS
    assert not is_high_privilege_channel("holographic_margin_note")


@pytest.mark.parametrize(
    "bad", ["Text_Layer", "text layer", "1channel", "", "text-layer", "x" * 65]
)
def test_a_malformed_channel_is_neither_valid_nor_privileged(bad: str) -> None:
    assert not is_valid_channel(bad)
    assert not is_high_privilege_channel(bad)


def test_known_channels_is_documentation_and_not_a_validation_set() -> None:
    """If this were a validation set, an unknown channel would raise instead of being wrapped
    unprivileged — and §13.6(c)'s rule is about privilege, not about visibility."""
    assert HIGH_PRIVILEGE_CHANNELS <= KNOWN_CHANNELS
    assert is_valid_channel("some_future_channel")


def test_low_privilege_channels_reports_the_distinct_offending_origins() -> None:
    chunks = [
        UntrustedChunk(paper_id="p", block_id="b1", page=0, channel="text_layer", text="a"),
        UntrustedChunk(paper_id="p", block_id="b2", page=0, channel="metadata", text="b"),
        UntrustedChunk(paper_id="p", block_id="b3", page=1, channel="figure_ocr", text="c"),
        UntrustedChunk(paper_id="p", block_id="b4", page=1, channel="metadata", text="d"),
        UntrustedChunk(paper_id="p", block_id="b5", page=2, channel="toc", text="e"),
    ]
    assert low_privilege_channels(chunks) == ("figure_ocr", "metadata")


def test_low_privilege_channels_is_empty_when_everything_is_body_text() -> None:
    """Non-vacuous counterpart: the function can return empty, so a non-empty result means
    something."""
    chunks = [
        UntrustedChunk(paper_id="p", block_id="b1", page=0, channel="text_layer", text="a"),
        UntrustedChunk(paper_id="p", block_id="b2", page=0, channel="toc", text="b"),
    ]
    assert low_privilege_channels(chunks) == ()


def test_the_chunk_property_agrees_with_the_free_function() -> None:
    body = UntrustedChunk(paper_id="p", block_id="b", page=0, channel="text_layer", text="x")
    meta = UntrustedChunk(paper_id="p", block_id="b", page=0, channel="metadata", text="x")
    assert body.is_high_privilege
    assert not meta.is_high_privilege
