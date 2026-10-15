# ruff: noqa: E501
"""Aggregate the A/B runs.jsonl into the evidence table, and pair answers for blinded judging.

python summarize.py <evidence dir>            # prints markdown tables, writes summary.json
python summarize.py <evidence dir> --pairs    # writes pairs/ (A/B order shuffled, key in pairs-key.json)
"""

from __future__ import annotations

import json
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def pct(values: list[float], p: float) -> float | None:
    v = sorted(x for x in values if x is not None)
    if not v:
        return None
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def f(x: float | None, d: int = 0) -> str:
    return "-" if x is None else f"{x:.{d}f}"


def main() -> None:
    root = Path(sys.argv[1])
    rows = [json.loads(line) for line in (root / "runs.jsonl").read_text().splitlines() if line]
    final: dict[str, dict] = {}
    for p in root.glob("runs-final-*.json"):
        for r in json.loads(p.read_text()):
            final[r["run_id"] or r["answer_file"]] = r
    rows = [final.get(r["run_id"] or r["answer_file"], r) for r in rows]
    # The agent's own verdict on markers: handles issued in THIS run (unseen_markers must be empty).
    done: dict[str, dict] = {}
    for p in (root / "logs").glob("agent-*.log"):
        for line in p.read_text(errors="replace").splitlines():
            if '"agent.run.done"' in line:
                d = json.loads(line)
                done[d["run_id"]] = d
    for r in rows:
        d = done.get(r["run_id"] or "")
        r["agent_unseen_markers"] = None if d is None else d["unseen_markers"]
        r["agent_turns"] = None if d is None else d["turns"]
    if "--pairs" in sys.argv:
        pairs(root, rows)
        return
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        groups[(r["kind"], r["arm"])].append(r)
    out = {}
    print(
        "| kind | arm | n | complete | first_text p50 / p90 (ms) | total p50 (ms) | "
        "in / out / reasoning tok (mean) | cost mean ($) | citations (mean) | "
        "markers not minted | agent-unseen markers | supported (ai_citations) | "
        "summary bullets: n / cited / supported | tool calls (mean) | load avg (mean) |"
    )
    print("|" + "---|" * 15)
    for (kind, arm), g in sorted(groups.items()):
        ok = sum(1 for r in g if r["status"] == "complete")
        ft = [r["first_text_ms"] for r in g if r["first_text_ms"] is not None]
        lat = [r["latency_ms"] for r in g if r["latency_ms"] is not None]

        def mean(k: str, g: list[dict] = g) -> float:
            return statistics.fmean([r[k] for r in g if r.get(k) is not None] or [0])

        t = sum(r.get("db_supported_true", 0) for r in g)
        fl = sum(r.get("db_supported_false", 0) for r in g)
        nu = sum(r.get("db_supported_null", 0) for r in g)
        invalid = sum(len(r["invalid_markers"]) for r in g) if kind != "summary" else None
        unseen = sum(len(r["agent_unseen_markers"] or []) for r in g)
        bul = sum(r.get("bullets") or 0 for r in g)
        bcit = sum(r.get("bullets_with_citation") or 0 for r in g)
        bsup = sum(r.get("bullets_supported") or 0 for r in g)
        tools = statistics.fmean(r.get("tool_calls") or 0 for r in g)
        la = statistics.fmean(r["load_avg"] for r in g)
        row = {
            "n": len(g),
            "ok": ok,
            "ft_p50": pct(ft, 0.5),
            "ft_p90": pct(ft, 0.9),
            "lat_p50": pct(lat, 0.5),
            "in": mean("input_tokens"),
            "out": mean("output_tokens"),
            "reasoning": mean("reasoning_tokens"),
            "cost": mean("cost_usd_est"),
            "cites": mean("citations_minted"),
            "invalid": invalid,
            "supported": [t, fl, nu],
            "bullets": [bul, bcit, bsup],
            "tool_calls": tools,
            "unseen": unseen,
            "load": la,
        }
        out[f"{kind}/{arm}"] = row
        print(
            f"| {kind} | {arm} | {len(g)} | {ok} | {f(row['ft_p50'])} / {f(row['ft_p90'])} | "
            f"{f(row['lat_p50'])} | {row['in']:.0f} / {row['out']:.0f} / {row['reasoning']:.0f} | "
            f"{row['cost']:.4f} | {row['cites']:.1f} | {'n/a' if invalid is None else invalid} | "
            f"{unseen} | {t} true / {fl} false | {bul} / {bcit} / {bsup} | {tools:.1f} | {la:.1f} |"
        )
    (root / "summary.json").write_text(json.dumps(out, indent=1))


def judge_view(root: Path, r: dict) -> str:
    """The answer as a reader sees it; a stored summary is flattened to its bullets (no anchors)."""
    text = (root / r["answer_file"]).read_text()
    if r["kind"] != "summary":
        return text
    bullets = json.loads(text)["bullets"]
    return "\n".join(
        f"- {b['text']}  (markers: {', '.join(c['marker'] for c in b['citations']) or 'none'})"
        for b in bullets
    )


def pairs(root: Path, rows: list[dict]) -> None:
    rng = random.Random(20261015)
    by: dict[tuple, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by[(r["kind"], r["paper"], r["prompt_id"])][r["arm"]].append(r)
    d = root / "pairs"
    d.mkdir(exist_ok=True)
    key = {}
    for (kind, paper, pid), arms in sorted(by.items()):
        if "m3" not in arms:
            continue
        for other in [a for a in arms if a != "m3"]:
            mine = [arms["m3"][0], arms[other][0]]  # first repeat of each
            rng.shuffle(mine)
            name = f"{kind}__{paper}__{pid}__vs_{other}"
            body = [f"# {name}\n"]
            for label, r in zip("AB", mine, strict=True):
                body.append(f"## Answer {label}\n\n{judge_view(root, r)}\n")
            (d / f"{name}.md").write_text("\n".join(body))
            key[name] = {"A": mine[0]["arm"], "B": mine[1]["arm"]}
    (root / "pairs-key.json").write_text(json.dumps(key, indent=1))
    print(f"{len(key)} pairs in {d}")


if __name__ == "__main__":
    main()
