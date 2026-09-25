"""contracts.md §7, the API's variables: defaults, parsing, refusal of nonsense, and no secret in a
repr. The LLM fields are S5's to remove and are not asserted here."""

from __future__ import annotations

import math
from pathlib import Path

import pytest
from api_support import harness
from papertree_api.settings import Settings

VARIABLES = (
    "PAPERTREE_DATA_ROOT",
    "PAPERTREE_MAX_UPLOAD_MB",
    "PAPERTREE_SIGNING_SECRET",
    "PAPERTREE_AGENT_URL",
    "PAPERTREE_AGENT_SECRET",
    "PAPERTREE_DAILY_BUDGET_USD",
    "PAPERTREE_CORS_ORIGINS",
)


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> pytest.MonkeyPatch:
    for name in VARIABLES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("PAPERTREE_DATA_ROOT", str(tmp_path / "root"))
    return monkeypatch


def test_defaults(clean_env: pytest.MonkeyPatch) -> None:
    settings = Settings.from_env()
    assert settings.max_upload_mb == 100
    assert settings.max_upload_bytes == 100 * 1024 * 1024
    assert settings.agent_url == "http://127.0.0.1:8200"
    assert settings.agent_secret == ""
    assert settings.daily_budget_usd == 1.00
    assert settings.cors_origins == ()
    # Random per boot (§2.3): present, long, and different on the next boot.
    assert len(settings.signing_secret) >= 32
    assert Settings.from_env().signing_secret != settings.signing_secret
    # A directly-built Settings (every test's) gets one too.
    assert len(Settings(root=Path("x")).signing_secret) >= 32


def test_every_variable_is_read(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("PAPERTREE_MAX_UPLOAD_MB", "5")
    clean_env.setenv("PAPERTREE_SIGNING_SECRET", "fixed-signing-secret")
    clean_env.setenv("PAPERTREE_AGENT_URL", "http://127.0.0.1:9999/")
    clean_env.setenv("PAPERTREE_AGENT_SECRET", "shared-agent-secret")
    clean_env.setenv("PAPERTREE_DAILY_BUDGET_USD", "2.50")
    clean_env.setenv("PAPERTREE_CORS_ORIGINS", " https://reader.example , http://b.test:3000,,")
    settings = Settings.from_env()
    assert settings.max_upload_mb == 5
    assert settings.signing_secret == "fixed-signing-secret"
    assert settings.agent_url == "http://127.0.0.1:9999"  # no trailing slash to double up
    assert settings.agent_secret == "shared-agent-secret"
    assert settings.daily_budget_usd == 2.5
    assert settings.cors_origins == ("https://reader.example", "http://b.test:3000")


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("PAPERTREE_MAX_UPLOAD_MB", "0"),
        ("PAPERTREE_MAX_UPLOAD_MB", "-1"),
        ("PAPERTREE_MAX_UPLOAD_MB", "lots"),
        ("PAPERTREE_DAILY_BUDGET_USD", "-0.01"),
        ("PAPERTREE_DAILY_BUDGET_USD", "nan"),
        ("PAPERTREE_DAILY_BUDGET_USD", "inf"),
        ("PAPERTREE_DAILY_BUDGET_USD", "a dollar"),
        ("PAPERTREE_AGENT_URL", "127.0.0.1:8200"),
        ("PAPERTREE_AGENT_URL", "ftp://127.0.0.1:8200"),
        ("PAPERTREE_CORS_ORIGINS", "*"),
    ],
)
def test_nonsense_is_refused_at_boot_naming_the_variable(
    clean_env: pytest.MonkeyPatch, name: str, value: str
) -> None:
    clean_env.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        Settings.from_env()


def test_no_secret_is_in_the_repr(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("PAPERTREE_SIGNING_SECRET", "SIGNING-SECRET-VALUE")
    clean_env.setenv("PAPERTREE_AGENT_SECRET", "AGENT-SECRET-VALUE")
    text = repr(Settings.from_env())
    assert "SIGNING-SECRET-VALUE" not in text and "AGENT-SECRET-VALUE" not in text
    assert not math.isnan(Settings.from_env().daily_budget_usd)


def test_extra_cors_origins_are_allowed_and_others_are_not(tmp_path: Path) -> None:
    settings = Settings(root=tmp_path / "data", cors_origins=("https://reader.example",))
    with harness(tmp_path, settings=settings) as h:
        listed = h.client.get("/auth/me", headers={"Origin": "https://reader.example"})
        other = h.client.get("/auth/me", headers={"Origin": "https://evil.example"})
        local = h.client.get("/auth/me", headers={"Origin": "http://localhost:3000"})
    assert listed.headers["access-control-allow-origin"] == "https://reader.example"
    assert "access-control-allow-origin" not in other.headers
    assert local.headers["access-control-allow-origin"] == "http://localhost:3000"
