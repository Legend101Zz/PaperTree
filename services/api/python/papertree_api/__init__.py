"""PaperTree's HTTP transport: PaperIR over the wire, owner-scoped, on top of packages/db.

    uv run uvicorn papertree_api:app --reload

`OwnerId` never crosses the wire. See `deps.py` for the mechanism and #74 for the requirement.
"""

from .app import create_app
from .settings import Settings

__all__ = ["Settings", "create_app"]
