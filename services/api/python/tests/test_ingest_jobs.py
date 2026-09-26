"""S1: the parse job's life as the library sees it — polling states, `GET /jobs/{id}`, re-parse,
delete, and a worker SIGKILLed between two steps (contracts.md §2.2, the worker job contract).

Regression tests named by slice-plan §S1: `test_promote_is_a_durable_step`,
`test_reparse_creates_generation_2`.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest
from api_support import assert_envelope, auth, harness, register
from papertree_document_worker import job as job_module
from papertree_document_worker.job import unreadable_reason
from test_ingest_helpers import (
    GARBAGE_PDF,
    UNCOUNTABLE_PDF,
    Gate,
    drain,
    encrypted_pdf,
    library,
    row_for,
    sql,
    synthetic_pdf,
    upload,
    worker_thread,
    write_sql,
)


def test_polling_shows_queued_then_reading_with_its_step_then_ready(tmp_path: Path) -> None:
    """Journey A's card, server side: every state is read off `GET /papers` alone, with no client
    state. The worker is held at the start of `persist` and then of `promote`, so each poll lands
    on a known step boundary rather than on a race."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = upload(h.client, token, synthetic_pdf()).json()["paper_id"]
        assert row_for(h.client, token, paper_id)["processing"] == "queued"

        gate = Gate("persist", "promote")
        with worker_thread(h.settings, gate):
            gate.wait_for("persist")
            row = row_for(h.client, token, paper_id)
            assert row["processing"] == "reading"
            assert {k: row["job"][k] for k in ("state", "step", "done", "total", "attempt")} == {
                "state": "running",
                "step": "persist",
                "done": 1,
                "total": 3,
                "attempt": 1,
            }
            assert row["generation"] is None and row["page_count"] == 2
            gate.release["persist"].set()

            gate.wait_for("promote")
            row = row_for(h.client, token, paper_id)
            assert (row["processing"], row["job"]["step"], row["job"]["done"]) == (
                "reading",
                "promote",
                2,
            )
            # Stored, not yet promoted: the reader still gets "not parsed yet".
            assert_envelope(
                h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)), 409, "not_parsed"
            )
            gate.release["promote"].set()

        row = row_for(h.client, token, paper_id)
        assert (row["processing"], row["generation"], row["job"]["state"]) == (
            "ready",
            1,
            "succeeded",
        )
        assert (row["job"]["step"], row["job"]["done"], row["job"]["total"]) == (None, 3, 3)
        assert h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).status_code == 200


def test_unreadable_reason_blames_the_file_only_when_pymupdf_cannot_read_it(tmp_path: Path) -> None:
    """The check `job.py` makes before it calls a parse failure the FILE's (`pdf_unreadable`)."""
    cases = {
        "readable": (synthetic_pdf(), None),
        "uncountable": (UNCOUNTABLE_PDF, "RuntimeError: code=7: Invalid number of pages"),
        "encrypted": (encrypted_pdf(), "the PDF needs a password to open"),
        "garbage": (GARBAGE_PDF, "FileDataError: Failed to open stream"),
    }
    for name, (data, expected) in cases.items():
        path = tmp_path / f"{name}.pdf"
        path.write_bytes(data)
        assert unreadable_reason(str(path)) == expected, name
    # A missing file says nothing about the PDF: the parser's own error stands.
    assert unreadable_reason(str(tmp_path / "missing.pdf")) is None


def test_a_parser_failure_on_a_readable_pdf_stays_internal_and_is_retried(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The other side of `pdf_unreadable`: the same bare `RuntimeError` PyMuPDF raised for the
    uncountable page tree, raised by the parser on a file PyMuPDF CAN read, is a parser fault, not
    the user's file. It stays `internal` and is retried with backoff (never final on attempt 1)."""

    def broken(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("code=7: a parser bug, not the file")

    monkeypatch.setattr(job_module, "parse_document", broken)
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        job_id = upload(h.client, token, synthetic_pdf()).json()["job_id"]
        drain(h.settings)
        (job,) = sql(h.settings, "SELECT state, attempt, error FROM jobs")
        assert (job["state"], job["attempt"]) == ("pending", 1), "rescheduled, not dead-lettered"
        assert job["error"] == "RuntimeError: code=7: a parser bug, not the file"
        body = h.client.get(f"/jobs/{job_id}", headers=auth(token)).json()
        assert (body["state"], body["error_code"]) == ("pending", "internal")


def test_get_job_carries_the_error_code_and_not_the_error_text(tmp_path: Path) -> None:
    """§2.2: "the existing shape plus `error_code` (the raw `error` text stays in logs and the
    DB)". WATCHED FAILING at base: the body carried `error: "FileDataError: Failed to open
    stream"` and no `error_code`."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        job_id = upload(h.client, token, GARBAGE_PDF).json()["job_id"]
        drain(h.settings)
        body = h.client.get(f"/jobs/{job_id}", headers=auth(token)).json()
        assert "error" not in body
        assert (body["state"], body["error_code"], body["attempt"], body["is_terminal"]) == (
            "dead_letter",
            "pdf_unreadable",
            1,
            True,
        )
        assert body["steps"] == [{"name": "parse", "index": 0, "state": "failed"}]
        other = register(h.client, "other@example.com")
        assert_envelope(h.client.get(f"/jobs/{job_id}", headers=auth(other)), 404, "not_found")


def test_the_worker_logs_claim_steps_and_done_as_json_with_the_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """contracts.md §8: `job.claim`, `job.step {step, ms, parser_version, status}`, `job.done` —
    and a failure's code AND text. WATCHED FAILING at base: the worker logged, not as JSON, only
    `job … (parse) -> dead_letter`, with no reason anywhere but the jobs table."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        good = upload(h.client, token, synthetic_pdf()).json()
        bad = upload(h.client, token, GARBAGE_PDF).json()
        capsys.readouterr()
        drain(h.settings)
        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    worker = [line for line in lines if line["service"] == "worker"]
    by_job = {
        job_id: [
            (line["event"], line.get("step"), line.get("status"))
            for line in worker
            if line.get("job_id") == job_id
        ]
        for job_id in (good["job_id"], bad["job_id"])
    }
    assert by_job[good["job_id"]] == [
        ("job.claim", None, None),
        ("job.step", "parse", "succeeded"),
        ("job.step", "persist", "succeeded"),
        ("job.step", "promote", "succeeded"),
        ("job.done", None, "succeeded"),
    ]
    assert by_job[bad["job_id"]] == [
        ("job.claim", None, None),
        ("job.step", "parse", "failed"),
        ("job.done", None, "dead_letter"),
    ]
    steps = [line for line in worker if line["event"] == "job.step"]
    assert all(
        isinstance(line["ms"], float) and line["parser_version"] == "1.0.0" for line in steps
    )
    (done,) = [
        line for line in worker if line["event"] == "job.done" and line["job_id"] == bad["job_id"]
    ]
    assert (done["level"], done["error_code"], done["outcome"]) == (
        "error",
        "pdf_unreadable",
        "dead_letter",
    )
    assert done["error"] == "[pdf_unreadable] FileDataError: Failed to open stream"
    assert {line["paper_id"] for line in worker if "job_id" in line} == {
        good["paper_id"],
        bad["paper_id"],
    }
    claim = next(line for line in worker if line["event"] == "job.claim")
    assert set(claim) >= {
        "ts",
        "level",
        "service",
        "event",
        "job_id",
        "user_ref",
        "attempt",
        "generation",
    }


def test_reparse_creates_generation_2(tmp_path: Path) -> None:
    """§2.2: `POST /reparse` -> 202 with `generation = next_generation`; 409 `busy` while it is
    queued; the new generation is promoted; generation 1's rows are KEPT; the library still has
    ONE row. WATCHED FAILING at base: 501 (and `GET /papers` listed one row per generation)."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = upload(h.client, token, synthetic_pdf()).json()["paper_id"]
        drain(h.settings)

        assert_envelope(
            h.client.post(
                f"/papers/{paper_id}/reparse", headers=auth(token), json={"reason": None}
            ),
            422,
            "validation_failed",
        )
        accepted = h.client.post(
            f"/papers/{paper_id}/reparse", headers=auth(token), json={"reason": "a better parser"}
        )
        assert accepted.status_code == 202, accepted.text
        assert accepted.json()["generation"] == 2
        assert_envelope(
            h.client.post(f"/papers/{paper_id}/reparse", headers=auth(token), json={}), 409, "busy"
        )
        # While generation 2 is queued the paper stays READY on generation 1 (§2.2), and the
        # row's job is the re-parse.
        row = row_for(h.client, token, paper_id)
        assert (
            row["processing"],
            row["generation"],
            row["job"]["job_id"],
            row["job"]["state"],
        ) == (
            "ready",
            1,
            accepted.json()["job_id"],
            "pending",
        )

        drain(h.settings)

        (row,) = library(h.client, token)
        assert (row["processing"], row["generation"], row["job"]["state"]) == (
            "ready",
            2,
            "succeeded",
        )
        generations = [
            r["generation"]
            for r in sql(h.settings, "SELECT generation FROM papers ORDER BY generation")
        ]
        assert generations == [1, 2]
        assert h.client.get(f"/papers/{paper_id}/ir", headers=auth(token)).json()["generation"] == 2
        assert (
            h.client.get(f"/papers/{paper_id}/ir?gen=1", headers=auth(token)).json()["generation"]
            == 1
        )
        (key,) = sql(
            h.settings,
            "SELECT idempotency_key FROM jobs WHERE job_id = ?",
            (accepted.json()["job_id"],),
        )
        assert key["idempotency_key"].endswith(f":{paper_id}:g2:a1")
        assert (h.settings.asset_root / paper_id / "2" / "figures").is_dir()
        assert list(h.settings.staging_root.iterdir()) == [], "promotion deletes the staged JSON"

        other = register(h.client, "other@example.com")
        assert_envelope(
            h.client.post(f"/papers/{paper_id}/reparse", headers=auth(other), json={}),
            404,
            "not_found",
        )


def test_delete_removes_the_rows_the_jobs_and_the_files(tmp_path: Path) -> None:
    pdf = synthetic_pdf()
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = upload(h.client, token, pdf).json()["paper_id"]
        drain(h.settings)
        assert (h.settings.asset_root / paper_id).is_dir()
        other = register(h.client, "other@example.com")
        assert_envelope(
            h.client.delete(f"/papers/{paper_id}", headers=auth(other)), 404, "not_found"
        )

        response = h.client.delete(f"/papers/{paper_id}", headers=auth(token))
        assert response.status_code == 204, response.text

        assert library(h.client, token) == []
        for table in (
            "paper_owners",
            "papers",
            "pages",
            "blocks",
            "paper_promotions",
            "jobs",
            "job_steps",
        ):
            assert sql(h.settings, f"SELECT * FROM {table}") == [], table
        assert not (h.settings.upload_root / f"{paper_id}.pdf").exists()
        assert not (h.settings.asset_root / paper_id).exists()
        assert list(h.settings.staging_root.iterdir()) == []
        assert_envelope(
            h.client.get(f"/papers/{paper_id}/file", headers=auth(token)), 404, "not_found"
        )
        assert_envelope(
            h.client.delete(f"/papers/{paper_id}", headers=auth(token)), 404, "not_found"
        )

        # The same bytes again are a new paper with a new job, not the deleted job handed back.
        again = upload(h.client, token, pdf).json()
        assert (again["paper_id"], again["created"]) == (paper_id, True)


def test_a_paper_deleted_mid_parse_is_not_resurrected_by_its_worker(tmp_path: Path) -> None:
    """The worker is held at the start of `persist` while the paper is deleted. Its lease check
    finds the job row gone and it writes NOTHING: no `paper_owners` row re-created by
    `put_paper`, no generation, no crops left behind."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        paper_id = upload(h.client, token, synthetic_pdf()).json()["paper_id"]
        gate = Gate("persist")
        with worker_thread(h.settings, gate):
            gate.wait_for("persist")
            assert (h.settings.asset_root / paper_id).is_dir(), "the parse wrote its crops"
            assert h.client.delete(f"/papers/{paper_id}", headers=auth(token)).status_code == 204
            gate.release["persist"].set()
        for table in ("paper_owners", "papers", "jobs"):
            assert sql(h.settings, f"SELECT * FROM {table}") == [], table
        assert library(h.client, token) == []
        assert not (h.settings.asset_root / paper_id).exists()
        assert list(h.settings.staging_root.iterdir()) == []


def test_a_generation_already_stored_by_a_dead_attempt_is_kept_and_promoted(tmp_path: Path) -> None:
    """A kill can land INSIDE persist: after `put_paper` committed, before the step's checkpoint.
    The resumed persist must find the generation and keep it, not fail on the duplicate key.
    Staged as exactly that: the job is put back to the state such a kill leaves."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        body = upload(h.client, token, synthetic_pdf()).json()
        gate = Gate("promote")
        with worker_thread(h.settings, gate):
            gate.wait_for("promote")
            # Persist committed its rows AND its checkpoint. Undo only the checkpoint: now it is
            # a persist whose put_paper committed and whose worker died before recording it.
            write_sql(
                h.settings,
                "DELETE FROM job_steps WHERE job_id = ? AND step_name = 'persist'",
                (body["job_id"],),
            )
            write_sql(
                h.settings,
                "UPDATE jobs SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL, "
                "run_after = 0 WHERE job_id = ?",
                (body["job_id"],),
            )
            gate.release["promote"].set()  # the held worker's lease is gone: it abandons
        # ...without promoting: its promote body ran, and its write was fenced on the lease.
        assert sql(h.settings, "SELECT * FROM paper_promotions") == []
        drain(h.settings)
        row = row_for(h.client, token, body["paper_id"])
        assert (row["processing"], row["generation"], row["job"]["attempt"]) == ("ready", 1, 2)
        (persist,) = sql(
            h.settings,
            "SELECT result FROM job_steps WHERE job_id = ? AND step_name = 'persist'",
            (body["job_id"],),
        )
        assert json.loads(persist["result"])["outcome"] == "already stored"


@pytest.mark.parametrize("step", ["persist", "promote"])
def test_a_worker_that_lost_its_lease_mid_step_writes_nothing(tmp_path: Path, step: str) -> None:
    """The lease is checked before and after a step body, never during it. So a worker held at
    the start of `step` has its job taken by another worker (its lease reassigned), then resumes:
    its body must NOT store the generation / promote it. The write is fenced on the lease inside
    the same `BEGIN IMMEDIATE` (`job.py`). WATCHED FAILING with the fence removed: the held worker
    wrote a `papers` row (persist) / a `paper_promotions` row (promote) for a job it no longer
    held."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        body = upload(h.client, token, synthetic_pdf()).json()
        gate = Gate(step)
        with worker_thread(h.settings, gate):
            gate.wait_for(step)
            write_sql(
                h.settings,
                "UPDATE jobs SET lease_owner = 'another-host:1', lease_expires_at = ? "
                "WHERE job_id = ?",
                (time.time() + 600, body["job_id"]),
            )
            gate.release[step].set()
        table = "papers" if step == "persist" else "paper_promotions"
        assert sql(h.settings, f"SELECT * FROM {table}") == [], f"a superseded {step} wrote"
        (job,) = sql(h.settings, "SELECT state, lease_owner FROM jobs")
        assert (job["state"], job["lease_owner"]) == ("running", "another-host:1")
        assert row_for(h.client, token, body["paper_id"])["processing"] == "reading"


_HOLD_BEFORE_PROMOTE = textwrap.dedent(
    """
    import sys, time
    from pathlib import Path
    from papertree_api.settings import Settings
    from papertree_api.worker import run
    from papertree_jobs import JobObserver

    root, marker = Path(sys.argv[1]), Path(sys.argv[2])

    class HoldBeforePromote(JobObserver):
        def step_started(self, job, name):
            if name == "promote":
                marker.write_text("persisted", encoding="utf-8")
                time.sleep(600)

    # The REAL worker loop, with the default worker id (<hostname>:<pid>) and lease.
    run(Settings(root=root), observer=HoldBeforePromote())
    """
)


def test_promote_is_a_durable_step(tmp_path: Path) -> None:
    """Slice-plan §S1: kill the worker between persist and promote, restart it, and the paper ends
    promoted. A REAL process is SIGKILLed, and the restarted worker resumes at `promote`: `parse`
    and `persist` are not run again (their attempt stays 1).

    WATCHED FAILING at base: promotion ran in the worker loop AFTER the job finished, so this
    kill point did not exist as a step; the equivalent kill (after `succeeded`, before the loop's
    promote) left `succeeded` + no promotion, and `/ir` answered 404 for good."""
    with harness(tmp_path) as h:
        token = register(h.client, "reader@example.com")
        body = upload(h.client, token, synthetic_pdf()).json()
        marker = tmp_path / "held-before-promote"
        log = (tmp_path / "held-worker.log").open("w", encoding="utf-8")
        held = subprocess.Popen(
            [sys.executable, "-c", _HOLD_BEFORE_PROMOTE, str(h.settings.root), str(marker)],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 120
            while not marker.exists():
                assert held.poll() is None, (tmp_path / "held-worker.log").read_text()
                assert time.monotonic() < deadline, "the worker never reached promote"
                time.sleep(0.05)
            row = row_for(h.client, token, body["paper_id"])
            assert (row["processing"], row["job"]["step"], row["job"]["done"]) == (
                "reading",
                "promote",
                2,
            )
            os.kill(held.pid, signal.SIGKILL)
            held.wait(timeout=30)
        finally:
            if held.poll() is None:
                held.kill()
                held.wait()
            log.close()
        assert held.returncode == -signal.SIGKILL

        # Dead worker, live lease (60 s): the job is `running` with nobody running it.
        (job,) = sql(h.settings, "SELECT state, attempt, lease_owner FROM jobs")
        assert (job["state"], job["attempt"]) == ("running", 1)
        assert job["lease_owner"].endswith(f":{held.pid}")
        assert sql(h.settings, "SELECT * FROM paper_promotions") == []
        assert_envelope(
            h.client.get(f"/papers/{body['paper_id']}/ir", headers=auth(token)), 409, "not_parsed"
        )

        started = time.monotonic()
        assert drain(h.settings) == 1
        assert time.monotonic() - started < 30, "the restart waited out the dead worker's lease"

        row = row_for(h.client, token, body["paper_id"])
        assert (
            row["processing"],
            row["generation"],
            row["job"]["state"],
            row["job"]["attempt"],
        ) == (
            "ready",
            1,
            "succeeded",
            2,
        )
        steps = {
            r["step_name"]: (r["state"], r["attempt"])
            for r in sql(h.settings, "SELECT step_name, state, attempt FROM job_steps")
        }
        assert steps == {
            "parse": ("succeeded", 1),
            "persist": ("succeeded", 1),
            "promote": ("succeeded", 2),
        }
        assert list(h.settings.staging_root.iterdir()) == []
        assert (
            h.client.get(f"/papers/{body['paper_id']}/ir", headers=auth(token)).status_code == 200
        )
