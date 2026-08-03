"""`GET /papers/{id}/ir` returns what the reader already consumes — asserted against the fixture.

WHY AGAINST A FIXTURE AND NOT AGAINST A SHAPE

`apps/web/src/lib/fixtures.ts:79` does `(await response.json()) as PaperSource` on
`public/fixtures/<slug>.paperir.json` and hands the result to `indexDocument`. Those three files
are the contract, and they are what `citation-nav.spec`, `reparse.spec` and `cross-mode.spec`
measure against. A test asserting "the response has a `blocks` key" would pass over a response
that lost every caption, renamed every relation endpoint, or double-encoded a payload.

So: put a committed fixture in through `PaperTreeDb.put_paper` — the SAME call the parse job's
persist step makes (job.py:150) — read it back through the route, and require the two to be equal.

THIS TEST FOUND TWO REAL DEFECTS before the PR was opened, and neither was visible by reading:

  * relations were emitted as `from_block`/`to_block`, the COLUMN names. The IR fields are `from`
    and `to`. The document would have indexed cleanly with zero usable relations.
  * `relations.provenance` is stored RAW while the identically named column on `blocks` is
    JSON-encoded, so round-tripping it through `json.loads` raised on the first row.

THE MUTATION EACH ASSERTION CATCHES is named on the assertion.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from api_support import FIXTURE_DIR, auth, harness, load_fixture, register, seed_paper

SLUGS = ["resnet-cvpr-2col", "neural-odes-mathheavy", "attention-is-all-you-need"]


def _normalised(document: dict[str, Any]) -> dict[str, Any]:
    """The document with the two orderings the database cannot preserve made canonical.

    NOT a way to make the test pass. It is the statement of what the round trip claims, and the
    claim is deliberately narrow: every field of every block, page, relation and top-level key is
    preserved exactly, and the ARRAY ORDER of `blocks` and of `pages[].block_ids` is not.

    `ir.py`'s header has the measurement. Briefly: `list_blocks_on_page` is `ORDER BY flow,
    "order"`, the producer wrote its array in a third order, and nothing stores that order. Array
    order carries no meaning in PaperIR — reading order is `Page.flows` plus parent/child descent
    (AGENTS.md §4) — and `flows` IS compared exactly, in `test_flows_round_trip_exactly`.

    Sorting by `block_id` rather than dropping order entirely, so a MISSING or DUPLICATED block
    still fails.
    """
    # Through the GENERATED Pydantic binding first, and dumped identically on both sides. That
    # settles `null` versus absent — every optional field on `Block` defaults to None, so a stored
    # `"parent_id": null` and an omitted `parent_id` are the same document by the schema's own
    # definition, and the producer wrote the fixture with `exclude_none`. Normalising through the
    # binding is a STRONGER claim than key equality: it also fails if a field came back
    # double-encoded, or as a string where the schema says number.
    #
    # `by_alias=True` because `Relation.from` is a Python keyword, so the generated model calls it
    # `from_` and only the alias round-trips to the wire name.
    from papertree_document_ir import Paper

    out = Paper.model_validate(document).model_dump(mode="json", exclude_none=True, by_alias=True)
    out["blocks"] = sorted(out["blocks"], key=lambda b: b["block_id"])
    out["relations"] = sorted(out["relations"], key=lambda r: (r["type"], r["from"], r["to"]))
    out["pages"] = [{**page, "block_ids": sorted(page["block_ids"])} for page in out["pages"]]
    return out


@pytest.mark.parametrize("slug", SLUGS)
def test_the_ir_response_matches_the_committed_fixture_field_for_field(
    tmp_path: Path, slug: str
) -> None:
    """The whole contract, in one comparison, on the terms the round trip actually claims.

    MUTATION: assemble `blocks` from `list_blocks_in_doc_order` instead of per page. Every caption,
    footnote, table row, table cell and inline equation disappears and this fails on the count.
    That is the trap `ir.py`'s header describes.

    MUTATION: emit relations as `from_block`/`to_block`. Fails on the key set. Found for real.
    MUTATION: `_loads` a relation's `provenance`. Raises on the first row. Found for real.
    """
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, slug)
        expected = load_fixture(slug)

        got = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token))
        assert got.status_code == 200, got.text

        assert _normalised(got.json()) == _normalised(expected)


@pytest.mark.parametrize("slug", SLUGS)
def test_flows_round_trip_exactly(tmp_path: Path, slug: str) -> None:
    """`Page.flows` is the reading order, so it is compared with ORDER, not as a set.

    This is the assertion that makes `_normalised`'s block-order relaxation honest: what was
    relaxed is a serialisation detail, and the field that actually carries meaning is pinned here
    exactly, on every page of every fixture.

    MUTATION: derive `flows` from top-level blocks only, as DESIGN.md §10 — and `0001_core.sql`'s
    `papers` comment, until #91 corrected it — instructs. resnet page 0 goes from 21 ids to 11 and
    this fails. That rule is wrong and this test is the proof it had to be rewritten.
    """
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, slug)
        expected = load_fixture(slug)

        document = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        for got_page, expected_page in zip(document["pages"], expected["pages"], strict=True):
            assert got_page["flows"] == expected_page["flows"], f"page {expected_page['index']}"


@pytest.mark.parametrize("slug", SLUGS)
def test_page_block_ids_carry_the_same_set_the_producer_wrote(tmp_path: Path, slug: str) -> None:
    """The honest version of the `block_ids` claim: same members, different order.

    Recorded as a test rather than only as a comment so the next session cannot mistake it for an
    oversight. If `packages/db` ever stores an ordinal, this becomes an equality and the relaxation
    in `_normalised` can go.
    """
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, slug)
        expected = load_fixture(slug)

        document = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        for got_page, expected_page in zip(document["pages"], expected["pages"], strict=True):
            assert set(got_page["block_ids"]) == set(expected_page["block_ids"])
            assert len(got_page["block_ids"]) == len(expected_page["block_ids"])


@pytest.mark.parametrize("slug", SLUGS)
def test_no_block_is_lost(tmp_path: Path, slug: str) -> None:
    """Named separately from the equality above so a regression reports a COUNT, not a diff.

    A whole-document `assert a == b` failure on a 974-block paper is unreadable. This one says
    "974 != 657" and points straight at the doc_order filter.
    """
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, slug)
        expected = load_fixture(slug)

        document = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        assert len(document["blocks"]) == len(expected["blocks"])
        assert {b["block_id"] for b in document["blocks"]} == {
            b["block_id"] for b in expected["blocks"]
        }


@pytest.mark.parametrize("slug", SLUGS)
def test_the_non_body_blocks_the_obvious_implementation_would_drop_are_present(
    tmp_path: Path, slug: str
) -> None:
    """Non-vacuity for the test above: there ARE blocks with no `doc_order`, and they came back.

    Without this, `test_no_block_is_lost` would pass on a paper where every block happened to be
    top-level body text, and the reader would find out on the first paper with a caption.
    """
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, slug)

        document = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        # `doc_order` is OMITTED, not null, when absent — PaperIR distinguishes the two.
        without_doc_order = [b for b in document["blocks"] if b.get("doc_order") is None]
        assert len(without_doc_order) > 0, (
            f"{slug} has no blocks lacking doc_order, so this test asserts nothing on it — "
            "pick a fixture with captions or footnotes"
        )


def test_relations_carry_the_ir_field_names_and_resolve(tmp_path: Path) -> None:
    """MUTATION: emit `from_block`/`to_block`. Every endpoint resolves to nothing.

    resnet has 974 blocks and 25 relations on `main` (#66), and three types account for all of
    them. Asserting the endpoints RESOLVE is what makes this more than a key-name check.
    """
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")

        document = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        ids = {b["block_id"] for b in document["blocks"]}
        assert len(document["relations"]) > 0
        for relation in document["relations"]:
            assert set(relation) == {"type", "from", "to", "confidence", "provenance"}
            assert relation["from"] in ids and relation["to"] in ids


def test_the_document_still_validates_against_the_shipped_json_schema(tmp_path: Path) -> None:
    """The strongest available check that the round trip did not corrupt anything.

    `packages/document-ir/schema/paperir-1.0.0.schema.json` is the single source of truth (DESIGN.md
    §1). Validating the RESPONSE against it — rather than against my idea of the response — catches
    a field that came back double-encoded, a bbox that became a string, or a null where the schema
    requires a value, none of which a key-set comparison would notice.

    Uses the Pydantic binding rather than an AJV-equivalent, because that binding is GENERATED from
    the schema and is what the worker itself validates with.
    """
    with harness(tmp_path) as h:
        from papertree_document_ir import Paper  # generated from the schema

        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")

        document = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        Paper.model_validate(document)


def test_the_fixtures_this_file_depends_on_are_actually_there() -> None:
    """Loud rather than skipped.

    Unlike the corpus PDFs (fetched, not committed — AGENTS.md §4), these three JSON files ARE
    committed, so their absence is a broken checkout rather than an expected CI condition. If that
    ever changes this fails with the reason instead of the suite quietly shrinking.
    """
    # No harness: this asserts a property of the checkout, not of the service.
    missing = [slug for slug in SLUGS if not (FIXTURE_DIR / f"{slug}.paperir.json").is_file()]
    assert missing == [], f"committed fixtures are missing: {missing} (looked in {FIXTURE_DIR})"


def test_block_location_is_what_a_citation_needs(tmp_path: Path) -> None:
    """`GET /blocks/{id}/location` — the (pageIndex, bbox) pair #64's scroll needs, server-side."""
    with harness(tmp_path) as h:
        token = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, token, "resnet-cvpr-2col")

        document = h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
        block = document["blocks"][5]

        found = h.client.get(
            f"/papers/{paper_id}/blocks/{block['block_id']}/location", headers=auth(token)
        ).json()
        assert found["page_index"] == block["page_index"]
        assert found["bbox"] == block["bbox"]
        assert found["polygon"] == block["polygon"]
