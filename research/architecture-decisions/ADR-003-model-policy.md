# ADR-003: Model policy (MiniMax-M3.1-Flash-Preview where it holds quality)

- Status: **Accepted** for v0.1 by track T0 under the owner's 2026-10-15 direction ("prefer MiniMax-M3.1-Flash-Preview where it holds quality; T0 decides by A/B"). Open to override on #141.
- Evidence labels: **MEASURED** = produced by `services/agent/bench/ab.py` in this session, raw data in the evidence store under the label `t0-impl/ab1` (not committed). **JUDGED** = one judge, blinded A/B order, 12 pairs. Method and the full table: `docs/release/v0.1/MODEL-AB.md`.

## 1. Decision

| Run kind | Model | Thinking | Why |
|---|---|---|---|
| `explain` | `MiniMax-M3.1-Flash-Preview` | adaptive, effort `low` | first text p50 1.8 s against 9.3 s, inside the 5 s bar; judged at least as useful; cheaper |
| `ask` (and follow-ups) | ~~`MiniMax-M3.1-Flash-Preview`~~ **`MiniMax-M3`** since the Revision of 2026-10-15 (last section) | ~~adaptive, effort `low`~~ budget-based low | first text p50 4.0 s against 8.1 s (the only arm inside the 5 s bar at p50); supported share higher; **judged usefulness lower on a sample of 4** (see section 4), so this row is provisional |
| `summary` | `MiniMax-M3` | budget-based low (Pi's default for M3) | Flash's summaries read `partial` in 3 of 4 runs and M3's in 0 of 2 (an uncited heading bullet, `[b28-b29]` ranges that do not parse); no latency bar applies to a summary |

`MiniMax-M3` stays the configurable fallback for every kind: `PAPERTREE_MODEL=MiniMax-M3` puts the whole service back on M3 with no code change; `PAPERTREE_MODEL_<KIND>` and `PAPERTREE_MODEL_EFFORT[_<KIND>]` change one kind. The defaults live in `services/agent/src/models.ts` (`DEFAULT_MODELS`).

## 2. Facts about Flash that shape the code

- It is **not in Pi 0.87.1's catalog**. The agent registers it as a custom model through the SDK's own `registerProvider` (BookReel's `registerFlash`, minus its payload rewriting).
- **Thinking cannot be turned off.** The API answers 400 "requires adaptive thinking" to `thinking: {type: "disabled"}` and to effort `none` (measured in BookReel, not re-measured here). A Flash request is therefore always `thinking: {type: "adaptive"}` + `output_config: {effort: low|medium|high}`. Setting `compat.forceAdaptiveThinking` on the custom model makes Pi 0.87.1 send exactly that, so no payload hook is needed. The offline suite asserts the request body and that the word `disabled` never appears in it.
- **Vision and tool calls work** (BookReel). The agent's paper tools are text-only, so vision is unused.
- **It narrates before a tool call.** The agent already drops the text of a message that ends in tool use; a Flash-shaped stream (thinking, narration, `tool_use`, then the answer) is a test now. MEASURED: Flash made 0.1 tool calls per explain run and 2.2 per ask run; no narration reached a reader.
- **No published price.** `cost_usd_est` for Flash uses M3's rates and every place it is reported says "estimate on M3 rates" (`/healthz` `cost_basis`, the agent README). The dollar figures below are those estimates; the real billing unit is the MiniMax token plan.
- The model id flows out in the run event (`run.model` = `minimax/<id>`), `/healthz` (`models` per kind, `effort`, `cost_basis`) and the agent's logs. The offline suite covers all three.

## 3. The numbers (MEASURED; 38 live runs, 2 papers, est. $0.18 on M3 rates)

Machine load was not controlled: the load average (1 min, mean over the runs of each row) is in the last column and the arms ran one after the other (M3 first), not interleaved. The M3 rows ran under heavier load (8.7 to 9.7) than the Flash rows (5.3 to 7.6), which can inflate M3's latency; it cannot explain a 5x gap in first text by itself, and M3's reasoning tokens (827 per explain run against 34) are the cause that shows in the data.

| kind | arm | n | complete | first text p50 / p90 (ms) | total p50 (ms) | in / out / reasoning tokens (mean) | est. cost per run | citations (mean) | markers not minted | supported (ai_citations) | load |
|---|---|---|---|---|---|---|---|---|---|---|---|
| explain | M3 | 12 | 12 | 9,281 / 26,422 | 15,290 | 3,901 / 1,397 / 827 | $0.0029 | 5.5 | 0 | 7 of 66 | 8.7 |
| explain | Flash low | 12 | 12 | **1,824 / 3,489** | 5,124 | 4,489 / 449 / 34 | $0.0019 | 7.2 | 0 | 18 of 87 | 7.6 |
| ask | M3 | 4 | 4 | 8,118 / 8,897 | 11,754 | 15,556 / 857 / 223 | $0.0065 | 9.0 | 0 | 14 of 36 | 9.7 |
| ask | Flash low | 4 | 4 | **4,038** / 6,320 | 6,687 | 12,192 / 519 / 15 | $0.0046 | 9.5 | 0 | 20 of 38 | 5.3 |
| summary | M3 | 2 | 2 | 14,040 / 14,158 | 21,820 | 33,907 / 1,014 / 314 | $0.0136 | 18.0 | n/a | bullets 10 of 15 | 9.0 |
| summary | Flash low | 2 | 0 (2 partial) | 6,478 / 6,820 | 11,080 | 23,493 / 935 / 0 | $0.0093 | 19.0 | n/a | bullets 6 of 15 | 4.6 |
| summary | Flash medium | 2 | 1 (1 partial) | 11,368 / 13,767 | 17,770 | 37,738 / 1,343 / 0 | $0.0155 | 19.0 | n/a | bullets 12 of 19 | 3.6 |

- First text is the API's `first_text_ms` (from request accepted); the bench's client-side clock agrees within 5 to 28 ms on every run (38 of 38).
- "Markers not minted" is the number of `[bN]` markers in the answer that the API did not turn into a citation: 0 for every explain and ask run, both arms. (For a summary the API mints one citation per distinct block, so the comparison there is bullets with a valid citation: M3 15 of 15, Flash low 11 of 15, Flash medium 18 of 19.)
- "Supported" is the API's lexical coverage check (`verify_grounding`), which is paraphrase-hostile: 11% and 21% of explain citations pass for M3 and Flash. Only the ordering is informative; both arms are measured by the same checker.
- Judged usefulness (JUDGED; mean of grounded, correct, readable, useful on 1 to 5; 4 pairs per kind, single judge): explain M3 4.19, Flash 4.25; ask M3 4.56, Flash 3.94; summary M3 4.62, Flash low 4.25, Flash medium 4.12.

## 4. What is worse about Flash (and about this decision)

- **Ask quality is not shown to hold.** Flash lost both YOLO ask pairs (it misread a fragmented results table, giving 18 and 21 fps for the wrong systems, and said YOLO "gives up about 10 mAP relative to the fast version of itself", which is backwards) and won both DDPM pairs. With n = 4 and one judge this is inconclusive, not a pass; the row is adopted because it is the only arm inside the 5 s bar and its supported share is higher, and it is marked provisional. The one-line fallback is `PAPERTREE_MODEL_ASK=MiniMax-M3`.
- **Summaries format worse.** Flash opens with a markdown heading as the first bullet (no citation, so the summary reads `partial`), writes `[b28-b29]` ranges that do not parse as markers, and its medium-effort YOLO summary opened on training minutiae with no statement of the core idea. Its summaries are often fuller than M3's (the judge scored Flash higher on "useful" for DDPM), so a prompt change might recover them; that is a v0.2 experiment, not this ADR.
- **An explain slip.** One explain pair (DDPM, the simplified objective) had Flash give a confident wrong mechanism; M3's answer to the same prompt was vaguer but correct. That is one pair of four.
- **p90 first text on ask is 6.3 s for Flash** (the bar is a p50); explain p90 3.5 s is inside it.
- **The judge is not blind to style.** The A/B order was shuffled, but Flash's headings, bold lead-ins and long bullets identify it; the scores are one reader's, from 12 pairs, and say nothing about papers other than YOLO and DDPM.
- **Sample sizes.** Explain: 12 runs per arm (3 repeats x 2 passages x 2 papers). Ask: 4 per arm. Summary: 2 per arm. Only explain supports a latency distribution.
- **Flash can not run with thinking off**, so its floor on first text is higher than a non-thinking model's; at effort low it spent 34 reasoning tokens per explain run, which is why it is fast.

## 5. Out-of-scope defects found (for the orchestrator; `services/api` is not edited by T0)

The API pins `MiniMax-M3` in several places. Under the shipped defaults they break explain and ask, which now run on Flash (superseded for ask by the Revision 2026-10-15 below: ask runs on M3):

1. `services/api/python/papertree_api/schemas.py:995` `AgentRun.model: Literal["minimax/MiniMax-M3"]`: a Flash `run` event fails to parse, so the run ends in `internal`. **Merge blocker for this PR on a live stack.** (The JSON schema in `contracts/agent/run-events.schema.json` is widened here to the two allowed labels; the pydantic twin is the API's to change.)
2. `services/api/python/papertree_api/agent_client.py:85` `MODEL = "MiniMax-M3"` is written as `ai_runs.model` (line 725, `finish_run`), `RunSummary.model` fallback (772), the run logs (746, 907), a stored summary's `model` (656) and `model_id` (716), and the cached-summary key (`routers/summary.py:57`). The `run` event's `model` is read at `agent_client.py:563-566` and dropped (only `sdk` is kept). Under the default policy `ai_runs.model` would say M3 for Flash runs. Contract requirement ("every AI run records model ... in ai_runs"): store the agent-reported model, and keep the summary cache key per model.
3. A faux agent keeps reporting `minimax/MiniMax-M3` unless a `PAPERTREE_MODEL*` variable is set, so the e2e stack and the contract fixtures are unchanged until the API accepts Flash.

The A/B itself ran through a launcher (`api_shim.py`, since deleted) that patches items 1 and 2 in memory in the API process (nothing in `services/api` is edited). With the shim, `ai_runs.model` carries the arm's label because the bench said so, not because the API stored what the agent reported; the agent-reported model was checked separately in `/healthz` and the run logs.

## 6. Consequences

- (Superseded for ask by Revision 2026-10-15: ask is M3.) Every later live run uses Flash for explain and ask and M3 for summaries unless the environment says otherwise; the release notes and README must call Flash costs "estimate on M3 rates".
- `bench/ab.py` re-runs the whole comparison (`uv run python services/agent/bench/ab.py --out <dir>`), so the decision can be re-taken after a Flash price, a prompt change or a new Flash build.
- Contracts section 7 rows to add (T0 proposes; the orchestrator owns `contracts.md`):

  | Variable | Used by | Default | Notes |
  |---|---|---|---|
  | `PAPERTREE_MODEL` | agent | unset | one model for all kinds: `MiniMax-M3` or `MiniMax-M3.1-Flash-Preview`; unset = the ADR-003 defaults |
  | `PAPERTREE_MODEL_EXPLAIN`, `PAPERTREE_MODEL_ASK`, `PAPERTREE_MODEL_SUMMARY` | agent | `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3.1-Flash-Preview`, `MiniMax-M3` | per kind; win over `PAPERTREE_MODEL` |
  | `PAPERTREE_MODEL_EFFORT`, `..._EXPLAIN`, `..._ASK`, `..._SUMMARY` | agent | `low` | Flash only (`low`, `medium`, `high`); ignored for M3; an unknown value refuses to boot |

  And in section 3.2: `run.model` is `minimax/<model id>` (one of the two allowed); `GET /healthz` on the agent also returns `models`, `effort` and `cost_basis`.


## Update after review (2026-10-15)

The API defect above is fixed in this PR: `AgentRun.model` accepts both ids, and `ai_runs.model`, a stored summary's `model_id`, the summary content's `model` and `RunSummary.model` take the model the agent reported in its `run` event (M3 only when the stream broke before that event). The cached-summary lookup tries every known model and serves the newest, so a policy change does not hide a stored summary. The shim is deleted. Regression tests: `services/api/python/tests/test_summary_api.py` (Flash run) and `test_agent_contracts.py` (schema enum equals the pydantic twin). Still open: `done.usage_totals` and `ai_runs` carry no cost-basis marker (the label lives in `/healthz` and the docs); it needs a contracts change.

## Revision 2026-10-15: ask -> M3

Status: **Accepted** by the orchestrator for v0.1 (W2API item 7), from the v0.1 quality panel (`docs/release/v0.1/QUALITY.md`, PR #165; three blinded model judges, 1 to 5; JUDGED, small n: 3 ask items and 3 follow-ups per arm) and T0's own A/B above. The section 1 row for `ask` said "provisional"; the panel did not support it.

| evidence (QUALITY.md unless noted) | ask on Flash (the old default) | ask on M3 |
|---|---|---|
| follow-ups, grounded (mean of 3 judges) | 3.22 | **3.78** |
| follow-ups, citations land | 3.22 | 4.22 |
| follow-ups, wrong citations counted by the judges (3 items, 3 judges summed) | **9** | **0** |
| follow-ups, mean of the four criteria | 3.50 | 4.03 |
| ask first turns, mean of the four criteria | 4.14 | 4.36 (useful 4.00 against 4.67) |
| ask pairs (3 pairs x 3 judges, M3 against Flash) | 3 votes for Flash | 4 for M3, 2 ties |
| T0's judged usefulness (section 3) | 3.94 | 4.56 |
| median latency, ask (s) | 16.9 | 20.3 |
| median latency, follow-up (s) | 10.2 | 16.3 |
| mean cost per ask, API estimate | $0.0048 | $0.0064 |

Reasons: Flash's follow-ups cited wrong passages nine times against none for M3, and its grounding score fell by 0.56 on a follow-up; the latency price is small on an ask (median 16.9 s against 20.3 s, but the arms ran at different machine loads, 4.8-5.5 against 2.5-4.0, so even that gap is confounded) and the cost is about a third higher in cents. Explain stays on Flash at effort `low` (panel: explain 4.43, median first text 2.9 s) and summary stays on M3 (panel: M3 summaries grounded 4.67 against 3.44, 3 against 14 unsupported claims; Flash medium scored higher on "useful", 4.33 against 3.00, which is the open v0.2 prompt experiment).

Changes: `DEFAULT_MODELS.ask` is `MiniMax-M3` in `services/agent/src/models.ts` (so `ask` has no effort: `null` in `/healthz`); the default test in `test/models.test.ts` pins it. `PAPERTREE_MODEL_ASK=MiniMax-M3.1-Flash-Preview` puts ask back on Flash with no code change. Follow-ups of an `explain` thread run as `kind: explain` (contracts 2.5) and so stay on Flash; the panel's follow-ups were asks, and no explain follow-up was measured.

What this does not settle: three items per cell, one machine, loads that differ by arm. The next re-take is the T0 bench (`services/agent/bench/ab.py`) with more asks.
