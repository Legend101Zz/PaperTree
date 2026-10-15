# ruff: noqa: E501
"""Run `python -m papertree_api` with the API's hardcoded model made to follow the agent's arm.

MEASUREMENT ONLY. As of this writing `services/api` pins one model in three places:

  * `schemas.AgentRun.model` is `Literal["minimax/MiniMax-M3"]`, so a Flash `run` event fails to parse;
  * `agent_client.MODEL = "MiniMax-M3"` is what `ai_runs.model`, `RunSummary.model` and a stored
    summary's `model_id` get, whatever the agent reports (the `run` event's `model` is read and dropped).

This launcher patches both IN MEMORY, in its own process, so the A/B can run before the API is fixed.
Nothing in services/api is edited. With the shim, `ai_runs.model` is the arm's label because the
bench says so (PAPERTREE_BENCH_MODEL), not because the API stored what the agent reported. Delete
this file once the API stores the agent's model.
"""

from __future__ import annotations

import os
import runpy

from papertree_api import agent_client, schemas
from pydantic import Field

model = os.environ.get("PAPERTREE_BENCH_MODEL", "MiniMax-M3")


class _AgentRunAnyMiniMax(schemas.AgentRun):
    model: str = Field(pattern=r"^minimax/MiniMax-[A-Za-z0-9.\-]+$")  # type: ignore[assignment]


schemas.AGENT_EVENTS["run"] = _AgentRunAnyMiniMax
agent_client.AgentRun = _AgentRunAnyMiniMax  # type: ignore[misc]
agent_client.MODEL = model  # type: ignore[misc]

runpy.run_module("papertree_api.__main__", run_name="__main__")
