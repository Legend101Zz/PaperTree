# EPIC 2 — result

**Branch:** `epic-2-reader`, from `main` at `e4a6b1f`.
**Status: PARTIAL.** The anchoring spine (F2.2, F2.3) is built, measured and merged-ready. The
reader application (F2.1, F2.4–F2.8) is **not built**. §7 says exactly what is missing and what
the next session inherits. Nothing in §1–§5 is a projection; every number was produced by a
command recorded here.

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

**`anchoring/cross-mode.spec` is NOT met** — it needs the Guided view, which is not built (§7).

---

## 2. Corrections to the inputs

Each was measured, not inferred. Commands are in the module headers.

### 2.1 The over-tall span defect is not confined to `resnet`

`fixtures/README.md` and `EPIC-00-RESULT.md` both scope it to that fixture.

| fixture | spans | no `size` field | over-tall | overshoot | overlapping line pairs |
|---|---:|---:|---:|---|---:|
| `resnet` | 295 | 13 | 17 (22 by absolute height) | 7.32–7.34 pt | 18 (5.16–5.39 pt) |
| `attention` | 173 | 48 | 0 | — | 9 (0.78–15.39 pt) |
| `neural-odes` | 259 | 57 | **12** | 5.86 pt+ | **14 (up to 19.24 pt)** |

`neural-odes` — the maths-heavy paper, whose highlights most need it — has 12 more of the defect
and the worst overlap in the set. A clamp applied only to `resnet` would have left it bleeding.

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

### 6.2 Two deletion-list items have ownership conflicts — NOT deleted, flagged instead

- **`hooks/useCanvas.ts`** is on the deletion list and is under `apps/web/src/hooks/`, which this
  epic owns. Its importers are `app/paper/[id]/canvas/page.tsx` and
  `components/canvas/PaperCanvas.tsx` — both under `canvas/**`, which this epic explicitly does
  **not** own. Deleting it breaks files belonging to Epic 5; leaving it keeps a type-broken module
  (it calls a non-existent `canvasApi.getBookCanvases`) that is part of why `apps/web` does not
  build.
- **`MermaidRenderer.tsx`** — the brief says "Mermaid rendering is deleted, not restyled", but the
  live renderer is reached only from canvas nodes this epic does not own.

Both need a decision that spans Epic 2 and Epic 5. **Recommend Epic 5 delete the canvas surface
wholesale**, at which point both fall out for free. Not resolved unilaterally.

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

| feature | state |
|---|---|
| **F2.1** PDF renderer | **not built.** No virtualised page list, no local worker bundling, no zoom control. Requires a `pdfjs-dist` upgrade first (§2.5.3) |
| **F2.2** anchor model + resolver | **built, measured, 57 tests passing** |
| **F2.3** capture + overlay | **geometry built and measured** (`bridge.ts`, `lineband.ts`, `capture.ts`). The React overlay component is **not built** |
| **F2.4** Navigator | **not built** |
| **F2.5 / F2.6** Guided + Split | **not built.** DESIGN.md §11.4's promise is therefore **NOT YET DISCHARGED** — see below |
| **F2.7** Touch / iPad | **not built** |
| **F2.8** Library + system states | **not built** |

Consequently **`reader/perf.spec`, `reader/touch.spec`, `reader/a11y.spec`,
`reader/provenance.spec` and `anchoring/cross-mode.spec` do not exist**, and `apps/web` still has
no test script, no test runner and no axe/browser harness. `--filter=!papertree-web` is still in
the root `build` and `lint` scripts; removing it is an Epic 2 deliverable and is **not done**,
because the app does not build yet.

**DESIGN.md §11.4 is still owed.** The schema tolerates arbitrary strings in
`EquationPayload.latex`/`mathml` and `TablePayload.html` *only because* "the UI is obliged to render
them in the 'our reading' register", and Epic 2 owns that promise. **No UI exists yet, so the
promise is undischarged** — this is the single most important thing the next session must not lose.
The required shape: the `image` crop is the ground truth and renders as the paper; `latex` /
`mathml` / `html` render in the derived register with the reserved `⊙`, a `derived_from` block id
and a working "show source", and `reader/provenance.spec` must fail if any of those is missing.

### 7.1 What the next session inherits

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
