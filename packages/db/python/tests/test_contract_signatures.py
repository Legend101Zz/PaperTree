"""contracts.md §1.1, pinned: the method names and parameter lists S0 fixed for every later slice.

S1, S4, S5 and S7 each fill in one mixin. They may implement a stub; they may not change its
signature without a contracts PR (contracts.md header). This file is what makes that checkable:

  * ``CONTRACT`` is §1.1's table transcribed — parameter names, order, and where the ``*`` falls.
    A slice that renames, reorders or drops a parameter turns this red.
  * ``STILL_STUBS`` is a LEDGER, enforced in both directions like ``KNOWN_CONSTANT_COPIES``: every
    method listed must still raise ``NotImplementedError``, and every method that raises it must be
    listed. The slice that implements a method deletes its line here, in the same PR.

The parameters of the methods §1.1 only NAMES (``create_thread`` and its four siblings, the canvas
methods other than ``patch_node``) are S0's proposal and are pinned in ``PROPOSED`` for the same
reason, with the understanding that their owning slice may change them there.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any

import pytest
from papertree_db import PaperTreeDb

#: contracts.md §1.1, verbatim. "*" marks the start of keyword-only parameters.
CONTRACT: dict[str, list[str]] = {
    # library.py (S1)
    "register_upload": [
        "owner",
        "paper_id",
        "source_hash",
        "original_filename",
        "byte_size",
        "page_count",
    ],
    "set_latest_job": ["owner", "paper_id", "job_id"],
    "next_generation": ["owner", "paper_id"],
    "list_library": ["owner"],
    # ai.py (S5)
    "create_run": [
        "owner",
        "*",
        "run_id",
        "paper_id",
        "generation",
        "kind",
        "thread_id",
        "message_id",
        "token_sha256",
        "datamark",
        "expires_at",
        "code_path",
        "request_id",
        "prompt_version",
    ],
    "finish_run": ["owner", "run_id", "**usage"],
    "put_run_handles": ["owner", "run_id", "generation", "pairs"],
    "run_grant": ["run_id", "token_sha256"],
    "cost_since": ["owner", "since"],
    "usage_since": ["owner", "since"],
    "get_summary": ["owner", "paper_id", "generation", "prompt_hash", "model_id"],
    # canvas.py (S7)
    "get_board": ["owner", "paper_id"],
    "create_node": ["owner", "paper_id", "node"],
    "patch_node": ["owner", "board_id", "node_id", "version", "fields"],
}

#: Named in §1.1 without parameters; these are S0's proposal (see each module's docstring).
PROPOSED: dict[str, list[str]] = {
    "create_thread": ["owner", "paper_id", "*", "thread_id", "kind", "title", "origin_anchor"],
    "append_message": [
        "owner",
        "thread_id",
        "*",
        "message_id",
        "role",
        "generation",
        "content",
        "status",
        "run_id",
    ],
    "update_message": [
        "owner",
        "message_id",
        "*",
        "content",
        "status",
        "error_code",
        "completed_at",
    ],
    "list_threads": ["owner", "paper_id"],
    "get_thread": ["owner", "paper_id", "thread_id"],
    "delete_node": ["owner", "board_id", "node_id"],
    "create_edge": ["owner", "board_id", "edge"],
    "patch_edge": ["owner", "board_id", "edge_id", "fields"],
    "delete_edge": ["owner", "board_id", "edge_id"],
    "patch_board": ["owner", "board_id", "fields"],
}

#: THE LEDGER. Delete a line in the PR that implements the method.
STILL_STUBS: frozenset[str] = frozenset(
    {
        # S1
        "register_upload",
        "set_latest_job",
        "next_generation",
        "list_library",
        # S5
        "create_thread",
        "append_message",
        "update_message",
        "list_threads",
        "get_thread",
        "create_run",
        "finish_run",
        "put_run_handles",
        "run_grant",
        "cost_since",
        "usage_since",
        "get_summary",
        # S7
        "get_board",
        "create_node",
        "patch_node",
        "delete_node",
        "create_edge",
        "patch_edge",
        "delete_edge",
        "patch_board",
    }
)


def _shape(method: Callable[..., Any]) -> list[str]:
    out: list[str] = []
    for param in list(inspect.signature(method).parameters.values())[1:]:  # drop `self`
        if param.kind is inspect.Parameter.KEYWORD_ONLY and "*" not in out:
            out.append("*")
        out.append(f"**{param.name}" if param.kind is inspect.Parameter.VAR_KEYWORD else param.name)
    return out


@pytest.mark.parametrize("name", sorted({**CONTRACT, **PROPOSED}))
def test_the_signature_is_the_one_s0_fixed(name: str) -> None:
    expected = {**CONTRACT, **PROPOSED}[name]
    method = getattr(PaperTreeDb, name, None)
    assert method is not None, f"PaperTreeDb.{name} is missing"
    assert _shape(method) == expected


def test_the_stub_ledger_is_exact() -> None:
    raising = {
        name
        for name in {**CONTRACT, **PROPOSED}
        if "raise NotImplementedError" in inspect.getsource(getattr(PaperTreeDb, name))
    }
    assert raising == STILL_STUBS, (
        f"implemented but still listed: {sorted(STILL_STUBS - raising)}; "
        f"stubs missing from the ledger: {sorted(raising - STILL_STUBS)}"
    )


@pytest.mark.parametrize("name", sorted(STILL_STUBS))
def test_every_stub_raises_and_names_its_owning_slice(name: str) -> None:
    """Called with placeholders: a stub raises before it reads a single argument."""
    method = getattr(PaperTreeDb, name)
    params = list(inspect.signature(method).parameters.values())[1:]
    positional = [None for p in params if p.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD]
    keywords = {p.name: None for p in params if p.kind is inspect.Parameter.KEYWORD_ONLY}
    with pytest.raises(NotImplementedError, match=r"^S[1-7] implements "):
        method(object.__new__(PaperTreeDb), *positional, **keywords)
