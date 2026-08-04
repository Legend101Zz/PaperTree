"""`POST /papers/{paper_id}/ask` — #76. The Inspector's live agent turn, COMPOSED not rebuilt.

WHAT THIS FILE DOES AND, MORE IMPORTANTLY, WHAT IT REFUSES TO DO

Every hard part of a grounded answer already exists in `packages/agent-tools`, and the
characteristic defect of this repository is building a second copy of one of them beside it
(`findings.md` §A; `paperview.py`'s header; `reachable.spec`'s two issues). So this module is a
composition and the pieces are named:

    load the paper        `ToolContext.view` -> `load_paper_view` -> `PaperIndex.from_reader`
    build the request     `generate_explanation` (tools.py) — expansion + budget + datamark +
                          system prompt, in one registry call. It stops one step short of the
                          model ON PURPOSE (a tool with network egress is the third leg of every
                          Rule-of-Two chain), and this route is the step it stops short of.
    drive the model       `ChatCompletionsTurn` (turn.py) — the shipped tool-calling loop.
    decode the answer     `answer_from_mapping` (answer.py) — every contract rule in one place.
    check the grounding   `verify_grounding` (grounding.py) — deterministic, lexical, FLAGS.
    serialise             `answer_to_wire` (answer.py) — snake_case -> camelCase, mechanical.

Nothing here re-derives expansion, budgeting, token estimation, datamarking or the answer schema.
The two things it genuinely does itself are the `block_id -> resolved text` mapping the verifier
takes (no helper exists — `tools.py` builds it inline too) and the JSON-shape instruction appended
to the system prompt.

THE ANSWER'S GEOMETRY COMES FROM THE PARSE, NEVER FROM THE MODEL

`ANSWER_SCHEMA` lets a draft carry `source_regions`, and a model will happily invent a bbox. The
verified answer's regions are therefore REBUILT here from `verified.supporting_block_ids` against
the indexed view — the same construction `tools.py::_verify_answer_grounding` performs — so a
citation chip outlines a polygon the parser produced. `answer.py` records the residual gap: these
are ADDRESSES, not `Anchor`s, because `@papertree/anchoring` is TypeScript-only (#72). The client
mints the anchor.

FOUR WAYS THIS ROUTE FAILS, AND NONE OF THEM IS A FABRICATED ANSWER

    503  no `PAPERTREE_LLM_API_KEY`. The provider is UNAVAILABLE, not broken. Stated, with the
         variable named, because "the ask button does nothing" is the failure a reader cannot
         diagnose.
    404  the paper is not this caller's, or the cited blocks are not in it.
    502  the model answered, and what it answered cannot be an answer — not JSON, or a contract
         violation such as an empty `supporting_block_ids`. **It is NOT patched into shape.**
         `tools.py` makes the same call for the same reason: "the field the patch would invent is
         exactly the field the reader is being asked to trust." The reader sees an error; the
         Inspector renders a designed state for it.
    504  the model kept asking for tools until the step budget ran out (`TurnDidNotFinish`).

OWNERSHIP, WHICH IS TWO GATES AND ONE SURPRISE

`promoted_or_404` is owner-scoped through `call.db_owner`, and `AgentDataHandle` is bound to
`call.user_id`. The surprise is in `deps.py`'s header and is worth repeating: that handle takes a
**user_id**, not an `OwnerId`. It opens its own guarded read-only connection, so a handle minted on
the `PaperTreeDb` connection would not resolve on it. `OwnerId` still never crosses the wire.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import replace
from typing import Annotated, Any

from fastapi import FastAPI, HTTPException, Query, status
from papertree_agent_tools import (
    ANSWER_SCHEMA,
    AnswerContractError,
    ChatCompletionsTurn,
    GroundedAnswer,
    PaperView,
    SourceRegion,
    ToolContext,
    ToolRegistry,
    TurnDidNotFinish,
    answer_from_mapping,
    answer_to_wire,
    build_registry,
    strip_reasoning_envelope,
    target_type_for_block_type,
    verify_grounding,
)
from papertree_db import PaperId, generation
from papertree_prompts import TurnCaps, prompt_hash
from pydantic import BaseModel, Field

from .deps import AgentHandleDep, CallerDep, ProviderDep, promoted_or_404

#: Built once per process, shared across turns, holds no handle and no tenant. `tools.py` is
#: explicit that this is cheap and side-effect-free, and that a registry needing a handle would be
#: "a registry with a tenant baked into it".
REGISTRY: ToolRegistry = build_registry()

#: The ordinary reading turn: paper text in context, no library reach, no writes. `toolset_for`
#: maps this triple to `READ_ONLY_SINGLE_PAPER`, which is §13.6(e) Attack 2's stopping point — a
#: turn that cannot name a second paper because no tool has an argument in which to name one.
ASK_CAPS = TurnCaps(untrusted_input=True, sensitive_scope=False, state_or_egress=False)

#: Appended to `build_system_prompt`'s output, on the TRUSTED side of the datamark.
#:
#: `papertree_prompts` owns the security half of the prompt and this service does not edit it; what
#: it does not own is the OUTPUT SHAPE, which is `packages/agent-tools`' `ANSWER_SCHEMA`. Rendering
#: the schema itself rather than prose describing it means the instruction cannot drift from the
#: decoder: `answer_from_mapping` and this string read the same object.
ANSWER_INSTRUCTION = (
    "\n\nWhen you have finished using tools, reply with ONE JSON object and nothing else — no "
    "prose before or after it, no code fence. It must satisfy this JSON Schema:\n"
    + json.dumps(ANSWER_SCHEMA, sort_keys=True)
    + "\n`states` is what the paper says, `interpretation` is your reading of it and is null when "
    "the answer is purely extractive. `supporting_block_ids` must name real block ids you read "
    "with a tool; an answer that names none is rejected and shown to the reader as a failure."
)


class Ask(BaseModel):
    """What the Inspector sends. The paper and generation are in the URL, never in the body."""

    question: str = Field(min_length=1, max_length=2000)
    #: The blocks the reader selected. `generate_explanation`'s structure-aware expansion adds the
    #: rest, so this is a seed and not the evidence set. Capped because the expansion ladder and
    #: the token budget both scale with it and a 10,000-id body is a denial of service, not a
    #: question.
    block_ids: list[str] = Field(min_length=1, max_length=64)


def mount_ask(app: FastAPI) -> None:
    @app.post("/papers/{paper_id}/ask")
    async def ask(
        call: CallerDep,
        handle: AgentHandleDep,
        provider: ProviderDep,
        paper_id: str,
        body: Ask,
        gen: Annotated[int | None, Query()] = None,
    ) -> dict[str, Any]:
        if not provider.available:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "no model credential is configured: set PAPERTREE_LLM_API_KEY. The reader, the "
                "document and every highlight still work; only /ask needs a key.",
            )

        context = ToolContext(
            handle,
            paper_id=PaperId(paper_id),
            generation=generation(promoted_or_404(call, paper_id, gen)),
            # One id per request. There is no persisted chat session in v2 yet, and inventing a
            # stable one here would make `retrieve_previous_questions` look implemented.
            session_id=f"ses_ask_{call.user_id}",
            caps=ASK_CAPS,
        )
        try:
            view = context.view
        except KeyError as exc:
            # The handle is owner-bound, so "not yours" and "not there" arrive identically. That
            # is the answer that leaks least — `test_isolation.py`'s "WHY 404 AND NOT 403".
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such paper") from exc

        built = await REGISTRY.call(
            "generate_explanation",
            {"question": body.question, "block_ids": body.block_ids},
            context=context,
        )
        if not built.ok:
            raise HTTPException(status.HTTP_404_NOT_FOUND, built.reason)

        system_prompt = str(built.data["system_prompt"]) + ANSWER_INSTRUCTION
        user_message = f"{body.question}\n\n{built.data['untrusted_evidence']}"
        try:
            outcome = await ChatCompletionsTurn(REGISTRY, provider).run(
                system_prompt=system_prompt, user_message=user_message, context=context
            )
        except TurnDidNotFinish as exc:
            raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, str(exc)) from exc

        verified = verify_grounding(_decode(outcome.text), _resolved_text(view))
        # The model's own `source_regions` are DISCARDED and rebuilt from the parse. See the header:
        # a bbox is geometry, and the model has no way to know one. `replace` rather than a second
        # dict so the result is still a `GroundedAnswer` and still goes through ONE serialiser.
        grounded = replace(verified, source_regions=_regions(view, verified))
        return {
            "answer": answer_to_wire(grounded),
            "meta": {
                "model": outcome.model,
                "steps": outcome.steps,
                "inputTokens": outcome.input_tokens,
                "outputTokens": outcome.output_tokens,
                # The tools the model ACTUALLY called. Reported because a turn that dispatched
                # nothing and answered anyway is an ungrounded answer wearing a grounded shape,
                # and it is indistinguishable from a good one in the answer body alone.
                "toolCalls": [dispatched.as_dict() for dispatched in outcome.calls],
                "evidenceBlockIds": list(built.data["evidence_block_ids"]),
                # The system prompt this answer was produced under, as the hash
                # `papertree_db.create_derivation` stores. The prompt itself is NOT returned: it
                # names the per-request datamark, and a token the client can read is a token an
                # injected instruction can name.
                "systemPromptHash": prompt_hash(system_prompt),
            },
        }


def _decode(text: str) -> GroundedAnswer:
    """The model's final message as a draft answer, or 502. Never repaired into shape.

    TWO UNWRAPPINGS, AND THEY ARE NOT REPAIRS. The bytes the model committed to as its answer are
    passed to `json.loads` exactly as sent; what is removed is packaging that is not part of the
    answer at all:

      * `<think>…</think>` — MiniMax-M3 is a reasoning model and puts its chain of thought in
        `message.content` ahead of the reply. MEASURED on a live call, not anticipated; see
        `turn.strip_reasoning_envelope`.
      * a ``` fence — models fence JSON despite being told not to.

    Anything else that fails to parse is a 502. In particular there is no scan for "the first `{`
    to the last `}`", because that would start finding an answer inside prose, and a route that
    can extract an answer from a refusal is a route that will.
    """
    stripped = strip_reasoning_envelope(text).strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[-1].removesuffix("```").strip().removesuffix("```")
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"the model did not answer with JSON: {exc}. Nothing was returned to the reader, "
            "because a failed generation is never presented as content (EPIC-03 §4).",
        ) from exc
    if not isinstance(payload, Mapping):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "the model answered with JSON that is not an object"
        )
    try:
        return answer_from_mapping(payload)
    except AnswerContractError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"the model's answer violates the answer contract and was NOT patched into shape: "
            f"{exc}",
        ) from exc


def _resolved_text(view: PaperView) -> dict[str, str]:
    """`block_id -> resolved reading`, which is what `verify_grounding` documents it wants.

    `IndexedBlock.text` and NOT `PaperView.raw_text`: the latter is `blocks.text` verbatim and
    unrepaired, and exists so `save_user_note` can verify an offset against the column the offsets
    are defined in. Verifying a claim against it would score the answer against a reading the
    reader is not being shown. There is no helper for this — `tools.py` builds the same mapping
    inline — so the two must agree by construction, which is why both walk `index.reading_order`.
    """
    return {
        block_id: block.text
        for block_id in view.index.reading_order
        if (block := view.index.block(block_id)) is not None
    }


def _regions(view: PaperView, answer: GroundedAnswer) -> tuple[SourceRegion, ...]:
    """Citable addresses for the answer's supporting blocks, resolved from the PARSE.

    Byte-for-byte the construction `tools.py::_verify_answer_grounding` performs, including the
    `"p3 · figure"` label, so a chip rendered from this route and a chip rendered from that tool
    carry the same key. A block id the answer cites that is not in this generation is DROPPED here
    and still flagged by the verifier, which is where the reader learns about it.
    """
    return tuple(
        SourceRegion(
            block_id=block.block_id,
            page_index=block.page_index,
            bbox=block.bbox,
            target_type=target_type_for_block_type(block.type),
            label=f"p{block.page_index + 1} · {block.type}",
        )
        for block_id in answer.supporting_block_ids
        if (block := view.index.block(block_id)) is not None
    )
