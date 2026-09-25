"""`python -m papertree_api` — the dev server.

A separate module from `__init__` so importing the package (which every test does) does not import
uvicorn, and so `create_app()` stays callable without a server.
"""

from __future__ import annotations

import os

import uvicorn

from .app import create_app


def main() -> None:
    uvicorn.run(
        create_app(),
        host=os.environ.get("PAPERTREE_HOST", "127.0.0.1"),
        port=int(os.environ.get("PAPERTREE_PORT", "8000")),
        # The app writes its own `http.request` JSON line per request (contracts.md §8). Uvicorn's
        # access log is a second, non-JSON line per request on the same stdout.
        access_log=False,
    )


if __name__ == "__main__":
    main()
