"""contracts.md §2: `GZipMiddleware(minimum_size=1024)` covers JSON responses; §2.2: `/ir` is gzip.

The PDF and the crop PNGs are NOT compressed: both are already compressed formats, so gzip at
Starlette's level 9 would spend CPU on every read of a multi-megabyte PDF for no bytes saved.
"""

from __future__ import annotations

from pathlib import Path

from api_support import auth, harness, register, seed_paper

SLUG = "resnet-cvpr-2col"
GZIP = {"Accept-Encoding": "gzip"}


def test_the_ir_is_sent_gzipped_and_decodes_to_the_same_document(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        zipped = h.client.get(f"/papers/{paper_id}/ir", headers={**auth(alice), **GZIP})
        plain = h.client.get(
            f"/papers/{paper_id}/ir", headers={**auth(alice), "Accept-Encoding": "identity"}
        )
        assert zipped.status_code == plain.status_code == 200
        assert zipped.headers["content-encoding"] == "gzip"
        assert "accept-encoding" in zipped.headers["vary"].lower()
        assert "content-encoding" not in plain.headers
        assert zipped.json() == plain.json()
        # Non-vacuous: the compressed body really is smaller on the wire.
        assert int(zipped.headers["content-length"]) < len(plain.content) / 3


def test_a_small_json_response_is_not_compressed(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        me = h.client.get("/auth/me", headers={**auth(alice), **GZIP})
        assert me.status_code == 200 and len(me.content) < 1024
        assert "content-encoding" not in me.headers


def test_the_pdf_is_never_gzipped(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        pdf = b"%PDF-1.7\n" + b"0" * 50_000  # compressible on purpose: nothing else stops gzip
        (h.settings.upload_root / f"{paper_id}.pdf").write_bytes(pdf)
        served = h.client.get(f"/papers/{paper_id}/file", headers={**auth(alice), **GZIP})
        assert served.status_code == 200
        assert "content-encoding" not in served.headers
        assert served.content == pdf
