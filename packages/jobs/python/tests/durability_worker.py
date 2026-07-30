"""A REAL worker process, started by test_durability.py and killed with SIGKILL.

It is a script, not a test module (pytest will not collect it: no ``test_`` prefix, and it
does no work at import time). It uses only the public papertree_jobs API — a caller who
copied this file would have a working worker.

The handler is data-driven so one script covers both subprocess scenarios: ``steps`` names
the steps, and ``block_at`` names the step that should announce itself and then hang, which
is how the parent gets a deterministic "we are now mid-step" moment to SIGKILL or cancel
at. The block is released by DELETING the block file, so the same script resumes cleanly
when it is started a second time.

Every step invocation appends its name to the side-effect log. That file is the evidence:
a name appearing twice means the step ran twice.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from papertree_jobs import JobContext, JobRunner, JobStore

_DB = Path(os.environ["PT_JOBS_DB"])
_LOG = Path(os.environ["PT_JOBS_LOG"])
_SENTINEL = Path(os.environ["PT_JOBS_SENTINEL"])
_BLOCK = Path(os.environ["PT_JOBS_BLOCK"])
_LEASE = float(os.environ.get("PT_JOBS_LEASE", "0.5"))


def _log(name: str) -> None:
    """Append-and-flush: the parent reads this after SIGKILL, so buffering would lose it."""
    with _LOG.open("a", encoding="utf-8") as handle:
        handle.write(name + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def handler(ctx: JobContext) -> None:
    steps: list[str] = ctx.payload["steps"]
    block_at: str | None = ctx.payload.get("block_at")

    for index, name in enumerate(steps, start=1):

        def body(name: str = name) -> dict[str, object]:
            _log(name)
            if name == block_at:
                _SENTINEL.write_text("mid-step", encoding="utf-8")
                # Hang here until the parent releases us — or kills us.
                while _BLOCK.exists():
                    time.sleep(0.02)
            return {"step": name, "attempt": ctx.attempt}

        ctx.step(name, body)
        ctx.progress(index, len(steps), name)


def main() -> int:
    with JobStore(_DB) as store:
        runner = JobRunner(
            store,
            {"demo": handler},
            worker_id=f"worker:{os.getpid()}",
            lease_seconds=_LEASE,
        )
        deadline = time.time() + 30.0
        while time.time() < deadline:
            job = runner.run_once()
            if job is not None:
                print(f"{job.job_id} {job.state}", flush=True)
                return 0
            time.sleep(0.02)
    print("no job became due", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
