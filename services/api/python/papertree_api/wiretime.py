"""The ONE time shape on the wire (contracts.md §0): `2026-09-25T15:09:25.123Z`.

UTC, millisecond precision, `Z`. Storage is NOT this shape and is not changed: `packages/db` and
`packages/jobs` stamp `datetime.isoformat()` (`…274228+00:00`), `security.py` stamps seconds with a
`Z`, the worker stamps milliseconds with a `Z`, and a legacy 0001 row keeps what its runner wrote.
So the shape is made on the way OUT, here: the highlight routes (wave 1's `_wire_time`, moved
here) and the log lines' `ts`.
"""

from __future__ import annotations

from datetime import UTC, datetime


def wire_time(stored: str) -> str:
    """A stored time in §0's shape.

    Every writer in this repo stamps UTC, so a time without an offset is read as UTC. A value that
    is not a time at all is returned as stored: listing a user's highlights must not fail over a
    timestamp (wave 1's rule, pinned by `test_highlight_times_on_the_wire_are_the_contract_shape`).
    """
    try:
        moment = datetime.fromisoformat(stored)
    except (TypeError, ValueError):
        return stored
    return format_moment(moment)


def format_moment(moment: datetime) -> str:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    moment = moment.astimezone(UTC)
    return f"{moment:%Y-%m-%dT%H:%M:%S}.{moment.microsecond // 1000:03d}Z"


def now_wire() -> str:
    return format_moment(datetime.now(UTC))
