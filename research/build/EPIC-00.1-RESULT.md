# EPIC 0.1 — Hardening: result

**Six issues closed with executed evidence (#22–#26, #29). Two brought back for a decision
(#27, #28), unchanged in the tree.** One branch, `epic-0.1-hardening`; one PR, #30; one commit
per issue.

Every number below was produced by running something during this session. Where a claim is
inherited rather than re-measured, it says so.

**Baseline preserved, with one deliberate change.** 901 TS (859 document-ir + 42 db) and
**719** Python — up from 718. The +1 is the `#24` regression test and nothing else. 0 failures,
0 errors, 0 skipped in both languages, from a clean clone.

---

## 1. What changed

| # | Change | Files |
|---|---|---|
| **#25** | `pull_request` trigger unfiltered; `push` narrowed to `[main]`; dead `epic-0-spine` removed | `.github/workflows/ci.yml` |
| **#23** | `@papertree/db#test` gets `python/**` and `$TURBO_ROOT$/infrastructure/migrations/**` as inputs | `turbo.json` |
| **#26** | The PENDING escape hatch deleted; `argv[2]` mandatory; three named hard errors | `.github/scripts/validate-fixtures.mjs`, `ci.yml` (stale comment) |
| **#24** | Failure path lease-fenced, in the runner **and** in SQL; regression test added | `packages/jobs/python/papertree_jobs/{runner,store}.py`, `tests/test_durability.py` |
| **#22** | The false "0 of 192" claim corrected in both places; two disclosures added; `DUP_TOL_PT` motivated | `research/architecture-decisions/ADR-001-…md` |
| **#29** | New §9, **appended**; DESIGN.md §8's claim corrected | `research/build/EPIC-00-RESULT.md`, `packages/document-ir/DESIGN.md` |

Scope was exactly Epic 0's ownership list plus its two documentation outputs. Nothing under
`services/**`, `packages/evaluation/**`, `research/benchmarks/**`, `apps/web/src/**`,
`packages/anchoring/**` or `packages/ui/**` was touched. `EPIC-00-spine.md` and
`WAVE-0-PROMPT.md` were not opened for writing at any point.

---

## 2. Verified by execution

### #25 — CI trigger

The weak test is that all three checks run on this PR. They do (run `30552085555`). But the
base of that PR is `main`, which was already in the old list, so it proves little.

**The real test**: a throwaway PR (#31) whose base was `epic-0.1-trigger-probe-base` — a branch
that is **not** in the old trigger list and which **does not itself carry the fix** (it was cut
from `main`). All three checks ran and passed, run `30553228350`. That is the Wave 1 case: a PR
stacked on a branch nobody added to a list. The probe PR and its base branch were then deleted.

`pull_request:` is unfiltered rather than an enumerated list because an enumeration
reintroduces exactly this bug the day someone stacks on a branch nobody remembered, and Wave
1's stacks are not nameable in advance. `push` stays `[main]`: PR head pushes are already
covered by `pull_request`'s `synchronize` event, so unfiltering it would only double every run.

### #23 — turbo cache

Before, with a modified migration:

```
$ printf -- '-- turbo cache probe (#23)\n' >> infrastructure/migrations/0001_core.sql
$ pnpm test
@papertree/db:test: cache hit, replaying logs 6f86f1473ea5eb76
 Tasks:    4 successful, 4 total
Cached:    3 cached, 4 total
```

Same result for a modified `packages/db/python/papertree_db/migrate.py`. After:

```
### step 2: warm again, nothing changed — db:test MUST cache-hit
@papertree/db:test: cache hit, replaying logs 3e1c7a62beda15f1
Cached:    3 cached, 4 total

### step 3: append a harmless comment to infrastructure/migrations/0001_core.sql
### step 4: pnpm test — db:test MUST re-execute
@papertree/db:test:       Tests  42 passed (42)
Cached:    2 cached, 4 total          <- db:test is no longer among the cached
```

and the same for the Python half. `$TURBO_ROOT$`-relative inputs on `@papertree/db#test` were
chosen over `globalDependencies` because `globalDependencies` is repo-wide: a migration edit
would also bust `@papertree/document-ir#test`, which does not read migrations. The narrow key
invalidates exactly the task that depends on the files.

**One thing worth knowing.** `__pycache__` and `.pytest_cache` are negated explicitly because
**turbo does not apply `.gitignore` to explicit input globs.** Without the negations the `.pyc`
files were hashed, and because CPython embeds the source mtime in the bytecode the key churned
on every run — a cache that never hits, which is a different kind of broken. Verified from
`turbo run test --dry=json`: 39 inputs before the negations, 28 after.

### #26 — validate-fixtures

Before: `EXIT=0` for both a missing argument and `/tmp/nope`, printing "F0.7 has not landed" —
false since `4d1f67d`. After:

```
$ node .github/scripts/validate-fixtures.mjs                       -> EXIT=1  no package path given
$ node .github/scripts/validate-fixtures.mjs /tmp/nope             -> EXIT=1  no such directory: /tmp/nope
$ node .github/scripts/validate-fixtures.mjs packages/db           -> EXIT=1  .../packages/db/fixtures does not exist
$ node .github/scripts/validate-fixtures.mjs packages/document-ir  -> EXIT=0  3 fixtures ok
```

Also tested with the fixtures moved aside — `expected exactly 3 *.json fixtures …, found 0 (the
directory exists but holds no *.json)`, `EXIT=1`. The three preconditions are checked by name
so a wrong path says which piece is missing instead of surfacing as an ENOENT stack trace.

### #24 — the lease fence

Test first. `test_a_superseded_worker_whose_body_throws_cannot_undo_a_committed_checkpoint`:
worker A's lease expires inside its step body, worker B re-claims, re-runs the step and commits
`succeeded`, then A's body raises. Before the fix:

```
E  AssertionError: assert [('render', 'failed')] == [('render', 'succeeded')]
   ledger after A threw: [('render', 'failed', "RuntimeError: worker A's body exploded
     after worker B committed the checkpoint")]
```

After: `render bodies in the end: ['superseded', 'live']` — the body ran twice, never three
times, which is the consequence the test exists for rather than the status.

Two layers, and the asymmetry is deliberate:

- `runner.py` calls `check_lease()` before `_fail_step`, exactly as it already did before
  `_finish_step`. `LeaseLost` then routes into `run_once`'s documented write-nothing branch.
- `store.py` additionally makes the `UPDATE` conditional on the predicate `_holds_lease` uses.
  `_finish_step` is **not** given the same SQL guard: both paths share a TOCTOU sliver, but
  losing it on success writes a `succeeded` the live worker is writing anyway, while losing it
  on failure destroys a committed checkpoint. Only the destructive one is worth the extra
  predicate. This is stated in the docstring so a future reader does not read the asymmetry as
  an oversight.

jobs suite 21 passed (was 20 — 9 durability + 11 jobs-api; +1 is this test). Full Python suite
719 passed, 0 failures, 0 skipped. `ruff check`, `ruff format --check` and `mypy` all clean.

### #22 — the ADR

Both numbers confirmed from `research/experiment-results/id-stability.json` before any edit:

```
total combinations: 192
r1_strict_pass true: 56 of 192
   anchor_xy [0.25, 0.5]
   centre_xy [0.25, 1.0]
   full_bbox [0.25, 0.5, 1.0]
chosen_row.geom = anchor_xy   grid_pt = 1.0   text_prefix_len = 8
chosen_row.r1_pass = True     chosen_row.r1_strict_pass = False
```

`DUP_TOL_PT` motivated from the data rather than from the prose. The exempted group at the
chosen configuration is the `[CLS]` pair on `bert-2col` p14:

```
per-coordinate deltas: [0.0, 0.7, 0.0, 0.6] -> max 0.7
exempt at DUP_TOL_PT=1.0? True   at 0.5? False
```

So 0.7 pt is the value that binds; 1.0 pt is the nearest round number above it, with no
measured group in between. The `"Tok 1"` pair the prose cites is 0.4 pt apart and would survive
a 0.5 pt tolerance — it binds at *other* configurations, not at this one.

**No number, formula, schema, vector, fixture or table value was changed.**

### The four guards, re-broken

Done in a throwaway clone of this branch so the working tree was never at risk. Tree restored
and `git status --porcelain --untracked-files=all` confirmed empty after each.

| Guard | Injected | Result |
|---|---|---|
| Codegen drift | `Block.gate_probe_field` into the schema, then CI's exact command | **FIRED.** `models.py`, `types.ts` **and** `zod.ts` all drifted — both languages |
| Geometry, TS | `sameLine = r.y0 < cur.y1` | **FIRED.** 3 failed / 193 passed, incl. `does NOT collapse to a bounding box when consecutive line boxes overlap` |
| Geometry, Python | `same_line = r.y0 < bands[-1].y1` | **FIRED.** Same 3 failures. `assert [[[292.0, 100.0], [292.0, 134.0], [54.0, 134.0], [54.0, 100.0]]] == [[[292, 100], [292, 122.5], [200, 122.5], [200, 134], [54, 134], [54, 100]]]` — the 6-vertex staircase collapsed to a rectangle |
| `@ts-expect-error` inversion | directive above a **legal** call | **FIRED.** `error TS2578: Unused '@ts-expect-error' directive.` |
| Migration checksum | bytes appended to an applied migration | **FIRED.** `MigrationError: migration 1 (core) has changed since it was applied: recorded sha256:38adeb8f…, on disk sha256:5d2aecd9…` |

A note for whoever repeats the geometry one: my first Python injection wrote `rect.y0 < cur.y1`
verbatim from the TS, which is a `NameError` in the twin — every test fails, but for the wrong
reason, and that is not a demonstration of anything. The faithful injection is
`r.y0 < bands[-1].y1`. A guard test that fails with the wrong exception has not been tested.

### Clean clone

```
git clone --branch epic-0.1-hardening   ->  f8029a2
pnpm install --frozen-lockfile          ->  Done in 525ms
uv sync --locked --all-packages         ->  ok
pnpm test        -> document-ir 859 passed (7 files) · db 42 passed (4 files) · 4/4 tasks, 0 cached
uv run pytest    -> tests=719 failures=0 errors=0 skipped=0   (JUnit XML, not the terminal line)
git status --porcelain --untracked-files=all -> empty
```

---

## 3. Found and NOT fixed

### 3.1 `id-stability.json` carries the same contradiction internally

`decision.r1_as_literally_stated` reads `"survivors": 56` alongside
`"outcome": "ELIMINATES EVERY COMBINATION, including the finest grid tested (0.25pt) and the
longest prefix (160)."` — the object contradicts itself in adjacent keys, and the ADR's false
sentence was copied from it.

Not fixed, for two reasons. The file is generated by
`research/benchmarks/harness/id_stability.py`, which is **Epic 1's** territory; and that script
**rewrites the normative `packages/document-ir/conformance/identity-vectors.json`**, so
regenerating the JSON to fix a string would rewrite the ID contract as a side effect. The ADR
now records the discrepancy and points at the file. **If anyone fixes the harness's `outcome`
string, `git diff packages/document-ir/conformance/identity-vectors.json` afterwards and revert
it.**

### 3.2 DESIGN.md §8's worked example is still semantically invalid — deliberately

The gate's finding reproduces exactly: 12 hard errors, `I1` ×7, `R29` ×4, `R36` ×1.

But its premise is half wrong, and the half that is wrong is the half that decides what to do.
**The failure was already known, enumerated and asserted in both languages** —
`test/validate.spec.ts` → `describe("DESIGN.md §8's worked example")` and
`python/tests/test_validate.py::test_worked_example_fails_exactly_i1_r29_and_r36` pin the exact
counts `{I1: 7, R29: 4, R36: 1}` **and** assert that every *other* Tier A rule passes once those
three are disabled. Six tests, written by Epic 0 in its own words *"so that neither the example
nor the rules can drift silently"*.

So "the claim can never drift again" is already true, in the opposite direction. The prompt's
proposed remedy — *add a test that parses §8's example and asserts it validates* — is the exact
dual of six tests that already exist. Adding it means **deleting a deliberate Epic 0
commitment**, and doing that unilaterally in a hardening pass is the same class of act as
weakening a spec.

So §8's **prose** was corrected — it now states the failure, tabulates the three rules, names
the six tests and stops implying semantic validity — and the **example JSON was left alone**.

**The repair is ready if you want it.** I computed it and verified it: substituting the seven
formula-correct `blk_` ids, the four `sha256:` content hashes and an `ImageRef` on the
inline_equation's `payload.image` gives `ok=true errors=0 warnings=0`. The patch is at
`design8-repair.patch` in the session scratchpad. Applying it also requires:

- inverting those six assertions in two languages;
- updating the hard-coded `ID` map at `packages/document-ir/test/schema.spec.ts:69`;
- regenerating the **162-file** `test/cases/` corpus via `pnpm exec tsx
  codegen/build-corpus.ts` — note this is **not** part of `pnpm run codegen`, so the
  codegen-drift job will not catch a stale corpus.

That is a decision, not a hardening step. It is recorded in `EPIC-00-RESULT.md` §9.5.

### 3.3 An operational mistake worth recording

`gh pr close 31 --delete-branch` deletes the PR's **head** branch. The head of the probe PR was
`epic-0.1-hardening` — the working branch — so the command deleted it locally and on the
remote, auto-closed PR #30, and reset the working tree to `main`. Recovered in full from the
reflog (`git branch epic-0.1-hardening f8029a2`, re-push, `gh pr reopen 30`); all seven commits
intact, nothing lost. **When probing with a throwaway base branch, delete the base explicitly
with `git push origin --delete <base>` and never pass `--delete-branch` to `gh pr close`.**

---

## 4. What Wave 1 must now know that the gate report does not say

1. **`pnpm test` is a real gate again for `packages/db`** — items 2 of both Wave 1 prompts
   ("do not trust `pnpm test`") can be relaxed for migrations and the Python migration runner.
   It is still **not** a gate for anything outside a task's declared inputs; the rule "run the
   suite directly when you need a real signal" still holds generally, and `turbo run test
   --force` is still the blunt instrument.
2. **`_fail_step` is fixed** — item 3 of the Epic 1 prompt is closed. Epic 1 does **not** need
   to run strictly single-worker on this account. The remaining TOCTOU sliver is documented in
   `store.py`'s docstring and is shared with the success path.
3. **CI now runs on every PR regardless of base.** Item 5 of the Epic 1 prompt is closed. You
   do not need to add your branch to any list, now or ever.
4. **`validate-fixtures.mjs` is fatal on a bad path.** If you move or rename
   `packages/document-ir/fixtures/`, the fixtures job fails loudly instead of going green
   having checked nothing.
5. **Turbo does not apply `.gitignore` to explicit `inputs` globs.** If you add a task with
   explicit inputs over a directory that holds build artefacts, negate them or your cache key
   will churn. This cost time to find and is not obvious from turbo's docs.
6. **`apps/web` does not build today** — under either package manager, for two independent
   pre-existing reasons. See §5 (#28). Epic 2 should not plan around "it works now".

---

## 5. Brought back for a decision — NOT applied

### #27 — `ingest/source-authenticity.spec` is missing from `EPIC-01-ingest.md`

Confirmed: `grep -n 'source-authenticity' research/build/EPIC-01-ingest.md` → no match, while
`DESIGN.md` §2.2 and §11.1 both assign it to Epic 1 and both say the schema is not a
substitute. It **is** already folded into `WAVE-1-EPIC-01-PROMPT.md` as item 1, so a session
run from the prompt will not drop it — but the epic file is the contract.

The exact patch (a tenth acceptance row plus an F1.10 feature line) is prepared and **has not
been applied**: an implementation session amending an acceptance spec is the failure mode this
process exists to catch, and that does not stop applying because the amendment looks right.

**One thing to settle before applying it.** The rule as worded in the Wave 1 prompt — *"for
every block with `source != "ocr"`, `text` must be reconstructible from the PDF's own glyph
stream"* — does not catch the gate's own negative case, which declared `source: "ocr"`
precisely to escape scrutiny. An `ocr` block's text legitimately is not in the glyph stream, so
the rule exempts exactly the value an adversary would choose. The row probably needs a second
clause for `source: "ocr"` (require the crop, or require the page to have failed the text-layer
check in F1.1). I have not invented one — that is a spec decision.

### #28 — `apps/web` and the pnpm workspace

**Current state.** `apps/web` is a Next.js 14.1.0 app, `name: papertree-web`, no
`packageManager` field, **npm** with its own `package-lock.json` (lockfileVersion 3, 737
packages), 19 deps + 10 devDeps. `apps/api` is separate and Python, with its own `uv.lock`.

**Does it build today? No — under either package manager, for two different pre-existing
reasons.**

```
# npm, as it ships today
$ cd apps/web && npx next build
 ✓ Compiled successfully
Failed to compile.
./src/app/dashboard/page.tsx
1:1  Error: Definition for rule '@typescript-eslint/no-unused-vars' was not found.
… 62 errors, 61 of them that same rule
EXIT=1
```

`.eslintrc.json` configures `@typescript-eslint/*` rules but extends only
`next/core-web-vitals`, which does not load that plugin.

```
# inside the pnpm workspace
$ cd apps/web && npx next build
 ✓ Compiled successfully
Failed to compile.
./src/app/paper/[id]/read/page.tsx:81:20
Type error: Conversion of type '…/types/highlight".Highlight[]' to type '…/types/index".Highlight[]'
  may be a mistake because neither type sufficiently overlaps with the other.
  Type 'Highlight' is missing the following properties from type 'Highlight': paper_id, mode, selected_text
EXIT=1
```

That second one is **the two-`Highlight`-types defect anti-slop rule 3 names by name.** Note
what it means: under pnpm the lint step got further, and the failure moved to a real
pre-existing type error.

**What actually breaks if it joins the workspace.** Measured in a throwaway clone:

| | result |
|---|---|
| `pnpm install --frozen-lockfile` | **FAILS** — `ERR_PNPM_OUTDATED_LOCKFILE`, listing all 29 apps/web deps. This is CI's guard doing its job |
| `pnpm install --no-frozen-lockfile` | succeeds, 1 m 37 s, +648 packages; lockfile **+6 864 / −636 lines** |
| new build scripts needing allowlist | `canvas`, `unrs-resolver` — both native, both currently ignored with a warning |
| **webpack module resolution** | **unaffected** — `✓ Compiled successfully` under pnpm's strict tree |
| `pnpm test` | **4/4 pass**, unaffected |
| `pnpm typecheck` | **4/4 pass**, unaffected (apps/web has no `typecheck` script) |
| `pnpm lint` | **FAILS** — turbo picks up `apps/web`'s `lint: next lint` and it exits 1 |
| CI "Assert apps/ is not in the pnpm workspace" | **FAILS** by design |

The headline: **pnpm's strict `node_modules` is not the problem.** The stated fear in
`pnpm-workspace.yaml` — *"pulling it into this workspace would change how it resolves
dependencies"* — is real in principle but did not bite: the app compiles. What breaks is the
lockfile guard, the shared `lint` task, and the CI assertion, and all three are mechanical.

**Recommendation: (a), relax the guard — but not yet, and not by deleting it.**

Do it in three steps, at the moment Epic 2 actually needs `packages/anchoring`, not before:

1. Add `'apps/web'` to `pnpm-workspace.yaml`, add `canvas` and `unrs-resolver` to
   `onlyBuiltDependencies`, relock, and **delete `apps/web/package-lock.json`** in the same
   commit — two lockfiles for one package is how the v1 app got into this state.
2. Give `apps/web` a `"lint": "next lint || true"`-equivalent escape, **or** — better — fix the
   `.eslintrc.json` plugin and the duplicate `Highlight` type. Epic 2 owns `apps/web/src/**`
   and is going to delete both anyway; doing it first means the workspace lands green.
3. Replace CI's "assert apps/ is not in the workspace" job with the inverse: assert
   `apps/web` **is** a workspace member and that `apps/web/package-lock.json` does **not**
   exist. The guard's purpose — "nobody re-introduces a second package manager" — survives; only
   its polarity changes.

Doing this now, before Epic 2 starts, would land a red `pnpm lint` on `main` for however long
step 2 takes. Doing it as Epic 2's first commit keeps `main` green. **My recommendation is to
schedule it as Epic 2's F2.0**, with the three steps above as its acceptance, and to have Epic 0
pre-authorise the two file edits in writing so Epic 2 is not blocked by exclusive ownership.

Both files are Epic 0's, so this needs your call either way. Nothing has been changed.

---

## 6. What you have to do yourself

**Branch protection on `main`.** There is none — no required status checks, no ruleset — so a
red CI blocks nothing. `ci.yml`'s header says `paths-ignore` was avoided precisely so the jobs
could be required checks; that intent was never completed. I cannot set this.

Now that the #25 fix has run, mark these three as required — the names are exactly as they
appear in the checks list, taken from run `30552085555`:

```
TypeScript (typecheck · lint · test · codegen drift)
Python (pytest · ruff · mypy)
Fixture validation
```

`Settings → Branches → Add branch ruleset → Require status checks to pass`, target `main`.
Also worth enabling *Require branches to be up to date before merging*, since a stale branch is
how a green check certifies a tree nobody merged.
