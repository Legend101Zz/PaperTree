# EPIC 0 — independent gate report

**Verdict: MERGED.** All seven named acceptance tests are MET with executed evidence, on a
clean clone of `main`. Merge commit **`ae5c99f`**, parents `1fa888d` (main) + `582c3c2`
(stack tip).

Written by the gate session, which did not write any of the code under review. Every number
below was produced by running something on this machine; where a claim is inherited rather
than re-measured, it says so.

---

## 0. Topology found

Not thirteen independent PRs. **One strictly linear stack of thirteen commits, zero merge
commits**, every branch an ancestor of the tip.

```
1fa888d (main == epic-0-spine, a base label only)
  └─ 9cb4cb7 F0.1 → 21ffba0 F0.2 → 32c4074 Phase A → 8ad62bf F0.3 → e1b8c71 F0.4
     → 19cf03a F0.5 → c851feb F0.6 → 7b0d78b F0.8 → 8dd2a1f G8 → 4d1f67d F0.7
     → 7d028d0 acceptance review → 382f1f3 CI drift both ways → 582c3c2 RESULT doc
```

Two corrections to the brief this gate was given:

1. **`epic-0-integration` is not merely tree-identical to the stack tip — it is the same
   commit**, `582c3c2`. `git rev-parse` on both returns the same SHA. So #12 and #21 were
   two PRs pointing at one commit.
2. **#12's base was `epic-0-spine`, not `main`.** Because `epic-0-spine == main == 1fa888d`
   the trees agreed, but merging #12 as it stood would have advanced `epic-0-spine` and left
   `main` untouched. The PR was retargeted to `main` before merging.

`382f1f3` belongs to no PR head branch; it was carried by #21.

**Merge executed:** one merge of #12 into `main`, `--merge` (not squash — the per-feature
commits are the review record). All thirteen commits verified reachable from `main`
afterwards.

**PR closure.** #12 shows MERGED. The other twelve could **not** be auto-closed or even
retargeted: GitHub rejects `--base main` with *"There are no new commits between base branch
'main' and head branch …"* precisely because the merge already made their commits reachable.
They were closed manually, each with a comment naming `ae5c99f`. This is a real wrinkle of
merging a stack via its superset branch and is worth knowing next time — the stack PRs do not
tidy themselves.

**Branch retained deliberately:** `origin/epic-0-spine-wip` (`6a41504`) is **not** deleted.
It is the audit trail for §2 below and destroying it would destroy the evidence.

---

## 1. Per-criterion verdicts

All seven MET. Thirteen adversarial reviewers, one per commit, each instructed to refute its
slice and to default to "not met" when uncertain, returned **zero NOT_MET verdicts**
(19 MET, 16 MET_BUT_FRAGILE, 56 not-applicable).

| # | Test | Verdict | Evidence produced by this gate |
|---|---|---|---|
| 1 | `document-ir/identity.spec` | **MET** | 10 392 ids over 433 distinct inputs × 24 rounds, 0 mismatches, in both languages. Cross-language checked against the committed vector file plus `verify-vectors.mjs`: `433 vectors / 8 negative / 11 equivalence / 5 rejection / 0 failures`. |
| 2 | `document-ir/geometry.spec` | **MET** | 196 tests. `roundtrip_grid` is 8 zooms × 4 rotations × 3 userUnits × 3 page sizes × 10 points = **2880 combinations**; worst observed error **4.552e-14 pt** against a 0.01 pt criterion. `userUnit ≠ 1` (2.5, 0.75) and `CropBox ≠ MediaBox` both present among the 10 page frames. |
| 3 | `document-ir/schema.spec` | **MET** | 3/3 fixtures validate. I ran 31 adversarial probes against the schema: all 7 attempts to name a model in a source field rejected; `polygon` absent/null/empty/2-vertex/non-numeric all rejected; unknown block **and** relation types accepted. |
| 4 | `document-ir/codegen-drift.spec` | **MET** | No drift on disk: all 7 generated files byte-identical after `pnpm run codegen`. Guard proven to fire — see §3. |
| 5 | `db/migrations.spec` | **MET** | Empty → head applies `(1,2)`; re-run returns `applied=()` — a real no-op; checksum tamper on an applied migration raises `MigrationError` quoting recorded-vs-disk sha256. All 11 required tables present. Perf re-measured: **687 ms** minimal / **1578 ms** parser-shaped, both under the 2 s bound, at load average 10.6. |
| 6 | `db/ownership.spec` | **MET** | 27 of 31 public methods take `ownerHandle: OwnerId` as their first parameter. The four that do not are `migrate`/`close` (lifecycle) and `createUser`/`ownerFor` (the owner-minting seam, which by definition cannot require an owner). The compile-time half proven to fire — see §3. |
| 7 | `jobs/durability.spec` | **MET** | Real `SIGKILL` to a real subprocess, asserted to have died by signal. Ledger before kill: `0:extract=succeeded@attempt1, 1:layout=running@attempt1`; after: `0:extract=succeeded@attempt1, 1:layout=succeeded@attempt2`. Step 0 stayed at attempt 1 — it resumed **at** the step, not from the start. Cancellation: `side effects: ['first'] (2 of 3 steps never ran)`. |

**Machine load.** No orphaned processes existed at any point (`pgrep -f '^yes'` → none). The
1.85× contamination described in the RESULT doc could not be reproduced because its cause is
gone. Load during measurement was 3.5–10.6, driven by other users' editor sessions; it is the
machine's floor and it can only *hurt* the numbers, so the `<2 s` result stands with margin.

---

## 2. The spec-weakening check

This is what the gate exists for, so it is reported in full.

`EPIC-00-spine.md` is blob **`5c4f1ed`** on `origin/main`, on
`origin/docs/audit-and-build-plan`, and on the merge candidate — **byte-identical across all
three** — and `git log` over the whole stack for that path is empty: **no commit in the stack
touched it.** Same for `WAVE-0-PROMPT.md`.

The weakened version is real and it is on `origin/epic-0-spine-wip`, which is **not an
ancestor** of the merge candidate. It changed the `db/migrations.spec` row to:

> …a paper with 30k blocks inserts in <2s. **MET BY THE MINIMAL FIXTURE ONLY** — with
> parser-shaped blocks … the same insert measures ~2.3 s TS / ~3.9 s Python.

That edit was both illegitimate *and* wrong: the numbers it encoded were the load-contaminated
ones the RESULT doc §3 retracts, and I measured 687 ms / 1578 ms. The revert is clean.

---

## 3. Guards deliberately broken

A guard nobody has seen fail is not a guard. Each was broken and restored; the tree was
verified pristine (`git status --porcelain --untracked-files=all` empty) after every test.

| Guard | Injected fault | Result |
|---|---|---|
| **Codegen drift (CI form)** | Added `Block.gate_probe_field` to the schema, ran CI's exact command | **FIRED.** Drift propagated to `types.ts`, `zod.ts` *and* `models.py` — both languages — and `git status` caught it. |
| **Codegen drift (spec form)** | Hand-staled `src/generated/types.ts` | **FIRED** when run directly: `× src/generated/types.ts has not drifted from the schema`. |
| **Geometry conformance, TS** | Re-injected the original FATAL (`sameLine = r.y0 < cur.y1`) | **FIRED.** Paragraph collapsed to a 4-point rectangle; 3 tests failed, including both hand-derived vectors and `does NOT collapse to a bounding box when consecutive line boxes overlap`. |
| **Geometry conformance, Python** | Same fault in the twin | **FIRED.** Same 3 failures. The assertion reads `assert len(polygon) > 4` with the comment *"a rectangle here is the bug, and '4 vertices' is exactly how it looked"*. |
| **Ownership, compile-time** | Placed `@ts-expect-error` above a *legal* call | **FIRED.** `error TS2578: Unused '@ts-expect-error' directive.` The inversion works and the file is genuinely typechecked. |
| **Migration checksum** | Appended bytes to an already-applied migration | **FIRED.** `MigrationError: migration 1 (core) has changed since it was applied: recorded sha256:38adeb8f…, on disk sha256:…` |

### Can the conformance methodology still certify a bug?

For **geometry**, no — and the fix is structural rather than a patch. `geometry-vectors.json`
declares its oracles explicitly:

> `fixture_vectors`: MuPDF. Markers painted by a raw PDF content stream, read back with
> `page.get_drawings()`, divided by `/UserUnit` and mapped with `page.rotation_matrix` — a
> second, independently implemented coordinate pipeline.
> `everything_else`: hand arithmetic, written as literals in `generate.py` with the working
> shown in the comment beside each entry. **Nothing here was produced by running geometry.ts
> or geometry.py.**

Expected values are hand-derived, not harvested from an implementation, so "both twins agree"
can no longer mean "both twins are wrong". Both twins were proven to fail on reintroduction.

For **identity** the picture is weaker and should be carried forward: `identity-vectors.json`
is `generated_by: research/benchmarks/harness/id_stability.py`, i.e. one implementation's
output. The mitigation is real but bounded — `verify-vectors.mjs` is a genuine third
implementation (212 lines, `node:crypto`/`node:fs` only, written from the `spec` blocks in the
JSON, calling no `toLowerCase`, no `slice`, no `Math.round`). It proves the written contract is
independently reimplementable; it does **not** prove the contract is right. A misreading shared
between the spec prose and the harness would still be invisible.

---

## 4. The fifth cross-language divergence class

The RESULT doc §7.4 says to assume one exists. **I looked hard and did not find one.**

40 identity edge cases and 19 canonical-JSON number cases, run through both languages and
diffed, across seven candidate classes: unpaired surrogates; astral truncation at the
8-code-point boundary; non-finite and extreme coordinates; NUL, bidi and variation selectors;
normalisation-order interactions (ligature+combining, Hangul jamo, singleton and CJK
compatibility decompositions); whitespace-set edges; and `block_type`/`source_hash` form edges.

**Every case either produced identical ids in both languages or was rejected by both.** The
two most promising candidates turned out to be already closed, with named guards:

- `ValueError: text contains an unpaired surrogate at code point index 0`
- `ValueError: quantised bucket 9200000000000000 is outside +/-9007199254740991: reject, never
  emit (JS String() gives exponential notation…)`

Canonical JSON agrees on `-0.0 → 0`, `1e-7 → 1e-7`, `1e-6 → 0.000001`, `5e-324`, and
`792.00000000000006 → 792.0000000000001`, and rejects the same integers in both languages.

This is a negative result, not a proof. It narrows the residual to what DESIGN.md §11.9 already
names: a future Unicode revision changing an **already-assigned** code point's compatibility
decomposition is not covered by the pin, and only the digest tripwire would catch it.

---

## 5. The four FATALs from #20

Verified by execution, not by reading the claim.

**FATAL 3, `union_of_line_rects` — fixed, and the fix is right.** Both languages now produce
byte-identical output on every case I tried, matching the hand-derived vectors and RESULT §6.1
exactly:

| input | output |
|---|---|
| 3 overlapping font-metric boxes | 6-vertex staircase, seam at 122.5 |
| abutting, differing widths | 6-vertex, seam at 111 |
| **overlapping, differing widths** | 6-vertex, seam at **110.5** (the overlap midpoint) |
| overlapping, equal widths | 4-point rectangle — correct, it genuinely is one |
| two columns | **2 polygons**, nothing painted across the gutter |

The polygons-not-rectangles rule holds in the shipped data too. My independent recount of all
three fixtures reproduced **every** §6.1 number: 199 blocks · 92 polygons with >4 vertices ·
92/92 genuinely non-rectangular · max 30 vertices · 107 four-point rectangles · 105 multi-line
blocks of which 13 are rectangles (`equation` 7, `table_row` 5, `algorithm` 1) · **0 of 70
multi-line paragraphs stored as a rectangle** · 0 multi-line prose blocks as rectangles. The
RESULT doc's own correction is accurate: 4 paragraphs, 19 headings, 3 titles and 2 captions
*are* rectangles, and every one is single-line.

One reviewer disputes the *narrative*: it argues the conformance file did not "certify" the bug
so much as stay silent on the case. That distinction does not change the outcome — the file is
no longer silent, and both twins now fail on reintroduction — but the RESULT doc's framing
overstates what the old file did.

---

## 6. Discrepancies against `EPIC-00-RESULT.md`

The document is unusually honest — it corrects itself in four places and flags what it did not
re-verify. Everything I sampled reproduced:

- §2 gate table: 901 TS (859 + 42) and **718 Python, 0 failures, 0 errors, 0 skipped** (JUnit
  XML, because a hidden skip is a known hazard in this repo). Total 1 619. Per-file counts match
  exactly.
- §6 fixture table and every §6.1 census number: reproduced.
- Conformance counts, fold-map size (1 530), whitespace set (26), NFC pin (46 starters / 20
  decompositions), Unicode 15.0.0: reproduced.
- §4 R1/R2/R3 tables against `id-stability.json`: `r2_best_score_pct 42.204`, `r3_applied
  false`, structural floor `35.75 %` — reproduced.
- 29/29 fixture `fixture://` asset URIs resolve; no orphans, no dangling references.

**What does not hold up:**

1. **A false, load-bearing claim in ADR-001 Amendment 1** (see §7 — this is the most serious
   item in this report).
2. **`packages/jobs` is 813 lines against the brief's "~300 lines"** (`model.py` 108 +
   `runner.py` 205 + `store.py` 421 + `__init__.py` 79). §5 claims to record *every* deviation
   from the epic brief and does not mention it.
3. **F0.1 is not covered by §5 either.** The workspace ships 2 of the 5 path groups the spine
   names (`services/*` matches nothing; `apps/**` is deliberately excluded). The engineering
   call is right and is justified inline in `pnpm-workspace.yaml`, but the word `apps` does not
   appear in the RESULT doc at all.
4. **The root `dev` script executes nothing** and is disclosed nowhere legitimate. It was absent
   from F0.1 entirely and added silently by `7d028d0`. (The one attempt to disclose it was the
   illegitimate edit to `EPIC-00-spine.md` that was reverted — the disclosure belonged in the
   RESULT doc and never made it there.)
5. **§7.3's "knowing a user id buys you nothing" is contradicted** by §7.2 on the same page:
   `owner_for(user_id)` is public, unauthenticated, and turns any known user id into a working
   `OwnerId`. §7.2 states this plainly; §7.3 should not claim the opposite.
6. **DESIGN.md §8's worked example** is labelled "a valid Paper" and claims it cannot drift from
   the validated one. The shipped semantic validator rejects it with 12 hard errors.

---

## 7. The one finding raised as BLOCKING, and why it is not

One reviewer returned a **BLOCKING** verdict on `32c4074`. I verified its factual core myself
and it is **partly right and materially important**, but it does not block. Recording both the
finding and my reasoning, so the human can disagree.

**What is true.** ADR-001 Amendment 1 says, as the stated justification for relaxing R1:

> **Applied literally, it eliminates everything — 0 of 192 pass.**

That is **false**, and the same paragraph contradicts it seven lines later ("under the strict
reading 56/192 still pass"), as does the harness's own output. Measured directly from
`id-stability.json`: `r1_strict_pass` is true for **56 of 192** combinations. And the selected
configuration is **not one of them** — `chosen_row.r1_pass = True`, `r1_strict_pass = False`.
The document tells a reviewer to check the exemption but never discloses that the shipped
configuration depends on it.

**Why it nevertheless does not block.** The epic's rule is *"pick the coarsest grid with zero
collisions"* — a statement about the **grid**. I computed the answer:

```
strict-pass (literal R1) = 56 of 192
  full_bbox  grids [0.25, 0.5, 1.0]
  anchor_xy  grids [0.25, 0.5]
  centre_xy  grids [0.25, 1.0]
COARSEST grid passing literal R1 : 1.0 pt
```

**The coarsest grid that passes even the literal reading is 1.0 pt — exactly the grid that
shipped.** The exemption is load-bearing for the *geometry* (`anchor_xy`), an axis the epic's
rule never mentioned and which ADR-001 had fixed at `full_bbox`; that change is disclosed as
deviation 1 and justified on churn (42.17 % vs 53.86 % under merge; 11.68 % vs 42.47 % under
split).

The exemption itself is sound and auditable: a group is exempt only if all members share block
type and normalised text **and** all four coordinates agree within a **fixed, grid-independent
1.0 pt**, so a coarse grid cannot launder a real collision. At the chosen configuration exactly
one group is exempted — a `[CLS]` label drawn twice 0.7 pt apart on `bert-2col` p14. Both counts
are in every row of the raw data.

**Classification: MAJOR, not BLOCKING.** The decisive test is whether fixing it changes the
artefact. It does not — the fix is to correct two sentences and add one disclosure; the code,
schema, fixtures and tests are byte-identical either way. It is filed as a high-priority issue
because this is the project's *frozen* contract and a future reader re-deriving the decision
would be misled by a false premise.

One incidental error: the disclosed cause of the relaxation ("`bert-2col` p14 draws *'Tok 1'*
twice, 0.4 pt apart") is not the group the selected configuration actually depends on, which is
the `[CLS]` pair ~0.7 pt apart. `DUP_TOL_PT = 1.0` is therefore load-bearing at a value the
prose does not motivate.

---

## 8. Residual risks carried into Wave 1

Ranked by what can bite Wave 1 soonest. Filed as issues **#22–#29**; none blocks the merge.

| Issue | Item |
|---|---|
| **#22** | ADR-001 Amendment 1's false "0 of 192 pass" claim (§7 — highest priority) |
| **#23** | `pnpm test` turbo-cache hole |
| **#24** | `_fail_step` not lease-fenced |
| **#25** | CI trigger missed 10 of 13 PRs; `main` unprotected |
| **#26** | `validate-fixtures.mjs` fails open |
| **#27** | `ingest/source-authenticity.spec` missing from Epic 1's contract |
| **#28** | Epic 2 cannot bring `apps/web` into the workspace |
| **#29** | Undisclosed deviations in `EPIC-00-RESULT.md` |


1. **`pnpm test` is not a gate.** `turbo`'s `test` task inputs are package-relative and omit
   `infrastructure/migrations/*.sql` and `packages/db/python/**`, both of which
   `db/migrations.spec` actually executes, and `turbo.json` declares no `globalDependencies`.
   Runs are cached: I observed `@papertree/db:test → cache hit, replaying logs` with the
   performance numbers reprinted from cache without executing. **Change a migration `.sql` and
   `pnpm test` can still report green from cache.** CI is unaffected (fresh checkout, no remote
   cache). Wave 1 must not treat a local `pnpm test` as proof.
2. **`_fail_step` is not lease-fenced.** `packages/jobs/.../store.py:353` writes
   `state='failed' WHERE job_id = ? AND step_name = ?` with no `lease_owner` predicate — while
   the success path immediately above it *is* fenced, with a comment explaining exactly why
   ("another worker now owns this job and is redoing the work; writing our checkpoint … would
   overwrite theirs"). A superseded worker whose body throws can overwrite the live worker's
   committed `succeeded` checkpoint with `failed`, after which a step whose side effect already
   committed runs again. Not covered by `jobs/durability.spec`, which is single-worker. Epic 1
   runs parsing as a durable job — this is the epic that will hit it.
3. **CI never ran on 10 of the 13 stack PRs.** `pull_request: branches: [main, epic-0-spine]`
   filters on the PR's *base*, and every stacked PR based on another `epic-0/*` branch. CI did
   run on the merge candidate, so the merge is covered — but per-PR review signal was absent for
   most of the stack. Wave 1's branch names must be in the trigger list.
4. **`main` has no branch protection.** No required checks, no ruleset; a red CI does not block
   a merge. The workflow header explicitly avoids `paths-ignore` so the jobs *can* be required
   status checks — that intent was never completed.
5. **`validate-fixtures.mjs` fails open**, and its message is now a lie: a missing or mistyped
   path argument prints "F0.7 has not landed", validates nothing and exits 0. F0.7 *has* landed.
   The PENDING branch has outlived its purpose and should become a hard error.
6. **`ingest/source-authenticity.spec` is owed by Epic 1 but is not in Epic 1's contract.** The
   schema and DESIGN.md §11.1 both name it and both say the schema is *not* a substitute — it is
   the "tested by a lint" half of anti-slop rule 5. `EPIC-01-ingest.md` never mentions it. Folded
   into the Epic 1 prompt.
7. **The ownership guarantee is narrower than "every helper".** TypeScript has no mechanical
   enumeration — 17 hand-written `@ts-expect-error` lines against 5 named methods — so a newly
   added unscoped helper is caught by nobody. The Python audit checks only that the first
   parameter is *named* `owner`. `packages/jobs` exempts 11 `JobStore` helpers by naming
   convention.
8. **The grid remains the weakest part of the ID answer**, as the RESULT doc itself says. All
   synthetic perturbations favour a coarser grid; the only empirical one (P10) churns 0.00 % at
   every grid — one data point. Evidence of a real parser release shifting coordinates ~0.5 pt
   flips the decision to `anchor_xy / 2.0 pt / prefix 24`.
9. **Coverage bound.** All 8 corpus papers are arXiv/LaTeX ML preprints. No scanned, OCR'd,
   Office-origin or CJK document; no real rotated page, CropBox offset or `/UserUnit` PDF exists
   in the repo — those are exercised only against synthetic PDFs. Everything about behaviour
   outside that class is extrapolation.
10. **Epic 0 wrote into `research/benchmarks/**`, which Epic 1 owns.** `id_stability.py` lives
    there and **rewrites** `packages/document-ir/conformance/identity-vectors.json`, which Epic 0
    owns and which is normative. An Epic 1 agent editing the harness can silently invalidate the
    ID contract. Called out in the Epic 1 prompt.
11. **`apps/**` is excluded from the pnpm workspace and CI asserts it stays excluded** — a job
    fails if `apps/` leaks in. Epic 2 owns `apps/web/src/**` and will need it in the workspace,
    but `.github/workflows/**` belongs to Epic 0. Epic 2 cannot resolve this alone; it must open
    an issue. Called out in the Epic 2 prompt.

---

## 9. What this gate did not do

- Did not re-run `id_stability.py`. It rewrites the normative `identity-vectors.json`;
  rewriting the artefact under audit is not an audit. Its outputs were checked against the
  committed file instead.
- Did not re-verify the fixtures visually against rendered PDF pages. The 10-page visual check
  is attested by `fixtures/README.md` and is not mechanically reproducible. `fixtures/README.md`
  already warns this check is weaker than it sounds — it did not catch the
  `union_of_line_rects` collapse.
- Did not reproduce the 22 orphaned processes. They no longer exist.
- Triaged but did not individually re-verify all 118 reviewer findings (1 blocking, 28 major,
  55 minor, 35 nit). The blocking one and the majors bearing on acceptance were re-verified by
  hand; the rest are recorded in the issues.

---

## 10. Post-merge state

| Check | Result |
|---|---|
| `main` after merge | `ae5c99f`, CI **success** (run 30549233876) |
| All 13 commits reachable from `main` | yes |
| PRs | #12 MERGED; #9–#11, #13–#21 closed with a pointer to `ae5c99f` |
| **Clean clone of `main`** | `git clone` → `pnpm install --frozen-lockfile` (17.7 s) → `uv sync --locked --all-packages` → **901 TS passed**, **718 Python passed, 0 failures, 0 skipped** |

The clean clone is the real gate, and it passes.
