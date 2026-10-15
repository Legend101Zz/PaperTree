# ruff: noqa: E501
"""The model A/B (ADR-003): M3 against Flash through the REAL stack (api + worker + agent + MiniMax).

    uv run python services/agent/bench/ab.py --out <evidence dir> [--arms m3,flash-low,flash-medium-summary]

What it does, in order:
  1. a fresh data root under --out; the worker and the API (no agent yet) start; one user registers;
     the PDFs upload over HTTP and are waited to `ready`; fixed passages are minted as real Anchors
     from the parsed IR (papertree_anchoring, as the reader's capture does);
  2. per arm: the agent starts (the MiniMax key is in ITS environment only, read from the macOS
     Keychain item `minimax_api_key`, never printed or written), the API restarts,
     then explain x passages x repeats, ask (+ a follow-up that says "that"), and summary (regenerate)
     run and are measured; the agent and API stop;
  3. every run is one JSON line in runs.jsonl; every answer text is in answers/.

Stops at once on a MiniMax token-plan error (2056/2062), or past --max-runs / --max-cost.
Each process it starts has its PID appended to <out>/pids.txt; it signals only those, by number.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
AGENT_DIR = REPO / "services" / "agent"
SECRET = "bench-" + os.urandom(8).hex()
PASSWORD = "correct horse battery staple"
ALLOWED_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TZ"]

# arm name -> (model id, flash effort per kind (None = n/a), kinds it runs)
ARMS: dict[str, dict[str, Any]] = {
    "m3": {"model": "MiniMax-M3", "effort": None, "kinds": ["explain", "ask", "summary"]},
    "flash-low": {
        "model": "MiniMax-M3.1-Flash-Preview",
        "effort": "low",
        "kinds": ["explain", "ask", "summary"],
    },
    "flash-medium": {
        "model": "MiniMax-M3.1-Flash-Preview",
        "effort": "medium",
        "kinds": ["summary"],
    },
}

PAPERS = {
    "yolo": "yolo-1506.02640.pdf",
    "ddpm": "ddpm-2006.11239.pdf",
}
# Fixed prompts. `needle` picks the passage: the first body paragraph containing it.
EXPLAIN = {
    "yolo": [
        ("y1", "reframe object detection as a single regression"),
        ("y2", "Fast YOLO is the fastest"),
    ],
    "ddpm": [
        ("d1", "discards the weighting in Eq. (12)"),
        ("d2", "progressive lossy code that mirrors"),
    ],
}
ASK = {
    "yolo": (
        "How fast is YOLO compared to the other detectors in this paper, and why?",
        "What does it give up in exchange for that?",
    ),
    "ddpm": (
        "How is the training objective of the diffusion model defined here?",
        "Why do the authors prefer that over the exact variational bound?",
    ),
}
MARKER = re.compile(r"\[(b\d+(?:\s*,\s*b\d+)*)\]")


def log(msg: str) -> None:
    print(f"[ab {time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Stack:
    def __init__(self, out: Path, api_port: int, agent_port: int) -> None:
        self.out, self.api_port, self.agent_port = out, api_port, agent_port
        self.data = out / "data"
        self.logs = out / "logs"
        self.logs.mkdir(parents=True, exist_ok=True)
        self.procs: dict[str, subprocess.Popen[bytes]] = {}
        self.pids = out / "pids.txt"

    @property
    def api(self) -> str:
        return f"http://127.0.0.1:{self.api_port}"

    @property
    def agent(self) -> str:
        return f"http://127.0.0.1:{self.agent_port}"

    def _env(self, own: dict[str, str]) -> dict[str, str]:
        env = {k: os.environ[k] for k in ALLOWED_ENV if k in os.environ}
        env.update(own)
        return env

    def _start(self, name: str, argv: list[str], cwd: Path, env: dict[str, str]) -> None:
        logfile = (self.logs / f"{name}.log").open("ab")
        proc = subprocess.Popen(argv, cwd=cwd, env=self._env(env), stdout=logfile, stderr=logfile)
        self.procs[name] = proc
        with self.pids.open("a") as handle:
            handle.write(f"{proc.pid} {name}\n")
        log(f"started {name} pid {proc.pid}")

    def _wait(self, name: str, url: str, ok: Any, timeout: float = 90) -> None:
        end = time.time() + timeout
        while time.time() < end:
            if self.procs[name].poll() is not None:
                raise RuntimeError(f"{name} exited; see logs/{name}.log")
            try:
                r = httpx.get(url, timeout=3)
                if r.status_code == 200 and ok(r.json()):
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
        raise RuntimeError(f"{name} not healthy in {timeout}s")

    def start_worker(self) -> None:
        self._start(
            "worker",
            [sys.executable, "-m", "papertree_api.worker"],
            REPO,
            {"PAPERTREE_DATA_ROOT": str(self.data), "PYTHONUNBUFFERED": "1"},
        )
        time.sleep(1.5)

    def start_api(self, model: str, with_agent: bool, tag: str) -> None:
        env = {
            "PAPERTREE_DATA_ROOT": str(self.data),
            "PAPERTREE_HOST": "127.0.0.1",
            "PAPERTREE_PORT": str(self.api_port),
            "PAPERTREE_DAILY_BUDGET_USD": "5",
            "PYTHONUNBUFFERED": "1",
        }
        if with_agent:
            env["PAPERTREE_AGENT_URL"] = self.agent
            env["PAPERTREE_AGENT_SECRET"] = SECRET
        self._start(f"api-{tag}", [sys.executable, "-m", "papertree_api"], REPO, env)
        self.procs["api"] = self.procs[f"api-{tag}"]
        self._wait("api", f"{self.api}/healthz", lambda b: b.get("ok") is True)

    def start_agent(self, model: str, effort: str | None, tag: str) -> None:
        key = subprocess.run(
            ["security", "find-generic-password", "-s", "minimax_api_key", "-w"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        env = {
            "PAPERTREE_AGENT_SECRET": SECRET,
            "PAPERTREE_AGENT_PORT": str(self.agent_port),
            "PAPERTREE_API_INTERNAL_URL": self.api,
            "PAPERTREE_MINIMAX_API_KEY": key,  # the agent's environment only
            "PAPERTREE_MODEL": model,
        }
        if effort:
            env["PAPERTREE_MODEL_EFFORT"] = effort
        self._start(
            f"agent-{tag}",
            [
                "node",
                "--experimental-strip-types",
                "--disable-warning=ExperimentalWarning",
                "src/server.ts",
            ],
            AGENT_DIR,
            env,
        )
        self.procs["agent"] = self.procs[f"agent-{tag}"]
        self._wait("agent", f"{self.agent}/healthz", lambda b: b.get("wiring_ok") is True)

    def stop(self, *names: str) -> None:
        for name in names:
            proc = self.procs.pop(name, None)
            if proc is None:
                continue
            for alias in [k for k, v in self.procs.items() if v is proc]:
                self.procs.pop(alias)
            if proc.poll() is None:
                proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    proc.send_signal(signal.SIGKILL)  # our own pid, recorded in pids.txt
            log(f"stopped {name} pid {proc.pid}")

    def stop_all(self) -> None:
        for name in list(self.procs):
            self.stop(name)


class Client:
    def __init__(self, base: str) -> None:
        self.base = base
        self.http = httpx.Client(base_url=base, timeout=httpx.Timeout(120, connect=5))
        self.headers: dict[str, str] = {}

    def register(self, email: str) -> None:
        r = self.http.post("/auth/register", json={"email": email, "password": PASSWORD})
        r.raise_for_status()
        self.headers = {"Authorization": f"Bearer {r.json()['token']}"}

    def upload(self, pdf: Path) -> str:
        with pdf.open("rb") as handle:
            r = self.http.post(
                "/papers",
                files={"file": (pdf.name, handle, "application/pdf")},
                headers=self.headers,
            )
        r.raise_for_status()
        return str(r.json()["paper_id"])

    def wait_ready(self, paper_id: str, timeout: float = 900) -> dict[str, Any]:
        end = time.time() + timeout
        while time.time() < end:
            r = self.http.get(f"/papers/{paper_id}", headers=self.headers)
            r.raise_for_status()
            p = r.json()
            if p["processing"] in ("ready", "partial", "failed"):
                return p
            time.sleep(3)
        raise RuntimeError("paper not ready")

    def stream(self, method: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        """One browser SSE call, timed on this side of the wire."""
        t0 = time.perf_counter()
        events: list[dict[str, Any]] = []
        first_text = None
        text = []
        with self.http.stream(
            method, path, json=body, headers=self.headers, timeout=httpx.Timeout(180, connect=5)
        ) as r:
            ctype = r.headers.get("content-type", "")
            if r.status_code != 200 or not ctype.startswith("text/event-stream"):
                r.read()
                return {"http_status": r.status_code, "json": _maybe_json(r.text), "events": []}
            event = None
            for line in r.iter_lines():
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:") and event:
                    data = json.loads(line[5:].strip())
                    events.append({"event": event, "data": data})
                    if event == "text":
                        if first_text is None:
                            first_text = (time.perf_counter() - t0) * 1000
                        text.append(data["delta"])
        return {
            "http_status": 200,
            "events": events,
            "text": "".join(text),
            "client_first_text_ms": first_text,
            "client_total_ms": (time.perf_counter() - t0) * 1000,
        }


def _maybe_json(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return text


def ev(events: list[dict[str, Any]], name: str) -> Any:
    for e in events:
        if e["event"] == name:
            return e["data"]
    return None


def mint_passages(
    client: Client, paper_id: str, needles: list[tuple[str, str]], dump: Path | None = None
) -> dict[str, Any]:
    """Real Anchor v1 for the first body paragraph containing each needle, from the parsed IR."""
    from papertree_anchoring import capture_anchor, index_document
    from papertree_document_ir import Paper

    r = client.http.get(f"/papers/{paper_id}/ir", headers=client.headers)
    r.raise_for_status()
    paper = Paper.model_validate(r.json())
    indexed = index_document(
        paper, f"api/{paper.paper_id}/g{paper.generation}/{paper.parser.version}"
    )
    out: dict[str, Any] = {}
    if dump is not None:
        paragraphs = [
            b for b in indexed.blocks if b.block.type == "paragraph" and len(b.text) > 120
        ]
        dump.write_text(
            "\n\n".join(f"[{b.block.block_id}] {b.text}" for b in paragraphs), encoding="utf-8"
        )
    for key, needle in needles:
        block = next(
            b
            for b in indexed.blocks
            if b.block.type == "paragraph"
            and len(b.text) > 120
            and needle.lower() in " ".join(b.text.split()).lower()
        )
        anchor = dict(
            capture_anchor(
                indexed,
                block.block.block_id,
                anchor_id=__import__("uuid").uuid4().__str__(),
                at=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                client="ab-bench",
            )
        )
        out[key] = {"anchor": anchor, "text": block.text, "needle": needle}
    return out


def find_db(data: Path) -> Path:
    found = sorted(data.rglob("*.db")) + sorted(data.rglob("*.sqlite*"))
    if not found:
        raise RuntimeError("no database file under the data root")
    return found[0]


class Bench:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.out = Path(args.out)
        self.answers = self.out / "answers"
        self.answers.mkdir(parents=True, exist_ok=True)
        self.runs_file = self.out / "runs.jsonl"
        self.stack = Stack(self.out, args.api_port, args.agent_port)
        self.client = Client(self.stack.api)
        self.n_runs = 0
        self.cost = 0.0
        self.papers: dict[str, str] = {}
        self.passages: dict[str, dict[str, Any]] = {}

    # -- measuring -------------------------------------------------------------------------
    def record(
        self,
        arm: str,
        kind: str,
        paper: str,
        prompt_id: str,
        rep: int,
        res: dict[str, Any],
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        events = res["events"]
        usage = ev(events, "usage") or {}
        done = ev(events, "done") or {}
        cites = (ev(events, "citations") or {}).get("items", [])
        text = res.get("text", "")
        written = {m.strip() for g in MARKER.findall(text) for m in g.split(",")}
        minted = {c["marker"] for c in cites}
        row: dict[str, Any] = {
            "arm": arm,
            "kind": kind,
            "paper": paper,
            "prompt_id": prompt_id,
            "rep": rep,
            "http_status": res["http_status"],
            "status": done.get("status"),
            "error": done.get("error") or (res.get("json") if res["http_status"] != 200 else None),
            "model_reported": usage.get(
                "model"
            ),  # the API's RunSummary.model: the agent-reported model
            "first_text_ms": usage.get("first_text_ms"),
            "latency_ms": usage.get("latency_ms"),
            "client_first_text_ms": res.get("client_first_text_ms"),
            "client_total_ms": res.get("client_total_ms"),
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
            "reasoning_tokens": usage.get("reasoning_tokens"),
            "cost_usd_est": usage.get("cost_usd_est"),
            "tool_calls": usage.get("tool_calls"),
            "retries": usage.get("retries"),
            "run_id": usage.get("run_id"),
            "text_chars": len(text),
            "markers_written": sorted(written),
            "citations_minted": len(cites),
            "markers_minted": sorted(minted),
            "invalid_markers": sorted(written - minted),
            "message_id": done.get("message_id"),
            "load_avg": os.getloadavg()[0],
        }
        row.update(extra or {})
        name = f"{arm}__{kind}__{paper}__{prompt_id}__r{rep}"
        row["answer_file"] = f"answers/{name}.txt"
        (self.out / row["answer_file"]).write_text(text, encoding="utf-8")
        with self.runs_file.open("a") as handle:
            handle.write(json.dumps(row) + "\n")
        self.n_runs += 1
        self.cost += float(row["cost_usd_est"] or 0)
        log(
            f"{name}: {row['status']} first={row['first_text_ms']} total={row['latency_ms']} "
            f"out={row['output_tokens']} cites={row['citations_minted']} ${row['cost_usd_est']}"
        )
        err = json.dumps(row["error"]) if row["error"] else ""
        if re.search(r"2056|2062|token plan|usage limit", err, re.I):
            raise SystemExit("STOP: MiniMax token-plan limit reached; report now")
        if self.n_runs >= self.args.max_runs or self.cost >= self.args.max_cost:
            raise SystemExit(f"STOP: cap reached (runs={self.n_runs}, cost={self.cost:.3f})")
        return row

    def settle_supported(self, rows: list[dict[str, Any]]) -> None:
        """verify_grounding writes ai_citations.supported after the run; read it back."""
        db = find_db(self.stack.data)
        time.sleep(self.args.verify_wait)
        for row in rows:
            if not row.get("message_id"):
                continue
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            try:
                got = conn.execute(
                    "SELECT supported FROM ai_citations WHERE message_id = ?", (row["message_id"],)
                ).fetchall()
                run = conn.execute(
                    "SELECT model, status, code_path FROM ai_runs WHERE run_id = ?",
                    (row["run_id"],),
                ).fetchone()
            finally:
                conn.close()
            vals = [g[0] for g in got]
            row["db_citations"] = len(vals)
            row["db_supported_true"] = sum(1 for v in vals if v == 1)
            row["db_supported_false"] = sum(1 for v in vals if v == 0)
            row["db_supported_null"] = sum(1 for v in vals if v is None)
            row["db_run"] = list(run) if run else None

    # -- the workload ------------------------------------------------------------------------
    def setup(self) -> None:
        self.stack.start_worker()
        self.stack.start_api("MiniMax-M3", with_agent=False, tag="setup")
        self.client.register(f"ab-{int(time.time())}@example.com")
        pdfs = Path(self.args.pdf_dir)
        for slug, name in PAPERS.items():
            pid = self.client.upload(pdfs / name)
            self.papers[slug] = pid
        for slug, pid in self.papers.items():
            p = self.client.wait_ready(pid)
            log(f"{slug}: {p['processing']} pages={p.get('page_count')}")
            if p["processing"] == "failed":
                raise RuntimeError(f"{slug} failed to parse")
            self.passages[slug] = mint_passages(
                self.client, pid, EXPLAIN[slug], self.out / f"paragraphs-{slug}.txt"
            )
        (self.out / "passages.json").write_text(
            json.dumps(
                {
                    s: {k: {"needle": v["needle"], "text": v["text"]} for k, v in d.items()}
                    for s, d in self.passages.items()
                },
                indent=1,
            )
        )
        self.stack.stop("api")

    def arm(self, name: str, kinds: list[str]) -> None:
        spec = ARMS[name]
        self.stack.start_agent(spec["model"], spec["effort"], name)
        self.stack.start_api(spec["model"], with_agent=True, tag=name)
        health = httpx.get(f"{self.stack.agent}/healthz").json()
        (self.out / f"healthz-{name}.json").write_text(json.dumps(health, indent=1))
        rows: list[dict[str, Any]] = []
        try:
            if "explain" in kinds:
                for rep in range(1, self.args.repeats + 1):
                    for slug, pid in self.papers.items():
                        for key, _ in EXPLAIN[slug]:
                            res = self.client.stream(
                                "POST",
                                f"/papers/{pid}/threads",
                                {"kind": "explain", "anchor": self.passages[slug][key]["anchor"]},
                            )
                            rows.append(self.record(name, "explain", slug, key, rep, res))
                            if self.args.smoke:
                                raise SystemExit("smoke done")
                            time.sleep(self.args.pace)
            if "ask" in kinds:
                for slug, pid in self.papers.items():
                    q1, q2 = ASK[slug]
                    res = self.client.stream(
                        "POST", f"/papers/{pid}/threads", {"kind": "ask", "question": q1}
                    )
                    rows.append(self.record(name, "ask", slug, "q1", 1, res))
                    tid = (ev(res["events"], "run") or {}).get("thread_id")
                    if tid:
                        res2 = self.client.stream(
                            "POST", f"/papers/{pid}/threads/{tid}/messages", {"question": q2}
                        )
                        rows.append(self.record(name, "ask", slug, "q2-followup", 1, res2))
                    time.sleep(self.args.pace)
            if "summary" in kinds:
                for slug, pid in self.papers.items():
                    res = self.client.stream("POST", f"/papers/{pid}/summary", {"regenerate": True})
                    extra: dict[str, Any] = {}
                    if res["http_status"] == 200 and not res["events"]:
                        extra["note"] = "non-stream"
                    row = self.record(name, "summary", slug, "summary", 1, res, extra)
                    s = self.client.http.get(f"/papers/{pid}/summary", headers=self.client.headers)
                    if s.status_code == 200:
                        summ = s.json().get("summary") or {}
                        bullets = summ.get("bullets", [])
                        row["summary_state"] = s.json().get("state")
                        row["bullets"] = len(bullets)
                        row["bullets_with_citation"] = sum(1 for b in bullets if b.get("citations"))
                        row["bullets_supported"] = sum(
                            1 for b in bullets if b.get("supported") is True
                        )
                        row["bullets_unsupported"] = sum(
                            1 for b in bullets if b.get("supported") is False
                        )
                        row["bullets_unverified"] = sum(
                            1 for b in bullets if b.get("supported") is None
                        )
                        (self.out / row["answer_file"]).write_text(
                            json.dumps(summ, indent=1, ensure_ascii=False), encoding="utf-8"
                        )
                    rows.append(row)
                    time.sleep(self.args.pace)
        finally:
            try:
                self.settle_supported(rows)
            except Exception as exc:  # noqa: BLE001 - report, don't hide
                log(f"settle_supported failed: {exc!r}")
            with (self.out / f"runs-final-{name}.json").open("w") as handle:
                json.dump(rows, handle, indent=1)
            self.stack.stop("api", "agent")

    def run(self) -> None:
        try:
            self.setup()
            for name in self.args.arms.split(","):
                self.arm(name, ARMS[name]["kinds"])
        finally:
            self.stack.stop_all()
            log(f"done: runs={self.n_runs} est_cost=${self.cost:.3f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--pdf-dir", default=str(REPO / "research/benchmarks/fresh/pdfs"))
    ap.add_argument("--api-port", type=int, default=18140)
    ap.add_argument("--agent-port", type=int, default=18240)
    ap.add_argument("--arms", default="m3,flash-low,flash-medium")
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--max-runs", type=int, default=40)
    ap.add_argument("--max-cost", type=float, default=3.0)
    ap.add_argument("--pace", type=float, default=2.0)
    ap.add_argument("--verify-wait", type=float, default=8.0)
    ap.add_argument("--smoke", action="store_true", help="one explain run, then stop")
    args = ap.parse_args()
    out = Path(args.out)
    if (out / "data").exists():
        raise SystemExit(f"{out / 'data'} exists: a fresh data root is required")
    out.mkdir(parents=True, exist_ok=True)
    Bench(args).run()


if __name__ == "__main__":
    main()
