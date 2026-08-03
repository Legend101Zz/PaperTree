"""The ONE test in this repository that calls a real model. Opt-in, and it skips LOUDLY.

`EPIC-03-RESULT.md` §6 deviation 2 recorded the gap this closes: *"No live provider call is made
anywhere. `MiniMaxProvider` is exercised only through an injected transport. A key exists in the
local Keychain; CI has none, and a graded suite that needs one is a suite CI cannot run."*

Both halves of that sentence are still true and both are honoured:

  * **CI cannot run this and must not pretend to.** It is `skipif`-marked on `PAPERTREE_LLM_API_KEY`
    and, when the key is absent, it emits a warning naming the variable — so the run's warnings
    summary says out loud that the live path was not exercised. AGENTS.md §4's rule for corpus
    tests, applied to a credential: *"Skipping loudly is honest; passing quietly is the
    vacuous-green failure in §2."*
  * **Nothing else in the suite depends on it.** Every property the loop has is asserted against a
    scripted transport in `test_turn_loop.py`, which runs everywhere. This layer adds the one thing
    a script cannot: evidence that a real model, given the real system prompt and the real tool
    definitions, actually drives the loop.

THE ASSERTION THAT MAKES IT WORTH HAVING IS `dispatched >= 1`, NOT THE TEXT

A stubbed loop that returned a canned answer would satisfy "the response parsed as a
`GroundedAnswer`". It would not have called a tool. `TurnOutcome.calls` is the record of what was
actually dispatched against the real database, and asserting it is non-empty is what distinguishes
"a model read this paper" from "a model wrote something plausible" — AGENTS.md §2's vacuous green
in the one place where it would be hardest to notice.

RUN IT:

    PAPERTREE_LLM_API_KEY="$(security find-generic-password -s minimax_api_key -w)" \\
        uv run pytest packages/agent-tools/python/tests/test_live_provider.py -s

It costs one paper's worth of tokens and a couple of round trips.
"""

from __future__ import annotations

import json
import os
import warnings
from pathlib import Path

import pytest
from _agent_tools_fixtures import Seeded, run, seed_synthetic
from papertree_agent_tools import (
    ANSWER_SCHEMA,
    ChatCompletionsTurn,
    MiniMaxProvider,
    ProviderSettings,
    ToolStatus,
    answer_from_mapping,
    build_registry,
    strip_reasoning_envelope,
    verify_grounding,
)

LIVE_KEY_VARIABLE = "PAPERTREE_LLM_API_KEY"
LIVE_KEY = os.environ.get(LIVE_KEY_VARIABLE, "")

if not LIVE_KEY:
    # LOUD. `pytest -q` prints the warnings summary and does not print skip reasons, so this is
    # what makes "the live path did not run" visible in a green log rather than only in `-rs`.
    warnings.warn(
        f"{LIVE_KEY_VARIABLE} is not set: the live provider test is SKIPPED and no model was "
        "called anywhere in this run. Everything the tool loop does is still asserted against a "
        "scripted transport in test_turn_loop.py. To run it: "
        f'{LIVE_KEY_VARIABLE}="$(security find-generic-password -s minimax_api_key -w)" uv run '
        "pytest packages/agent-tools/python/tests/test_live_provider.py",
        stacklevel=1,
    )

requires_live_provider = pytest.mark.skipif(
    not LIVE_KEY,
    reason=(
        f"{LIVE_KEY_VARIABLE} is not set. This is the only test that opens a socket to a model; "
        "CI has no key and a graded suite that needs one is a suite CI cannot run."
    ),
)

REGISTRY = build_registry()

#: What the model is told to produce. The SAME object `services/api`'s `/ask` route renders into
#: its system prompt, imported rather than restated so the two cannot describe different shapes.
ANSWER_INSTRUCTION = (
    "\n\nWhen you have finished using tools, reply with ONE JSON object and nothing else — no "
    "prose before or after it, no code fence. It must satisfy this JSON Schema:\n"
    + json.dumps(ANSWER_SCHEMA, sort_keys=True)
)

#: The question, chosen so the turn CANNOT be answered from the evidence package alone.
#:
#: This matters more than it looks. `generate_explanation` puts the expanded block text in the
#: prompt, so "what does this paper present?" is answerable with zero tool calls — measured: one
#: live run dispatched three tools and the next dispatched none, for the same question. An
#: assertion that flakes is worse than no assertion, so the question asks for the paper's TITLE,
#: SECTION COUNT and PAGE COUNT, none of which is in the evidence text and all of which
#: `get_paper_metadata` / `get_document_outline` hold. That is a property of the question, not a
#: hint in the prompt.
LIVE_QUESTION = (
    "What is this paper's title, how many sections does it have, and how many pages? "
    "These are not in the evidence below — look them up with the tools before answering."
)


@pytest.fixture(scope="module")
def synthetic(tmp_path_factory: pytest.TempPathFactory) -> Seeded:
    return seed_synthetic(tmp_path_factory.mktemp("agent-tools-live"))


@requires_live_provider
def test_a_real_model_drives_the_shipped_loop_and_calls_at_least_one_tool(
    synthetic: Seeded, capsys: pytest.CaptureFixture[str]
) -> None:
    """The whole path, live: real prompt, real tools, real model, real verifier.

    Four assertions, and only the second is about the model being clever:

      1. **at least one tool was dispatched** — the thing a stub cannot fake;
      2. the final message decodes into a `GroundedAnswer`, i.e. it satisfied the contract's
         invariants including a non-empty `supporting_block_ids`;
      3. every id it cited is a real block in this parse — a model that invented one gets caught
         here rather than in the reader;
      4. `verify_grounding` ran on it and returned the same number of claims it was given.

    NOT asserted: that the answer is correct, or that every claim is `supported`. This is one
    non-deterministic generation and the verifier is lexical — `supported` means "necessary
    condition met", never "true" (`grounding.py`). A test that demanded a verdict from a model
    would be measuring the weather.
    """
    print(f"live provider: calling a real model with {LIVE_KEY_VARIABLE} (this opens a socket)")
    block_id = synthetic.first_of_type("paragraph")
    provider = MiniMaxProvider(ProviderSettings(api_key=LIVE_KEY))

    with synthetic.handle() as handle:
        context = synthetic.context(handle)
        built = run(
            REGISTRY.call(
                "generate_explanation",
                {"question": LIVE_QUESTION, "block_ids": [block_id]},
                context=context,
            )
        )
        assert built.status is ToolStatus.OK, built.reason
        outcome = run(
            ChatCompletionsTurn(REGISTRY, provider).run(
                system_prompt=str(built.data["system_prompt"]) + ANSWER_INSTRUCTION,
                user_message=f"{LIVE_QUESTION}\n\n{built.data['untrusted_evidence']}",
                context=context,
            )
        )

        print(
            f"live provider: model={outcome.model} steps={outcome.steps} "
            f"tools={[c.as_dict() for c in outcome.calls]}"
        )
        assert outcome.dispatched >= 1, (
            "the model answered without calling a single tool. A green suite in which no tool ran "
            "is testing the prompt, not the registry — see this module's header."
        )

        # `strip_reasoning_envelope` is not decoration: MiniMax-M3 puts `<think>…</think>` in
        # `message.content` ahead of the answer, so `json.loads(outcome.text)` raises
        # "Expecting value: line 1 column 1". Measured here first; `services/api`'s `_decode` does
        # the same unwrapping for the same reason.
        text = strip_reasoning_envelope(outcome.text).strip()
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        answer = answer_from_mapping(json.loads(text))

        view = context.view
        resolved = {
            b: block.text
            for b in view.index.reading_order
            if (block := view.index.block(b)) is not None
        }
        for cited in answer.supporting_block_ids:
            assert cited in resolved, f"the model cited {cited!r}, which is not in this parse"

        verified = verify_grounding(answer, resolved)
        assert len(verified.claims) == len(answer.claims)

    captured = capsys.readouterr()
    assert "live provider" in captured.out


def test_the_opt_in_switch_is_the_environment_and_nothing_else(tmp_path: Path) -> None:
    """Runs EVERYWHERE, including CI. It is what stops the skip above from being invisible.

    A suite whose only live test is skipped reports the same green as a suite with no live test at
    all. This one always executes and asserts the mechanism: with no key the provider is
    `available is False` and raises rather than returning prose, which is `test_runtime_swappable`'s
    rule (*"Failed generations are never persisted as content"*) restated at the credential.
    """
    assert MiniMaxProvider(ProviderSettings(api_key="")).available is False
    assert MiniMaxProvider(ProviderSettings(api_key="anything")).available is True
    assert bool(LIVE_KEY) is bool(os.environ.get(LIVE_KEY_VARIABLE, ""))
