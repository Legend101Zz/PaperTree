"""S1: what the reader fetches — `/file`, `/ir` and the signed crop URLs (contracts.md §2.2, §2.3).

Regression tests named by slice-plan §S1: `test_file_served_before_promotion`,
`test_signed_asset_url`.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from api_support import assert_envelope, auth, harness, register
from papertree_api import assets
from papertree_api.settings import Settings
from test_ingest_helpers import drain, synthetic_pdf, upload

GZIP = {"Accept-Encoding": "gzip"}


def test_file_served_before_promotion(tmp_path: Path) -> None:
    """§2.2: `/file` is "gated on ownership, not on promotion". WATCHED FAILING at base: 404 for
    a paper whose parse had not been promoted (and for a failed one, for ever)."""
    pdf = synthetic_pdf()
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        body = upload(h.client, alice, pdf).json()
        paper_id = body["paper_id"]

        served = h.client.get(f"/papers/{paper_id}/file", headers={**auth(alice), **GZIP})
        assert served.status_code == 200, served.text
        assert served.content == pdf
        assert served.headers["content-type"] == "application/pdf"
        assert "content-encoding" not in served.headers, "the PDF is never re-compressed"
        assert served.headers["etag"] == f'"{body["paper"]["source_hash"]}"'
        assert served.headers["cache-control"] == "private, max-age=31536000, immutable"
        # The parse has not even started: the IR is 409 while the pages are readable.
        assert_envelope(
            h.client.get(f"/papers/{paper_id}/ir", headers=auth(alice)), 409, "not_parsed"
        )

        again = h.client.get(
            f"/papers/{paper_id}/file",
            headers={**auth(alice), "If-None-Match": served.headers["etag"]},
        )
        assert again.status_code == 304 and again.content == b""
        assert again.headers["etag"] == served.headers["etag"]
        ranged = h.client.get(
            f"/papers/{paper_id}/file", headers={**auth(alice), "Range": "bytes=0-4"}
        )
        assert (ranged.status_code, ranged.content) == (206, b"%PDF-")

        assert_envelope(
            h.client.get(f"/papers/{paper_id}/file", headers=auth(bob)), 404, "not_found"
        )
        assert_envelope(h.client.get(f"/papers/{paper_id}/ir", headers=auth(bob)), 404, "not_found")
        assert_envelope(h.client.get(f"/papers/{paper_id}/file"), 401, "auth_required")

        drain(h.settings)
        assert h.client.get(f"/papers/{paper_id}/file", headers=auth(alice)).content == pdf


def _figure_uris(document: dict[str, Any]) -> list[str]:
    return [
        block["payload"]["image"]["uri"]
        for block in document["blocks"]
        if block["type"] == "figure" and (block.get("payload") or {}).get("image")
    ]


def test_signed_asset_url(tmp_path: Path) -> None:
    """§2.3. Every `asset://` URI in `/ir` is a signed absolute URL; that URL is 200 with no other
    credential, and the same object unsigned, tampered, expired or signed by another secret is 401.
    WATCHED FAILING at base: `/ir` carried the raw `asset://ppr_…/1/figures/blk_…@3x.png`, which an
    `<img>` cannot load, and the asset route required a Bearer."""
    settings = Settings(root=tmp_path / "data", signing_secret="s1-test-secret-not-a-real-one")
    with harness(tmp_path, settings=settings) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper_id = upload(h.client, alice, synthetic_pdf(pages=2)).json()["paper_id"]
        drain(h.settings)

        ir = h.client.get(f"/papers/{paper_id}/ir", headers={**auth(alice), **GZIP})
        assert ir.status_code == 200
        assert ir.headers["content-encoding"] == "gzip"
        document = ir.json()
        assert "asset://" not in ir.text
        uris = _figure_uris(document)
        assert len(uris) == 2
        stored = [
            f"{block['block_id']}@3x.png"
            for block in document["blocks"]
            if block["type"] == "figure"
        ]

        for uri, name in zip(uris, stored, strict=True):
            parts = urlsplit(uri)
            assert (parts.scheme, parts.netloc) == ("http", "testserver"), uri
            kind, block_id = parts.path.split("/")[-2:]
            assert parts.path == f"/papers/{paper_id}/assets/{kind}/{block_id}"
            query = {key: value[0] for key, value in parse_qs(parts.query).items()}
            assert set(query) == {"gen", "exp", "sig"} and query["gen"] == "1"
            assert 3500 < int(query["exp"]) - time.time() <= 3600
            assert query["sig"] == assets.sign(
                settings.signing_secret, paper_id, 1, kind, block_id, int(query["exp"])
            )

            png = h.client.get(uri)  # no Authorization header: the signature is the credential
            assert png.status_code == 200, png.text
            assert png.headers["content-type"] == "image/png"
            on_disk = h.settings.asset_root / paper_id / "1" / kind / name
            assert png.content == on_disk.read_bytes() and png.content.startswith(b"\x89PNG")

            path = parts.path
            assert_envelope(h.client.get(path), 401, "auth_required")  # unsigned, no Bearer
            assert_envelope(h.client.get(f"{path}?gen=1&exp={query['exp']}"), 401, "auth_required")
            tampered = query["sig"][:-1] + ("A" if query["sig"][-1] != "A" else "B")
            assert_envelope(
                h.client.get(f"{path}?gen=1&exp={query['exp']}&sig={tampered}"),
                401,
                "auth_required",
            )
            later = int(query["exp"]) + 60  # the same signature cannot be stretched
            assert_envelope(
                h.client.get(f"{path}?gen=1&exp={later}&sig={query['sig']}"), 401, "auth_required"
            )
            past = int(time.time()) - 1
            expired = assets.sign(settings.signing_secret, paper_id, 1, kind, block_id, past)
            assert_envelope(
                h.client.get(f"{path}?gen=1&exp={past}&sig={expired}"), 401, "auth_required"
            )
            forged = assets.sign("another-secret", paper_id, 1, kind, block_id, int(query["exp"]))
            assert_envelope(
                h.client.get(f"{path}?gen=1&exp={query['exp']}&sig={forged}"), 401, "auth_required"
            )

            # A Bearer still works without a signature; another user's Bearer is a 404.
            assert h.client.get(path, headers=auth(alice)).content == png.content
            assert_envelope(h.client.get(path, headers=auth(bob)), 404, "not_found")

        # One figure's signature does not open the other figure.
        first, second = (urlsplit(uri) for uri in uris)
        swapped = f"{second.path}?{first.query}"
        assert_envelope(h.client.get(swapped), 401, "auth_required")

        # A signed URL outlives nothing it names: after DELETE it is 404, not the old crop.
        assert h.client.delete(f"/papers/{paper_id}", headers=auth(alice)).status_code == 204
        assert_envelope(h.client.get(uris[0]), 404, "not_found")


def test_rewrite_touches_only_exact_uris_of_this_paper() -> None:
    this, other = "ppr_" + "A" * 26, "ppr_" + "B" * 26
    block = "blk_" + "a" * 16
    document: dict[str, Any] = {
        "pages": [{"image": None}],
        "blocks": [
            {"payload": {"image": {"uri": f"asset://{this}/2/figures/{block}@3x.png"}}},
            {"payload": {"image": {"uri": f"asset://{other}/2/figures/{block}@3x.png"}}},
            {"payload": {"image": {"uri": f"asset://{this}/2/figures/{block}@2x.png"}}},
            {"text": f"see asset://{this}/2/figures/{block}@3x.png for the crop"},
            {"payload": {"image": {"uri": "fixture://resnet/pages/000@2x.png"}}},
        ],
    }
    calls: list[tuple[int, str, str]] = []

    def url_for(gen: int, kind: str, block_id: str) -> str:
        calls.append((gen, kind, block_id))
        return "https://signed.example/x"

    assert assets.rewrite_asset_uris(document, paper_id=this, url_for=url_for) == 1
    assert calls == [(2, "figures", block)]
    uris = [b.get("payload", {}).get("image", {}).get("uri") for b in document["blocks"]]
    assert uris[0] == "https://signed.example/x"
    assert uris[1].startswith(f"asset://{other}/"), "another paper's URI is never signed"
    assert uris[2].endswith("@2x.png") and uris[4].startswith("fixture://")
    assert document["blocks"][3]["text"].startswith("see asset://"), "prose is left alone"


def _verify(exp: str | None, sig: str | None, gen: int | None = 1) -> bool:
    return assets.verify(
        "k", paper_id="ppr_X", gen=gen, kind="figures", block_id="blk_y", exp=exp, sig=sig, now=1.0
    )


def test_verify_refuses_malformed_parameters_without_raising() -> None:
    good = assets.sign("k", "ppr_X", 1, "figures", "blk_y", 2_000_000_000)
    assert _verify("2000000000", good)
    for exp, sig in (
        (None, good),
        ("2000000000", None),
        ("2e9", good),
        ("-1", good),
        ("2000000000", good + "="),
        ("2000000000", "x" * 43),
        ("99999999999999999999", good),
    ):
        assert not _verify(exp, sig), (exp, sig)
    assert not _verify("2000000000", good, gen=None)
    assert not _verify("2000000000", good, gen=2)
