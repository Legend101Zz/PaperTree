# ruff: noqa: E501
"""The v0.3 live bench: the REAL stack (api + worker + agent + MiniMax), one default-policy arm.

    uv run python services/agent/bench/ab.py --out <evidence dir> [--arms default] [--repeats 2]

v0.3 CHANGES (against the v0.1/v0.2 model A/B this file used to be):

* NO VERDICT COLUMNS. #351 dropped the grounding verdicts (`ai_citations.supported`, a summary
  bullet's `supported`): migration 0015 removed the column, so the old `settle_supported` query
  failed on a current database and the `supported` / `db_supported_*` columns could only ever be
  empty. They are gone from the rows and from summarize.py. What is kept: run status, latency,
  first text, tokens (input, output, reasoning, cache read), cost, tool calls, and how many
  citations were minted (and whether a written `[bN]` marker was minted at all, which is a
  structural check, not a verdict).
* ONE ARM, THE SHIPPED POLICY. Flash for every kind at the default efforts (models.ts); no
  PAPERTREE_MODEL* variable is set unless an arm names one, so the agent runs what a user gets.
  The M3-against-Flash arms are retired with the verdict columns (ADR-003, revision 2026-11-19).
* NEW KINDS: `followup` (its own kind now, not `ask` q2), `glance` (the spread's At-a-glance sheet,
  made in the background from `GET /papers` and read back from `GET /papers/{id}/glance`; its
  tokens come from its `ai_runs` row, no stream), `image` (POST /papers/{id}/threads with
  kind image and a figure anchor, v03-IMAGE-SPEC.md) and `board_ask` (an excerpt node on the
  paper's board, then POST /boards/{b}/nodes/{n}/asks).

What it does, in order:
  1. a fresh data root under --out; the worker and the API (no agent yet) start; one user registers;
     the PDFs upload over HTTP and are waited to `ready`; fixed passages are minted as real Anchors
     from the parsed IR (papertree_anchoring, as the reader's capture does); the figure anchors
     (a PageSelector, one ShapeSelector quad and the float's BlockSelector, no TextQuote) are minted
     from the IR's `figure` blocks;
  2. per arm: the agent starts (the MiniMax key is in ITS environment only, read from the macOS
     Keychain item `minimax_api_key`, never printed or written), the API restarts; glance runs
     first, then explain x passages x repeats, ask (+ a follow-up that says "that"), summary
     (regenerate), image and board_ask run and are measured; the agent and API stop;
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
import uuid
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
AGENT_DIR = REPO / "services" / "agent"
SECRET = "bench-" + os.urandom(8).hex()
PASSWORD = "correct horse battery staple"
ALLOWED_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TZ"]

# arm name -> (model id or None = the shipped per-kind policy, effort or None = the shipped one)
ARMS: dict[str, dict[str, Any]] = {
    "default": {"model": None, "effort": None},
}

# slug -> corpus file
PAPERS = {
    "resnet": "resnet-cvpr-2col.pdf",
    "attention": "attention-is-all-you-need.pdf",
    "bert": "bert-2col.pdf",
}
# Fixed prompts. `needle` picks the passage: the first body paragraph containing it.
EXPLAIN = {
    "resnet": [
        ("r1", "a degradation problem has been exposed"),
        ("r2", "denoting the desired underlying mapping"),
        ("r3", "shortcut connections in Eqn.(1) introduce neither"),
    ],
    "attention": [
        ("a1", "We call our particular attention"),
        ("a2", "we employ h = 8 parallel attention layers"),
        ("a3", "Recurrent models typically factor computation"),
    ],
    "bert": [
        ("b1", "we do not use traditional left-to-right"),
        ("b2", "we simply mask some percentage of the input tokens"),
        ("b3", "a downside is that we are creating a mismatch"),
    ],
}
ASK = {
    "resnet": (
        "What is the degradation problem and how do residual connections address it?",
        "Does that add any parameters or computation?",
    ),
    "attention": (
        "Why do the authors scale the dot products in attention?",
        "What goes wrong without that?",
    ),
    "bert": (
        "What are BERT's two pre-training tasks?",
        "Why does the second one matter?",
    ),
}
# Figure targets: (key, slug, 0-based page, an approximate box in PDF points). The float is the IR
# `figure` block on that page that overlaps the box most; its own bbox and id make the anchor.
IMAGES = [
    ("resnet-fig1", "resnet", 0, (309.0, 224.0, 545.0, 302.0)),
    ("resnet-fig2", "resnet", 1, (129.0, 85.0, 204.0, 154.0)),
    ("attention-fig1", "attention", 2, (196.0, 72.0, 415.0, 394.0)),
]
# Board asks: the first explain passage of each paper becomes an excerpt card, then one question.
BOARD = {
    "resnet": "Why would adding layers raise training error rather than lower it?",
    "attention": "What does that scaling change in practice?",
    "bert": "What does masking do that left-to-right training cannot?",
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

    def start_api(self, with_agent: bool, tag: str) -> None:
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

    def start_agent(self, model: str | None, effort: str | None, tag: str) -> None:
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
        }
        if model:
            env["PAPERTREE_MODEL"] = model
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
                return dict(p)
            time.sleep(3)
        raise RuntimeError("paper not ready")

    def stream(self, method: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
        """One browser SSE call, timed on this side of the wire."""
        t0 = time.perf_counter()
        events: list[dict[str, Any]] = []
        text: list[str] = []
        try:
            return self._stream(method, path, body, t0, events, text)
        except httpx.TimeoutException:
            return {
                "http_status": 0,
                "json": {"error": "client_timeout_180s"},
                "events": events,
                "text": "".join(text),
                "client_total_ms": (time.perf_counter() - t0) * 1000,
            }

    def _stream(
        self,
        method: str,
        path: str,
        body: dict[str, Any],
        t0: float,
        events: list[dict[str, Any]],
        text: list[str],
    ) -> dict[str, Any]:
        first_text = None
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
    from papertree_document_ir import Paper  # type: ignore[import-untyped]

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


def mint_image_anchor(
    client: Client,
    paper_id: str,
    text_anchor: dict[str, Any],
    page: int,
    box: tuple[float, float, float, float],
) -> dict[str, Any]:
    """An image Anchor v1 (v03-IMAGE-SPEC.md): targetKind `figure`, the float's BlockSelector, one
    PageSelector, one ShapeSelector with one quad, no TextQuote. The float is the IR `figure` block on
    `page` that overlaps `box` most; its own bbox is the quad. `text_anchor` lends the paper's `doc`."""
    r = client.http.get(f"/papers/{paper_id}/ir", headers=client.headers)
    r.raise_for_status()
    ir = r.json()

    def overlap(b: list[float]) -> float:
        w = min(b[2], box[2]) - max(b[0], box[0])
        h = min(b[3], box[3]) - max(b[1], box[1])
        return max(w, 0.0) * max(h, 0.0)

    figures = [
        b
        for b in ir["blocks"]
        if b["type"] == "figure" and b["page_index"] == page and b.get("bbox")
    ]
    block = max(figures, key=lambda b: overlap(b["bbox"]))
    if overlap(block["bbox"]) <= 0:
        raise RuntimeError(f"no figure block on page {page} overlaps {box}")
    pg = ir["pages"][page]
    return {
        "anchorVersion": 1,
        "offsetUnit": "unicode",
        "id": str(uuid.uuid4()),
        "doc": text_anchor["doc"],
        "targetKind": "figure",
        "provenanceClass": "source",
        "selectors": [
            {
                "type": "BlockSelector",
                "blockId": block["block_id"],
                "blockTextHash": block.get("content_hash") or "",
            },
            {"type": "PageSelector", "index": page},
            {
                "type": "ShapeSelector",
                "pageIndex": page,
                "quads": [list(block["bbox"])],
                "polygons": [],
                "pageWidth": pg["width"],
                "pageHeight": pg["height"],
                "rotation": pg["rotation"],
                "userUnit": pg["user_unit"],
                "cropBox": pg["crop_box"],
            },
        ],
        "created": {
            "mode": "source",
            "at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "client": "ab-bench",
        },
    }


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
        self.images: dict[str, dict[str, Any]] = {}

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
            "status": done.get("status") or ("client_timeout" if res["http_status"] == 0 else None),
            "error": done.get("error") or (res.get("json") if res["http_status"] != 200 else None),
            "model_reported": usage.get("model"),
            "first_text_ms": usage.get("first_text_ms"),
            "latency_ms": usage.get("latency_ms"),
            "client_first_text_ms": res.get("client_first_text_ms"),
            "client_total_ms": res.get("client_total_ms"),
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
            "cache_read_tokens": usage.get("cache_read_tokens"),
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
        self.append(row)
        log(
            f"{name}: {row['status']} first={row['first_text_ms']} total={row['latency_ms']} "
            f"out={row['output_tokens']} cites={row['citations_minted']} ${row['cost_usd_est']}"
        )
        err = json.dumps(row["error"]) if row["error"] else ""
        if re.search(r"2056|2062|token plan|usage limit", err, re.I):
            raise SystemExit("STOP: MiniMax token-plan limit reached; report now")
        self.check_caps()
        return row

    def append(self, row: dict[str, Any]) -> None:
        with self.runs_file.open("a") as handle:
            handle.write(json.dumps(row) + "\n")
        self.n_runs += 1
        self.cost += float(row.get("cost_usd_est") or 0)

    def check_caps(self) -> None:
        if self.n_runs >= self.args.max_runs or self.cost >= self.args.max_cost:
            raise SystemExit(f"STOP: cap reached (runs={self.n_runs}, cost={self.cost:.3f})")

    def settle_runs(self, rows: list[dict[str, Any]]) -> None:
        """Cross-check each streamed run against its `ai_runs` row (model, kind, status, code path).
        No grounding verdict is read: those columns are gone (#351, migration 0015)."""
        db = find_db(self.stack.data)
        time.sleep(self.args.verify_wait)
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            for row in rows:
                if not row.get("run_id"):
                    continue
                got = conn.execute(
                    "SELECT model, kind, status, code_path FROM ai_runs WHERE run_id = ?",
                    (row["run_id"],),
                ).fetchone()
                row["db_run"] = list(got) if got else None
        finally:
            conn.close()

    # -- the workload ------------------------------------------------------------------------
    def setup(self) -> None:
        self.stack.start_worker()
        self.stack.start_api(with_agent=False, tag="setup")
        self.client.register(f"ab-{int(time.time())}@example.com")
        pdfs = Path(self.args.pdf_dir)
        for slug, name in PAPERS.items():
            self.papers[slug] = self.client.upload(pdfs / name)
        for slug, pid in self.papers.items():
            p = self.client.wait_ready(pid)
            log(f"{slug}: {p['processing']} pages={p.get('page_count')}")
            if p["processing"] == "failed":
                raise RuntimeError(f"{slug} failed to parse")
            self.passages[slug] = mint_passages(
                self.client, pid, EXPLAIN[slug], self.out / f"paragraphs-{slug}.txt"
            )
        for key, slug, page, box in IMAGES:
            text_anchor = self.passages[slug][EXPLAIN[slug][0][0]]["anchor"]
            self.images[key] = {
                "slug": slug,
                "anchor": mint_image_anchor(self.client, self.papers[slug], text_anchor, page, box),
            }
        (self.out / "passages.json").write_text(
            json.dumps(
                {
                    "passages": {
                        s: {k: {"needle": v["needle"], "text": v["text"]} for k, v in d.items()}
                        for s, d in self.passages.items()
                    },
                    "images": {k: v["anchor"] for k, v in self.images.items()},
                },
                indent=1,
            )
        )
        self.stack.stop("api")

    def run_glance(self, name: str) -> list[dict[str, Any]]:
        """The At-a-glance sheet of each paper: started by a library read, polled until `ready` or
        `none`; tokens, cost and latency come from the paper's `glance` `ai_runs` row."""
        rows: list[dict[str, Any]] = []
        t0 = time.perf_counter()
        pending = dict(self.papers)
        states: dict[str, str] = {}
        done_at: dict[str, float] = {}
        deadline = time.time() + 240
        while pending and time.time() < deadline:
            self.client.http.get("/papers", headers=self.client.headers)  # starts missing sheets
            for slug, pid in list(pending.items()):
                r = self.client.http.get(f"/papers/{pid}/glance", headers=self.client.headers)
                state = (
                    r.json().get("state")
                    if r.status_code in (200, 202)
                    else f"http_{r.status_code}"
                )
                if state in ("ready", "none") or str(state).startswith("http_"):
                    states[slug] = str(state)
                    done_at[slug] = (time.perf_counter() - t0) * 1000
                    del pending[slug]
            time.sleep(1.0)
        db = find_db(self.stack.data)
        time.sleep(self.args.verify_wait)
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            runs = [
                dict(x)
                for x in conn.execute("SELECT * FROM ai_runs WHERE kind = 'glance'").fetchall()
            ]
        finally:
            conn.close()
        slug_of = {pid: slug for slug, pid in self.papers.items()}
        runs.sort(key=lambda x: str(x.get("started_at", "")))
        # One row per glance RUN (a failed run and its retry are two rows), matched to its paper by
        # `paper_id`; `glance_state` is where the paper's sheet ended (ready | none | timeout).
        for run in runs:
            slug = slug_of.get(str(run.get("paper_id")), "?")
            ok = run.get("status") == "done"
            rows.append(
                {
                    "arm": name,
                    "kind": "glance",
                    "paper": slug,
                    "prompt_id": "glance",
                    "rep": 1,
                    "http_status": 200,
                    "status": "complete" if ok else f"error:{run.get('error_code')}",
                    "error": None if ok else run.get("error_code"),
                    "glance_state": states.get(slug, "timeout"),
                    "client_total_ms": done_at.get(slug),
                    "load_avg": os.getloadavg()[0],
                    "run_id": run.get("run_id"),
                    "model_reported": run.get("model"),
                    "first_text_ms": run.get("first_text_ms"),
                    "latency_ms": run.get("latency_ms"),
                    "input_tokens": run.get("input_tokens"),
                    "output_tokens": run.get("output_tokens"),
                    "cache_read_tokens": run.get("cache_read_tokens"),
                    "reasoning_tokens": run.get("reasoning_tokens"),
                    "cost_usd_est": run.get("cost_usd_est"),
                    "tool_calls": run.get("tool_calls"),
                }
            )
        for slug in self.papers:
            if slug not in {r["paper"] for r in rows}:
                rows.append(
                    {
                        "arm": name,
                        "kind": "glance",
                        "paper": slug,
                        "prompt_id": "glance",
                        "rep": 1,
                        "http_status": 200,
                        "status": f"no_run:{states.get(slug, 'timeout')}",
                        "load_avg": os.getloadavg()[0],
                    }
                )
        for row in rows:
            self.append(row)
            log(
                f"glance {row['paper']}: {row['status']} total={row.get('latency_ms')} ${row.get('cost_usd_est')}"
            )
        return rows

    def arm(self, name: str) -> None:
        spec = ARMS[name]
        self.stack.start_agent(spec["model"], spec["effort"], name)
        self.stack.start_api(with_agent=True, tag=name)
        health = httpx.get(f"{self.stack.agent}/healthz").json()
        (self.out / f"healthz-{name}.json").write_text(json.dumps(health, indent=1))
        rows: list[dict[str, Any]] = []
        reps = self.args.repeats
        kinds = set(self.args.kinds.split(","))
        try:
            if "glance" in kinds:
                self.run_glance(name)
            if "explain" in kinds:
                for rep in range(1, reps + 1):
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
                for rep in range(1, reps + 1):
                    for slug, pid in self.papers.items():
                        q1, q2 = ASK[slug]
                        res = self.client.stream(
                            "POST", f"/papers/{pid}/threads", {"kind": "ask", "question": q1}
                        )
                        rows.append(self.record(name, "ask", slug, "q1", rep, res))
                        tid = (ev(res["events"], "run") or {}).get("thread_id")
                        if tid:
                            res2 = self.client.stream(
                                "POST", f"/papers/{pid}/threads/{tid}/messages", {"question": q2}
                            )
                            rows.append(self.record(name, "followup", slug, "q2", rep, res2))
                        time.sleep(self.args.pace)
            if "summary" in kinds:
                for rep in range(1, reps + 1):
                    for slug, pid in self.papers.items():
                        res = self.client.stream(
                            "POST", f"/papers/{pid}/summary", {"regenerate": True}
                        )
                        extra: dict[str, Any] = {}
                        if res["http_status"] == 200 and not res["events"]:
                            extra["note"] = "non-stream"
                        row = self.record(name, "summary", slug, "summary", rep, res, extra)
                        s = self.client.http.get(
                            f"/papers/{pid}/summary", headers=self.client.headers
                        )
                        if s.status_code == 200:
                            summ = s.json().get("summary") or {}
                            bullets = summ.get("bullets", [])
                            row["summary_state"] = s.json().get("state")
                            row["bullets"] = len(bullets)
                            row["bullets_with_citation"] = sum(
                                1 for b in bullets if b.get("citations")
                            )
                            (self.out / row["answer_file"]).write_text(
                                json.dumps(summ, indent=1, ensure_ascii=False), encoding="utf-8"
                            )
                        rows.append(row)
                        time.sleep(self.args.pace)
            if "image" in kinds:
                for rep in range(1, reps + 1):
                    for key, img in self.images.items():
                        pid = self.papers[img["slug"]]
                        res = self.client.stream(
                            "POST",
                            f"/papers/{pid}/threads",
                            {"kind": "image", "anchor": img["anchor"]},
                        )
                        rows.append(self.record(name, "image", img["slug"], key, rep, res))
                        time.sleep(self.args.pace)
            if "board_ask" in kinds:
                for rep in range(1, reps + 1):
                    for slug, pid in self.papers.items():
                        anchor = self.passages[slug][EXPLAIN[slug][0][0]]["anchor"]
                        node_id = "nod_" + uuid.uuid4().hex[:16]
                        made = self.client.http.post(
                            f"/papers/{pid}/board/nodes",
                            json={
                                "node_id": node_id,
                                "kind": "excerpt",
                                "x": 0,
                                "y": 0,
                                "w": 360,
                                "h": 220,
                                "source_anchor": anchor,
                            },
                            headers=self.client.headers,
                        )
                        made.raise_for_status()
                        board_id = made.json()["board"]["board_id"]
                        res = self.client.stream(
                            "POST",
                            f"/boards/{board_id}/nodes/{node_id}/asks",
                            {"question": BOARD[slug]},
                        )
                        rows.append(self.record(name, "board_ask", slug, "board-q", rep, res))
                        time.sleep(self.args.pace)
        finally:
            try:
                self.settle_runs(rows)
            except Exception as exc:  # noqa: BLE001 - report, don't hide
                log(f"settle_runs failed: {exc!r}")
            with (self.out / f"runs-final-{name}.json").open("w") as handle:
                json.dump(rows, handle, indent=1)
            self.stack.stop("api", "agent")

    def run(self) -> None:
        try:
            self.setup()
            for name in self.args.arms.split(","):
                self.arm(name)
        finally:
            self.stack.stop_all()
            log(f"done: runs={self.n_runs} est_cost=${self.cost:.3f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--pdf-dir", default=str(REPO / "research/benchmarks/corpus"))
    ap.add_argument("--api-port", type=int, default=8302)
    ap.add_argument("--agent-port", type=int, default=8402)
    ap.add_argument("--arms", default="default")
    ap.add_argument("--kinds", default="glance,explain,ask,summary,image,board_ask")
    ap.add_argument("--repeats", type=int, default=2)
    ap.add_argument("--max-runs", type=int, default=120)
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
