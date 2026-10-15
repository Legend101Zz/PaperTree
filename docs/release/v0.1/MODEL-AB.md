# Model A/B: MiniMax-M3 against MiniMax-M3.1-Flash-Preview (v0.1)

The decision and its reasoning are in `research/architecture-decisions/ADR-003-model-policy.md`. This page is the method and the table.

## Method

- **Script:** `services/agent/bench/ab.py` (re-run with `uv run python services/agent/bench/ab.py --out <dir>`). `summarize.py` aggregates it and pairs answers for blind judging; the A/B measured in `t0-impl/ab1` ran through a since-deleted launcher that patched the API's pinned model in memory; the API now stores the agent-reported model, so the script starts the API directly.
- **Stack:** the real worker, API and agent on one machine, a fresh data root, one registered user, two papers uploaded over HTTP and parsed to `ready` (YOLO, DDPM from `research/benchmarks/fresh/pdfs/`). The MiniMax key is in the agent process's environment only.
- **Arms:** `m3` (MiniMax-M3), `flash-low` (Flash, effort low) for all three kinds; `flash-medium` (Flash, effort medium) for the summary only. The arms ran one after another (M3 first) on the same machine; the agent and API restarted between arms.
- **Workload per arm:**
  - explain: 2 fixed passages per paper (real Anchors minted from the parsed IR, found by a fixed phrase), 3 repeats each: 12 runs;
  - ask: 1 fixed question per paper plus a follow-up that says "that": 4 runs;
  - summary: one per paper with `regenerate: true`: 2 runs.
  - Total 38 live runs (cap was 40 runs and $3; stopped at an estimated $0.18 on M3 rates).
- **Recorded per run:** first text (API-measured and client-measured), total latency, input/output/reasoning tokens, estimated cost, status, tool calls, citations minted, markers written and whether each was minted, the agent's own unseen-marker list, and `ai_citations.supported` / the summary bullets' `supported` read back after the verifier ran. Every answer text is saved.
- **Judging:** the first run of each (paper, kind, prompt) per arm was put side by side in a shuffled A/B order (fixed seed) and scored 1 to 5 on grounded, correct, readable, useful with a written reason; the key was opened afterwards. It is a **single-judge sample of 12 pairs**, and style (Flash's headings and bold lead-ins) gives the arm away, so it is not blind in practice.

## Summary table (MEASURED)

| kind    | arm          | n   | complete         | first text p50 / p90 (ms) | total p50 (ms) | out / reasoning tokens (mean) | est. cost per run (estimate on M3 rates for Flash) | markers not minted | supported                         | load avg (mean) |
| ------- | ------------ | --- | ---------------- | ------------------------- | -------------- | ----------------------------- | -------------------------------------------------- | ------------------ | --------------------------------- | --------------- |
| explain | M3           | 12  | 12               | 9,281 / 26,422            | 15,290         | 1,397 / 827                   | $0.0029                                            | 0                  | 7 of 66 citations                 | 8.7             |
| explain | Flash low    | 12  | 12               | 1,824 / 3,489             | 5,124          | 449 / 34                      | $0.0019                                            | 0                  | 18 of 87                          | 7.6             |
| ask     | M3           | 4   | 4                | 8,118 / 8,897             | 11,754         | 857 / 223                     | $0.0065                                            | 0                  | 14 of 36                          | 9.7             |
| ask     | Flash low    | 4   | 4                | 4,038 / 6,320             | 6,687          | 519 / 15                      | $0.0046                                            | 0                  | 20 of 38                          | 5.3             |
| summary | M3           | 2   | 2                | 14,040 / 14,158           | 21,820         | 1,014 / 314                   | $0.0136                                            | n/a                | 10 of 15 bullets (15 of 15 cited) | 9.0             |
| summary | Flash low    | 2   | 0 (both partial) | 6,478 / 6,820             | 11,080         | 935 / 0                       | $0.0093                                            | n/a                | 6 of 15 (11 of 15 cited)          | 4.6             |
| summary | Flash medium | 2   | 1 (one partial)  | 11,368 / 13,767           | 17,770         | 1,343 / 0                     | $0.0155                                            | n/a                | 12 of 19 (18 of 19 cited)         | 3.6             |

Judged usefulness, mean of the four criteria (1 to 5), 4 pairs per kind (2 for each summary comparison): explain M3 4.19 / Flash 4.25; ask M3 4.56 / Flash 3.94; summary M3 4.62 / Flash low 4.25 / Flash medium 4.12. Per-pair scores and reasons are in `judgments.json` under the evidence label below.

Reasoning-token denominators: the reasoning column is the mean over the rows that reported a reasoning count (null rows excluded). Over ALL rows of the arm it is: explain M3 689 (10 of 12 reported) and Flash low 31 (11 of 12); ask M3 167 (3 of 4) and Flash low 4 (1 of 4); summary M3 314 (2 of 2), Flash 0 (0 of 2, none reported). Re-computed from `runs.jsonl` on 2026-10-15 (load average 4.6 at that moment).

Confounds, stated plainly: the ask rows (n=4 per arm) and summary rows (n=2 per arm) are too thin to decide anything; one judge scored all pairs and the answer style gives the arm away; the arms ran one after the other under different machine load (M3 8.7 to 9.7, Flash 3.6 to 7.6), which favours Flash on every latency number; and `model_reported` in the `t0-impl/ab1` raw rows is the shim's arm label, not an agent report (rows from a re-run with this branch carry the agent's own). The Flash default for ask (judged 3.94 against 4.56) and for summary (partial status, fewer cited bullets) is PROVISIONAL; only explain (12 runs per arm, judged level) has a measured basis.

Machine load was uncontrolled (the `uptime` 1-minute load was 7.1 after the run; per-row means above), the arms were not interleaved, and the sample sizes are small; read the explain rows as the only latency distribution.

## Where the raw data lives

Evidence label `t0-impl/ab1` (not committed; local evidence store): `runs.jsonl` and `runs-final-*.json` (one record per run), `answers/` (every answer text; summaries as JSON), `passages.json` and `paragraphs-*.txt` (the fixed passages), `healthz-*.json` (what each agent reported), `logs/` (worker, API, agent logs; the agent's `agent.run.done` lines carry the agent-side tokens, cost and unseen markers), `pairs/` and `pairs-key.json` (the blinded pairs and their key), `judgments.json`, `summary.md`.
