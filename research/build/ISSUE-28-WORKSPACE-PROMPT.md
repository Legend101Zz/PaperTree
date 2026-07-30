# Issue #28 — bring `apps/web` into the pnpm workspace — session prompt

> Unblocks Epic 2 · F2.1. **Normal Claude Code session — not ultracode.** Small and mechanical;
> work solo, no subagents. Paste everything below the line.

---

You are closing **issue #28** for PaperTree v2. Single-purpose task: make it possible for Epic 2
to build the reader against `packages/anchoring` and `packages/ui` from inside `apps/web`,
without breaking anything for the Epic 1 session that runs alongside it.

**Repo:** `/Volumes/Mrigesh SSD/PaperTree` — **the path contains a space; quote it in every
shell command.** Branch: `fix/28-apps-web-workspace`, from `main` (currently `8524cad`).

## Read first

- `gh issue view 28` — including its comment, which already contains a full investigation.
  **Do not redo those measurements; verify and act on them.**
- `research/build/EPIC-00-GATE.md` §8.11 — why this exists.
- `research/build/README.md` — anti-slop rules, especially rule 1 (exclusive file ownership).

## What is already known — from the #28 investigation, in a throwaway clone

- `apps/web` is Next.js 14.1.0, npm, its own `package-lock.json` (lockfileVersion 3, 737
  packages), 19 deps + 10 devDeps, **no `packageManager` field**.
- **pnpm's strict `node_modules` is NOT the problem.** Inside the workspace, `next build`
  reported `✓ Compiled successfully`. The fear recorded in `pnpm-workspace.yaml` did not bite.
- `pnpm install --frozen-lockfile` **fails** (`ERR_PNPM_OUTDATED_LOCKFILE`) — the guard doing its
  job. `--no-frozen-lockfile` succeeds in ~1m37s, +648 packages, lockfile +6 864 / −636 lines.
- New native build scripts appear and are currently ignored with a warning: **`canvas`,
  `unrs-resolver`** — they need adding to `onlyBuiltDependencies`.
- `pnpm test` and `pnpm typecheck` are **unaffected** (4/4 pass).
- **`pnpm lint` FAILS** — turbo picks up `apps/web`'s `lint: next lint`, which exits 1.
- **`apps/web` does not build today under either package manager**, for two *pre-existing*
  reasons: (1) `.eslintrc.json` configures `@typescript-eslint/*` rules but extends only
  `next/core-web-vitals`, which never loads that plugin — 62 errors, 61 of them that one rule;
  (2) a real type error from **two competing `Highlight` types**, which is the defect
  `research/build/README.md` anti-slop rule 3 names explicitly.

## Scope — what you may change

```
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
package.json            (root only)
.github/workflows/ci.yml
```

## What you may NOT change

- **Anything under `apps/web/src/**`, and `apps/web/.eslintrc.json`.** Those are **Epic 2's**
  files. The eslint misconfiguration and the two-`Highlight`-types error are **pre-existing and
  Epic 2's to fix** — it is chartered to delete both. Your job is to stop them blocking
  *everyone else*, not to fix them.
- `packages/**`, `infrastructure/**`, `apps/api/**`, `research/build/EPIC-0*.md`.
- Do not "fix" `apps/web` into building. That is out of scope and it is someone else's contract.

## The constraint that decides your design

**A session that has not touched `apps/web` must still see green.** The Epic 1 session runs in
parallel, owns none of this, and must not inherit a red `pnpm lint` it cannot fix. So after your
change:

```bash
pnpm install --frozen-lockfile   # must succeed
pnpm test                        # must be green
pnpm typecheck                   # must be green
pnpm lint                        # must be GREEN — this is the one that currently breaks
```

You choose the mechanism — scoping the root turbo tasks, a filter in the root scripts, a
`turbo.json` task override for `papertree-web`, or something better. **Whatever you pick, it must
be explicit and reversible in one line, with a comment naming Epic 2 as the party that re-enables
it**, so re-enabling is a deliberate act rather than an archaeology exercise. Do not silence the
failure by deleting `apps/web`'s `lint` script.

## The CI job you must deal with

`.github/workflows/ci.yml` has a job step *"Assert apps/ is not in the pnpm workspace"* that
**fails the build** when `apps/` appears. It exists to protect `apps/web`'s separate npm install
from being disturbed while v1 runs.

That guard is now partly obsolete and partly still useful. Decide and justify in the PR body:
does it become an assertion about `apps/api` only, does it get a narrower form, or does it go?
`apps/api` is Python with its own `uv.lock` and is not a pnpm package at all — check whether the
assertion was ever meaningful for it before you keep it on those grounds.

**Do not simply delete a guard because it is now red.** If it goes, say what replaces it.

## Steps

1. Add `apps/web` to `pnpm-workspace.yaml`, replacing the `'!apps/**'` exclusion. Rewrite the
   comment above it — it currently states a rationale the investigation disproved, and leaving a
   disproved rationale in place is how the next person re-derives a wrong conclusion.
2. Regenerate `pnpm-lock.yaml` once (`pnpm install --no-frozen-lockfile`) and commit it. Confirm
   `pnpm install --frozen-lockfile` then succeeds from clean.
3. Add `canvas` and `unrs-resolver` to `onlyBuiltDependencies`, each with a one-line reason —
   the existing entries in that list are commented and yours should match.
4. Keep the four root commands green per the constraint above.
5. Resolve the CI assertion.
6. Confirm `apps/web`'s own npm path is not made *worse*: `cd apps/web && npm ci` must still
   work for anyone on the v1 app. Record its pre-existing `next build` failure as pre-existing —
   with the command and output — so nobody later blames your PR for it.

## Verify, then open the PR

Paste real command output into the PR body for each of these:

```bash
pnpm install --frozen-lockfile
pnpm test        # expect 901 TS  (859 document-ir + 42 db)
pnpm typecheck
pnpm lint        # the one that currently fails
uv run pytest -q --junit-xml=/tmp/j.xml   # expect 719, 0 failures, 0 skipped
pnpm ls --recursive --depth -1            # show papertree-web is now a member
cd apps/web && npm ci                     # the v1 path still works
```

Note `pytest -q` prints no summary line in this repo — read the JUnit XML for counts.
Note also that `pnpm test` is turbo-cached; use `turbo run test --force` if you need certainty.

Open the PR against `main` titled `fix(#28): bring apps/web into the pnpm workspace`, with:

- the four green commands,
- your decision on the CI assertion and why,
- the exact one-line change Epic 2 makes to re-enable `apps/web` linting,
- an explicit statement that `apps/web`'s two build failures are pre-existing, Epic 2's, and
  untouched by this PR.

Confirm all three CI checks run and pass on the PR. Then comment on #28 with the evidence and
link the PR — but **leave #28 open until the PR merges.**

If bringing `apps/web` in turns out to break something the investigation did not predict, **stop
and report** rather than widening scope into `apps/web`'s source. Epic 2 can equally well start
on `packages/anchoring` and `packages/ui`, which are already workspace members — so a clean
"this is harder than it looked, here is why" is a perfectly good outcome and is much better than
a PR that quietly edits files it does not own.
