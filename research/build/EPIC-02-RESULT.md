# EPIC 2 — result

**Branch:** `epic-2-reader`, from `main` at `e4a6b1f`; continued 2026-08-01 from `560109e` (PR #56);
continued again 2026-08-01 on `epic-2/f2.3-wire-capture` from `ddbe123` (PR #61).
**Status: COMPLETE.** All 9 of 9 acceptance tests satisfied and measured, and — since §11 — all of
them reachable by a user.

> **§11 IS THE CORRECTION THAT MATTERS.** Everything above and below it was written when the nine
> criteria passed, and the nine criteria passing turned out not to mean the epic worked. **Four
> features were built, tested, audited and mounted by nothing**: the provenance stylesheet (§10.2),
> the highlight capture path, the library, and the zoom control. A user could not create a
> highlight, could not reach any designed system state, and could not change the zoom. Read §11
> before quoting any status from this file.

`anchoring/cross-mode.spec` — the one this document originally recorded as NOT met, in §7.1 — was
written on 2026-08-01 and is covered in **§10**. That section also records two defects it found
that no existing test could have caught, and the corrections in §2.1 above.

| | |
|---|---|
| tests passing | **1 050** — anchoring **64**, ui 41, web 86, document-ir 859 (no regression) |
| `turbo run lint --force` | green, 5/5, **with `apps/web` included** |
| `turbo run typecheck --force` | green, 9/9 |
| `turbo run test --force` | green, 9/9 |
| re-anchor rate | **100.00 %**, 21 fixture × perturbation combinations, zero orphans |
| cross-mode | **199 blocks → 179 resolve in Guided, 20 explicitly unavailable, 0 silent** |
| WCAG 2.2 AA, **real Chrome** | **0 violations** in Source, Guided and Split; `color-contrast` and `target-size` both RAN |
| touch targets, **real measured px** | **75 interactive elements, 0 under 44 × 44** |

Nothing below is a projection — every number was produced by a command recorded in §9 or §10.

> **Read §10 before trusting §7.** §7's inventory was accurate when written and is now partly
> superseded: it lists F2.5/F2.6 as "built" and `provenance.spec` as passing, both of which were
> true of the code and false of the running product, because the stylesheet that carries the
> provenance register was never imported by anything (§10.2).

---

## 1. The criterion that matters most

> `anchoring/reparse.spec`: ≥99 % of highlights must re-anchor when block ids change under a
> perturbed parse, and every failure must be visible to the user.

**Measured: 100.00 %, zero orphans, across 21 (fixture × perturbation) combinations.**

```
cd packages/anchoring && ../../node_modules/.bin/vitest run test/reparse.spec.ts
```

| fixture | perturbation | anchors | ids retired | re-anchored | anchored | approx | orphan |
|---|---|---:|---:|---:|---:|---:|---:|
| attention | merge_paragraphs | 183 | 7.0 % | **100.00 %** | 183 | 0 | 0 |
| attention | split_paragraphs | 183 | 0.0 % | **100.00 %** | 183 | 0 | 0 |
| attention | jitter_geometry | 183 | 45.6 % | **100.00 %** | 179 | 4 | 0 |
| attention | retype_blocks | 183 | 15.8 % | **100.00 %** | 183 | 0 | 0 |
| attention | text_noise | 183 | 0.0 % | **100.00 %** | 179 | 4 | 0 |
| attention | all | 183 | 61.4 % | **100.00 %** | 179 | 4 | 0 |
| attention | **worst_case** | 183 | **89.5 %** | **100.00 %** | 176 | 7 | 0 |
| neural-odes | merge_paragraphs | 257 | 6.2 % | **100.00 %** | 257 | 0 | 0 |
| neural-odes | split_paragraphs | 257 | 0.0 % | **100.00 %** | 257 | 0 | 0 |
| neural-odes | jitter_geometry | 257 | 43.2 % | **100.00 %** | 250 | 7 | 0 |
| neural-odes | retype_blocks | 257 | 11.1 % | **100.00 %** | 257 | 0 | 0 |
| neural-odes | text_noise | 257 | 0.0 % | **100.00 %** | 257 | 0 | 0 |
| neural-odes | all | 257 | 44.4 % | **100.00 %** | 252 | 5 | 0 |
| neural-odes | **worst_case** | 257 | **88.9 %** | **100.00 %** | 244 | 13 | 0 |
| resnet | merge_paragraphs | 206 | 11.5 % | **100.00 %** | 206 | 0 | 0 |
| resnet | split_paragraphs | 206 | 0.0 % | **100.00 %** | 205 | 1 | 0 |
| resnet | jitter_geometry | 206 | 42.6 % | **100.00 %** | 205 | 1 | 0 |
| resnet | retype_blocks | 206 | 24.6 % | **100.00 %** | 206 | 0 | 0 |
| resnet | text_noise | 206 | 0.0 % | **100.00 %** | 206 | 0 | 0 |
| resnet | all | 206 | 49.2 % | **100.00 %** | 197 | 9 | 0 |
| resnet | **worst_case** | 206 | **90.2 %** | **100.00 %** | 199 | 7 | 0 |

"Re-anchored" means `state !== 'orphan'`. `approximate` counts, because it is shown to the user in
the right place with an affordance saying so — but it is reported separately, above, so the split
is visible rather than folded into a headline.

`worst_case` retires **89–90 % of block ids**, more than double the 42.2 % a real segmenter change
costs, and composes merging, splitting, character-level text noise, 1.4 pt geometry jitter and
reclassification. It is deliberately harder than any measured parser upgrade.

### 1.1 Why 100 % is reachable at all, given that 42.2 % of ids die

Because **a segmentation change moves boundaries, not glyphs.**

- T3 searches the **document-global text stream**, not blocks. Merging two paragraphs does not
  change the character sequence, so the quote is still there to be found. It carries 45–124 of the
  ~200 anchors in the hard cases.
- T4 re-projects quads through the new parse. The glyphs did not move at all.

T1 alone tops out near 58 % and is wrong about a ninth of what it returns. The tier attribution
column in the spec output shows the ladder actually doing this work rather than T1 quietly
answering everything.

### 1.2 The 100 % is not vacuous — `falsify.spec` proves the metric discriminates

A resolver that answered "found it, approximately" for every input would also report 100 %. Five
tests exist to make that impossible, and **one of them caught a real defect** (§4.1):

| test | asserts |
|---|---|
| deleted block | an anchor whose block and text were removed does not report `anchored` |
| **different paper** | a ResNet anchor against Neural ODEs is `orphan`, with a reason |
| changed content hash | a tier-1 hit whose `content_hash` moved is never returned as tier 1 |
| stale T0 cache | a cache written under another `parserVersion`/`textStreamId` is ignored |
| short quote | a 4-character quote with no context is refused, not guessed at |

### 1.3 Adjacent bars

| spec | bar | measured |
|---|---|---|
| `anchoring/zoom.spec` | drift < 1 pt over 50–400 % | **1.14e-13 pt**, 1 194 round-trips |
| `anchoring/resize.spec` | drift < 1 pt over 5 widths | **1.61e-13 pt** (390/834/1194/1440/2560) |
| `anchoring/targets.spec` | all 10 target kinds resolve | **10/10**, incl. part-of-equation, table cell |

Those two pass by *construction* — the overlay is sized to the scale-1 viewport and scaled by one
CSS transform, so zoom multiplies and divides by the same scalar and viewport width never enters
the geometry at all. They are worth asserting anyway, as a tripwire: the v1 reader fails them by
orders of magnitude, and the day a DOM measurement re-enters this path the numbers stop being
1e-13.

~~**`anchoring/cross-mode.spec` is NOT met.**~~ **Met as of 2026-08-01 — see §10.1.** When this
paragraph was written the Guided view was built and the anchor record carried
`targetKind: 'guided_para'`, but the spec that drives a Source-captured anchor through the Guided
renderer and asserts the fallback message was not written. It now exists: 199 blocks → 179 resolve,
20 explicitly unavailable, 0 silent. Writing it exposed `doc.continuedBy` as a one-entry map keyed
`undefined`, which is why it was not the small piece of work §7.1 estimated.

---

## 2. Corrections to the inputs

Each was measured, not inferred. Commands are in the module headers.

### 2.1 The over-tall span defect is not confined to `resnet`

`fixtures/README.md` and `EPIC-00-RESULT.md` both scope it to that fixture.

| fixture | spans | no `size` field | over-tall | overshoot | overlapping line pairs |
|---|---:|---:|---:|---|---:|
| `resnet` | 295 | 13 | 17 (22 by absolute height) | 7.32–7.34 pt | 18 (5.16–5.39 pt) |
| `attention` | 173 | 48 | 0 | — | 9 (0.78–15.39 pt) |
| `neural-odes` | 259 | 57 | **12** | 5.86 pt+ | ~~14 (up to 19.24 pt)~~ **see below** |

`neural-odes` — the maths-heavy paper, whose highlights most need it — has 12 more of the defect
and the worst overlap in the set. A clamp applied only to `resnet` would have left it bleeding.

> **CORRECTION, 2026-08-01 — "up to 19.24 pt" does not reproduce, and issue #48 is right.**
>
> Re-measured independently, per block, over adjacent line pairs, feeding the shipped
> `groupIntoLines` and `clampLineBands`:
>
> | fixture | raw overlapping line pairs | worst raw | after the clamp | worst |
> |---|---:|---:|---:|---:|
> | `attention` | 10 | 10.93 pt | 1 | 1.33 pt |
> | `neural-odes` | 13 | **10.51 pt** | 2 | 0.74 pt |
> | `resnet` | 5 | 5.39 pt | **0** | 0.00 pt |
>
> 19.24 pt is the *height* of two spans in `neural-odes`' `algorithm` block
> (`blk_fyzlxqrbvqw47hb2`, spans 8 and 9, both `y = [174.26, 193.50]`) that sit on the **same
> visual line** and abut in x. `lineband.ts`'s own `sameLine()` groups them into one band, so
> under the shipped algorithm it was never an overlap at all. The worst genuine *cross-line*
> overlap in `neural-odes` is 10.51 pt, exactly as #48 reports.
>
> This also corrects §2.2 below: the clamp takes 28 raw overlapping pairs to **3**, not to 0, and
> the residue is ≤1.33 pt — under a typographic line and far under the 5–7 pt bleed the clamp
> exists for. The scalpel claim stands; the "→ 0" does not.
>
> **§2.3's producer-side guidance was wrong and #48 measured why.** "Do not emit spans that exceed
> 1.3 × their declared `size`" would delete the arXiv stamp from every arXiv paper (`h/size` 17.05
> –17.55, because the text runs *vertically* — `line["dir"] == (0, -1)`), every rotated matplotlib
> axis label, and the large delimiters of every display equation (`{`, `}` reach `h/size ≈ 1.73`
> with `dir == (1, 0)`; `size` is the nominal font size, not the glyph's extent). It also violates
> the epic's own rule that unclassifiable regions are never dropped. The correct producer-side rule
> is **"the extent perpendicular to the writing direction is about one line"**, which is what
> Epic 1's `Span.line_band` and `Span.direction` implement. `packages/anchoring/src/lineband.ts`
> remains a correct *consumer*-side response to fixtures it could not change.
>
> Also from #48, and it matters for §2.2: **`size` is never missing from real MuPDF output** — 0 of
> 84 395 spans across all 8 corpus papers lack it. The "118 of 727 (16 %)" figure is a property of
> how Epic 0 hand-built these three fixtures, not of anything a parser emits. The geometric clamp is
> still the right choice for the fixtures, but the stated *reason* does not generalise.

Counts reconcile as follows: **17** spans exceed 1.3 × their declared `size`; **22** have absolute
height in [17.0, 17.5] pt against a 9.96 pt median. The difference is the 5 spans that declare no
`size` at all. The brief's "17 / ~7.33 pt" and the recon's "22" are both right about different
questions; `fixtures/README.md`'s "21 / ~7.2 pt" matches neither and appears stale.

### 2.2 The clamp cannot be font-metric

**`size` is absent on 118 of 727 spans (16 %)**, concentrated in exactly the equation and algorithm
blocks whose geometry is hardest. A rule shaped `height ≤ size × k` silently does nothing on a
sixth of the corpus. The shipped clamp is geometric — modal line pitch, then a successor clamp —
and needs no font metadata. Measured effect: **20 raw line-band overlaps → 0**, while leaving
**486 of 530 bands byte-identical**. A scalpel, not a blanket.

### 2.3 `doc_order` cannot order the document

It exists only on `flow === "body"`, non-nested blocks. **64 of the 199 blocks do not carry it** —
14 in `attention`, 39 in `neural-odes`, 11 in `resnet` — every caption, footnote, page number,
margin note, and every `table_row`, `table_cell` and `inline_equation`. Sorting by
`doc_order ?? 0` collapses all 64 to position 0 and scrambles the text stream that T2's offsets
index into. `neural-odes` is nearly half nested blocks. Reading order is built from `Page.flows`
plus parent/child descent instead.

### 2.4 `Section` has no title and no path

It is exactly `{heading_block_id, level, block_ids}`, plus `parent_heading_block_id` when
`level > 1`. The anchor-schema prose in `synthesis-10` shows a `path` and a `headingText`; a
resolver written against that matches nothing and returns every T5 anchor as an orphan. The
display title lives in `blocks[heading_block_id].text`. **F2.4's outline must read it from there.**

### 2.5 Three pdf.js facts, from the installed `pdfjs-dist@3.11.174`

1. **`convertToViewportRectangle` still exists** in the installed version and in 5.4.296. Four
   documents — `32-frontend-canvas-pdf-tech.md` §1.4, `synthesis-10` §10.2, `EPIC-02-reader.md`:118
   and `WAVE-1-EPIC-02-PROMPT.md`:164 — say it does not. They describe pdf.js *master*; the removal
   was explicitly not bisected. Converting corners individually remains correct anyway, because
   v3's implementation does not min/max-renormalise, so its output is not a valid rect after the Y
   flip. **Do not write a compile-time assumption that the method is absent.**
2. **`getViewport({ rotation: 0 })` discards the page's `/Rotate`.** The parameter is the *absolute*
   rotation, defaulting to `page.rotate`. IR space has `/Rotate` already applied, so the viewport
   corresponding to IR space at zoom 1 is `getViewport({ scale: 1 })` — **not**
   `getViewport({ scale: 1, rotation: 0 })`, which every brief in this repo specifies. Invisible on
   these fixtures (all 10 pages are `/Rotate 0`); a wrong-place highlight on any rotated page.
3. **v3 has no `/UserUnit` support at all** — no `PDFPageProxy.userUnit`, and `PageViewport` never
   multiplies by it. Its CSS has only `--scale-factor`; `--total-scale-factor` and `--user-unit`
   arrive in v4+. `userUnit` is taken from the IR's `Page.user_unit` and never asked of pdf.js.
   **Correct `/UserUnit` handling in the renderer requires upgrading `pdfjs-dist`.**

### 2.6 The coordinate-space collision, and how it was resolved

`synthesis-10` §10.2 and `literature/13` both mandate **origin bottom-left** for stored quads. The
shipped `packages/document-ir/src/geometry.ts` mandates **IR space: origin top-left, y down,
`/Rotate` applied, `/UserUnit` not applied**, and declares itself "the only place any of them is
converted into another".

**IR space wins**, and not by preference: 199 fixture polygons, 433 conformance vectors and every
`block_id` in existence are already expressed in it. `packages/anchoring/src/bridge.ts` calls
`normalisePageFrame` / `normalisePoint` rather than re-deriving the transform, and imports no
pdf.js, so the whole bridge tests in Node.

---

## 3. Fixture gaps filled

### 3.1 Citation — `packages/anchoring/test/fixtures/citation-nav.paperir.json`

`references[]` is empty in all three golden fixtures; there is no `reference_entry` block and no
`cites` relation in the set at all. `targets.spec` names `citation` as a required target kind, so
it had no data. Generated by `test/make-citation-fixture.ts` from `resnet`: one `citation` block
over the "[22, 21]" callout that really is printed on page 0, one `reference_entry` (whose geometry
is **synthetic and marked as such** — the real bibliography is on page 11, outside the range), one
`cites` relation and one `references[]` entry. Ids and hashes minted with the real formula.

**Deviation:** the brief sanctions adding data to `packages/document-ir/fixtures/*.json`. It was
put here instead, because:

- `.github/scripts/validate-fixtures.mjs` asserts *"expected exactly N `*.json` fixtures"* and
  `test/schema.spec.ts` asserts *"all three fixtures are present"* — a fourth file **fails Epic 0's
  CI**; and
- editing one of the three in place would change `confidence.overall` (a mean over blocks) and the
  block counts `fixtures/README.md` documents, and would invalidate a two-pass hand-verification
  attestation this epic is not in a position to re-earn.

The test value is identical and the blast radius is zero. Recommend Epic 0 adopt it into the golden
set (with the count assertions updated) if citation navigation is wanted before Epic 1 widens the
page range.

### 3.2 Gaps NOT filled, and what they block

| absent | blocks |
|---|---|
| `Repair`, `Alternative`, `Derivation`, model authorship | the provenance/repair UI has nothing to render against. `resolvedText` is called correctly, but the `applyProposed` path gets **no positive test data** — a reader that ignored `resolvedText` would pass every fixture test and still be wrong on real parser output |
| diagnostics (all three produce zero at every severity) | the warning/error rendering path |
| `header` flow, OCR, scanned pages | those code paths entirely |
| rotation ≠ 0, `userUnit` ≠ 1, CropBox ≠ MediaBox | covered instead by `packages/document-ir/test/fixtures-pdf/` synthetic PDFs, which the bridge is written against |

---

## 4. Defects found and fixed in this epic's own work

### 4.1 T4 was not gated on document identity — found by `falsify.spec`

A ResNet anchor resolved **`approximate` against Neural ODEs**. Both papers are 612 × 792 pt, so a
paragraph at (50, 556) on page 1 of one lands inside a block at (50, 556) on page 1 of the other.
The ladder was answering "yes, approximately" for a document sharing not one character with the
anchor.

**This would have made the headline 100 % meaningless.** Geometry is parser-independent but *not*
document-independent. T4 and T5 now require `pdfSha256` to match; T1–T3 deliberately do not,
because matching a quote across two versions of the same paper is legitimate and wanted, while
matching coordinates across them is not — v2 repaginates.

### 4.2 T4 orphaned every `unknown` block

Strict intersection orphaned all of them. They are **hairline rules — 0.4, 0.4, 1.0 and 4.0 pt
tall.** A region 0.4 pt tall is displaced past its own extent by any coordinate change larger than
0.4 pt, so intersection cannot recover it even though it plainly still exists a fraction of a point
away. T4b resolves by proximity within 6 pt, ranked by centroid distance **and area similarity** —
so a hairline matches a hairline rather than the paragraph two points above it. 6 pt is bounded
above by a 12 pt line of type and below by the ~0.5 pt a real parser release shifts.

### 4.3 The two-column gutter bug, reintroduced and removed

`quadsForRange` merged each line into one band spanning min-x to max-x, so a selection crossing a
two-column gutter produced **one** polygon painted across the gutter — the exact bug Epic 0 shipped
and then fixed inside `unionOfLineRects`, reintroduced one layer downstream where the helper could
no longer see the columns. Spans now keep their own x-extent and take only their line's clamped
y-band, so `unionOfLineRects` does the column separation it exists for. Caught by a test written
before the code was trusted; `lineband.spec` asserts two polygons and nothing painted in the gutter.

---

## 5. What was deleted

887 lines, in `b9a65a2`. Every target verified to have zero importers first.

`components/Mermaid.tsx` · `reader/SearchResults.tsx` · `reader/ExplanationModal.tsx` ·
`reader/OutlinePanel.tsx` · `hooks/useHighlights.ts` · `store/highlightStore.ts` ·
`types/highlight.ts` · the second API client in `lib/api.ts` (72 lines) · `globals.css` dead block.

Two corrections to the deletion list:

- **`globals.css:49-148` is not a clean cut.** Line 148 is the *opening* brace of a rule closing at
  150; the specified cut leaves an orphaned declaration and syntactically broken CSS. The real dead
  block is **46–176**, banner through the end of `@keyframes pulse`. Verified brace-balanced after
  (depth 0, min 0). That range also removes a global `@keyframes pulse` that was shadowing
  Tailwind's own `animate-pulse` app-wide — outside the brief's range, and a booby trap either way.
- **`MermaidRenderer.tsx` is live and canvas-owned** (`RichCanvasNode.tsx`, `nodes/AIResponseNode.tsx`).
  Only `components/Mermaid.tsx`, the unrelated 0-importer file, was safe to delete. See §6.2.

Deleting the legacy API group also resolves the two competing `Highlight` types that
`README.md` anti-slop rule 3 names: one definition now survives, in `@/types`.

---

## 6. Deviations and unresolved conflicts

### 6.1 The workspace collision in the brief is already resolved — no issue opened

The brief instructs opening an issue because `apps/**` is excluded from the pnpm workspace and CI
asserts it stays excluded. **Both were fixed on `main` before this epic started.** `apps/web` is a
workspace member (`pnpm-workspace.yaml`, PR #28 / `e4a6b1f`), the assertion job is gone, and the
`pull_request` trigger is unfiltered (#25), so CI *does* run on `epic-2-reader`. The brief's §"The
collision you must resolve by issue" and `WAVE-1-EPIC-02-PROMPT.md` are stale. No issue was opened;
none was needed.

### 6.2 Two deletion-list items have ownership conflicts — resolved without deleting Epic 5's files

- **`hooks/useCanvas.ts`** is on the deletion list and is under `apps/web/src/hooks/`, which this
  epic owns. Its importers are `app/paper/[id]/canvas/page.tsx` and
  `components/canvas/PaperCanvas.tsx` — both under `canvas/**`, which this epic explicitly does
  **not** own. Deleting it breaks files belonging to Epic 5; leaving it keeps a type-broken module
  (it calls a non-existent `canvasApi.getBookCanvases`) that is part of why `apps/web` does not
  build.
- **`MermaidRenderer.tsx`** — the brief says "Mermaid rendering is deleted, not restyled", but the
  live renderer is reached only from canvas nodes this epic does not own.

**How it was resolved.** Neither file was deleted. `apps/web/tsconfig.json` EXCLUDES
`src/components/canvas/**` and `src/hooks/useCanvas.ts`, and the canvas route is stood down to a
placeholder that explains why. Epic 5 finds every canvas component byte-identical.

That was enough to unblock the build, and the numbers say the breakage was never Epic 2's: **29 of
the 60 type errors were in the canvas surface, 25 of them in `useCanvas.ts` alone**, all
pre-existing. **Recommend Epic 5 delete the surface wholesale** when it rebuilds, at which point
both deletion-list items fall out for free. Deleting another epic's components to satisfy a
deletion list would have been the wrong trade.

### 6.3 `@papertree/document-ir` cannot be imported into a browser bundle — issue #33

`src/index.ts:31` re-exports `identity.js`, which imports `node:crypto` at module scope, and the
package declares no `"sideEffects": false`. Any import of the barrel — even for `polygonExtent` —
pulls `node:crypto` into a Next.js client bundle, which webpack 5 will not resolve.
`packages/document-ir/**` is Epic 0's, so this was raised as **issue #33** asking for
`"sideEffects": false` plus subpath exports.

`packages/anchoring` is browser-safe regardless, by construction: the resolver **compares** content
hashes the IR already carries and never **computes** one, and the perturbation harness (which does
need the real formula) is a separate Node-only entry point, `@papertree/anchoring/perturb`.

### 6.4 No new runtime dependency

The fuzzy matcher is a banded DP implemented in `src/match.ts` rather than `approx-string-match`,
which the literature names. Reason: this package must bundle for the browser, a Web Worker and
Node, and a dependency resolving in all three is a liability for ~90 lines of arithmetic — while
correctness here is *checkable* rather than trusted. The realistic input is one page (~3 000 code
points against a ~100-point quote), so the asymptotic advantage of bit-parallel Myers is not
reachable. If profiling ever shows T3 dominating, the bit-parallel version drops in behind
`search()` unchanged.

### 6.5 Thresholds are proposals, and are labelled as such in the code

0.72 / 0.60 and the 64-code-point context window are **not measured values**. `match-quote.ts`
returns the top-scored match unconditionally and lets the caller decide;
`13-highlight-anchoring.md` §9 says plainly they are its author's suggestion. They need calibration
against a real corpus, and the code says so where they are defined.

---

## 7. What is NOT built — the honest inventory

| feature | state | evidence |
|---|---|---|
| **F2.1** PDF renderer | built | `reader/perf.spec`, 17 tests. pdfjs-dist 5.7.284, worker served from `/`, visible ±2 mounted |
| **F2.2** anchor model + resolver | built | 57 tests; §1 |
| **F2.3** capture + overlay | built | `zoom.spec` 1.14e-13 pt, `resize.spec` 1.61e-13 pt, `targets.spec` 10/10 |
| **F2.4** Navigator | built | one panel, six tabs; outline from the section tree |
| **F2.5 / F2.6** Guided + Split | built | `reader/provenance.spec`, 12 tests. **DESIGN.md §11.4 discharged** |
| **F2.7** Touch / iPad | built | `reader/touch.spec` 19 tests, `reader/a11y.spec` 28 tests |
| **F2.8** Library + system states | built | every state in §19.8 |

**DESIGN.md §11.4 is discharged.** `packages/ui/src/provenance.tsx` is the only way to render
derived content, so "did we mark it?" reduces to "did it go through `DerivedBlock`?" — a question a
test can answer, and `provenance.spec` answers it. The equation crop renders as the paper and the
LaTeX as "our transcription" inside the derived register; `provenance.spec` asserts the ordering
with `compareDocumentPosition` rather than trusting source order, asserts that a hostile
`TablePayload.html` renders as escaped text with no `<script>` element, and sweeps every other
component to confirm the reserved `⊙` is emitted by nothing else.

### 7.1 The one acceptance test NOT satisfied — *resolved 2026-08-01, see §10.1*

> **Superseded.** This section is kept as written because its estimate was wrong in an instructive
> way: it calls the missing spec "a small piece of work". It was not — writing it uncovered
> `doc.continuedBy` returning a one-entry map keyed `undefined` on every document, which had been
> silently disabling paragraph continuation since Epic 0. The two "honest limits" below about
> `touch.spec` and `a11y.spec` were both correct, and both are now closed by §10.3.

**`anchoring/cross-mode.spec`** — "a highlight made in Source resolves in Guided, or explicitly
reports 'not available in this view'." The machinery is all present: `targetKind: 'guided_para'`
and `provenanceClass` are in the anchor record, `targets.spec` covers a Guided-paragraph anchor,
and `GuidedView` sets `data-block-id` on every block. What is missing is the spec that drives a
Source-captured anchor through the Guided renderer and asserts the fallback message. It is a
small piece of work and it is not done; claiming otherwise would be the kind of overclaim §7 exists
to prevent.

Two further honest limits on what the specs prove:

- `reader/touch.spec` asserts the 44 × 44 minimum from inline style and `className`, not from
  measured pixels, because happy-dom performs no layout. The spec says so in a comment.
- `reader/a11y.spec` runs axe at WCAG 2.2 AA but **cannot** run `color-contrast` or `target-size`
  for the same reason, and lists those rules rather than reporting a clean sweep over them.
  Neither has been verified in a real browser.

### 7.2 What a follow-up session inherits

- A proven, dependency-light `@papertree/anchoring` with a stable API: `indexDocument`,
  `captureAnchor`, `resolveAnchor`, `quadsForRange`, `frameForPdfPage`, `viewportFor`.
- `bridge.ts` documents the three pdf.js traps (§2.5) so the renderer does not have to rediscover
  them.
- The recon corrections in §2 — particularly §2.3 and §2.4, which any component touching reading
  order or the outline will otherwise hit.
- Decide the `pdfjs-dist` version **before** writing the text layer: v3 has no `TextLayer` class
  (only `renderTextLayer`), no `userUnit`, and only `--scale-factor`; v5 has all three. The
  literature describes v5's API against a v3 install.
- The worker is fetched from a protocol-relative CDN in **three** places (`PDFViewer.tsx:13`,
  `PDFMinimap.tsx:17`, `FigureViewer.tsx:11`) and `GlobalWorkerOptions` is a singleton — set it in
  exactly one module all three import, or the CDN line survives the fix.

---

## 8. Component inventory for Epic 5 (canvas)

Reusable today, all from `@papertree/anchoring`, none React-coupled:

| export | what Epic 5 gets |
|---|---|
| `indexDocument(paper, textStreamId)` | reading order, per-page and per-hash indices, the document text stream. Handles the `doc_order` trap in §2.3 |
| `captureAnchor(...)` | a complete multi-selector anchor for any of the 10 target kinds. A canvas node that keeps a live PaperIR reference should store one of these, not a block id |
| `resolveAnchor(anchor, doc)` | the ladder, with `state`/`tier`/`reason` for the UI |
| `quadsForRange(spans, start, end)` | paintable polygons with the line-band clamp and correct gutter splitting |
| `frameForPdfPage` / `viewportFor` / `pdfRectToIr` / `pdfPointToIr` | the pdf.js ↔ IR bridge |
| `irBboxToOverlayRect` / `irPolygonToSvgPoints` | scale-1 overlay geometry for a `transform: scale(z)` layer |
| `@papertree/anchoring/perturb` | the seeded perturbation harness, for scoring a real parser upgrade |

**"Open source" always works** if a canvas node stores an `Anchor` rather than a `block_id`: that is
precisely the property §4.1's document gate and the T1 `content_hash` check exist to guarantee.

---

## 9. Reproducing every number here

```bash
cd "/Volumes/Mrigesh SSD/PaperTree"
pnpm install
pnpm --filter @papertree/anchoring typecheck     # 0 errors
pnpm --filter @papertree/anchoring lint          # 0 errors
cd packages/anchoring && ../../node_modules/.bin/vitest run   # 57 passed, 6 files
```

`pnpm test` is **not** a gate — turbo's `test` inputs are package-relative with no
`globalDependencies` and runs are cached; the Epic 0 gate observed a cache hit reprinting results
without executing. Run the suite directly, as above, or `turbo run test --force`.

The reparse table (§1), the zoom/resize drift (§1.3) and the line-band census (§2.1–2.2) are all
printed by the specs themselves, so the numbers in this document and the numbers the suite emits
cannot drift apart.

---

# 10. Continuation session — 2026-08-01

Branched from `main` at `560109e`. PR #56. Closes #41 and #42, the two open Epic 2 issues.

This session began by **verifying §1–§9 rather than believing them**, per `AGENTS.md` §1. They
hold: `packages/anchoring` 57 tests pass and the §1 reparse table reproduces byte-for-byte —
100.00 % re-anchor, zero orphans, 21 combinations, `worst_case` retiring 89–90 % of block ids.
`ui` 41 and `web` 86 pass. The architectural gate criterion 3 is genuinely met.

Then it wrote the ninth spec and opened the reader in a browser, and each of those found a defect
the existing 184 tests could not.

## 10.1 `anchoring/cross-mode.spec` — and the map that was silently empty

**Measured: 199 blocks → 179 resolve in Guided, 20 report unavailable, 0 silent.**

```
cd packages/anchoring && ../../node_modules/.bin/vitest run test/cross-mode.spec.ts
```

7 tests. The 20 unavailable are page furniture — the arXiv stamp, page numbers, the 0.4–4 pt
hairline rules — each carrying a **user-readable sentence**, not a reason code destined for a log.
The spec asserts that **both** outcomes occur, so a resolver that answered "resolved" for
everything fails it. That is the anti-vacuity guard, and it is the same shape as §1.2's
`falsify.spec`: a criterion with an easy half and a hard half needs a test that can fail on the
easy one.

### The defect underneath

**`doc.continuedBy` was a one-entry map keyed `undefined`, on every document in existence.**
`document.ts` read `relation.from_block_id`; `paperir-1.0.0.schema.json:1458` requires `from`, and
all three fixtures agree.

| fixture | continuation relations | `continuedBy` before | after |
|---|---:|---|---:|
| `attention` | 1 | 1, keyed `undefined` | 1 |
| `neural-odes` | 1 | 1, keyed `undefined` | 1 |
| `resnet` | 4 | 1, keyed `undefined` | **4** |

Nothing threw — `byId.has(undefined)` is merely false — so every consumer behaved as though no
paper had a continued paragraph, and `resnet` read **"high- way networks"**. `GuidedView` had
shimmed around it locally and recorded the defect as *"another group's file"*. That was wrong
twice: `packages/anchoring` is the **same epic's** package, and a view that re-implements the index
it renders from is a second source of truth. Both spellings are now read — the worker has emitted
either (cf. `1dff4d1`).

### What moved, and why it had to

The Guided projection and `reflow` now live in `packages/anchoring/src/guided.ts`, and `GuidedView`
renders **from** it. Two implementations of "what counts as a paragraph" drift, and when they drift
the symptom is a highlight drawn in the wrong place — the bug this package exists to prevent.

The real work is **offsets**. `reflow` deletes line breaks and repairs hyphens, so code point 40 in
`Block.text` is not code point 40 in the paragraph the reader sees. `reflowWithMap` emits the map
back; `offsetToGuided` binary-searches it. A cross-mode resolution that returned only a paragraph
id would be a guess wearing an answer's clothes.

`reflow.spec`'s 19 tests pass **unchanged** against the moved implementation — that is the
regression check. The move also drops `String.charAt` (UTF-16 code units) for code points, which is
what `Anchor.offsetUnit: 'unicode'` has claimed since §1.

## 10.2 The provenance stylesheet was never imported — §7's worst overclaim

**`@papertree/ui/styles.css` was not imported by anything.**

It defines ~200 `pt-*` rules — `pt-derived__marker`, `pt-derived__header`, `pt-equation`,
`pt-figure`, `pt-table`. `@papertree/ui`'s `package.json` even carries a note explaining why
`sideEffects` is `["*.css"]` rather than `false`, *so that a bundler could not drop
`import '@papertree/ui/styles.css'`*. **The import it was protecting did not exist.**

The consequence is this epic's own hard rule failing in the running product: **Guided content
rendered in the same visual register as the paper.** The `⊙` marker and the "our reading" label
were present in the DOM and visually undifferentiated — the header rendered as `⊙our readingshow
source`, unspaced, because `display:flex; gap:8px` never applied.

**§7 says "DESIGN.md §11.4 is discharged" and cites `provenance.spec`'s 12 tests. Those 12 tests
passed throughout.** They assert class names, `derived_from` ids, and DOM order via
`compareDocumentPosition` — all of which were correct. happy-dom applies no stylesheet, so *every
assertion was true and the product was still wrong.* §11.4's promise is that the UI renders
interpretation "in the 'our reading' register"; a register is a visual claim, and no assertion in
that spec is about anything visible.

With the stylesheet loaded, derived blocks render as dark cards with a violet rule and a rounded
face against the paper's serif. §11.4 is discharged **now**.

## 10.3 axe at WCAG 2.2 AA, in Chrome — the two rules that had never run

§7.1 admitted `reader/a11y.spec` "cannot run `color-contrast` or `target-size`" because happy-dom
performs no layout, and that neither had been verified in a real browser. Both now have been, at
`/paper/resnet-cvpr-2col/read`, in all three modes with the Navigator open:

| surface | violations | passes |
|---|---:|---:|
| Source + Navigator | **0** | 25 |
| Guided + Navigator | **0** | 26 |
| Split + Navigator | **0** | 26 |

`color-contrast` **RAN**. `target-size` **RAN**. **75 interactive elements, 0 under 44 × 44 real
measured pixels** — `touch.spec` could only read inline style and `className`.

The 5–11 remaining `color-contrast` *incompletes* are all "element content contains only non-text
characters": the `aria-hidden` `⊙` glyphs and the icon button. Not failures.

Two real violations, both `serious`, both fixed:

- **`scrollable-region-focusable`** — the virtualised page scroller had `overflow-auto` and no
  `tabIndex`. The pages are not themselves focusable, so a keyboard-only reader could open a paper
  and never move down it.
- **`color-contrast`, 15 nodes** — the Navigator's 11 px metadata text. **Recorded because the
  obvious fix was wrong.** The root cause was §10.2: the panel is `#16151a` under the real
  stylesheet, so `text-gray-400` was always correct there and the violation was measured against an
  unstyled white background. Darkening it to `text-gray-600` fixed the measurement and would have
  produced 2.4:1 the moment the CSS loaded. The genuine failures were `text-gray-500` at 3.75:1 on
  the dark panel, now 6.5:1. *A contrast fix validated without the real stylesheet is not a fix.*

## 10.4 The reader had never rendered a real PDF

`copy-fixtures` reported **`0/3 PDFs`** throughout the original session: corpus PDFs are gitignored
and fetched, not committed, and `research/benchmarks/corpus/` did not exist. After
`./research/benchmarks/fetch_corpus.sh` (8/8 papers, all checksums verify against
`corpus.sha256`) it is **3/3**, and ResNet renders — two columns, figure crops, the arXiv stamp
rotated down the left margin, and that stamp correctly **absent** from Guided as furniture, which
is §10.1's classification visible on screen.

So every claim in §7 about F2.1's renderer was, until now, a claim about a component that had never
been given a document.

## 10.5 A verification gap, recorded because it reached CI

Run 30702316937 failed on `@papertree/anchoring#lint`: two oxlint errors (`asRecord` unused in
`guided.ts`, `sort()` for `toSorted()` in `cross-mode.spec`). This session had run `tsc --noEmit`
and `vitest run` per package and `next lint` for `apps/web` — and never `oxlint`, which is what the
four TypeScript **packages** lint with. Every suite run was green; the branch looked verified and
was not.

**A green subset looks exactly like a green whole.** `AGENTS.md` now carries the pre-push block:

```bash
pnpm exec turbo run lint --force
pnpm exec turbo run typecheck --force
pnpm exec turbo run test --force
```

## 10.6 Corrections to this document

- **§2.1's "up to 19.24 pt"** does not reproduce. Re-measured independently: the worst genuine
  cross-line band overlap in `neural-odes` is **10.51 pt**. 19.24 is the height of two spans on the
  *same* visual line, which `sameLine()` groups into one band. Issue #48 is correct.
- **§2.2's "20 raw line-band overlaps → 0"** does not reproduce either. Measured 28 raw → **3**,
  worst residue 1.33 pt. The scalpel claim stands; "→ 0" does not.
- **§2.3's producer-side guidance was wrong**, and #48 measured why: a `1.3 × size` height rule
  deletes the arXiv stamp from every arXiv paper, every rotated axis label and every large
  delimiter, because those are tall in the axis-*across* the writing direction. The right rule is
  per-direction. `lineband.ts` remains a correct consumer-side response.
- **§2.2's "`size` is absent on 118 of 727 spans (16 %)"** is a property of Epic 0's hand-built
  fixtures, not of parser output: 0 of 84 395 real MuPDF spans lack `size`. The geometric clamp is
  still right for these fixtures; the stated reason does not generalise.
- **§7's inventory** is superseded by §10.2 for F2.5/F2.6 and by §10.3/§10.4 for F2.1 and F2.7.

## 10.7 What is still open, and whose it is

| | issue | owner |
|---|---|---|
| `useCanvas.ts` + `MermaidRenderer.tsx` — Epic 2's last 2 must-delete items | #43 | Epic 5 |
| `@papertree/document-ir`'s barrel pulls `node:crypto` into a browser bundle | #33 | Epic 0 |
| `apps/web/package-lock.json` still exists; v1 npm path still works | — | a deliberate transitional state, see `pnpm-workspace.yaml` |

**One thing this session found and did not fix.** The reader route is wrapped in `AuthGuard`, which
calls `authApi.getMe()` against `apps/api` — a Python service that does not run in a fixture-only
dev setup. With no backend the reader spins forever or bounces to `/login`, so **the epic's own
deliverable cannot be looked at without standing up v1's auth**. Verification here used a
throwaway stub on `:8000`. That is a product decision (should a fixture-backed reader be behind a
login at all?), not a defect to silently patch, so it is left for the owner to rule on.

## 10.8 Reproducing §10

```bash
cd "/Volumes/Mrigesh SSD/PaperTree"
./research/benchmarks/fetch_corpus.sh        # 8 papers; shasum -c research/benchmarks/corpus.sha256
pnpm install
pnpm exec turbo run lint --force             # 5/5
pnpm exec turbo run typecheck --force        # 9/9
pnpm exec turbo run test --force             # 9/9
cd packages/anchoring && ../../node_modules/.bin/vitest run   # 64 passed, 7 files
```

The browser numbers in §10.3 are not reproduced by a suite — that is the point of them, and it is
also their weakness: **they are a measurement taken once, by hand, not a regression test.** Wiring
axe into a real-browser runner (Playwright) so `color-contrast` and `target-size` cannot silently
stop being checked is the obvious follow-up, and it is not done.

---

# 11. The fourth correction: nine passing criteria, four unreachable features

*Written 2026-08-01, on `epic-2/f2.3-wire-capture` (PR #61), after the owner asked whether Epic 2
could be closed. The answer was no, and the reason is the most useful thing in this document.*

## 11.1 What was actually wrong

`#56` closed the ninth acceptance criterion, and I recorded this epic COMPLETE. Both halves of that
were true and the conclusion was wrong. Booting the product — mongo, `apps/api`, `next dev` — and
using it found:

| | what existed | what a user could do |
|---|---|---|
| F2.3 capture | `useSelectionCapture`, `SelectionToolbar`, 57 anchoring tests, 100.00% re-anchor | **nothing** — neither is imported by anything; `onAnchorCaptured` is declared, supplied, and read by no descendant |
| F2.3 stamping | `useSelectionCapture`'s header states `PdfPage` writes `data-block-id`/`data-cp-start` | **nothing** — 415 rendered spans, 0 stamped; the hook could only ever run its own documented fallback |
| F2.8 library | `PaperGrid`, `PaperList`, `UploadDropzone`, six `SystemStates`, 0 axe violations, every target ≥44×44 | **nothing** — imported only by `test/library-cases.tsx` and `test/a11y.spec`; `/dashboard` was still v1 |
| F2.1 zoom | `ZoomControl`, `resolveZoom`, fit modes, pinch | **nothing** — unmounted; the shell held a zoom scalar no control could change |

Verified in Chrome, not inferred: selecting the word `convolutional` inside the abstract left
`document.querySelector('.pt-selection-toolbar')` null.

## 11.2 Why nine green criteria said nothing about it

**Every acceptance test in this epic imports the component it tests.** `reparse.spec` builds
anchors by calling `captureAnchor` in TypeScript; `a11y.spec` and `touch.spec` call
`render(testCase.element)`. Both prove the component works. Neither can observe whether anything
renders it, because the act of testing supplies the missing caller.

The property that was broken is REACHABILITY, and it is a property of the import graph rather than
of any module. `apps/web/test/reachable.spec.ts` now checks it: walk from `src/app/**`, Next's real
entry points, and require every component to be in the transitive closure. It would have caught all
four. **It found the fourth** — I wrote it for capture and the library, ran it, and it named
`ZoomControl` and `ModeSwitch`.

If one check from this epic is worth keeping, it is that one.

## 11.3 The stamping, and the trap inside it

pdf.js and PyMuPDF segment a page differently — 469 text items against 62 line-level spans on
`attention` — so no index, id or offset survives the crossing. `stampTextLayer` matches each item's
box to a block geometrically, then walks that block's text with a running cursor:

| fixture | items | matched | placed (of textual) |
|---|---|---|---|
| attention-is-all-you-need | 469 (332 textual) | 465 · 99.1% | 327 · **98.5%** |
| resnet-cvpr-2col | 754 (567 textual) | 673 · 89.3% | 488 · **86.1%** |
| neural-odes-mathheavy | 892 (656 textual) | 820 · 91.9% | 577 · **88.0%** |

The denominator is TEXTUAL items: a third of pdf.js's stream is whitespace-only gap markers, which
have no offset to have. The remaining shortfall is display equations and rotated margin text, left
**unstamped** rather than guessed — an absent `data-block-id` is visibly approximate where a wrong
one is silently wrong.

**The trap.** `item.transform` is already raw PDF user space, so `convertToPdfPoint` — which is what
the surrounding code uses everywhere else, and which reads as obviously correct here — runs the
inverse of a transform that was never applied.

|  | matched | placed |
|---|---|---|
| with `convertToPdfPoint` | 35.8% | 3.4% |
| without | 99.1% | 98.5% |

Both typecheck. Neither throws. The wrong one silently degrades every anchor to the text fallback.
pdf.js's own `#appendText` is the proof it does not belong: it composes the PDF→CSS flip *onto*
`geom.transform`, which it could not do if that were already viewport space.

## 11.4 A defect I introduced while fixing these

Wiring the scroller's measured box up to `resolveZoom`, I declared `onViewportResize` on
`SourcePaneProps` and never supplied it from the shell. Fit-width then saw a container of zero and
clamped to `MIN_ZOOM`: a 25% page, in a reader, with no error anywhere — **the same
declared-and-never-read shape as the bug I was fixing**, introduced in the commit fixing it.

The prop is now **required**. That moves the check from a test that has to think of it to the
compiler, which cannot forget. Worth generalising: of the five instances of this defect on this
epic, four involved an OPTIONAL prop or an unimported module, and none would have survived being
mandatory.

## 11.5 Two environment findings, so the next session does not re-derive them

**The reader renders nothing in a background browser tab.** `visibilityState: "hidden"` starves
`requestAnimationFrame`; pdf.js's `RenderTask.promise` never settles; the text layer is never built.
0 spans, no error, canvas apparently painted. I spent an hour treating this as a regression in my
own change before testing pristine `main` and finding it there too. **Any automated browser check of
this reader must foreground the tab, or it is measuring the tab.**

**The corpus is not committed and CI does not have it.** `stamp.spec` reads the real PDFs, passed
locally against a `--force` gate, and failed CI on `ENOENT … public/fixtures/*.pdf`. It now
`describe.skipIf`s on their absence and prints the fetch script. The cost, stated plainly: **in CI
the coverage numbers in §11.3 are unverified.** The wire itself is not — `capture-wire.spec` fakes
pdf.js, needs only the committed IR, and runs everywhere.

## 11.6 What is still open, and whose

| | |
|---|---|
| #43 | Epic 5 owns `hooks/useCanvas.ts` and the stood-down canvas surface — Epic 2's last must-delete item, and the nine components on `reachable.spec`'s `ORPHAN_LEDGER` |
| #33 | Epic 0 owns `@papertree/document-ir`'s barrel, which pulls `node:crypto` into a browser bundle |

Neither is this epic's to close. Every child of #3 is.

## 11.7 What a user can and cannot do today

**Can:** open the three sample papers from the library, read them as a real pdf.js render, switch
Source/Guided/Split, zoom (presets, fit-width, fit-page), navigate by PaperIR's section tree, select
text and create a highlight that survives zoom, resize, reload and a reparse.

**Cannot:** open their own PDF. The reader takes fixture slugs; `apps/api` is v1 and does not
produce PaperIR, and `services/document-worker`, which does, has no HTTP surface. An upload
therefore lands as `pending` and says so rather than pretending. **That gap is Epic 1's ingest
endpoint, not Epic 2's, and it is the single thing between this reader and a usable product.**
