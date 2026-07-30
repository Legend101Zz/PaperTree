# Epic Gate — reusable review / merge / handoff prompt

Run this **between every epic**. It is the independent checkpoint that keeps the build
from becoming AI slop: the session that wrote the code never gets to certify it.

**To use:** copy the template below, substitute the four `{{...}}` values, paste into a
fresh Claude Code session in ultracode mode.

| Placeholder | Epic 0 example |
|---|---|
| `{{EPIC_N}}` | `0` |
| `{{EPIC_FILE}}` | `research/build/EPIC-00-spine.md` |
| `{{PR_RANGE}}` | `#9–#21` |
| `{{NEXT}}` | `Wave 1 — Epic 1 (Ingest) ‖ Epic 2 (Reader), two parallel sessions` |

---

## Why this exists

The epic session reviews its own work. On Epic 0 that self-review was unusually good — five
adversarial reviewers found four FATALs — but it also caught *an agent editing the
acceptance spec to weaken a criterion it was failing.* That is the failure mode this gate
exists for. An implementation does not get to amend its own acceptance spec, and it does
not get to certify itself.

Two standing rules:
1. **Verify by execution, not by reading.** A reviewer who reads code and forms an opinion
   has added nothing. Run the tests. Re-measure the numbers.
2. **Never assume the PR topology.** Epic 0 looked like 13 independent PRs and was actually
   one linear stack of 13 commits where a single PR carried the whole tree. Merging it as
   13 would have been wrong.

---

# TEMPLATE — copy from here

ultracode

You are the **independent gate for EPIC {{EPIC_N}}** of PaperTree v2. PRs {{PR_RANGE}}
are open. You did not write this code. Your job is to decide whether it may enter `main`,
merge it if so, and hand off to {{NEXT}}.

Repo: `/Volumes/Mrigesh SSD/PaperTree` — **the path contains a space; quote it in every
shell command.**

## Read first

- `{{EPIC_FILE}}` — the epic's scope, hard rules, and **named acceptance tests**. This is the contract. It is not negotiable and you may not edit it.
- `research/build/README.md` — anti-slop rules and file-ownership boundaries
- `research/build/EPIC-0{{EPIC_N}}-RESULT.md` — the implementer's own hand-off claims. **Treat this as a claim to verify, not as evidence.**
- `research/architecture-decisions/` — any ADR the epic touched, including amendments it added

## Phase 0 — Establish the actual topology (do this before anything else)

Do **not** assume the PRs are independent. Determine:

```bash
gh pr list --limit 40 --json number,title,headRefName,baseRefName
git fetch origin
# for each branch: how many commits ahead of main, and does any single branch
# already contain the whole stack?
```

Answer explicitly before proceeding:
- Are these independent PRs, a linear stack, or a mix?
- Does one branch already contain every commit, based directly on `main`?
- If it is a stack: **the correct merge is one merge of the superset branch**, after which
  GitHub auto-closes the rest because their commits become reachable from `main`.
  Merging a stack bottom-up as N separate merges produces N merge commits and is usually wrong.

Write the topology into your report. If it is not what this prompt assumed, say so and
adapt — do not force the assumption.

## Phase 1 — Adversarial review (fan out)

One reviewer per feature/commit, in parallel. Each is told to **refute** that its slice
meets the epic's acceptance criteria — not to summarise it, not to praise it. Default to
"not met" when uncertain.

Each reviewer reports, per named acceptance test in `{{EPIC_FILE}}`:
`MET` / `NOT MET` / `MET BUT FRAGILE`, with the command run and its output.

Reviewers must specifically hunt for:
- **Acceptance criteria that were weakened rather than satisfied.** Diff every planning and
  ADR file on the branch against `origin/main`. Any change to an acceptance criterion by
  the implementing session is a **blocking** finding.
- **Tests that assert nothing** — tautologies, tests that pass on an empty implementation, mocks that mock the thing under test.
- **Hard rules from `{{EPIC_FILE}}` violated in spirit while satisfied in letter.**
- **Numbers in the RESULT doc that do not reproduce.**
- Silent exception swallowing, `TODO`s in shipped paths, dead code added.
- Anything committed that should be generated or ignored.

## Phase 2 — Verify by execution

On a **clean checkout of the merge candidate**, in a fresh environment:

1. Install from a cold cache exactly as a new contributor would. Record what breaks.
2. Run every acceptance test named in `{{EPIC_FILE}}`. Paste real output.
3. **Re-measure every performance claim yourself.** Check machine load first (`uptime`);
   Epic 0's numbers were once inflated ~1.85× by 22 orphaned processes. A number measured
   on a loaded machine is not a number.
4. Confirm CI is green on the merge candidate: `gh pr checks <n>`.
5. Verify the codegen-drift and any conformance checks fail when they should — deliberately
   break something and confirm the test catches it. **A guard nobody has seen fail is not a guard.**

## Phase 3 — Audit the record

- Does `EPIC-0{{EPIC_N}}-RESULT.md` match what you measured? List every discrepancy.
- Were known issues disclosed, or quietly dropped between commits?
- Are the epic's declared **file-ownership boundaries** respected? Anything edited outside them?
- Are deletions the epic promised actually done? A PR that adds a replacement without removing what it replaces is incomplete.

## Phase 4 — The merge gate

**Merge only if every named acceptance test is MET and no blocking finding stands.**

- If it passes: merge per the Phase 0 topology (usually **one** merge of the superset branch).
  Use a merge commit; do not squash — the per-feature commits are the review record.
- If anything fails: **do not merge.** Post the findings as review comments on the specific
  PRs, open issues for what must be fixed, update the tracker, and stop. Report clearly that
  the gate did not pass and why. A blocked gate is a successful gate.
- Partial merges are allowed only if the topology genuinely supports them. In a stack, it
  does not.

Never lower a criterion to make it pass. If a criterion turns out to be wrong, say so
explicitly in your report and leave it to the human — do not edit `{{EPIC_FILE}}`.

## Phase 5 — Post-merge verification

- Confirm `main` is green after the merge.
- Confirm the superseded PRs auto-closed; close any stragglers with a pointer to the merge commit.
- Delete merged branches.
- Confirm a clean clone of `main` installs and its tests pass. **This is the real gate** —
  everything before it was on a branch.

## Phase 6 — Handoff

1. Update the tracker issue (#7): tick this epic, record the merge commit, and note anything the next wave must know.
2. Write `research/build/EPIC-0{{EPIC_N}}-GATE.md`: topology found, per-criterion verdicts with evidence, discrepancies against the RESULT doc, what you fixed vs what you filed, and residual risk carried into the next wave.
3. Emit the **next session's prompt(s)** for {{NEXT}}, saved to `research/build/`. Base them on the relevant `EPIC-0N-*.md` §WORKFLOW PROMPT, and fold in:
   - what actually landed (versus what the epic planned)
   - the real API surface downstream epics will consume
   - every residual risk and known-fragile area
   - anything the epic deferred
   If the next wave is two parallel epics, emit **two** prompts and state explicitly which files each owns, so they do not collide.

## Report to the human

Lead with the verdict: **MERGED** or **BLOCKED**, and the one-line reason. Then the
per-criterion table, then discrepancies, then what the next wave inherits. Be direct about
anything that is fragile — an epic that merges with known weak spots is fine as long as
they are written down, and dangerous if they are not.

# TEMPLATE ends
