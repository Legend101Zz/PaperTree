# ruff: noqa: E501
"""Aggregate the bench's runs.jsonl into the evidence table (v0.3).

    python summarize.py <evidence dir>        # prints markdown tables, writes summary.json

v0.3 CHANGES: the grounding-verdict columns (`supported` per citation, supported summary bullets)
are gone with the verdicts themselves (#351, migration 0015), and so is the blinded M3-against-Flash
pair builder (`--pairs`): there is one arm now, the shipped policy. The table reports, per kind:
runs, how many finished `complete`, errors and client timeouts, first text and total latency
(median and p90), tokens (median input and output, mean reasoning and cache read), cost per run
(median and mean), citations minted (mean), tool calls (mean) and the machine load (mean).

Latency is the agent's own `latency_ms` / `first_text_ms` from the run's usage record (the API's
RunSummary); `client` columns are the same run timed on the benchmark's side of the wire.
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

Row = dict[str, Any]
KINDS = ["glance", "explain", "ask", "followup", "summary", "image", "board_ask"]


def pct(values: list[float | None], p: float) -> float | None:
    v = sorted(x for x in values if x is not None)
    if not v:
        return None
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def f(x: float | None, d: int = 0) -> str:
    return "-" if x is None else f"{x:,.{d}f}"


def load_rows(root: Path) -> list[Row]:
    rows = [json.loads(line) for line in (root / "runs.jsonl").read_text().splitlines() if line]
    final: dict[str, Row] = {}
    for p in root.glob("runs-final-*.json"):
        for r in json.loads(p.read_text()):
            final[r["run_id"] or r["answer_file"]] = r
    return [final.get(r.get("run_id") or r.get("answer_file") or "", r) for r in rows]


def col(g: list[Row], key: str) -> list[float | None]:
    return [r.get(key) for r in g]


def mean(g: list[Row], key: str) -> float:
    return statistics.fmean([r[key] for r in g if r.get(key) is not None] or [0.0])


def main() -> None:
    root = Path(sys.argv[1])
    rows = load_rows(root)
    groups: dict[tuple[str, str], list[Row]] = defaultdict(list)
    for r in rows:
        groups[(r["kind"], r["arm"])].append(r)
    out: dict[str, Any] = {}
    print(
        "| kind | arm | n | complete | errors / timeouts | first text p50 / p90 (ms) | "
        "total p50 / p90 (ms) | client total p50 (ms) | in / out tokens (median) | "
        "reasoning / cache read tokens (mean) | cost median / mean ($) | citations (mean) | "
        "tool calls (mean) | load avg (mean) |"
    )
    print("|" + "---|" * 14)
    order = {k: i for i, k in enumerate(KINDS)}
    for (kind, arm), g in sorted(
        groups.items(), key=lambda kv: (order.get(kv[0][0], 99), kv[0][1])
    ):
        ok = sum(1 for r in g if r["status"] == "complete")
        timeouts = sum(1 for r in g if r["status"] == "client_timeout")
        errors = sum(1 for r in g if r["status"] != "complete") - timeouts
        costs = [r["cost_usd_est"] for r in g if r.get("cost_usd_est") is not None]
        row = {
            "n": len(g),
            "complete": ok,
            "errors": errors,
            "timeouts": timeouts,
            "ft_p50": pct(col(g, "first_text_ms"), 0.5),
            "ft_p90": pct(col(g, "first_text_ms"), 0.9),
            "lat_p50": pct(col(g, "latency_ms"), 0.5),
            "lat_p90": pct(col(g, "latency_ms"), 0.9),
            "client_total_p50": pct(col(g, "client_total_ms"), 0.5),
            "in_median": pct(col(g, "input_tokens"), 0.5),
            "out_median": pct(col(g, "output_tokens"), 0.5),
            "reasoning_mean": mean(g, "reasoning_tokens"),
            "cache_read_mean": mean(g, "cache_read_tokens"),
            "cost_median": pct(costs, 0.5),
            "cost_mean": statistics.fmean(costs) if costs else None,
            "cost_sum": sum(costs),
            "cites_mean": mean(g, "citations_minted"),
            "tool_calls_mean": mean(g, "tool_calls"),
            "load_mean": statistics.fmean(r["load_avg"] for r in g),
        }
        out[f"{kind}/{arm}"] = row
        print(
            f"| {kind} | {arm} | {len(g)} | {ok} | {errors} / {timeouts} | "
            f"{f(row['ft_p50'])} / {f(row['ft_p90'])} | {f(row['lat_p50'])} / {f(row['lat_p90'])} | "
            f"{f(row['client_total_p50'])} | {f(row['in_median'])} / {f(row['out_median'])} | "
            f"{row['reasoning_mean']:.0f} / {row['cache_read_mean']:.0f} | "
            f"{f(row['cost_median'], 5)} / {f(row['cost_mean'], 5)} | {row['cites_mean']:.1f} | "
            f"{row['tool_calls_mean']:.1f} | {row['load_mean']:.1f} |"
        )
    total = sum(float(r.get("cost_usd_est") or 0) for r in rows)
    out["_total"] = {"runs": len(rows), "cost_usd_est": total}
    print(f"\nRuns: {len(rows)}; estimated cost of all runs: ${total:.4f}")
    (root / "summary.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
