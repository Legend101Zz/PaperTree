"""Every integer a request carries to SQL is bounded before the SQL runs (wave 1's review F1).

JSON integers and query strings are unbounded; SQLite's INTEGER is signed 64-bit. One past
`SQLITE_INTEGER_MAX` raised `OverflowError` at the bind, which was a 500. Wave 1 closed that on the
highlight routes; this pins it on every route that takes `?gen=` or `?page=`, with ONE grammar for
`?gen=` everywhere (wave 1's: 1-19 ASCII digits, 1 to 2**63-1).
"""

from __future__ import annotations

from pathlib import Path

from api_support import assert_envelope, auth, harness, register, seed_paper
from papertree_db import SQLITE_INTEGER_MAX

SLUG = "resnet-cvpr-2col"

BAD_GENS = (
    "0",
    "-1",
    "abc",
    "1.0",
    "+1",
    "%201",
    "%C2%B2",  # superscript two
    "%D9%A3",  # ARABIC-INDIC DIGIT THREE
    "99999999999999999999999",
    str(SQLITE_INTEGER_MAX + 1),
)


def _gen_routes(paper_id: str, block_id: str) -> list[str]:
    return [
        f"/papers/{paper_id}",
        f"/papers/{paper_id}/ir",
        f"/papers/{paper_id}/pages",
        f"/papers/{paper_id}/blocks",
        f"/papers/{paper_id}/relations",
        f"/papers/{paper_id}/blocks/{block_id}/location",
        f"/papers/{paper_id}/assets/figures/{block_id}",
        f"/papers/{paper_id}/highlights",
    ]


def test_every_gen_param_is_one_bounded_grammar(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        block_id = h.client.get(f"/papers/{paper_id}/ir", headers=auth(alice)).json()["blocks"][0][
            "block_id"
        ]
        for path in _gen_routes(paper_id, block_id):
            for raw in BAD_GENS:
                response = h.client.get(f"{path}?gen={raw}", headers=auth(alice))
                body = assert_envelope(response, 422, "validation_failed")
                assert body["detail"].startswith("gen: "), (path, raw, body)
        # Non-vacuous: a real generation still answers.
        for path in _gen_routes(paper_id, block_id)[:6]:
            assert h.client.get(f"{path}?gen=1", headers=auth(alice)).status_code == 200, path


def test_page_is_bounded_too(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        for raw in ("-1", str(SQLITE_INTEGER_MAX + 1), "99999999999999999999999"):
            response = h.client.get(f"/papers/{paper_id}/blocks?page={raw}", headers=auth(alice))
            assert_envelope(response, 422, "validation_failed")
        assert (
            h.client.get(
                f"/papers/{paper_id}/blocks?page={SQLITE_INTEGER_MAX}", headers=auth(alice)
            ).json()
            == []
        )
