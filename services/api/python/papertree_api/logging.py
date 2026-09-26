"""One JSON line per event on stdout (contracts.md §8, journey E).

    {"ts": "…Z", "level": "info", "service": "api", "event": "http.request",
     "request_id": "req_…", "method": "GET", "route": "/papers/{paper_id}", "status": 200,
     "ms": 3.1, "user_ref": "9f86d081884c"}

WHAT CAN BE LOGGED IS AN ALLOWLIST (`FIELDS`), and `log_event` refuses any other keyword. The rule
is "keys, emails and tokens are never logged", and the only way to make that true of every future
call is to make the logger unable to accept them: there is no `email=`, no `token=`, no free-form
`message=` for one to hide in. A user is `user_ref = sha256(user_id)[:12]`, never the id or email.
A route is its TEMPLATE (`/papers/{paper_id}`), never the concrete path, and never the query string,
which is where a signed asset URL carries its `sig=` (contracts.md §2.3).

The module is `papertree_api.logging`; `import logging` elsewhere in the package still means the
standard library (absolute imports), and this module does not use it: stdout JSON lines need no
handler graph.
"""

from __future__ import annotations

import hashlib
import json
import sys
from typing import Final, Literal

from .wiretime import now_wire

SERVICE: Final = "api"

Level = Literal["debug", "info", "warning", "error"]

#: contracts.md §8's fields, plus `method` (beside `route`), and `error_type` / `where` for
#: `http.error` (an exception's class and `file:function:line`, never its message). S5 adds the
#: run record's numbers for `run.done` (the agent's `agent.run.done` carries the same: §8) and
#: `marker` (a `bN` handle, never text) for `run.citation_dropped`, and `tool` for `internal.tool`.
FIELDS: Final = frozenset(
    {
        "kind",
        "stop_reason",
        "input_tokens",
        "output_tokens",
        "cost_usd_est",
        "retries",
        "tool_calls",
        "first_text_ms",
        "marker",
        "tool",
        "request_id",
        "run_id",
        "job_id",
        "paper_id",
        "user_ref",
        "route",
        "method",
        "status",
        "ms",
        "code_path",
        "provider",
        "model",
        "error_code",
        "error_type",
        "where",
    }
)

LogValue = str | int | float | bool | None


def user_ref(user_id: str) -> str:
    """contracts.md §8: `sha256(user_id)[:12]`. Joinable across services, not reversible."""
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:12]


def log_event(event: str, *, level: Level = "info", **fields: LogValue) -> None:
    """Writes one JSON line. `None` values are omitted. An unknown field is a `TypeError`: see
    the module docstring for why that is a feature."""
    unknown = set(fields) - FIELDS
    if unknown:
        raise TypeError(f"log_event: fields outside the §8 allowlist: {sorted(unknown)}")
    record: dict[str, LogValue] = {
        "ts": now_wire(),
        "level": level,
        "service": SERVICE,
        "event": event,
    }
    record.update((key, value) for key, value in fields.items() if value is not None)
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()
