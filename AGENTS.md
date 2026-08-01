# Working agreement for agent sessions

Read this before doing anything else. It is the process contract; the epic file in
`research/build/EPIC-0N-*.md` is the work contract.

---

## 1. GitHub issues are the tracker. Not a scratchpad, not a todo list in chat.

A session that leaves no trace on the issue tracker did not happen, because the next
session cannot see it.

**Hierarchy.** One main tracker → one issue per epic → one issue per unit of remaining work.

```
#7  PaperTree v2 — Build Tracker        (label: epic)   ← the target: closing this closes the build
├── #1 EPIC 0 — The Spine               (closed)
├── #2 EPIC 1 — Ingest                  ← closes when every child closes
├── #3 EPIC 2 — Reader & Anchoring      ← ditto
├── #4 EPIC 3 · #5 EPIC 4 · #6 EPIC 5
└── children: #33 #41 #42 #43 #48 #51 #52 #53 #54 #55 …
```

**An epic issue may not be closed while a child of it is open.** Epic 1's issue #2 was
closed on 2026-08-01 while #51–#55 were open and `EPIC-01-RESULT.md` said
`Status: INCOMPLETE`. That is the failure this rule exists to prevent: the tracker said
done, the result file said not done, and only the result file was right.

### At the START of a session

1. `gh issue list --state open` — read it. Do not create what exists.
2. Open the epic issue and the result file of the epic *before* yours. Both. They
   disagree more often than you would think, and the disagreement is the finding.
3. Verify the previous session's claims by **running them**, not by reading them.
   `pnpm test` is not a gate — turbo caches and will reprint a pass it did not execute.
4. Comment on the epic issue saying what you are picking up.

### Before you push — run what CI runs, uncached

```bash
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
```

`--force` because turbo caches, and the Epic 0 gate observed a cache hit reprinting
results without executing them.

**Per-package `tsc --noEmit` and `vitest run` are not enough.** The four TypeScript
packages lint with **oxlint**; `apps/web` lints with `next lint`. Running only the latter
misses the former entirely, which is how run 30702316937 failed on two errors after a
branch that had passed every suite its author thought to run. A green subset looks
exactly like a green whole.

### DURING

- One issue = one PR. Split anything over ~600 changed lines.
- Every PR body names the acceptance test it satisfies and the issue it closes
  (`Closes #NN`).
- Found something outside your owned paths? **File an issue, do not edit.** Path
  ownership is in the epic file under "Owns (exclusive)".
- Found a claim in a brief that does not reproduce? File an issue with the measurement.
  #48 is the model: it corrects a producer-side instruction with a table of numbers and
  does not touch the consumer that worked around it.

### At the END

- Update the epic issue's checklist.
- Write / update `research/build/EPIC-0N-RESULT.md`.
- **File an issue for every unfinished thing** before you write "complete" anywhere.
  Then close only what is genuinely closed.

---

## 2. Honesty rules that have already been violated once each

These are not aspirations. Each is here because it happened.

- **A green test may assert less than it appears to.** `perf.spec` asserted
  `peak_mb < 2000` against a 500 MB bar, on the second-smallest paper, inside a shared
  pytest process. It passed for months and measured nothing. Three separate times on the
  Epic 1 branch a green test turned out to assert less than it looked like.
- **A metric that is never called reports nothing, and nothing looks a lot like a pass.**
  Two of Epic 1's four headline metrics were written and never wired into the scorer.
- **Do not round a PARTIAL up to a MET.** State the verdict the evidence supports and
  name what is missing.
- **Numbers get re-derived, not quoted.** If a doc states a count, recompute it. Several
  in `fixtures/README.md` are stale.

---

## 3. Worktrees

Work on the SSD, never the system disk (~35 GB free there vs ~645 GB on the SSD, and one
worktree carrying a debug plus a release build is 2–4 GB).

```bash
[ -d "/Volumes/Mrigesh SSD/PaperTree/.git" ] || { echo "SSD not mounted - STOP"; exit 1; }
git -C "/Volumes/Mrigesh SSD/PaperTree" fetch origin
git -C "/Volumes/Mrigesh SSD/PaperTree" worktree add \
    "/Volumes/Mrigesh SSD/PaperTree-worktrees/<slug>" -b <branch> origin/main
```

If `/Volumes/Mrigesh SSD` is not mounted, **stop**. Unmounted, it is an ordinary
directory on the system disk, so anything written there fills the wrong volume under a
path that looks correct. Do not fall back to `$HOME`. Do not create the directory.

Review subagents get their own worktree. Remove a worktree when its issue merges — they
never shrink on their own.

**Quote every path: the repo path contains a space.**

---

## 4. Things about this repo that will bite you

- `pnpm test` is cached and not a gate (above).
- `@papertree/document-ir`'s barrel re-exports `node:crypto`, so importing it into a
  browser bundle breaks webpack — issue #33.
- `doc_order` exists only on top-level `flow == "body"` blocks. Sorting by
  `doc_order ?? 0` collapses every caption, footnote and nested table cell to position 0.
  Build reading order from `Page.flows` plus parent/child descent.
- `Section` is `{heading_block_id, level, block_ids}` — no title, no path. The display
  title lives in `blocks[heading_block_id].text`.
- `Block.text` keeps the *unrepaired* reading permanently by design (deviation D4).
  `resolvedText(block, {applyProposed})` is the only sanctioned reader. Never concatenate
  `text` and `repairs` by hand.
- Corpus PDFs are fetched, not committed: `./research/benchmarks/fetch_corpus.sh`.
  Without them the reader renders nothing and `copy-fixtures` warns `0/3 PDFs`.
  **Your machine has them and CI does not.** A test that reads one passes locally and fails on a
  clean checkout with `ENOENT … public/fixtures/*.pdf` — that is how run 30712541335 went red after
  a fully green local `--force` gate. A test that needs the corpus must `describe.skipIf` on its
  absence and say so on stdout, naming the fetch script. Skipping loudly is honest; passing quietly
  is the vacuous-green failure in §2.
- **The reader renders nothing in a browser tab that is not foregrounded.**
  `document.visibilityState === 'hidden'` starves `requestAnimationFrame`, so pdf.js's
  `RenderTask.promise` never settles and the text layer is never built — 0 spans, no error, canvas
  apparently painted. Confirmed on pristine `main`, so it is not anyone's regression. Any automated
  browser check of the reader must foreground the tab, or it is measuring the tab and not the code.
