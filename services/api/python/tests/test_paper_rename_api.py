"""The opened book's two paper writes over HTTP (v0.3 #337): `PATCH /papers/{id}` renames, and
`DELETE /papers/{id}/topic` takes the topic off (the book's "remove it").

Papers are the committed fixtures put in the store the way the parse job does (`seed_paper`), so no
corpus PDF is needed and nothing is skipped. Every refusal for another user's paper is the same
404 the other paper routes give.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from api_support import assert_envelope, auth, harness, register, seed_paper

SLUG = "resnet-cvpr-2col"


def test_rename_is_listed_survives_a_second_read_and_wins_over_the_parsed_title(
    tmp_path: Path,
) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        parsed = h.client.get(f"/papers/{paper_id}", headers=auth(token)).json()["title"]

        response = h.client.patch(
            f"/papers/{paper_id}", json={"title": "  My ResNet notes  "}, headers=auth(token)
        )

        assert response.status_code == 200, response.text
        assert response.json()["title"] == "My ResNet notes"  # trimmed, and the row comes back
        assert parsed != "My ResNet notes"
        listed = h.client.get("/papers", headers=auth(token)).json()
        assert [row["title"] for row in listed] == ["My ResNet notes"]
        assert h.client.get(f"/papers/{paper_id}", headers=auth(token)).json()["title"] == (
            "My ResNet notes"
        )
        # A second rename replaces the first, never adds a row.
        again = h.client.patch(f"/papers/{paper_id}", json={"title": "Skip"}, headers=auth(token))
        assert again.json()["title"] == "Skip"


@pytest.mark.parametrize("title", ["", "   ", "x" * 301])
def test_a_blank_or_over_long_title_is_refused_and_changes_nothing(
    tmp_path: Path, title: str
) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        before = h.client.get(f"/papers/{paper_id}", headers=auth(token)).json()["title"]

        response = h.client.patch(f"/papers/{paper_id}", json={"title": title}, headers=auth(token))

        assert_envelope(response, 422, "validation_failed")
        assert h.client.get(f"/papers/{paper_id}", headers=auth(token)).json()["title"] == before


def test_the_longest_title_is_accepted(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        longest = "x" * 300
        response = h.client.patch(
            f"/papers/{paper_id}", json={"title": longest}, headers=auth(token)
        )
        assert response.status_code == 200 and response.json()["title"] == longest


def test_another_users_paper_cannot_be_renamed_and_keeps_its_title(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        before = h.client.get(f"/papers/{paper_id}", headers=auth(alice)).json()["title"]

        refused = h.client.patch(
            f"/papers/{paper_id}", json={"title": "Mine now"}, headers=auth(bob)
        )
        missing = h.client.patch(
            "/papers/ppr_00000000000000000000000000", json={"title": "x"}, headers=auth(bob)
        )

        assert_envelope(refused, 404, "not_found")
        assert_envelope(missing, 404, "not_found")  # the same answer: no existence oracle
        assert h.client.get(f"/papers/{paper_id}", headers=auth(alice)).json()["title"] == before


def test_rename_needs_a_session(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = seed_paper(h.settings, h.client, token, SLUG)
        assert h.client.patch(f"/papers/{paper_id}", json={"title": "x"}).status_code == 401


def test_the_topic_can_be_taken_off_and_another_users_paper_is_404(tmp_path: Path) -> None:
    with harness(tmp_path) as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        topic = h.client.post("/topics", json={"name": "Vision"}, headers=auth(alice)).json()
        h.client.put(
            f"/papers/{paper_id}/topic", json={"topic_id": topic["topic_id"]}, headers=auth(alice)
        )
        shelved = h.client.get(f"/papers/{paper_id}", headers=auth(alice)).json()["topic"]
        assert shelved is not None and shelved["name"] == "Vision"

        assert_envelope(
            h.client.delete(f"/papers/{paper_id}/topic", headers=auth(bob)), 404, "not_found"
        )
        assert h.client.get(f"/papers/{paper_id}", headers=auth(alice)).json()["topic"] is not None

        removed = h.client.delete(f"/papers/{paper_id}/topic", headers=auth(alice))

        assert removed.status_code == 200 and removed.json()["topic"] is None
        assert h.client.get(f"/papers/{paper_id}", headers=auth(alice)).json()["topic"] is None
