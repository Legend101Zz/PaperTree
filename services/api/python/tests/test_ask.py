"""`POST /papers/{id}/ask` — #76. The route that turns three epics of libraries into an answer.

WHAT IS REAL IN HERE AND WHAT IS SCRIPTED, SAID UP FRONT

Real: the ASGI app, the dependency graph, `owner_for`, `AgentDataHandle`'s guarded read-only
connection, `PaperIndex`, the structure-aware expansion, the token budget, the datamark, the
eighteen-tool registry, the shipped tool loop, the grounding verifier and the camelCase serialiser.
A committed PaperIR fixture is `put_paper`'d through the same call the parse job makes.

Scripted: the MODEL, and only the model. `create_app(..., llm_transport=...)` takes a callable that
returns canned bytes, so no test here opens a socket — the same construction
`packages/agent-tools`' tests use, and the reason `MiniMaxProvider` takes a `Transport` at all. The
one test that DOES call a model lives in `packages/agent-tools/python/tests/test_live_provider.py`,
is opt-in, and skips loudly.

THE TRAP THIS FILE IS BUILT AROUND. A scripted transport makes it trivially easy to assert on an
answer the route never grounded — feed it a canned JSON answer, get a 200, ship. So every positive
test here asserts something the SCRIPT could not have produced: that the tool the model asked for
was really dispatched against the real paper, that the returned `sourceRegions` carry the parse's
own page and bbox rather than the model's, and that a claim citing words the paper does not contain
comes back FLAGGED. AGENTS.md §2's "a green test may assert less than it appears to".
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from api_support import auth, harness, register, seed_paper

#: The smallest committed fixture. `test_isolation.py` uses the same one.
SLUG = "resnet-cvpr-2col"


class ScriptedModel:
    """A `Transport` that returns queued chat-completions responses and records every request."""

    def __init__(self, responses: Sequence[Mapping[str, Any]]) -> None:
        self.responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def __call__(self, url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> bytes:
        self.requests.append({"url": url, "body": json.loads(body)})
        return json.dumps(self.responses.pop(0)).encode("utf-8")


def _answer_response(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "model": "MiniMax-M3",
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": json.dumps(payload)},
            }
        ],
        "usage": {"prompt_tokens": 900, "completion_tokens": 40},
    }


def _tool_call_response(name: str, arguments: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "model": "MiniMax-M3",
        "choices": [
            {
                "finish_reason": "tool_calls",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }
                    ],
                },
            }
        ],
        "usage": {"prompt_tokens": 800, "completion_tokens": 20},
    }


def _first_paragraph(client: Any, token: str, paper_id: str) -> dict[str, Any]:
    """A real block out of the real IR the route will read. Never a made-up id."""
    document = client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()
    for block in document["blocks"]:
        if block["type"] == "paragraph" and (block.get("text") or "").strip():
            return dict(block)
    raise AssertionError(f"{SLUG}'s fixture has no non-empty paragraph; this test is vacuous")


# ── the happy path, and what it is allowed to prove ──────────────────────────────────────


def test_a_grounded_answer_comes_back_with_the_parses_own_geometry(tmp_path: Path) -> None:
    """End to end: tool loop, verifier, serialiser, camelCase, and geometry from the PARSE.

    `sourceRegions` is asserted against the block's page and bbox as they appear in `/ir`, and the
    scripted answer deliberately claims neither — so a route that echoed the model's regions would
    return an empty list here and a route that invented them would disagree with the IR.
    """
    with harness(tmp_path, llm_transport=None, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    model = ScriptedModel(
        [
            _tool_call_response("get_block", {"block_id": block["block_id"]}),
            _answer_response(
                {
                    "states": block["text"][:120],
                    "interpretation": None,
                    "supporting_block_ids": [block["block_id"]],
                    "claims": [{"text": block["text"][:60], "supported_by": [block["block_id"]]}],
                }
            ),
        ]
    )
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        response = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(alice),
            json={"question": "What does this say?", "block_ids": [block["block_id"]]},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    answer, meta = body["answer"], body["meta"]

    # camelCase, every key, exactly the eight `types.ts` declares.
    assert set(answer) == {
        "states",
        "interpretation",
        "supportingBlockIds",
        "sourcePages",
        "sourceRegions",
        "confidence",
        "unresolvedAmbiguities",
        "claims",
    }
    assert answer["supportingBlockIds"] == [block["block_id"]]
    assert answer["claims"][0]["supported"] is True

    # THE PART A SCRIPT COULD NOT HAVE PRODUCED: the tool ran against the real database, and the
    # geometry is the parser's.
    assert meta["toolCalls"] == [{"tool": "get_block", "status": "ok"}]
    assert meta["steps"] == 2
    assert meta["model"] == "MiniMax-M3"
    assert (meta["inputTokens"], meta["outputTokens"]) == (1700, 60)
    assert len(meta["evidenceBlockIds"]) >= 1
    region = answer["sourceRegions"][0]
    assert region["blockId"] == block["block_id"]
    assert region["pageIndex"] == block["page_index"]
    assert region["bbox"] == list(block["bbox"])
    assert region["label"] == f"p{block['page_index'] + 1} · {block['type']}"

    # The system prompt reached the model with the datamark in it, and the paper's text arrived as
    # DATA rather than as instructions.
    system = model.requests[0]["body"]["messages"][0]["content"]
    assert "PaperTree" in system and "JSON Schema" in system
    assert len(model.requests[0]["body"]["tools"]) == 18


def test_an_unsupported_claim_is_flagged_and_still_present(tmp_path: Path) -> None:
    """EPIC-03 §4: FLAGGED, not deleted and not silently emitted.

    The verifier is real and offline, so a fabricated number in a claim is caught here even though
    the "model" is a script. A route that ran no verifier would return `supported: false` never.
    """
    with harness(tmp_path, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    model = ScriptedModel(
        [
            _answer_response(
                {
                    "states": block["text"][:120],
                    "interpretation": "the authors are describing a residual formulation",
                    "supporting_block_ids": [block["block_id"]],
                    "claims": [
                        {"text": block["text"][:60], "supported_by": [block["block_id"]]},
                        {
                            "text": "the method reaches 99.7 percent accuracy on ImageNet",
                            "supported_by": [block["block_id"]],
                        },
                    ],
                }
            )
        ]
    )
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        answer = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(alice),
            json={"question": "How accurate is it?", "block_ids": [block["block_id"]]},
        ).json()["answer"]

    assert len(answer["claims"]) == 2, "a verifier that FILTERS would return one"
    flagged = [claim for claim in answer["claims"] if not claim["supported"]]
    assert len(flagged) == 1
    assert "99.7" in flagged[0]["reason"]
    assert answer["interpretation"] == "the authors are describing a residual formulation"


# ── every way it refuses, and none of them invents an answer ─────────────────────────────


def test_with_no_api_key_the_route_says_so_and_names_the_variable(tmp_path: Path) -> None:
    """The `DoclingAdapter` shape applied to a credential: UNAVAILABLE is not BROKEN.

    503 rather than 500, with the variable named, because "the ask button does nothing" is a
    failure the reader cannot diagnose and the developer cannot either.
    """
    with harness(tmp_path, llm_api_key="") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        response = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(alice),
            json={"question": "q", "block_ids": ["blk_whatever"]},
        )
    assert response.status_code == 503
    assert "PAPERTREE_LLM_API_KEY" in response.text


def test_an_answer_with_no_supporting_blocks_is_502_and_is_not_patched(tmp_path: Path) -> None:
    """The server-side twin of `DerivedBlock`'s throw.

    `GroundedAnswer.__post_init__` refuses it, this route surfaces the refusal, and the Inspector
    renders a designed failure state. Three layers, one rule: **an ungrounded answer must fail to
    exist rather than render unattributed.** The tempting fix — filling `supporting_block_ids`
    from the request's `block_ids` — would invent exactly the field the reader is asked to trust.
    """
    with harness(tmp_path, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    model = ScriptedModel(
        [
            _answer_response(
                {
                    "states": "The paper says something.",
                    "interpretation": None,
                    "supporting_block_ids": [],
                    "claims": [{"text": "something", "supported_by": []}],
                }
            )
        ]
    )
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        response = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(alice),
            json={"question": "q", "block_ids": [block["block_id"]]},
        )
    assert response.status_code == 502
    assert "supporting_block_ids" in response.text
    assert "NOT patched" in response.text


def test_a_model_that_does_not_answer_with_json_is_502(tmp_path: Path) -> None:
    with harness(tmp_path, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    model = ScriptedModel(
        [
            {
                "model": "MiniMax-M3",
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "Sure! Here is my answer."},
                    }
                ],
            }
        ]
    )
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        response = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(alice),
            json={"question": "q", "block_ids": [block["block_id"]]},
        )
    assert response.status_code == 502
    assert "did not answer with JSON" in response.text


def test_a_fenced_json_answer_is_unwrapped_because_models_fence_anyway(tmp_path: Path) -> None:
    """Unwrapping a fence is not repairing an answer: the object inside is untouched.

    Worth a test because it is the one piece of leniency in `_decode`, and leniency is how a
    "never patch the answer" rule erodes. Everything else about the object still has to be right.
    """
    with harness(tmp_path, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    payload = json.dumps(
        {
            "states": block["text"][:120],
            "interpretation": None,
            "supporting_block_ids": [block["block_id"]],
            "claims": [{"text": block["text"][:60], "supported_by": [block["block_id"]]}],
        }
    )
    model = ScriptedModel(
        [
            {
                "model": "MiniMax-M3",
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "role": "assistant",
                            "content": f"```json\n{payload}\n```",
                        },
                    }
                ],
            }
        ]
    )
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        response = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(alice),
            json={"question": "q", "block_ids": [block["block_id"]]},
        )
    assert response.status_code == 200, response.text
    assert response.json()["answer"]["supportingBlockIds"] == [block["block_id"]]


def test_block_ids_that_are_not_in_this_paper_are_404_before_a_model_is_called(
    tmp_path: Path,
) -> None:
    """`generate_explanation` answers `not_found`, and the route stops there.

    The transport is asserted to have received NOTHING, which is what "before a model is called"
    means — an evidence package assembled around nothing looks, to a model, exactly like a paper
    with nothing in it.
    """
    model = ScriptedModel([])
    with harness(tmp_path, llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        response = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(alice),
            json={"question": "q", "block_ids": ["blk_not_in_this_paper"]},
        )
    assert response.status_code == 404
    assert model.requests == []


def test_an_unauthenticated_ask_is_401(tmp_path: Path) -> None:
    with harness(tmp_path, llm_api_key="k") as h:
        response = h.client.post(
            "/papers/ppr_whatever/ask", json={"question": "q", "block_ids": ["b"]}
        )
    assert response.status_code == 401


# ── cross-owner isolation. WATCHED FAILING — see the PR's mutation table ─────────────────


def _willing_model(block: Mapping[str, Any]) -> ScriptedModel:
    """A model that WOULD answer, so a leak reads as `assert 200 == 404` and not as a crash.

    Written this way after watching the mutation. With `ScriptedModel([])` the leak still turned
    the test red — but as `IndexError: pop from empty list` out of an exhausted script, which is
    red for the right cause with the wrong message. A reviewer reading that failure learns nothing
    about ownership. With a willing model, the mutated route hands BOB a grounded answer quoting
    ALICE's paper, and the assertion says exactly that.
    """
    return ScriptedModel(
        [
            _answer_response(
                {
                    "states": block["text"][:120],
                    "interpretation": None,
                    "supporting_block_ids": [block["block_id"]],
                    "claims": [{"text": block["text"][:60], "supported_by": [block["block_id"]]}],
                }
            )
        ]
    )


def test_user_b_cannot_ask_about_user_as_paper(tmp_path: Path) -> None:
    """#74's non-negotiable, extended to the one route that reads through a different connection.

    Every other paper route reads through `PaperTreeDb` with an `OwnerId`. This one reads through
    `AgentDataHandle`, which binds a raw `user_id` on its own connection — a completely separate
    mechanism, so the isolation the other tests observe says nothing about this route.
    """
    with harness(tmp_path, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    model = _willing_model(block)
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)

        response = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(bob),
            json={"question": "what is this?", "block_ids": [block["block_id"]]},
        )
    assert response.status_code == 404, response.text
    assert model.requests == [], "bob's question reached a model, which means it reached the paper"


def test_user_b_cannot_ask_even_with_the_generation_pinned(tmp_path: Path) -> None:
    """The same assertion with `/ask`'s FIRST gate deliberately removed, so the second is alone.

    `promoted_or_404` returns a pinned `?gen=` without running a query, so this request reaches
    `AgentDataHandle` with no owner-scoped read having happened. What answers 404 is the handle's
    user binding and nothing else — which is why this is the test the mutation is watched on:
    without it, breaking the handle binding leaves a green suite because `promoted_or_404` covers
    for it on the unpinned path.
    """
    with harness(tmp_path, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    model = _willing_model(block)
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        bob = register(h.client, "bob@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)

        response = h.client.post(
            f"/papers/{paper_id}/ask?gen=1",
            headers=auth(bob),
            json={"question": "what is this?", "block_ids": [block["block_id"]]},
        )
    assert response.status_code == 404, response.text
    assert model.requests == []


def test_the_leak_would_have_been_a_real_answer_about_a_real_paper(tmp_path: Path) -> None:
    """Non-vacuity, in `test_isolation.py`'s shape.

    Without this, a route that 404'd for everybody would pass both tests above. Alice asks the
    same question about the same paper with the same pinned generation and gets a grounded answer
    quoting the paper's own text — so the thing withheld from bob is real.
    """
    with harness(tmp_path, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    model = ScriptedModel(
        [
            _answer_response(
                {
                    "states": block["text"][:120],
                    "interpretation": None,
                    "supporting_block_ids": [block["block_id"]],
                    "claims": [{"text": block["text"][:60], "supported_by": [block["block_id"]]}],
                }
            )
        ]
    )
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        response = h.client.post(
            f"/papers/{paper_id}/ask?gen=1",
            headers=auth(alice),
            json={"question": "what is this?", "block_ids": [block["block_id"]]},
        )
    assert response.status_code == 200, response.text
    answer = response.json()["answer"]
    assert answer["states"] == block["text"][:120]
    assert len(answer["supportingBlockIds"]) == 1
    assert len(answer["sourceRegions"]) == 1


def test_the_ask_response_carries_no_owner_handle_and_no_datamark(tmp_path: Path) -> None:
    """AGENTS.md §4, plus one this route adds.

    `own_` is the owner handle and must never cross the wire. The DATAMARK must not either: it is
    the per-request token the system prompt names, and a client that can read it can be asked —
    by injected text in the paper — to send it back somewhere. It is deliberately absent from
    `meta`, which carries the prompt HASH instead.
    """
    with harness(tmp_path, llm_api_key="") as bootstrap:
        alice = register(bootstrap.client, "alice@example.com")
        paper_id = seed_paper(bootstrap.settings, bootstrap.client, alice, SLUG)
        block = _first_paragraph(bootstrap.client, alice, paper_id)

    model = ScriptedModel(
        [
            _answer_response(
                {
                    "states": block["text"][:120],
                    "interpretation": None,
                    "supporting_block_ids": [block["block_id"]],
                    "claims": [{"text": block["text"][:60], "supported_by": [block["block_id"]]}],
                }
            )
        ]
    )
    with harness(tmp_path / "live", llm_transport=model, llm_api_key="k") as h:
        alice = register(h.client, "alice@example.com")
        paper_id = seed_paper(h.settings, h.client, alice, SLUG)
        body = h.client.post(
            f"/papers/{paper_id}/ask",
            headers=auth(alice),
            json={"question": "q", "block_ids": [block["block_id"]]},
        ).text

    datamark = model.requests[0]["body"]["messages"][0]["content"].split("^")[1][:32]
    assert "own_" not in body
    assert "owner_id" not in body
    assert datamark not in body
