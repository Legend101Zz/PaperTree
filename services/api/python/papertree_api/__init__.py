"""PaperTree's HTTP transport: PaperIR over the wire, owner-scoped, on top of packages/db.

    uv run python -m papertree_api            # the API (PAPERTREE_HOST / PAPERTREE_PORT)
    uv run python -m papertree_api.worker     # the parse worker, beside it, same data root

The ingest loop (contracts.md §2.2): `POST /papers` stores the bytes, lists the paper and enqueues a
parse job; the worker runs it as three durable steps (`parse -> persist -> promote`); the library
(`GET /papers`) shows it queued, reading (step n of 3), then ready, partial or failed; the reader
gets `/file` at once and `/ir` (gzip, crop URIs signed, §2.3) once a generation is promoted.

`OwnerId` never crosses the wire. See `deps.py` for the mechanism and #74 for the requirement.
"""

from .app import create_app
from .settings import Settings

__all__ = ["Settings", "create_app"]
