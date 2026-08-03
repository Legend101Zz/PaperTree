"""``ToolResult`` — the one shape every tool returns, and the reason it has five statuses.

THE PROBLEM THIS TYPE EXISTS TO MAKE UNREPRESENTABLE

Issue #66 records a live parse of the corpus on 2026-08-02. Three of the numbers in it decide
the design of this module:

    prev_id / next_id                        0 of 974 blocks populated
    relations of type cites / references     0 emitted, ever
    equation.payload.referenced_by           0 populated
    block_vectors                            0 rows; Epic 0 computes no embeddings

``cites`` MOVED on 2026-08-03: the parser now emits it, 525 edges over the 8-paper corpus. The
row above is kept because it is what this type was designed against and because it is still true
of every paper parsed before that date — relations are written at parse time, so an old document
has none. ``references``, ``prev_id``/``next_id``, ``referenced_by`` and ``block_vectors`` are
unchanged, and even a freshly parsed author-year paper resolves only about a third of its markers.

So ``search_semantic_blocks`` returns nothing on every real paper, ``get_equation``'s
``referenced_by`` is empty on every equation, and ``resolve_citation`` returns nothing on any
paper stored before #66. **A tool that returned a
bare ``[]`` for those would be telling the model something false**: an empty list, in a tool
result, reads as "I looked, and there are none". The truth is "the parser never emits this, so I
cannot look". A model that receives the first will confidently answer "this equation is not
referenced anywhere in the paper" — a fabrication produced by an honest-looking empty list, and
the exact failure mode EPIC-03 §11.4 is written against.

So every non-``ok`` status carries a REQUIRED, non-empty ``reason``, enforced in
``__post_init__``. A result that cannot answer and does not say why is not constructible. That
is a stronger guarantee than a convention and it costs one ``if``.

THE FIVE STATUSES, AND WHY EACH IS A DIFFERENT FACT

    ok           the tool answered.
    empty        the tool ran, the arguments named real things, and the answer is genuinely
                 nothing. ``reason`` says WHY it is nothing — "this paper generation has 0
                 bibliography entries" is a different world from "no entry is labelled [41]".
    not_found    the arguments named something that does not exist in this paper generation.
                 A typo'd ``block_id`` must not look like an empty section.
    unavailable  the CAPABILITY is not reachable from what exists. Nothing the caller can pass
                 would change the answer. ``crop_pdf_region`` is permanently here: the database
                 stores crop URIs, not bytes, and an agent tool has no filesystem.
    refused      the tool ran and declines to emit output because a precondition it is
                 responsible for upholding failed — ``save_user_note`` with a quote that is not
                 verbatim at those offsets. Not an error in the caller's arguments (they were
                 well-formed) and not an absence in the data.

``data`` IS ALLOWED TO BE NON-EMPTY ON A NON-OK RESULT, and that is deliberate.
``crop_pdf_region`` is ``unavailable`` and still returns the page index, the bbox and the
coordinate space — everything the PRIVILEGED runtime would need to render the crop itself. An
unavailable tool that also throws away the address it resolved makes the caller do the lookup
twice. The status is the machine-readable truth; ``data`` is what survives it.

WHY NOT AN EXCEPTION FOR THE UNHAPPY PATHS
    Same argument ``MemoryStore.create_proposal`` makes about rejections: the unhappy answer is
    the artefact somebody wants to read. A tool result goes back to a model, and a model cannot
    read a traceback — it reads the string. Raising would also mean the runtime adapter decides
    the wording, which puts the honesty guarantee in the layer this package does not own.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

__all__ = ["ToolResult", "ToolStatus"]


class ToolStatus(StrEnum):
    """What happened. See the module docstring for why there are five and not two."""

    OK = "ok"
    EMPTY = "empty"
    NOT_FOUND = "not_found"
    UNAVAILABLE = "unavailable"
    REFUSED = "refused"


@dataclass(frozen=True, slots=True)
class ToolResult:
    """One tool call's answer, in the shape that goes back to the model.

    Frozen because a result is a statement about a read that already happened; a runtime that
    could edit one after the fact could edit the ``reason``, which is the field the whole
    honesty argument rests on.
    """

    tool: str
    status: ToolStatus
    data: Mapping[str, Any] = field(default_factory=dict)
    #: Empty ONLY when ``status is OK``. Enforced below, not documented and hoped for.
    reason: str = ""

    def __post_init__(self) -> None:
        if self.status is not ToolStatus.OK and not self.reason.strip():
            raise ValueError(
                f"{self.tool}: a {self.status.value!r} result must carry a reason. An empty "
                "answer with no stated cause is indistinguishable, to the model reading it, "
                "from 'I looked and there are none' — see results.py's module docstring."
            )
        if self.status is ToolStatus.OK and self.reason:
            raise ValueError(
                f"{self.tool}: an 'ok' result must not carry a reason. Notes about the answer "
                "belong in data['notes'], where they are attached to the thing they qualify."
            )

    @property
    def ok(self) -> bool:
        return self.status is ToolStatus.OK

    def as_dict(self) -> dict[str, Any]:
        """The JSON object the runtime hands the model. Key order is fixed, so logs diff."""
        return {
            "tool": self.tool,
            "status": self.status.value,
            "reason": self.reason,
            "data": dict(self.data),
        }
