# EPIC 3 — Grounded AI · RESULT

**Status: INCOMPLETE.** Six of eight features landed; two of the seven acceptance criteria are
PARTIAL, one is DEFERRED with no dataset to score it against, and the "Must delete" list is NOT
DONE. Every one of those is filed as an issue, and none of them is rounded up.

Written 2026-08-02, against `main` at `14c1f3c`. PRs #67 → #68 → #69 → #70, stacked in that order,
all three CI jobs green on each.

> Epic 1 rounded four PARTIALs up to MET and the correction cost more than the honesty would have
> (`AGENTS.md` §2). This file does not repeat that. Where a number is missing, it says the number is
> missing rather than substituting one that is easy to produce.

---

## 0. Verify this file rather than reading it

`AGENTS.md` §1: *"the previous session's claims and the result file disagree more often than you
would think, and the disagreement is the finding."* Everything below was measured on the top of the
stack (`epic-3/f3.1-agent-tools`), uncached:

```
pnpm exec turbo run lint typecheck test --force   19 successful, 0 cached
uv run pytest                                     1493 passed, 1 skipped (196 s)
uv run ruff check packages services               All checks passed!
uv run ruff format --check packages services      136 files already formatted
uv run mypy packages/*/python services/*/python   Success: no issues found in 130 source files
```

**Baseline correction.** `EPIC-03-grounded-ai.md` §5 states `uv run pytest` → "962 passed". On
`main` at `14c1f3c` it is **1095 passed, 1 skipped**. Stale by 133. The TypeScript figure (19/19,
0 cached) is correct. Numbers get re-derived, not quoted.

Added by this epic: **+398 Python tests** (prompts 170 · memory 74 · retrieval 41 · agent-tools 113)
and **+13 web tests** (103 → 116).

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
| `qa/grounding.spec` | **DEFERRED — not attempted** | The 120 Tier C questions do not exist. Schema, loader and scorer ship; the spec is not written because there is nothing to run it on. See §2. |
| `qa/citation-nav.spec` | **PARTIAL** | Resolution accuracy measured and met (§4). The end-to-end DOM scroll is a no-op today — **#64**, in files this epic does not own. |
| `qa/interpretation.spec` | **MET** | `apps/web/test/interpretation.spec.tsx`, 6 tests. Falsified on purpose: replacing the flag with a filter fails 2 of them. |
| `security/injection.spec` | **MET** | `packages/memory/python/tests/test_security_injection.py`, 12 tests. See §5 — this is the strongest result in the epic. |
| `security/isolation.spec` | **PARTIAL** | 10 tests. Asserted for every surface the registry can expose; **not** asserted at the process level. §5.3 says exactly what is and is not claimed. |

## 2. Features

| | Feature | Verdict |
|---|---|---|
| F3.1 | Tool registry | **MET** — 18 tools, plain registry, stdlib schema validator. 6 are honestly degraded by #66 and each says why. |
| F3.2 | Structure-aware retrieval | **PARTIAL** — the ladder is built and deterministic, but **three of six rungs have no data to return** (#66). |
| F3.3 | Evidence package assembly | **MET** |
| F3.4 | Agent runtime | **PARTIAL** — registry + provider layer + a 54-line lazy Pydantic AI adapter. `pydantic-ai` is **not** a dependency (§6), and **no live provider call is made anywhere in the suite**. |
| F3.5 | Answer contract + grounding verifier | **PARTIAL** — contract and verifier built, tested, and aligned with the TS twin mechanically. **Unscored**, because §2's dataset does not exist. |
| F3.6 | Inspector UI | **PARTIAL** — built, reachable, measured; wired to a **fixture** answer source (#62), and the last DOM hop is a no-op (#64). |
| F3.7 | Memory stores | **MET** — four stores + proposal queue + append-only audit. |
| F3.8 | Injection defence | **MET** — structural, measured, and falsified on purpose. |
| — | **Must delete** (4 v1 AI clients) | **NOT DONE** — #71. The replacement layer exists; the deletion needs Epic 5 for two of the four. |

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

That is **#64**. It lives in Epic 2's files and Epic 2 is closed, so it is filed rather than reached
past. The criterion is therefore **PARTIAL**: resolution is measured and meets the bar; delivery is
blocked one layer down.

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

1. **`pydantic-ai` is not a dependency.** F3.4 says "Pydantic AI over the registry". `uv sync
   --locked --all-packages` is a CI gate and `packages/evaluation` records the measured precedent —
   one `docling>=2.0` line took `uv.lock` from 22 packages to 100+. The adapter therefore imports
   lazily and reports UNAVAILABLE, exactly as `docling_bridge` does. It is **54 executable lines**,
   which is the epic's own "<100 lines" swappability requirement demonstrated rather than asserted.
   F3.4 is **PARTIAL** for this reason and for the next one.
2. **No live provider call is made anywhere.** `MiniMaxProvider` is exercised only through an
   injected transport. A key exists in the local Keychain; CI has none, and a graded suite that
   needs one is a suite CI cannot run.
3. **The Inspector is wired to a fixture answer source.** Nothing serves PaperIR over HTTP (#62).
   `AnswerSource` is a **required** prop with no default, so the seam is visible at the call site and
   the compiler will name every site to change when an endpoint lands.
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
| #64 | `documentRef.scrollToBlock` is never assigned — `onShowSource`/`onJumpToPage` are no-ops, and the capability exists one layer down under a different signature. **Blocks the end-to-end half of `qa/citation-nav.spec`.** |
| #65 | The migration and three other edits outside Epic 3's owned paths, declared. |
| #66 | Three of the retrieval ladder's six rungs have no data: no `cites`/`references`/`defines`, no `prev_id`/`next_id`, no equation `referenced_by`. |
| #71 | The must-delete list is NOT done; two of the four need Epic 5 (#43) first. |
| #72 | Python cannot mint an `Anchor`, so a server-side citation is a bare `block_id` — measured at 3.3 % survival. |

Answered on an existing issue: **#62** (the dataset ruling, and the `mode=ro`/ATTACH finding).

**Epic issue #4 must not be closed** while #64, #66, #71 and #72 are open — `AGENTS.md` §1, and the
rule Epic 1's #2 exists to enforce.

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

**Where the lesson was only partly applied:** F3.6 is reachable from a route and its citations
resolve correctly, but the click does not yet move the page (#64), and the panel is fed by a fixture
rather than an agent (#62). A user can reach the Inspector. They cannot yet get a real answer out of
it. That is stated here rather than counted as a working feature.
