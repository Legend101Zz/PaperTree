# Working agreement for agent sessions

Read this before doing anything else. It is the process contract; the epic file in
`research/build/EPIC-0N-*.md` is the work contract.

> **CURRENT PHASE — read #78 before anything else.** Epics 0–3 are merged and Epics 4
> and 5 have **not started**. #78 is a three-session phase that finishes Epics 1–3 and
> turns three epics of libraries into a product a person can use. It carries the backlog,
> the session prompts, the design prompt, the review prompt and the handoff protocol.
> If you are starting a session, #78 is your work contract — not an epic file.

---

## 1. GitHub issues are the tracker. Not a scratchpad, not a todo list in chat.

A session that leaves no trace on the issue tracker did not happen, because the next
session cannot see it.

**Hierarchy.** One main tracker → one issue per epic → one issue per unit of remaining work.

```
#7  PaperTree v2 — Build Tracker        (label: epic)   ← the target: closing this closes the build
├── #1 EPIC 0 — The Spine               (closed)
├── #2 EPIC 1 — Ingest                  ← closes when every child closes
├── #3 EPIC 2 — Reader & Anchoring      (closed)
├── #4 EPIC 3 — Grounded AI             ← ditto
├── #78 Epic 1–3 completion             ← THE CURRENT TARGET. Closes #2 and #4.
│    ├── Session A  #75 #71 #33 #74 #64
│    ├── Session B  #50 #51 #57 #55 #53
│    └── Session C  #66 #72 #76 #77 #62 #54
└── #5 EPIC 4 · #6 EPIC 5               ← blocked on #78
```

**Every PR names the issue it closes** (`Closes #NN`). An issue that a merged PR did not
close is an issue somebody has to re-read later to find out whether it is done.

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

- **`archive/` is v1 and is not to be read.** It is outside every workspace, gate and lint
  path. A grep hit in `archive/` is a false positive — go back. See `archive/README.md`.
  (Lands with #75; until then v1 is still at `apps/api` and `components/canvas/**`, and
  the same advice applies.)
- `pnpm test` is cached and not a gate (above).
- **`migrations.spec`'s 30k-block insert is a wall-clock assertion and fails randomly on
  CI** (#80). Observed on a docs-only PR: `expected 6207 to be less than 5000`, then green
  on re-run with no change. If your gate goes red *only* there, **re-run before you
  diagnose** — and do not "fix" it by raising the bound, which is how a guard degrades into
  a smoke test one increment at a time.
- **A stacked PR merges into its stated base branch, not into `main`.** Epic 3's four PRs
  all reported MERGED and only one reached `main` — the other three merged into each
  other, leaving `main` 12,564 lines short while the board said done (#73). Prefer a flat
  rebased series off `main`. If you stack, verify with
  `git merge-base --is-ancestor <head> origin/main` afterwards, not by reading PR state.
  **The cause was a repo setting, and it is now fixed (#81): `deleteBranchOnMerge` was
  `false`.** GitHub auto-retargets an open PR when its base branch is **deleted** — so
  merging the bottom of a stack *and deleting its branch* silently re-points the next PR at
  `main`, and the stack unwinds correctly however fast the merges are clicked. With the
  setting off, no base was ever deleted, no retarget fired, and each PR merged into a branch
  that was about to become garbage. That is why "merge bottom-up and let each merge retarget
  the next" is the safe protocol rather than merely a tidy one: **the retarget is what makes
  it safe, and it only happens if the branch is deleted.** The setting is on now, so it
  happens by itself. Two guards in `ci.yml` back it up — a PR-time annotation when
  `base != main` (a warning, never a failure: stacking is legitimate), and a push-to-`main`
  guard asserting every recently merged PR's merge commit is an ancestor of `main`
  (`.github/scripts/assert-merged-prs-reached-main.sh`, runnable by hand against any ref).
  Note what the second one cannot do: it runs when something reaches `main`, so a stack that
  breaks and then goes quiet is caught at the *next* push to `main`, not at the moment of
  breakage. It converts "silent for a day" into "loud at the next merge".
  Two of Epic 3's merge commits (#68, #69) are **permanently** not ancestors of `main` —
  #73 remediated the *content* via `epic-3/f3.6-inspector`, but their merge commits live on
  branches that no longer exist. They are allowlisted in that script, by name and with the
  commit that remediated them; the entry only suppresses on a history that actually contains
  that remediation, so it cannot become a mute button.
- `@papertree/document-ir`'s barrel re-exports `node:crypto`, so importing it into a
  browser bundle breaks webpack — issue #33. `apps/web` aliases it to a throwing stub
  meanwhile; **delete the stub when #33 lands**, and delete this bullet with it.
- `doc_order` exists only on top-level `flow == "body"` blocks — validator rule 15 makes
  that mandatory, not a choice, so populating it on a caption is an ERROR (#49). Sorting by
  `doc_order ?? 0` collapses every caption, footnote and nested table cell to position 0.
  Build reading order from `Page.flows` plus parent/child descent. This hazard is
  permanent, not transitional.
- `Block.order` is **not** a substitute: it is dense and unique only within each
  `(page_index, flow, container)` group, and nested blocks restart the numbering.
- **PyMuPDF reports its two page boxes in two different coordinate spaces.**
  `page.mediabox` is the raw `/MediaBox`; `page.cropbox` is **already y-flipped** into
  MuPDF's top-left space about the MediaBox's top edge. Passing `page.cropbox` to
  `normalise_page_frame` intersects a top-left rect with a bottom-left one. The flip is the
  *identity* whenever the MediaBox starts at `(0,0)` and CropBox equals it — true of **8 of
  8** corpus papers — so nothing catches it, and a wrong page frame was priced at **99.93%**
  of block ids by ADR-001 Amendment 1. Handled in `pdf.py::raw_page_boxes`, guarded by
  `test_geometry_contract.py`. Any future parser, adapter or probe hits this (#47).
- **Do not reject spans by height.** A rule like "reject spans over 1.3× their declared
  `size`" deletes the arXiv margin stamp from every arXiv paper (`h/size` **17.55** on
  resnet, `line["dir"] == (0,-1)`), every rotated matplotlib axis label, and the large
  delimiters of every display equation (`h/size ≈ 1.73` at `dir == (1,0)`). `size` is the
  *nominal font size*, not the glyph's extent, and a tall box usually means **rotated
  text** — the extent across the writing direction is 1.00–1.33× size. Use `Span.line_band`
  (baseline + font metrics, exactly one line high by construction) and keep `Block.text`'s
  bbox truthful (#48).
- `Section` is `{heading_block_id, level, block_ids}` — no title, no path. The display
  title lives in `blocks[heading_block_id].text`.
- `Block.text` keeps the *unrepaired* reading permanently by design (deviation D4).
  `resolvedText(block, {applyProposed})` is the only sanctioned reader. Never concatenate
  `text` and `repairs` by hand.
- **The gold set measures; it does not authorise.** 442 regions, 36 pages, 6 of 8 corpus
  papers, **one annotator, no inter-annotator agreement** — 30% of `benchmarks/README.md`
  §1.2's Tier B. Every verdict derived from it carries that n **in the row, not in a
  footnote**. 27% of gold regions are found in the right place and boxed differently
  (IoU 0.25–0.5), and Docling's own absolute F1 against this gold is **0.168–0.308** — a
  mature converter scoring 0.28 says the boxing conventions differ from *both* parsers,
  not that both parsers are bad.
- **Never derive gold from parser output.** `ANNOTATION_GUIDE.md` §1 and
  `benchmarks/README.md` §4.4 both forbid it, for the same reason: it scores an
  implementation against a reimplementation of itself and measures nothing. This binds
  agents specifically — deriving Tier C questions from `blocks`, or a caption's parent
  from proximity, fails the standard by the standard's own definition.
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
- **Half the relation types in the schema are never emitted.** Live on `main`: resnet has
  974 blocks and **25** relations; `cites`, `references`, `defines`, `explains`,
  `result_of`, `visually_associated_with` and `parent_of` appear **zero** times, and
  `prev_id`/`next_id` are **0/974**. A consumer written against `prev_id` returns nothing
  on every real paper *while passing against a fixture that sets it* — that is #66, and it
  is the defect class `findings.md` §A records. **Any test for a producer-side field must
  run against a real parse of a corpus paper, not only against a fixture you authored.**
- **A citation stored as a bare `block_id` does not survive a re-parse.** Measured on
  resnet under `worst_case` with ids re-minted by the real `blockId` function: bare
  `block_id` **3.3%**, `Anchor` **100.0%**. Block ids are content-derived, so any edit to a
  block retires its id and the link breaks *silently*. `@papertree/anchoring` is
  TypeScript-only, so Python can currently only return a `SourceRegion` (#72). Store an
  `Anchor`, never a `block_id` — this applies to canvas nodes, saved answers, audit trails
  and replay sync alike.
- **`OwnerId` is an opaque per-connection handle and must never cross a wire or a
  boundary.** Resolve a token to a `user_id`, call `owner_for(user_id)`, pass the handle
  inward. Isolation that has never been observed *failing* has not been tested.
