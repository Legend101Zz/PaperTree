# EPIC 3 — Grounded AI · RESULT

**Status: COMPLETE, with one PARTIAL that no code can move and four follow-ups filed.**
**Seven of eight features MET**; F3.5 stays PARTIAL because the Tier C question set does not exist
and no agent may author it (**#62**, open). Of the seven acceptance criteria, five are MET, one is
DEFERRED for that same dataset, and `security/isolation.spec` stays PARTIAL on a claim it has always
declined to make. **Nothing is rounded up**, and §8 states the condition this file set for closing
**#4** and shows it met.

> **Revised 2026-08-04 by #78 Session C.** The original was written 2026-08-02 against `main` at
> `14c1f3c` (PRs #67 → #68 → #69 → #70). Since then Session A closed #64/#71/#74/#75/#33, Session B
> and B-bis moved Epic 1, and **Session C closed #66 (PRs #127 + #130), #72 (#126), #76 (#131) and
> #77 (#134), and shipped the grounding harness (#125)**. Four feature verdicts moved as a result and
> each says why below. Where a verdict did **not** move, the reason is named rather than softened.

> Epic 1 rounded four PARTIALs up to MET and the correction cost more than the honesty would have
> (`AGENTS.md` §2). This file does not repeat that. Where a number is missing, it says the number is
> missing rather than substituting one that is easy to produce.

---

## 0. Verify this file rather than reading it

`AGENTS.md` §1: *"the previous session's claims and the result file disagree more often than you
would think, and the disagreement is the finding."*

**Re-measured 2026-08-04 on the merged `main` at `e950f23`**, uncached, after every Session C PR had
been verified an ancestor of `main` with `git merge-base --is-ancestor` rather than by a MERGED badge:

```
pnpm exec turbo run lint typecheck test --force   19 successful / 19 total, 0 cached, 11.4 s
uv run pytest                                     1733 passed, 2 skipped, 0 failed, 335.3 s
uv run ruff check packages services               All checks passed!
uv run ruff format --check packages services      171 files already formatted
uv run mypy packages/*/python services/*/python   Success: no issues found in 165 source files
.github/scripts/assert-merged-prs-reached-main.sh examined 50, on main 48, known-good 2,
                                                  violations 0 — PASS
```

**The second skip is not a regression and it matters that it is not.** `main` carried one
pre-existing skip; Session C adds exactly one more — `test_live_provider.py`, which skips when
`PAPERTREE_LLM_API_KEY` is unset and emits a `UserWarning` naming the variable, so a green log
cannot quietly mean "no model was called". Neither skip is a corpus skip in this run.

**As originally measured** (2026-08-02, `14c1f3c`, top of the Epic 3 stack): turbo 19/19 0 cached,
pytest **1493 passed / 1 skipped**, 136 files formatted, mypy **130** source files. So the tree has
gained **+240 tests, +35 formatted files and +35 mypy source files** since this epic was written —
most of it from #78's three sessions, not from Epic 3.

**Baseline correction, kept because it is the reason this section exists.**
`EPIC-03-grounded-ai.md` §5 states `uv run pytest` → "962 passed". At `14c1f3c` it was **1095 passed,
1 skipped** — stale by 133. Numbers get re-derived, not quoted.

Added by this epic itself: **+398 Python tests** (prompts 170 · memory 74 · retrieval 41 ·
agent-tools 113) and **+13 web tests** (103 → 116).

**Note on the Python gate.** `AGENTS.md`'s pre-push gate lists only the three turbo targets, which
is incomplete for Python work: turbo does not cover the Python packages at all. CI additionally runs
`uv run pytest`, `ruff check`, `ruff format --check` and `mypy` over globs. All five commands above
are the real gate.

---

## 1. Acceptance criteria

| Test | Verdict | Evidence |
|---|---|---|
| `retrieval/expansion.spec` | **MET** | `packages/retrieval/python/tests/test_expansion.py`. Parent section, adjacent blocks and related equation/figure returned; determinism asserted by running twice and comparing exactly. |
| `retrieval/budget.spec` | **MET**, with the ceiling stated as an *upper bound* | `tests/test_budget.py`. Never exceeds 8,100; truncation recorded as data. See §3 for what the estimator can and cannot claim. |
| `qa/grounding.spec` | **DEFERRED — harness shipped, dataset absent** | The Tier C questions still do not exist (#62, **open**). As of #78 Session C the schema, loader and §4.2 scorer ship for the QUESTION SET too — `packages/evaluation/.../grounding.py`, `python -m papertree_evaluation grounding` — and refuse an absent, empty or zero-question set by name with a non-zero exit. **Scored on 0 questions of 0**, which is coverage, not a verdict. See §2. |
| `qa/citation-nav.spec` | **MET** | Resolution accuracy measured and met (§4). The end-to-end scroll was a no-op (**#64**); closed in #78 Session A (PR #93), asserted by `apps/web/test/citation-scroll.spec.tsx`. |
| `qa/interpretation.spec` | **MET** | `apps/web/test/interpretation.spec.tsx`, 6 tests. Falsified on purpose: replacing the flag with a filter fails 2 of them. |
| `security/injection.spec` | **MET** | `packages/memory/python/tests/test_security_injection.py`, 12 tests. See §5 — this is the strongest result in the epic. |
| `security/isolation.spec` | **PARTIAL** | 10 tests. Asserted for every surface the registry can expose; **not** asserted at the process level. §5.3 says exactly what is and is not claimed. |

## 2. Features

| | Feature | Verdict |
|---|---|---|
| F3.1 | Tool registry | **MET** — 18 tools, plain registry, stdlib schema validator. The 6 that were "honestly degraded by #66" are no longer: `resolve_citation`'s edge branch (`tools.py:870`) was unreachable code and is now reached, and `get_equation`/`get_figure` read the payload mirrors rather than working around their absence. |
| F3.2 | Structure-aware retrieval | **MET** — the ladder is built, deterministic, and **every rung now has data**. #66 closed by PRs #127 + #130: `cites` **0 → 525**, `references` **0 → 115**, figure `caption_block` **0 → 58/85**, equation `referenced_by` **0 → 7/81**. `prev_id`/`next_id` stay empty **by ruling, not by omission** — `test_prev_id_and_next_id_are_still_empty_and_that_is_the_ruling` pins it at 0 of 9,903, because `Page.flows` is the authoritative reading order and a second one would drift. |
| F3.3 | Evidence package assembly | **MET** |
| F3.4 | Agent runtime | **MET** — and the two clauses that made it PARTIAL are both discharged in §6. `pydantic-ai` stays out **by an amendment argued from a measurement** (43 → 128 packages, +85), not by silence; and a live provider call now happens in `test_live_provider.py`, opt-in and skipping loudly. `ChatCompletionsTurn` (65 executable lines) is the shipped loop `/ask` drives. |
| F3.5 | Answer contract + grounding verifier | **PARTIAL — and this is the one verdict Session C could not move.** Contract and verifier are built, tested and aligned with the TS twin. The §4.2 scorer now ships too (`papertree_evaluation grounding`). It remains **UNSCORED**, because the Tier C question set does not exist and **no agent may author it** (#62, open). Scored on **0 questions of 0**. See §3. |
| F3.6 | Inspector UI | **MET, with one filed follow-up.** `POST /papers/{id}/ask` is live and `createLiveAnswerSource` feeds the panel; a real question against a real uploaded paper returns a real answer whose citations land on the right polygon (§10). **#133** records that the panel allows one ask per page load — filed rather than invented, because §19.8 does not design the return path from an answer to the idle state. |
| F3.7 | Memory stores | **MET** — four stores + proposal queue + append-only audit. |
| F3.8 | Injection defence | **MET** — structural, measured, and falsified on purpose. |
| — | **Must delete** (4 v1 AI clients) | **DONE** — **#71 closed** by #78 Session A (PR #89). `apps/api` and the v1 canvas surface are in `archive/`, outside every workspace, gate and lint path. |

---

## 3. The dataset ruling (#62), and why `qa/grounding.spec` is deferred

Of the three missing datasets, two were authorable without violating PTUB's own standard and one was
not. `research/benchmarks/README.md` §4.4:

> Questions are written from the *paper*, by someone who has read it, **before seeing any parser
> output** — to avoid writing questions that happen to suit one parser.

An agent authoring 120 questions by reading `blocks` produces a set that is invalid by that
definition, and its evidence-F1 would measure only that retrieval can find the block retrieval was
pointed at. Shipping that number would be worse than shipping none, because it would look like
evidence. So:

- **authored and scored** — adversarial PDFs (built in-process with PyMuPDF, so CI runs them), the
  citation→polygon set (mechanically derivable: "a citation to block *X* lands on *X*'s polygon" is
  an identity property, not a judgement), and the interpretation cases.
- **deferred** — the 120 Tier C questions. Annotation work, not code.

One scoping note for whoever picks it up: README §1.2 sizes Tier C at **12 papers × 10**, and
`fetch_corpus.sh` provides **8**. "120" is quoted in four documents and is not currently reachable.

**Updated by #78 Session C (#62's ruling of 2026-08-02: option 2, a 20–30 question subset).** The
ruling reduced the QUANTITY owed and changed nothing about who may produce it, so no agent authored
the questions and **#62 stays open**. What shipped is the harness: a JSON Schema + dataclass +
loader for the question set, the `grounding` subcommand, and §4.2's five metrics — of which
**support validity is reported NOT EVALUABLE** (§4.2 requires a rubric adjudicated by a human on a
30-item sample; no proxy is substituted) and **§4.2's single "contamination rate" is not reported
as one number**, because `answer.py:100-108` buckets `caption` and `paragraph` both into
`target_type: "text"` and its caption half is therefore not expressible. `DEFAULT_COVERAGE_THRESHOLD
= 0.6` remains a **judgement, not a calibration** — a 20–30 question subset would move it from
unscored to scored thinly, and today it is neither.

### The token estimator, stated precisely

MiniMax's tokenizer is not public and `tiktoken` is OpenAI's, so using it would produce
precise-looking numbers that are wrong for the model actually called. Instead:

> For every byte-level BPE in production, the vocabulary contains all 256 single-byte tokens and
> every merge replaces two tokens with one. Therefore `tokens(s) <= len(s.encode("utf-8"))`, always.

That is a **theorem**. `TOKENIZER_AGNOSTIC_ESTIMATOR` computes it. The default claims a 2-bytes-per-token
merge credit on ASCII alphanumeric runs only — a stated 2× margin which is **a calibration, not a
proof**, and the docstring says so in those words. Non-ASCII (Greek, CJK, emoji) falls to the
provable branch, which is exactly where a prose-calibrated divisor would have been wrong and silent.

Tests assert the estimate sits inside `words <= estimate <= utf-8 bytes` on real block text, **and
that `len(text) // 4` falls out of it on the same input**, so the check is known to have teeth. What
that sandwich validates is the segmentation, not the choice of 2 — which cannot become a measurement
until a real tokenizer exists to compare against.

---

## 4. Citation navigation — the measured numbers

The epic calls this *"the entire trust mechanism"*. Two measurements, because reporting only the
first would be dishonest.

### A — same parse

All three committed fixtures, every target type: **100 % page, 100 % polygon, 100 % anchored.**

Flagged in the test's own docstring as *nearly a tautology* — `resolveAnchor` hits T1 and returns the
block's own geometry. Kept, but it is not the interesting number.

### B — after a real re-parse (`worst_case`, ids re-minted with the real `blockId`)

| fixture | ids retired | text: page | text: anchored | all other types |
|---|---|---|---|---|
| attention-is-all-you-need | 48 / 57 | 100.0 % | 100.0 % | 100 % / 100 % |
| neural-odes-mathheavy | 72 / 81 | **93.1 %** | 100.0 % | 100 % / 100 % |
| resnet-cvpr-2col | 59 / 61 | **97.3 %** | 100.0 % | 100 % / 100 % |

### The control

```
bare block_id survival: 3.3%   ·   Anchor survival: 100.0%
```

Without this there is no counterfactual and the anchor's six selectors could be dead weight. **This
is the measurement that justifies storing an `Anchor` and never a bare `block_id`.**

### Per target type, never blended

#55 has equation extents at 0/17 at IoU 0.5; #51 has figure regions unresolved. Equations, figures
and tables are therefore **measured and reported with no bar claimed** — asserting one would either
fail for someone else's reason or be set so low it asserts nothing. Text and headings carry the real
bar.

### What is NOT met

`documentRef.current.scrollToBlock` is **never assigned anywhere in the app** — `DocumentSlot` does
not forward the ref, `SourcePane` keeps `listRef` private, and `VirtualPageList` implements a working
`scrollToBlock(pageIndex, bbox)` one layer down under a different signature. So `onShowSource` and
`onJumpToPage` are silent no-ops in Source and Split modes **on `main` today**, and a citation chip
reaches the declared seam and stops.

That was **#64**, and it is **CLOSED** — #78 Session A, PR #93. `DocumentSlot` forwards
`documentRef` to `SourcePane`, `SourcePane` populates it from its existing `listRef` and resolves
`blockId -> (pageIndex, bbox)` where `doc.byId` is in scope, and `scrollToPage` replaced the
`` `page:${n}` `` sentinel. Both members of the handle are REQUIRED, so the missing forward is now
`TS2741` rather than a dead click — Epic 2's own post-mortem conclusion, applied to the fifth and
last instance of that defect.

The criterion is therefore **MET** for delivery as well as resolution. What the new
`citation-scroll.spec` asserts stops at the scroller's imperative handle rather than at a CSS
`scrollTop`, because happy-dom does no layout; that boundary is stated in the spec's header rather
than papered over.

---

## 5. The injection defence

### 5.1 A read-only connection is not sufficient, and this was measured

The epic specifies *"a separate read-only connection plus a write-guard layer"*. Reproduced on this
workspace before the module was written:

```
mode=ro connection, no authorizer:
  INSERT / UPDATE / DELETE / CREATE / DROP    -> blocked
  ATTACH DATABASE '/tmp/side.db' AS evil;
  CREATE TABLE evil.x(a);                     -> SUCCEEDS
  VACUUM INTO '/tmp/copy.db'                  -> SUCCEEDS, and the copy contains every row,
                                                 including another tenant's
```

`VACUUM INTO` is the worse of the two: a whole-library **exfiltration** primitive, not a scratch
file. Denying `SQLITE_PRAGMA` closes **neither**. Denying `SQLITE_ATTACH` closes **both**
(`VACUUM INTO` attaches its output internally). Also measured: sqlite-vec KNN runs normally with the
full deny set, so layer 2 costs no functionality.

### 5.2 The test measures structure, not persuasion

The attack is driven by an **adversarially compliant stub** — a fake agent that maximally *obeys* the
injected instruction and tries every write route it can reach. Not a model that might resist. Two
non-vacuity controls: the same statements **succeed** on an ordinary connection, and the same
preference **does** land through the privileged `MemoryStore` with explicit user confirmation.

**Falsified on purpose:** removing layer 2 fails **7 tests**, including
`test_no_user_learning_row_exists_after_the_full_attack`.

Adversarial PDFs are built in-process with PyMuPDF — white-on-white text, `/Title` + `/Keywords`
payloads, instructions inside a figure image — so nothing is committed, nothing is fetched, and the
suite is **not** 100 % skipped on CI the way every corpus test is.

### 5.3 What `security/isolation.spec` does NOT claim

`connection.set_authorizer(None)` removes layer 2, and so does `sqlite3.connect(path)`. Both require
executing arbitrary Python in-process, and **an adversary who can do that has already won by a route
this package cannot close**. The threat model is a compromised *model output* driving a tool
registry: the model chooses which listed tool to call and with what arguments, and cannot call
anything not in the registry. The claim is that **every route the registry can expose is read-only**.

This is the same honest position `papertree_db`'s gate 1 takes about `_conn`: unreachable in
TypeScript, merely unexported in Python. Pretending otherwise is how a reviewer stops looking. Hence
PARTIAL rather than MET.

---

## 6. Deviations from the brief, each with its reason

1. **`pydantic-ai` is not a dependency, and F3.4 is AMENDED IN WRITING to say so.** F3.4 asks for
   "Pydantic AI over the registry". It was originally declined here by analogy to the `docling`
   precedent; #76 replaced the analogy with a measurement of the actual package, taken in a
   throwaway uv workspace containing only this repo's `pyproject.toml` files, on 2026-08-04:

   | | packages in `uv.lock` |
   |---|---|
   | this workspace today | **43** |
   | with `pydantic-ai` added to `packages/agent-tools` | **128** |
   | delta | **+85 (2.98×)** |

   The 85 include `openai`, `anthropic`, `google-genai`, `mcp`, `logfire`, **nine**
   `opentelemetry-*`, `cryptography`, `keyring`, `secretstorage`, `jeepney`, `pywin32`,
   `protobuf`, `tiktoken`, `websockets` and `requests`. **This repository calls none of them.**
   `uv sync --locked --all-packages` is a CI gate and uv locks a group whether or not it installs
   it, so all 85 land on every checkout — to replace a **54-line** adapter.

   There is a second, independent reason that is not about size. `test_runtime_swappable.py:103`
   asserts `find_spec("pydantic_ai") is None` **as the premise of the degradation tests**: the two
   tests after it check that the adapter reports UNAVAILABLE with a reason and a fix rather than
   crashing. Installing the package turns that suite red and, worse, stops it testing anything —
   the degradation path becomes unreachable.

   So: **do not add it.** The adapter stays lazy (`importlib.util.find_spec` at call time), which
   is the `docling_bridge` shape, and #76 additionally ships a *concrete* runtime —
   `papertree_agent_tools.turn.ChatCompletionsTurn`, 65 executable lines — that `services/api`'s
   `/ask` drives. F3.4's real requirement, "the runtime must stay swappable in <100 lines", is now
   demonstrated three times over: the 54-line adapter, the 37-line one written from scratch inside
   `test_runtime_swappable.py`, and the 65-line one that ships.
2. **~~No live provider call is made anywhere.~~ CLOSED by #76.**
   `packages/agent-tools/python/tests/test_live_provider.py` calls a real MiniMax-M3 through the
   shipped loop, asserts at least one tool was dispatched, and decodes the reply through the answer
   contract and the grounding verifier. It is opt-in on `PAPERTREE_LLM_API_KEY` and **skips loudly**
   — a `UserWarning` naming the variable appears in every run's warnings summary, so a green log
   cannot quietly mean "no model was called". It found two defects nine scripted tests had not:
   `ToolArgumentError` escaping the loop as a 500, and a 2048-token output ceiling truncating a
   reasoning model's JSON answer about one run in four.
3. **~~The Inspector is wired to a fixture answer source.~~ CLOSED by #76.** `POST
   /papers/{id}/ask` exists and `createLiveAnswerSource` implements `AnswerSource` against it. The
   prediction this deviation made held exactly: `AnswerSource` being a **required** prop with no
   default meant the compiler named one call site — `ReaderWorkspace`'s Inspector slot — and
   neither `Inspector` nor `AnswerView` changed. The fixture source stays as the offline path,
   because a fixture paper has no `paper_id` on any server to ask about.
4. **Four edits outside Epic 3's owned paths**, all declared in #65: the new migration
   `0003_memory.sql`, two hunks of root `pyproject.toml`, a regenerated `uv.lock`, and one assertion
   in `packages/jobs/.../test_jobs_api.py` that pinned *how many migrations exist* — now read from
   disk, as `packages/db/test/migrations.spec.ts` already did.

---

## 7. What the next epic can rely on

**Tool surface for Epics 4 and 5.** `build_registry()` returns the 18 tools; every one takes a
read-only `AgentDataHandle` and returns a `ToolResult` with one of five statuses. `unavailable` and
`empty` are distinct, and both carry a reason — a tool never returns a bare `[]` that reads as "none
exist".

Real data today: `get_paper_metadata`, `get_document_outline`, `get_block`, `get_block_children`,
`get_parent_section`, `get_adjacent_blocks`, `get_table`, `retrieve_previous_questions`,
`save_user_note`, `generate_explanation`, `verify_answer_grounding`.

Degraded, each with a stated reason: `get_equation` and `get_figure` (partial, #66/#51),
`resolve_citation` (printed-label inference only — `cites` is emitted zero times),
`search_semantic_blocks` (no embedding model exists), `get_page_image` and `crop_pdf_region`
(no pixels reachable from a tool with no filesystem).

**Also usable:** `papertree_prompts.render_untrusted` / `build_system_prompt` / `TurnCaps` — any
surface that puts paper text in front of a model should go through these rather than concatenating.
`papertree_memory.MemoryStore` is the only writer; `AgentDataHandle` is the only thing an agent gets.
`papertree_retrieval.PaperReader` is the protocol both satisfy.

---

## 8. Open issues filed by this epic

| # | What |
|---|---|
| #64 | `documentRef.scrollToBlock` is never assigned. **CLOSED** — #78 Session A (PR #93). |
| #65 | The migration and three other edits outside Epic 3's owned paths, declared. **CLOSED.** |
| #66 | Three of the retrieval ladder's six rungs have no data. **CLOSED** — #78 Session C (PRs #127 + #130). |
| #71 | The must-delete list is NOT done. **CLOSED** — #78 Session A (PR #89). |
| #72 | Python cannot mint an `Anchor`, so a server-side citation is a bare `block_id` — 3.3 % survival. **CLOSED** — #78 Session C (PR #126). |
| #76 | The Inspector answers from a hardcoded fixture. **CLOSED** — #78 Session C (PR #131). |
| #77 | The end-to-end journey has never been walked. **CLOSED** — #78 Session C (PR #134). |

Answered on an existing issue: **#62** (the dataset ruling, and the `mode=ro`/ATTACH finding).

### The condition this file set for closing #4, and whether it is met

The previous revision of this section said, in its own words:

> **Epic issue #4 must not be closed** while #64, #66, #71 and #72 are open — `AGENTS.md` §1, and the
> rule Epic 1's #2 exists to enforce.

**All four are closed**, as are #76 and #77, which were filed later against this epic. So Epic 3's own
stated closing condition is satisfied and **#4 is closed** by #78 Session C.

**What that does NOT claim.** Four things are open and each is named rather than absorbed:

| # | What it is | Why it does not block #4 |
|---|---|---|
| **#62** | the Tier C question set | Needs a **human author** — §4.4 requires the questions written before seeing parser output, which an agent that has read the corpus cannot honestly satisfy. The harness ships; the dataset cannot be agent-made. #78 §8 lists "#4 closed" and "#62 open" as simultaneously true. **F3.5 stays PARTIAL because of it, and that is stated in §2 rather than rounded up.** |
| **#121** ·  **#123** ·  **#124** | anchoring follow-ups filed while landing #72 | #72's scope was the *derivation*, and it is done and proved against the real TS resolver. #124 (nothing calls it yet) costs **zero today** by its own measurement — nothing persists a citation. #121 (the `anchors` table cannot store a T4/T5/T6 verdict) bites the day something does. |
| **#133** | the Inspector allows one ask per page load | A design question §19.8 does not answer, filed under #77's own "file it, do not invent it" rule. |
| **#132** | mode switching loses reading position | Epic 2 surface, same rule. |

**If a reader judges #124 or #133 to be unfinished Epic 3 scope rather than follow-ups, reopening #4
is one click and this table is the argument to overrule.** It is written here so the decision is
reviewable rather than implicit.

---

## 9. The Epic 2 lesson, and whether it was actually avoided

Epic 2 shipped nine of nine criteria with four features a user could not reach. The structural fix —
`reachable.spec` walking the import graph from `src/app/**` — was inherited and **passes without an
`ORPHAN_LEDGER` entry**, and that green was watched fail first: adding one unreferenced file under
`components/inspector/` produces *"these components are built and no URL reaches them"*.

For the Python side there is no import-graph scan, so the equivalent discipline was applied by hand:
every package is listed in the root `pyproject.toml` `dependencies`, because a uv workspace member
that nothing depends on is **not installed into the root `.venv`**, and `uv run pytest` then collects
**zero tests from it** — which reports as a pass. That is the same vacuous green in the other
language, and it is why those four lines exist.

**Where the lesson was only partly applied — and where it now is.** This section previously read:
*"A user can reach the Inspector. They cannot yet get a real answer out of it."* Since #76 (PR #131)
they can: `POST /papers/{id}/ask` composes retrieval → evidence → runtime → verifier, and
`createLiveAnswerSource` feeds the panel. §10 records the question, the answer and the cited block
ids from a real uploaded paper.

**The lesson's harder half was re-learned in a new place, and it is worth recording.** `reachable.spec`
walks the import graph and would have caught an unmounted component. It could not have caught what
the #77 walk actually found: surfaces that are reachable at every step and incoherent as a whole —
a mode switch that discards the reading position (#132), an ask affordance that vanishes after one
use (#133). **The only instrument that finds that class is a person driving the product**, which is
why #77 existed and why its output is a defect list rather than a feature.

---

## 10. The headline claim, recorded rather than asserted

Epic 3's goal sentence is *"every answer cites blocks, pages and regions — and clicking a citation
lands on the exact polygon."* #78's done-when for Session C asks for it **recorded with the question,
the answer and the block ids**. This is that record, taken by the session's own orchestrator against
the merged `main` at `e950f23`, not by the PR that built it.

**Setup.** `python -m papertree_api` + `python -m papertree_api.worker` against a scratch
`PAPERTREE_DATA_ROOT`, `PAPERTREE_LLM_API_KEY` from the local Keychain. Registered a new user,
uploaded `research/benchmarks/corpus/resnet-cvpr-2col.pdf` over HTTP, waited for the job to reach
`state: "succeeded"` (2/2 steps), then selected the paper's two abstract blocks as the seed —
the same path a reader takes.

```
paper_id   ppr_2ZWQKB8WKZ71DSM5CD58ET4T37     (12 pages, 955 blocks, real upload)
seed       blk_yaup3uye2fwqce6n, blk_2iep3dd7a7j27kx7   (type "abstract")
```

**Question asked:**

> What error rate did the ensemble of residual nets achieve on the ImageNet test set, and how deep
> were the networks the authors evaluated?

**Answer returned** — `HTTP 200` in **6.6 s**, MiniMax-M3 through `ChatCompletionsTurn`:

> On the ImageNet dataset the authors evaluate residual nets with a depth of up to 152 layers—8×
> deeper than VGG nets [41] but still having lower complexity. An ensemble of these residual nets
> achieves 3.57 % error on the ImageNet test set.

`interpretation: null` — correctly, the answer is purely extractive and the contract has one
spelling for that. `confidence: 0.95`. `unresolvedAmbiguities: []`.

**The verifier's three claims, all `supported: true`, each naming the block it came from:**

| claim | supported by |
|---|---|
| An ensemble of the evaluated residual nets achieved 3.57 % error on the ImageNet test set. | `blk_yaup3uye2fwqce6n` |
| On ImageNet, the authors evaluated residual nets with a depth of up to 152 layers. | `blk_yaup3uye2fwqce6n` |
| The evaluated residual nets were 8× deeper than VGG nets while still having lower complexity. | `blk_yaup3uye2fwqce6n` |

**Checked independently against the parse, not taken on trust.** The cited block is
`type: "abstract"`, `page_index: 0`, and its text contains `"3.57"`, `"152 layers"` and
`"152 layers—8× deeper than VGG nets [41]"` verbatim. So all three claims are grounded in the block
the answer names.

**The region is the parser's, not the model's** — which is the property that makes the citation
land on the right polygon:

```
answer.sourceRegions[0].bbox   [50.111961, 247.113036, 286.365112, 519.141593]
blocks[blk_yaup3…].bbox        [50.111961, 247.113036, 286.365112, 519.141593]   identical
blocks[blk_yaup3…].polygon     56 points
label                          "p1 · abstract"
```

`ANSWER_SCHEMA` permits a draft to carry `source_regions`, and a model will invent a bbox given the
chance. `ask.py` discards them and rebuilds from `verified.supporting_block_ids` against the indexed
view. The identity above is that rule holding on a live answer.

**One thing this record does NOT establish.** It is a single question on one paper — it is an
existence proof that the path works end to end, not a rate. **The rate is what `qa/grounding.spec`
would measure and it cannot be run, because the Tier C question set does not exist (#62).** Scored
on 0 questions of 0. That distinction is the whole reason F3.5 stays PARTIAL in §2.
