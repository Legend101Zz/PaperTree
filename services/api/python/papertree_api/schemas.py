"""The wire models: one pydantic model per request and response body in contracts.md §2.

Every model is `strict` (no `"1"` for `1`, no `1.0` for an int) and `extra="forbid"`, so the
exported JSON Schema (`contracts/api/*.schema.json`, `python -m papertree_api.contracts export`)
says `additionalProperties: false` and a client type with a stray or missing field fails
`apps/web/test/contracts.spec.ts`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class Wire(BaseModel):
    """The base of every wire model."""

    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


# ── §2.8 health ──────────────────────────────────────────────────────────────────────────────


class AgentHealth(Wire):
    """What the API learned by asking `GET {PAPERTREE_AGENT_URL}/healthz` (§3.2).

    `reachable` is True only for an HTTP 200 whose body is a JSON object. When it is False the
    other two are null: the API does not know, and saying `key_present: false` would claim it did.
    """

    reachable: bool
    key_present: bool | None
    sdk: str | None


class Healthz(Wire):
    ok: bool
    version: str
    db: str
    migrations: list[int]
    agent: AgentHealth
