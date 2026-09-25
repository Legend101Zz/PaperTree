"""contracts.md §0: "Times are ISO-8601 UTC strings (`2026-09-25T15:09:25.123Z`)" — on EVERY
response, whichever writer stamped the row (`packages/db` and `packages/jobs` stamp
`isoformat()`, `…274228+00:00`; the worker stamps `…123Z`).

Walks every JSON response the API has and checks every `*_at` string. The one exception is the
PaperIR document (`/ir`): it is a versioned document validated by its own schema, served verbatim,
and `test_ir.py` requires it to equal the stored fixture field for field.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from api_support import auth, harness, register, seed_paper

WIRE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
SLUG = "resnet-cvpr-2col"
CAPTURE = Path(__file__).resolve().parents[4] / "packages/db/python/tests/data"


def _times(value: Any, where: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(value, dict):
        for key, item in value.items():
            if key.endswith("_at") and isinstance(item, str):
                yield f"{where}.{key}", item
            elif key != "anchor":  # an Anchor's own `created.at` is the client's, verbatim (§6)
                yield from _times(item, f"{where}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _times(item, f"{where}[{index}]")


def test_every_time_on_every_json_response_is_the_wire_shape(tmp_path: Path) -> None:
    import json

    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        anchor = json.loads((CAPTURE / "capture_anchor_resnet.json").read_text("utf-8"))["anchor"]
        created = h.client.post(
            f"/papers/{paper_id}/highlights",
            headers=auth(alice),
            json={
                "highlight_id": "hl_01K0WIRETIMES00000000001",
                "color": "amber",
                "anchors": [{"anchor": anchor}],
            },
        )
        assert created.status_code == 201, created.text
        upload = h.client.post(
            "/papers",
            headers=auth(alice),
            files={"file": ("x.pdf", b"%PDF-1.7\nnot parsed in this test", "application/pdf")},
        ).json()

        responses = {
            "/papers": h.client.get("/papers", headers=auth(alice)),
            "/papers/{id}": h.client.get(f"/papers/{paper_id}", headers=auth(alice)),
            "/papers/{id}/highlights": h.client.get(
                f"/papers/{paper_id}/highlights", headers=auth(alice)
            ),
            "POST /papers/{id}/highlights": created,
            "/jobs/{id}": h.client.get(f"/jobs/{upload['job_id']}", headers=auth(alice)),
        }
        found = 0
        for name, response in responses.items():
            assert response.status_code == 200 or name.startswith("POST"), (name, response.text)
            for where, stamp in _times(response.json(), name):
                found += 1
                assert WIRE_TIME.fullmatch(stamp), f"{where} = {stamp!r}"
        # Non-vacuous: papers carry created_at + parsed_at, jobs created_at + updated_at, ...
        assert found >= 8, found
