"""What a board ask sends: the path from the root passage to the card asked from.

v0.3 #343, spec §1 rule 5: never the thread's stored state and never a sibling branch.

    root passage ── answer ── answer ── (the card asked from) ── the new question

* The root passage is the seed anchor (``paper`` decides how much of the paper comes with it).
* Every ancestor answer is a turn: its question, then its answer. The parent's and the
  grandparent's turns go IN FULL; older ones go as their TL;DR line, or the first sentence when the
  answer has no TL;DR (``Turn.full``).
* The agent reads the turns as its own conversation (``history_entries``): synthetic Pi message
  entries, user and assistant alternating, so the new question is a follow-up. Answers are sent
  without their ``[bN]`` handles (those named passages of another run) and without their diagram
  and check fences (noise to the model).
* The selected words and any cards the user attached ride in the new question
  (``compose_question``): the words are the parent answer's own, an attached passage is paper text
  and is datamarked and wrapped as untrusted, exactly like the root quote.

Pure functions over rows already read: no database, no I/O, so every rule has a plain test.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

from papertree_db import NodeAnswer, NodeRow
from papertree_prompts import datamark_text

from . import evidence

#: Turns this close to the new question (the parent and its parent) are sent in full.
FULL_TURNS: Final = 2
MAX_QUESTION_CHARS: Final = 2000
MAX_DEPTH: Final = 256
ATTACHED_PASSAGE_CHARS: Final = 600
DEFAULT_FIRST_QUESTION: Final = "Explain this passage."
_MARKER: Final = re.compile(r"\s*\[b\d+(?:\s*,\s*b\d+)*\]")
_FENCE: Final = re.compile(
    r"^```(?:diagram|check)[^\n]*\n.*?^```[ \t]*\n?", re.MULTILINE | re.DOTALL
)
_TLDR: Final = re.compile(r"^##\s*TL;DR[ \t]*\n+(.*?)(?=^##\s|\Z)", re.MULTILINE | re.DOTALL | re.I)
_SENTENCE_END: Final = re.compile(r"(?<=[.!?])\s+")
_TL_DR_MAX: Final = 400


@dataclass(frozen=True, slots=True)
class Turn:
    """One answer of the path: what was asked, what the answer said, and how much of it goes."""

    node_id: str
    question: str
    answer: str
    full: bool


@dataclass(frozen=True, slots=True)
class PathPlan:
    """The path to a card: its root, the anchor and words the seed is built from, the turns."""

    chain: tuple[str, ...]  # node ids, root first, the card asked from last
    root_id: str
    root_anchor: Mapping[str, Any] | None
    root_quote: str
    turns: tuple[Turn, ...]


def unmarked(text: str) -> str:
    """An answer without its handles and its diagram and check fences.

    The ``[bN]`` handles named passages of another run; the rest of the Markdown is kept.
    """
    out = _FENCE.sub("", text + ("\n" if not text.endswith("\n") else ""))
    out = _MARKER.sub("", out)
    return re.sub(r"[ \t]+([.,;:!?])", r"\1", out).strip()


_MATHS: Final = re.compile(r"\$[^$\n]*\$")
_MARKS: Final = re.compile(r"[*_`]")
_HASHES: Final = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]+", re.MULTILINE)


def plain_words(quote: str) -> str:
    """A span's quote (the exact Markdown source between its offsets) as the words a reader sees.

    Handles, ``$maths$``, heading hashes and the ``*``/``_``/backtick marks are left out and runs of
    whitespace (a paragraph break included) become one space: the TS twin is ``spanWords``
    (``spans.ts``; it keeps the space that stood before a handle, this one does not).
    """
    text = _MARKS.sub("", _MATHS.sub("", _MARKER.sub("", _HASHES.sub("", quote))))
    return " ".join(text.split())


def tldr(text: str) -> str:
    """The TL;DR line of a tutor answer, else its first sentence (what an older ancestor sends)."""
    plain = unmarked(text)
    match = _TLDR.search(plain)
    if match is not None and match.group(1).strip():
        return " ".join(match.group(1).split())[:_TL_DR_MAX]
    body = re.sub(r"^#+\s.*$", "", plain, flags=re.MULTILINE).strip()
    first = _SENTENCE_END.split(" ".join(body.split()), maxsplit=1)[0] if body else ""
    return first[:_TL_DR_MAX]


def _quote_of(node: NodeRow) -> str:
    anchor = node.source_anchor
    quote = evidence.anchor_quote(anchor) if anchor is not None else ""
    return quote or node.body


def build_path(
    nodes: Mapping[str, NodeRow],
    answers: Mapping[str, NodeAnswer],
    start_id: str,
    *,
    path: bool = True,
) -> PathPlan:
    """The path from the root above ``start_id`` down to ``start_id`` (the card asked from).

    The root is the top of the ``parent_id`` chain: a passage (its anchor seeds the run), or a v0.2
    answer card with no parent (its thread's own anchor does, and it is the first turn). ``path``
    false keeps the root's words and the card asked from (its question and answer): no turns
    between them.
    """
    chain: list[str] = []
    seen: set[str] = set()
    current: NodeRow | None = nodes.get(start_id)
    while current is not None and current.node_id not in seen and len(chain) < MAX_DEPTH:
        seen.add(current.node_id)
        chain.append(current.node_id)
        current = nodes.get(current.parent_id) if current.parent_id is not None else None
    chain.reverse()
    root = nodes[chain[0]]
    anchor: Mapping[str, Any] | None = None
    quote = ""
    if root.kind == "excerpt":
        anchor, quote = root.source_anchor, _quote_of(root)
    else:
        origin = answers[root.node_id].origin_anchor if root.node_id in answers else None
        if origin is not None:
            anchor, quote = origin, evidence.anchor_quote(origin)
    answered: list[tuple[str, str, str]] = []
    for node_id in chain:
        node = nodes[node_id]
        if node.kind != "explanation" or node_id not in answers:
            continue
        got = answers[node_id]
        question = node.question or got.asked or DEFAULT_FIRST_QUESTION
        answered.append((node_id, question, got.final_text))
    if not path:
        # Only the card asked from (its Q and A); the root passage rides on the first turn.
        answered = [turn for turn in answered if turn[0] == chain[-1]]
    turns = tuple(
        Turn(node_id, question, answer, full=position >= len(answered) - FULL_TURNS)
        for position, (node_id, question, answer) in enumerate(answered)
    )
    return PathPlan(tuple(chain), chain[0], anchor, quote, turns)


def untrusted(text: str, datamark: str) -> str:
    """Paper text inside the untrusted delimiter, datamarked: the TS twin is ``untrustedQuote``."""
    body = datamark_text(text.replace("<", "‹").replace(">", "›"), datamark=datamark)
    return f'<untrusted_document trust="untrusted">\n{body}\n</untrusted_document>'


def _entry(parent: str | None, message: dict[str, Any], moment: datetime) -> dict[str, Any]:
    return {
        "type": "message",
        "id": uuid.uuid4().hex[:8],
        "parentId": parent,
        "timestamp": moment.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "message": message,
    }


_ZERO_COST: Final = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}


def history_entries(
    plan: PathPlan, datamark: str, *, now: datetime | None = None
) -> list[dict[str, Any]]:
    """The path as the conversation the agent resumes: ``[]`` when there are no ancestor turns.

    The first user entry carries the root passage (untrusted, datamarked) after the first question.
    Pi's ``history.entries`` rule (contract.ts ``historyProblem``): message entries only, each one's
    ``parentId`` the previous one's ``id``.
    """
    if not plan.turns:
        return []
    moment = now or datetime.now(UTC)
    stamp = int(moment.timestamp() * 1000)
    entries: list[dict[str, Any]] = []
    previous: str | None = None
    for position, turn in enumerate(plan.turns):
        question = turn.question
        if position == 0 and plan.root_quote:
            question = f"{question}\n\n{untrusted(plan.root_quote, datamark)}"
        answer = unmarked(turn.answer) if turn.full else tldr(turn.answer)
        for message in (
            {"role": "user", "content": [{"type": "text", "text": question}], "timestamp": stamp},
            {
                "role": "assistant",
                "content": [{"type": "text", "text": answer or "(no answer)"}],
                "api": "anthropic-messages",
                "provider": "minimax",
                "model": "MiniMax-M3.1-Flash",
                "usage": {
                    "input": 0,
                    "output": 0,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "totalTokens": 0,
                    "cost": dict(_ZERO_COST),
                },
                "stopReason": "stop",
                "timestamp": stamp,
            },
        ):
            entry = _entry(previous, message, moment)
            entries.append(entry)
            previous = entry["id"]
    return entries


def attached_text(
    nodes: Mapping[str, NodeRow], answers: Mapping[str, NodeAnswer], node_id: str, datamark: str
) -> str:
    """One card the user attached (``uses.extra_node_ids``) as text for the new question.

    Their own note as written, an answer as its question and TL;DR, a passage as untrusted text.
    """
    node = nodes[node_id]
    if node.kind == "note":
        return f"Note: {node.body.strip()}"
    if node.kind == "excerpt":
        return f"Passage:\n{untrusted(_quote_of(node)[:ATTACHED_PASSAGE_CHARS], datamark)}"
    if node.kind == "explanation" and node_id in answers:
        question = node.question or answers[node_id].asked or DEFAULT_FIRST_QUESTION
        return f'Answer to "{question}": {tldr(answers[node_id].final_text)}'
    return f"Card: {(node.title or node.body).strip()}"


def compose_question(question: str, span_quote: str | None, attached: Sequence[str]) -> str:
    """The new question as the agent reads it, within its 2,000-character limit.

    What was typed, then the selected words, then the attached cards. The typed question always
    stays; a card that would not fit WHOLE is left out (never cut, so an untrusted wrapper cannot
    lose its closing tag).
    """
    out = question[:MAX_QUESTION_CHARS]
    blocks: list[str] = []
    words = plain_words(span_quote) if span_quote else ""
    if words:
        quote = words if len(words) <= 400 else words[:399] + "…"
        blocks.append(f'About these words of your last answer: "{quote}"')
    blocks.extend(attached)
    if attached:
        blocks.insert(len(blocks) - len(attached), "Cards I attached:")
    for block in blocks:
        if len(out) + 2 + len(block) <= MAX_QUESTION_CHARS:
            out += "\n\n" + block
    return out
