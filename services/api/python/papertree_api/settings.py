"""Where the four things this service touches on disk live, and how they are configured.

Every path is derived from ONE root so that a developer runs `python -m papertree_api` and gets
a working service, and so that a test gets a `tmp_path` and gets total isolation. The four:

    <root>/papertree.sqlite   the PaperTreeDb + JobStore file. One file, two connections.
    <root>/uploads/           the PDF bytes as received. See below.
    <root>/assets/            figure/equation crops written by the parse pipeline.
    <root>/staging/           the parsed PaperIR JSON between the parse and persist steps.

WHERE PDF BYTES LIVE, because #74 asks for this decision to be made out loud.

`<root>/uploads/<paper_id>.pdf`, on the local filesystem beside the database. Not in SQLite, not
in S3.

The decision is close to forced. `enqueue_parse(store, owner, *, paper_id, source_path,
source_hash)` takes a FILESYSTEM PATH — not bytes, not a URL — and `pipeline.parse_document`
opens it with PyMuPDF, which wants a real file. So the upload route must land the bytes somewhere
openable before it can enqueue anything. Given that, a directory beside the SQLite file is the
choice that matches the project constraint the build plan states first: "SQLite + sqlite-vec, no
Postgres, no Docker requirement for the datastore — `git clone && install && run`." S3 would add a
dependency, a credential and a failure mode to satisfy no requirement anyone has stated.

The name is the PAPER ID rather than the original filename. A filename from an upload is
attacker-controlled and a path-traversal risk; a `paper_id` is minted here from the content hash
and matches `^pap_[0-9A-Za-z]+$`. The original filename is kept as metadata, never as a path.

WHY paper_id IS DERIVED FROM source_hash

`0001_core.sql:47` states the rule this implements: "a paper_id is minted ONCE per (owner,
source_hash) and held fixed across every re-parse". Deriving it means uploading the same PDF twice
resolves to the same paper rather than to a second copy, without a lookup — and `enqueue_parse`'s
idempotency key is `parse:{source_hash}:{paper_id}`, so the duplicate upload returns the ORIGINAL
job id instead of parsing again. That behaviour is asserted in `tests/test_papers.py`.
"""

from __future__ import annotations

import math
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

# IMPORTED, NEVER RE-TYPED. `tests/test_runtime_swappable.py::
# test_the_provider_constants_have_no_new_live_definition` scans every .py under `packages/` and
# `services/` for these three strings as LITERALS and fails on a fresh copy. #88 ruled that the two
# existing copies in `services/document-worker` stay and are declared; a third is a defect. So this
# service names the constants and never their values — which is also what makes
# `PAPERTREE_LLM_MODEL` unset behave identically to `papertree_agent_tools`' default.
from papertree_agent_tools import DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_TIMEOUT_SECONDS

#: How long a session token is good for. Twenty-four hours, matching v1's `jwt_expiration_hours`
#: default so nothing about the user-visible behaviour changes with the scheme.
DEFAULT_SESSION_HOURS = 24

#: scrypt cost. n=2**14 / r=8 / p=1 is the interactive-login profile from RFC 7914 §2 and costs
#: ~16 MB and ~50 ms per verification here. The parameters are stored PER ROW (0004_auth.sql), so
#: raising this later re-hashes on next login rather than invalidating every password.
SCRYPT_N = 1 << 14
SCRYPT_R = 8
SCRYPT_P = 1

#: contracts.md §7 defaults for the reader release's API variables.
DEFAULT_MAX_UPLOAD_MB = 100
DEFAULT_AGENT_URL = "http://127.0.0.1:8200"
DEFAULT_DAILY_BUDGET_USD = 1.00


def _random_signing_secret() -> str:
    """contracts.md §2.3: with no `PAPERTREE_SIGNING_SECRET`, a random one PER BOOT. Signed asset
    URLs then stop working across a restart, which is acceptable: the reader re-fetches `/ir`."""
    return secrets.token_urlsafe(32)


@dataclass(frozen=True, slots=True)
class Settings:
    """Resolved paths and knobs. Construct with `Settings.from_env()` or directly in a test."""

    root: Path
    session_hours: int = DEFAULT_SESSION_HOURS

    #: The model credential for `POST /papers/{id}/ask`. EMPTY IS A SUPPORTED STATE, not a broken
    #: one: `MiniMaxProvider.available` is False, the route answers 503 naming this variable, and
    #: nothing else in the service changes. That is the `DoclingAdapter` shape — "an adapter that
    #: was never INSTALLED has not failed at anything" — applied to a credential, and it is why a
    #: developer with no key still gets a working reader.
    llm_api_key: str = ""
    llm_model: str = DEFAULT_MODEL
    llm_base_url: str = DEFAULT_BASE_URL
    llm_timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    # ── contracts.md §7 (the reader release). Parsed and refused in `from_env`; wired by the
    # slice that uses each: the upload cap by S1, the signing secret by S1's signed asset URLs,
    # the agent and the budget by S5. CORS origins are wired here (`create_app`).

    #: `PAPERTREE_MAX_UPLOAD_MB`: larger uploads are 413 `payload_too_large` (§2.2).
    max_upload_mb: int = DEFAULT_MAX_UPLOAD_MB
    #: `PAPERTREE_SIGNING_SECRET`: the asset URL HMAC key (§2.3). `repr=False`: a Settings that
    #: reaches a log line or a traceback must not carry it.
    signing_secret: str = field(default_factory=_random_signing_secret, repr=False)
    #: `PAPERTREE_AGENT_URL`: the Pi agent service (§3), without a trailing slash.
    agent_url: str = DEFAULT_AGENT_URL
    #: `PAPERTREE_AGENT_SECRET`: the shared API<->agent secret. EMPTY IS A SUPPORTED STATE: the AI
    #: routes answer 503 `not_configured` and nothing else changes (§7).
    agent_secret: str = field(default="", repr=False)
    #: `PAPERTREE_DAILY_BUDGET_USD`: per user, rolling 24 h, from `ai_runs.cost_usd_est` (§3.4).
    daily_budget_usd: float = DEFAULT_DAILY_BUDGET_USD
    #: `PAPERTREE_CORS_ORIGINS`: extra allowed origins beyond the localhost regex (§2).
    cors_origins: tuple[str, ...] = ()

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def database_file(self) -> Path:
        return self.root / "papertree.sqlite"

    @property
    def upload_root(self) -> Path:
        return self.root / "uploads"

    @property
    def asset_root(self) -> Path:
        return self.root / "assets"

    @property
    def staging_root(self) -> Path:
        return self.root / "staging"

    def ensure_directories(self) -> None:
        for directory in (self.root, self.upload_root, self.asset_root, self.staging_root):
            directory.mkdir(parents=True, exist_ok=True)

    @classmethod
    def from_env(cls) -> Settings:
        # PAPERTREE_DATA_ROOT rather than a per-path variable: four independent path variables is
        # four ways to configure a service into an inconsistent state, and `crops.py` is explicit
        # that the asset root must sit OUTSIDE the repo, which one root makes obvious.
        root = os.environ.get("PAPERTREE_DATA_ROOT")
        return cls(
            root=Path(root).expanduser() if root else Path.home() / ".papertree",
            session_hours=int(os.environ.get("PAPERTREE_SESSION_HOURS", DEFAULT_SESSION_HOURS)),
            llm_api_key=os.environ.get("PAPERTREE_LLM_API_KEY", ""),
            llm_model=os.environ.get("PAPERTREE_LLM_MODEL", DEFAULT_MODEL),
            llm_base_url=os.environ.get("PAPERTREE_LLM_BASE_URL", DEFAULT_BASE_URL),
            llm_timeout_seconds=float(
                os.environ.get("PAPERTREE_LLM_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)
            ),
            max_upload_mb=_positive_int("PAPERTREE_MAX_UPLOAD_MB", DEFAULT_MAX_UPLOAD_MB),
            signing_secret=os.environ.get("PAPERTREE_SIGNING_SECRET") or _random_signing_secret(),
            agent_url=_http_url("PAPERTREE_AGENT_URL", DEFAULT_AGENT_URL),
            agent_secret=os.environ.get("PAPERTREE_AGENT_SECRET", ""),
            daily_budget_usd=_budget("PAPERTREE_DAILY_BUDGET_USD", DEFAULT_DAILY_BUDGET_USD),
            cors_origins=_origins("PAPERTREE_CORS_ORIGINS"),
        )


# ── parsing. Each refuses a value that cannot mean anything, NAMING the variable: a service that
# boots on `PAPERTREE_MAX_UPLOAD_MB=lots` fails later, somewhere else, for a reason nobody links.


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name}={raw!r} is not a whole number") from None
    if value < 1:
        raise ValueError(f"{name}={raw!r} must be at least 1")
    return value


def _budget(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name}={raw!r} is not a number of US dollars") from None
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name}={raw!r} must be a finite amount of at least 0")
    return value


def _http_url(name: str, default: str) -> str:
    raw = os.environ.get(name, "").strip() or default
    parts = urlsplit(raw)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise ValueError(f"{name}={raw!r} must be an http(s) URL such as {default}")
    return raw.rstrip("/")


def _origins(name: str) -> tuple[str, ...]:
    origins = tuple(o.strip() for o in os.environ.get(name, "").split(",") if o.strip())
    for origin in origins:
        parts = urlsplit(origin)
        if parts.scheme not in {"http", "https"} or not parts.netloc or parts.path not in {"", "/"}:
            # `*` included: a wildcard is a policy decision, not a list entry.
            raise ValueError(f"{name}: {origin!r} is not an origin such as https://reader.example")
    return tuple(o.rstrip("/") for o in origins)
