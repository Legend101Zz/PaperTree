"""The FakeAgent as a REAL local server, for the acceptance run over real HTTP (not a test module).

    uv run python services/api/python/tests/fake_agent_server.py --port 18710 --secret S

It binds 127.0.0.1 only and speaks exactly what ``services/agent`` speaks to the API (contracts.md
§3.2): ``POST /v1/runs`` (the fixture replay, with the real ``event:``/``data:``/``: ping``
framing, and REAL tool calls back to the API's ``tool.base_url`` with the run token),
``DELETE /v1/runs/{id}``, ``GET /healthz``. Two test-only routes steer it: ``POST /_fake/script``
queues a one-shot script (``{fixture, hold_after_text?, drop_after_text?, status?, done_patch?}``)
and ``GET /_fake/log`` reports what it received. Default fixtures: a summary run replays
``summary-ok``, a follow-up (``history`` set) ``followup-ok``, anything else ``explain-ok``.

NOT the product's agent and never started by the product: it has no model, no key, and exists so
the API half (S5b) can be walked end to end before the Pi agent (S5a) is merged.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402
from fake_agent import FakeAgent, Script  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import JSONResponse, Response, StreamingResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402


def default_script(body: dict[str, Any]) -> Script:
    if body.get("kind") == "summary":
        return Script("summary-ok")
    if body.get("history"):
        return Script("followup-ok")
    return Script("explain-ok")


def build(secret: str) -> tuple[Starlette, FakeAgent]:
    fake = FakeAgent([], secret=secret, choose=default_script)

    async def runs(request: Request) -> Response:
        status, answer = fake.start(dict(request.headers), await request.body())
        if isinstance(answer, dict):
            return JSONResponse(answer, status_code=status)
        return StreamingResponse(answer, media_type="text/event-stream")

    async def cancel(request: Request) -> Response:
        return Response(status_code=fake.cancel(request.path_params["run_id"]))

    async def healthz(_: Request) -> Response:
        return JSONResponse(fake.healthz())

    async def script(request: Request) -> Response:
        spec = await request.json()
        fake.queued.append(Script(**spec))
        return JSONResponse({"queued": len(fake.queued)})

    async def log(_: Request) -> Response:
        return JSONResponse(
            {
                "runs": [r["run_id"] for r in fake.requests],
                "kinds": [r["kind"] for r in fake.requests],
                "deletes": fake.deletes,
                "contract_errors": fake.contract_errors,
                "tool_logs": [c.tool_log for c in fake.contexts],
                "request_ids": [h.get("x-request-id") for h in fake.headers],
            }
        )

    app = Starlette(
        routes=[
            Route("/v1/runs", runs, methods=["POST"]),
            Route("/v1/runs/{run_id}", cancel, methods=["DELETE"]),
            Route("/healthz", healthz, methods=["GET"]),
            Route("/_fake/script", script, methods=["POST"]),
            Route("/_fake/log", log, methods=["GET"]),
        ]
    )
    return app, fake


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--secret", required=True)
    args = parser.parse_args()
    app, _fake = build(args.secret)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
