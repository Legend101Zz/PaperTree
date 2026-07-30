# Golden PaperIR fixtures (F0.7)

Hand-checked PaperIR documents for real papers from `research/benchmarks/corpus/`.
**Epic 2 builds against these and never waits for the parser** (`research/build/EPIC-02-reader.md`).

Each fixture is a complete, schema-valid `Paper` covering a **page range**, not a whole paper.
The range is stated per paper below and is also recorded in the document itself as
`parser.profile`. Four pages that are right beat twelve that are approximately right: a wrong
fixture poisons Epic 2, and nothing downstream can tell the difference.

## Coverage at a glance

| Fixture                                  | Paper                                | Pages **covered** | Pages **NOT covered** | Blocks | Relations | Sections | Spans |
| ---------------------------------------- | ------------------------------------ | ----------------- | --------------------- | -----: | --------: | -------: | ----: |
| `attention-is-all-you-need.paperir.json` | Vaswani et al. 2017, `arXiv:1706.03762v7` | **0–3** of 15 | 4–14                  |     57 |        34 |        8 |   173 |
| `neural-odes-mathheavy.paperir.json`     | Chen et al. 2018, `arXiv:1806.07366v5`    | **0–2** of 18 | 3–17                  |     81 |        71 |        3 |   259 |
| `resnet-cvpr-2col.paperir.json`          | He et al. 2015, `arXiv:1512.03385v1`      | **0–2** of 12 | 3–11                  |     61 |        53 |        7 |   295 |

**10 pages of 45 in total.** Everything the three fixtures do not carry is listed in
[What these fixtures do NOT cover](#what-these-fixtures-do-not-cover-read-this-before-you-plan-epic-2)
at the foot of this file. The short version: **no references, no citations, no OCR, no repairs, no
alternatives, no derivations, no scanned page, and exactly one table** (in `neural-odes`).

## What a reader can legitimately be built against

Every capability below is present in at least one fixture, with a real page behind it.

| Capability                                          | Fixture that carries it                             |
| --------------------------------------------------- | --------------------------------------------------- |
| Two-column body reading order interrupted by a float | `resnet` (the only true two-column layout here)     |
| Single-column body with a wrapped side float, on both sides | `neural-odes` (p0 float right, p1 float left) |
| Paragraph continued into the next **column**         | `resnet` (`continues_in_next_column` ×2)            |
| Paragraph continued onto the next **page**           | all three (`continues_on_next_page` ×2/×1/×1)       |
| Section outline, 3 levels deep                       | `attention` (`3` → `3.2` → `3.2.1`)                 |
| **Raster** figure region + linked caption            | `attention` (both figures, `source: "pdf_raster"`)  |
| **Vector** figure region + linked caption            | `resnet` (both figures) and `neural-odes` (both)     |
| Figure panels / in-figure `detected_labels`          | `resnet` (2 panels, 28 + 9 labels), `attention` (2 panels, 2 labels) |
| Numbered display equation with a rendered crop       | `neural-odes` ×5, `resnet` ×2, `attention` ×1        |
| Display equation carrying hand-transcribed `latex`   | `resnet` ×2, `attention` ×1 (`neural-odes` display equations carry none — see its limitation 6) |
| **Inline** equation nested in a paragraph, located by a role-tagged span | all three (`neural-odes` ×3, `resnet` ×1, `attention` ×1) |
| **Table** → `table_row` → `table_cell`, two levels of nesting | `neural-odes` **only** (1 table, 5 rows, 24 cells) |
| `algorithm` block                                    | `neural-odes` **only** (Algorithm 1)                 |
| `unknown` block that keeps its geometry              | all three (`attention` 4, `neural-odes` 2, `resnet` 2) |
| Rotated marginal text                                | all three (the arXiv stamp; typed `margin_note` in two, `annotation` in `neural-odes`) |
| Footnotes with `footnote_of`                         | `resnet` ×2, `attention` ×1 (`neural-odes` has a conference footnote with no referent) |
| `status: "partial"` + `partial_reason`               | `neural-odes` (the other two declare `complete` — see the `status` note below) |

## How these were verified, and by whom

Two passes, by different agents, and the second one did not trust the first.

**Pass 1 — the builder.** `tools/build_fixture.py` refuses to write a document that fails any of
the mechanical checks in the next section, and each fixture's covered pages were rendered at 2×
with every polygon stroked and labelled, and looked at.

**Pass 2 — independent verification (F0.7 review).** One verifier per fixture, each of whom
re-extracted the region of every block from the corpus PDF with PyMuPDF and diffed it against the
fixture's own `text`, re-derived every `block_id` / `text_normalised` / `content_hash` in **both**
languages, intersected every polygon with the page's `rawdict` character boxes, and read the
rendered overlays and crops as images rather than as numbers. Between them they visually checked
**10 of the 10 covered pages** — raw renders, full-page polygon overlays at 2–2.4×, and targeted
zooms at 4–8× — and they found and **fixed two MATERIAL defects** that no mechanical check could
see:

| Found in     | Defect                                                                                                                                                                                                       | Fix                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `attention`  | `text` claimed a line break the page does not have, on the bold run-in leads `Encoder:` / `Decoder:`. `_merge_baselines` sorted runs by rounded `y0` and then tested "is this to the right of the previous one"; the lead sits 0.06 pt *below* the prose beside it, so the two runs never merged. | `_merge_baselines` rewritten to cluster runs on y-**overlap** first and order left-to-right second. `block_id`, `text_normalised`, `content_hash`, `bbox` and `polygon` are all unchanged; only `text` and one span moved. |
| `neural-odes`| Table 1's row and cell polygons enclosed the **next** row's glyphs — 5.7 pt of CMSY/CMR font descent, ~57 % of a row height. A reader hit-testing a table row would have covered most of the row beneath it.   | Per-row `clip_y` read off the lowest glyph box actually in that row (595.17 / 605.13 / 615.08). See limitation 9 there. |

Everything else the verifiers found is recorded as a numbered limitation in the per-fixture
sections below, including the ones they chose **not** to fix and why. Nothing was found in `resnet`
that needed changing.

**Pass 3 — permanent.** The checks are now tests, so a regression is red rather than rediscovered:

| Where                                     | Asserts                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `test/schema.spec.ts` → `golden fixtures (F0.7)` | 3 fixtures present · ajv strict · generated Zod binding · `validatePaper` **0 errors and 0 warnings** · every `block_id` / `text_normalised` / `content_hash` recomputes · a negative control proving the recompute discriminates |
| `python/tests/test_fixtures.py`           | the Python twin of all of the above (Pydantic + `validate_paper` + `block_id`), plus: every declared `fixture://` asset exists on disk, and each file is byte-stable JSON |
| `.github/scripts/validate-fixtures.mjs`   | the CI job: exactly 3 fixtures, each schema-valid, on every push                                      |

## What has been verified about every fixture here

Run `packages/document-ir/tools/build_fixture.py` to rebuild; it refuses to write a document that
fails any of this. Independently re-checked in **both** languages:

| Check                                                          | How                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| JSON Schema                                                    | `ajv` (strict, allErrors) against `schema/paperir-1.0.0.schema.json` |
| Generated Zod binding                                          | `PaperSchema.safeParse`                                          |
| Generated Pydantic binding                                     | `Paper.model_validate`                                           |
| Semantic rules (DESIGN.md §5.2, Tier A)                        | `validatePaper` (TS) **and** `validate_paper` (Python) — 0 errors, 0 warnings |
| `block_id` recomputes from the block's own content             | `identity.block_id` re-derived per block, in TS and in Python    |
| `text_normalised` / `content_hash` recompute                   | `normaliseText` / `contentHash` re-derived per block             |
| `bbox` == `polygon` extent                                     | `polygonExtent`, tolerance 1e-9                                  |
| Every relation endpoint resolves; `page.block_ids` agrees      | explicit set comparison                                          |
| **Polygons enclose what they claim, and reading order is right** | every covered page rendered at 2× with all polygons overlaid and labelled `type/flow order doc_order`, and looked at |

## Conventions these fixtures share

**Geometry.** PDF user space, **origin top-left**, `/Rotate` applied, CropBox-relative, `/UserUnit`
recorded but not applied — produced by `papertree_document_ir.geometry`, never by reading a
viewer's device coordinates. Coordinates are rounded to **0.01 pt** before anything is derived from
them, so the number in the JSON is the number `block_id` was hashed from and the number rule 1
compares. Multi-line PROSE blocks (paragraph, heading, caption, abstract, list item) get their polygon from
`union_of_line_rects`, which returns a **staircase** wherever the lines differ in width and a
rectangle where they do not; the build fails if that function returns more than one region for one
block. **92 of the 199 blocks carry a polygon with more than four vertices** (up to 30), and **0
multi-line prose blocks are plain rectangles**.

Blocks whose region is a typeset BOX rather than a run of lines are rectangles ON PURPOSE, and the
plan says so with `geometry="rect"`: `equation` and `inline_equation` (the region a reader means by
"equation (4)" is the formula's box plus its flush-right number), `table_row` (the row band), and
the one `algorithm` float (its region is the ruled frame drawn on the page, at y = 120.01, 133.61
and 222.59). Do not "fix" those into staircases.

_Corrected 2026-07-30, acceptance review._ This paragraph used to say every multi-line block was a
staircase, and it was FALSE OF THE DATA: three paragraphs and the algorithm float carried plain
4-point rectangles, because `union_of_line_rects` collapsed a whole paragraph into one band
whenever consecutive line rects overlapped vertically — which is the NORMAL case, since MuPDF's
line boxes are font ascent/descent boxes that abut or overlap. Hit-testing returned true in
whitespace the block did not occupy: for `blk_gwc2xsv7t6wxonxe` (Attention) the point (480, 618)
was inside a polygon whose last printed line ends at x = 459.46. The helper was fixed (it now
decides band membership against the band's ANCHOR interval, not its running extent), the fixtures
were rebuilt, and the claim was rewritten to what the data supports rather than to what the call
was supposed to produce. The verification table's "rendered at 2x with all polygons overlaid and
looked at" row did not catch it, so treat that check as weaker than its wording implies.

**Text and spans.** `text` is the glyph stream as the PDF's text layer gives it, with lines joined
by `\n`. It is **not** de-hyphenated: a line ending `transduc-` stays that way, because a repair is
a declared, reproducible edit (D4 / rule 30b) and inventing one for the fixture would be inventing
source. Every text block carries `spans` at line granularity, and `text_normalised` +
`content_hash` (rule 37), which is what `anchoring/zoom.spec` and `anchoring/reparse.spec` need.
An `inline_equation` block goes finer — one span per glyph run — because
`anchoring/targets.spec` has to resolve an anchor at *part of* an equation.

**Images.** `ImageRef.uri` must carry an explicit non-inline scheme, so a bare path is rejected by
the schema. These fixtures use:

```
fixture://<slug>/<path>   ->   packages/document-ir/fixtures/assets/<slug>/<path>
```

Every page is rendered at 2×, and every `figure` / `equation` / `inline_equation` crop at 3–8×.
**A crop is exactly the block's own region** — no padding — so a consumer can map crop pixels back
to points with `image.scale` alone. That also means an inline-equation crop legitimately contains
slivers of the lines above and below it: a radical or a subscript overlaps its neighbours' boxes,
and the region is the truth.

**`status`.** Every fixture here satisfies the *obligations* of `complete`: every declared
`equation` / `inline_equation` / `figure` has its crop rendered (rule 36) and no confidence is null
(rule 13b). The declared status differs by fixture and the difference is deliberate, because
`PaperStatus` is genuinely ambiguous for a page-range slice and Epic 2 should see both states
(`F2.8` has to render a partial document):

| fixture                              | `status`   | reading                                                                                                                                    |
| ------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `attention-is-all-you-need.paperir.json` | `complete` | `complete` describes the *parse* of the pages the document declares; the range is a property of the fixture, not of the parse.              |
| `resnet-cvpr-2col.paperir.json`      | `complete` | same reading, and every crop is rendered, so rule 36 and rule 13b are both satisfied rather than sidestepped.                               |
| `neural-odes-mathheavy.paperir.json` | `partial`  | `Paper.pages` *is* the whole of the document's page list, so a 3-of-18 slice is a partial parse and `partial_reason` says exactly which pages. |

Neither reading is wrong and neither costs a consumer anything: a reader that branches on `status`
gets both branches exercised, and a reader that does not is unaffected.

**Flow counts** in the per-fixture tables below count `Block.flow` — that is, every block including
the nested ones. `Page.flows.<name>` is always shorter, because a nested block (a `table_cell`, a
`table_row`, an `inline_equation`) carries its parent's flow but is deliberately absent from the
page's ordered flow list (D14 / rule 42). Both numbers are given where they differ.

## Three places the fixtures deliberately disagree with each other

PaperIR leaves each of these genuinely open, so rather than pick one and hide the choice, the
fixture set exercises both readings. **A reader that hard-codes one of them will break on the
other, and that is the point.**

| Question                                        | `attention`                                    | `resnet`                                | `neural-odes`                                    |
| ----------------------------------------------- | ---------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| Is a page-range slice `complete` or `partial`?   | `complete` (describes the *parse*)             | `complete`                              | `partial`, with a `partial_reason` naming the range |
| Does front matter belong to a `Section`?         | the `Abstract` heading **opens** a level-1 section | front matter (title, authors, affiliation) is in **no** section; `Abstract` opens one | front matter *including* the abstract is in **no** section |
| Is a display equation's `(n)` tag part of its `text`? | yes (`…)V\n(1)`)                          | yes (`…+ x.\n(1)`)                      | **no** — `text` is the formula only, and `payload.equation_number` carries the number |

In all three cases the *region* (polygon, bbox, crop) includes the equation number, and
`payload.equation_number` is populated everywhere. Only `text` differs.

**Confidence** follows DESIGN.md §10's normative table rather than a flat 0.99: `1.0` for text read
verbatim from a born-digital text layer whose type was hand-assigned after looking at the page,
`0.98` where a region was assembled from more than one source run by hand, `0.3` for an
unclassifiable vector region. `page.confidence` is the mean over the page's blocks;
`confidence.overall` is the mean over all blocks.

**`paper_id` and `page_id` are derived from the PDF's `source_hash`**, not minted from a clock, so
rebuilding a fixture produces the same bytes instead of a diff (DESIGN.md §7.1).

---

## `attention-is-all-you-need.paperir.json`

**Attention Is All You Need** (Vaswani et al., NeurIPS 2017), `arXiv:1706.03762v7`.
**Pages 0–3 of 15.** Single-column NeurIPS style, 612×792, rotation 0, CropBox == MediaBox.

**Why 0–3.** It is the shortest prefix that clears the F0.7 bar and is still small enough for every
polygon to be looked at. It carries: the front matter; three levels of section hierarchy
(`3` → `3.2` → `3.2.1`); **both figures, which are RASTER** — the deliberate contrast with ResNet's
all-vector figures, so between the two fixtures a reader must handle both; each figure's caption
with a `caption_of` relation; display equation (1); an inline equation located inside a paragraph
by a role-tagged span; footnotes; page numbers; a rotated margin stamp; and four unclassifiable
vector regions emitted as `unknown` with geometry intact.

### Contents

57 blocks over 4 pages, 34 relations, 8 sections.

| Type              |  n  | Notes                                                                          |
| ----------------- | :-: | ------------------------------------------------------------------------------ |
| `paragraph`       | 20  |                                                                                |
| `author`          |  8  | four-column author grid on p0; reading order is row-major                       |
| `heading`         |  8  | `Abstract`, `1`, `2`, `3`, `3.1`, `3.2`, `3.2.1`, `3.2.2`                       |
| `unknown`         |  4  | the two rules around the title, and the two footnote separators                 |
| `footnote`        |  4  | `∗`, `†`, `‡` on p0; footnote 4 on p3                                          |
| `page_number`     |  3  | p1–p3 footers                                                                   |
| `figure`          |  2  | **Figure 1** (p2, one raster) and **Figure 2** (p3, two rasters + two panels)   |
| `caption`         |  2  | both linked by `caption_of`                                                     |
| `title`           |  1  |                                                                                |
| `abstract`        |  1  |                                                                                |
| `footer`          |  1  | the NIPS 2017 conference line                                                   |
| `margin_note`     |  1  | the **rotated** arXiv stamp down the left edge of p0                            |
| `equation`        |  1  | equation (1), scaled dot-product attention                                      |
| `inline_equation` |  1  | `√dₖ`, **nested** inside a paragraph                                            |

Flows (`Block.flow`): `body` 44 · `footnote` 6 · `footer` 4 · `caption` 2 · `margin` 1 ·
`header` 0. The one nested block (the inline equation) is absent from `Page.flows`, so
`Page.flows.body` is 43.
Relations: `parent_of` 30 · `caption_of` 2 · `continues_on_next_page` 1 · `footnote_of` 1.
Sources: `pdf_text_layer` 51 · `pdf_vector` 4 · `pdf_raster` 2.
Sections, in order: `Abstract` (L1, 1 block) · `1 Introduction` (L1, 4) · `2 Background` (L1, 4) ·
`3 Model Architecture` (L1, 6) · `3.1 Encoder and Decoder Stacks` (L2, 2) · `3.2 Attention` (L2, 6) ·
`3.2.1 Scaled Dot-Product Attention` (L3, 5) · `3.2.2 Multi-Head Attention` (L3, 1).

### The things a reader is most likely to get wrong, and what this fixture asserts

- **Reading order.** `doc_order` runs 0–42 over the body flow, dense and continuous across all four
  pages. On p0 that is: licence notice → rule → title → rule → the eight authors **row-major, left
  to right** → `Abstract` → the abstract. Floats sit where they sit on the page: Figure 2 is
  `doc_order` 33 and the paragraph it interrupts resumes at 34.
- **A paragraph broken across a page.** "An attention function can be described as…" ends p2 and
  resumes on p3 with "of the values, where the weight assigned…". They are two blocks with two
  polygons, joined by a **`continues_on_next_page`** relation (D18's cross-page half). Do not merge
  them; do not render half a sentence.
- **A nested block.** The inline equation `√dₖ` has a `paragraph` parent, so it has **no
  `doc_order`** and does **not** appear in `page.flows.body` (D14 / rule 42). It is still fully
  addressable, and its parent locates it at characters 36–39 of the paragraph's third line via a
  span carrying `role: "inline_equation"` and `block_id`. That span is what makes "highlight part
  of an equation" resolvable (`anchoring/targets.spec`).
- **`unknown` carries geometry.** The four vector rules have polygons, `source: "pdf_vector"`,
  `confidence: 0.3` and no `text`. They are exactly as expressible as the title block. A reader
  must draw nothing for them and must not crash on them.
- **Section hierarchy is a tree, not a page list.** `sections[]` gives the outline; `parent_of`
  relations and `parent_id`/`child_ids` agree with it (rule 19). `3.2 Attention` is level 2 with
  `parent_heading_block_id` = `3 Model Architecture`; `3.2.1` is level 3.
- **Rotated text.** The arXiv stamp's polygon is a tall, narrow box down the left margin. Its text
  reads horizontally in the fixture and vertically on the page.
- **Metadata is cited, not invented.** Every `Metadata` scalar names the block it came from and is
  a substring of that block's normalised text (rule 6b). `arxiv_id` comes from the margin stamp;
  `venue` and `year` from the conference footer.

### Known limitations, stated so nobody discovers them as bugs

1. **It is a 4-page slice.** `pages[]` is `0..3` and `references[]` is empty — the bibliography is
   on pages 10+. Anything needing a `reference_entry` or a `cites` relation needs a different
   fixture or a wider range.
2. **No table.** Table 1 is on page 5. The `table` / `table_row` / `table_cell` nesting rules of
   D14 are exercised by a different fixture (DESIGN.md §10 requires at least one).
3. **`text` is un-dehyphenated** (see Conventions). A Guided view that re-flows this prose must
   handle `-\n` itself, or a future generation must add `dehyphenate` repairs.
4. **Equation and inline-equation `latex` was hand-transcribed** from the crop and carries
   `latex_confidence`. It is a *declared interpretation*, exactly as ADR-001 intends; the crop is
   the ground truth. It is not model output and no `Derivation` exists for this paper.
5. **The two labels inside Figure 2** ("Scaled Dot-Product Attention", "Multi-Head Attention") are
   `detected_labels` on the figure payload, not blocks. That is deliberate — promoting diagram
   interior text into the reading order is `findings.md` B6 — but it means their text is not in
   `page.block_ids` and is not highlightable as a block.
6. **Hairline vector rules inside equations and text lines are not emitted.** Only the four
   *standalone* rules are. A fraction bar belongs to its equation's region, not to a block of its
   own; emitting each would have added noise no reader can use.
7. **The `Abstract` heading opens a level-1 section.** DESIGN.md §4 says front matter is
   section-less; that is read here as "everything *before the first heading*" — the licence notice,
   the title and the eight author blocks — with the `Abstract` heading itself opening the first
   section, so that the Navigator's outline has an Abstract entry and no `heading` block is left
   heading nothing.
8. **`\n` in `text` means "new *run*", and for inline math that is not the same as "new printed
   line".** Where a paragraph contains a stacked inline fraction, the numerator, the denominator and
   the prose on either side are three runs at three vertical offsets, and the joiner puts a `\n`
   between them even though the page prints them on one line. Three blocks are affected:
   `blk_noeb6lt5tiuyqfyx` (`… scaling factor\nof\n1\n√dk . Additive …`), `blk_gwc2xsv7t6wxonxe`
   (`… dot products by\n1\n√dk .`) and footnote `blk_zwfkmgyhsfuppqoo` (`… q · k = Pdk\ni=1 qiki …`),
   plus the display equation `blk_cjj3c7fwhp2ce7lz`, where it is expected and `payload.latex` is the
   authoritative reading. **A reader must not treat `\n` in `text` as a hard line break.** Line
   geometry lives in `spans[].bbox`, which is correct in all four cases; `text_normalised` collapses
   the newline and is unaffected, so anchoring and search are unaffected. Same-*baseline* runs — the
   bold run-in leads `Encoder:` / `Decoder:` and every numbered heading — **are** joined with a real
   space span and do not have this problem. (That last clause is true only since the F0.7 review:
   the two run-in leads were the MATERIAL defect fixed above.)
9. **`parser.config_hash` is not a change detector.** It is the SHA-256 of the `parser.profile`
   *string* (`build_fixture.py`, `config_hash =` line), not a digest of the build plan, so editing
   a `BlockPlan` and rebuilding leaves it identical. It is deterministic and honest about the
   profile it names; nobody should read it as "the inputs that produced these bytes". This applies
   to all three fixtures.

### Rebuilding

```
cd "/Volumes/Mrigesh SSD/PaperTree"
uv run --python 3.12 --with pymupdf python packages/document-ir/tools/build_fixture.py \
    --paper attention-is-all-you-need
```

The corpus PDF is gitignored, so this needs `research/benchmarks/corpus/` populated. The tool is
**scaffolding, not the parser** — read its module docstring before borrowing anything from it.

---

## `resnet-cvpr-2col.paperir.json`

**Deep Residual Learning for Image Recognition** (He, Zhang, Ren, Sun), `arXiv:1512.03385v1`.
**Pages 0–2 of 12.** Two-column CVPR style, 612×792, rotation 0, CropBox == MediaBox.

**Why this paper matters most.** `findings.md` §H2 records the live v1 path finding **zero figures**
in this paper while **every figure in it is vector** — 0 embedded rasters on any page. Getting a
vector figure into a fixture, with its region right and its caption linked, is the exact capability
the rewrite exists to restore. This fixture carries **both** of the paper's early vector figures.

**Why 0–2.** The shortest prefix that clears the F0.7 bar and is still small enough for every
polygon to be looked at. It carries: the front matter; two levels of numbered section hierarchy
(`3` → `3.1` / `3.2` / `3.3`) plus `Abstract`, `1`, `2` at level 1; **both vector figures** with
their captions and their in-figure labels; **both** residual-mapping display equations (1) and (2);
an inline equation located inside a paragraph by a role-tagged span; a two-column reading order
interrupted by a float; two column continuations and two page continuations; footnotes; page
numbers; the rotated arXiv margin stamp; and two unclassifiable vector rules.
Page 3 was deliberately left out: it is one ~100-label network diagram whose labels would double the
fixture's size without exercising anything these three pages do not.

### Contents

61 blocks over 3 pages, 53 relations, 7 sections.

| Type              |  n  | Notes                                                                         |
| ----------------- | :-: | ----------------------------------------------------------------------------- |
| `paragraph`       | 31  |                                                                               |
| `heading`         |  7  | `Abstract`, `1`, `2`, `3`, `3.1`, `3.2`, `3.3`                                 |
| `author`          |  4  | four names sharing one baseline, emitted left to right                         |
| `page_number`     |  3  | p0–p2 footers                                                                  |
| `abstract`        |  2  | the abstract is two italic paragraphs on this paper                            |
| `figure`          |  2  | **Figure 1** (p0, 58 drawing groups, 2 panels, 28 labels) and **Figure 2** (p1, 16 drawing groups, 9 labels) — **both `is_vector: true`, `source: "pdf_vector"`** |
| `caption`         |  2  | both linked by `caption_of`                                                    |
| `equation`        |  2  | equations (1) and (2), the residual formulation                                |
| `footnote`        |  2  | the ILSVRC/COCO URL note on p0, the open-question note on p2                   |
| `unknown`         |  2  | the two footnote separator rules                                               |
| `title`           |  1  |                                                                               |
| `affiliation`     |  1  | "Microsoft Research" + the contact line, one staircase polygon                 |
| `margin_note`     |  1  | the **rotated** arXiv stamp down the left edge of p0                           |
| `inline_equation` |  1  | `y = W₁x + x`, **nested** inside a paragraph                                   |

Flows (`Block.flow`): `body` 51 · `footnote` 4 · `footer` 3 · `caption` 2 · `margin` 1 ·
`header` 0. The one nested block (the inline equation) is absent from `Page.flows`, so
`Page.flows.body` is 50.
Relations: `parent_of` 45 · `caption_of` 2 · `continues_in_next_column` 2 ·
`continues_on_next_page` 2 · `footnote_of` 2.
Sources: `pdf_text_layer` 57 · `pdf_vector` 4 — **zero rasters**, which is the whole point of this
fixture.
Sections, in order: `Abstract` (L1, 3 blocks) · `1. Introduction` (L1, 16) · `2. Related Work`
(L1, 5) · `3. Deep Residual Learning` (L1, 3) · `3.1. Residual Learning` (L2, 4) ·
`3.2. Identity Mapping by Shortcuts` (L2, 10) · `3.3. Network Architectures` (L2, 3).

### The things a reader is most likely to get wrong, and what this fixture asserts

- **Two-column reading order.** `doc_order` runs 0–49 over the body flow, dense and continuous
  across all three pages, and it is **left column top-to-bottom, then right column** — not visual
  y-order. On p0: title → four authors → affiliation → `Abstract` → both abstract paragraphs →
  `1. Introduction` → the first intro paragraph (`doc_order` 10) → **Figure 1** (11, top of the
  right column) → the paragraph the figure interrupted (12) → three more. Getting this wrong is the
  single most visible way a reader breaks on this paper.
- **A paragraph broken by a float, on the same page.** "…tasks [8, 12, 7, 32, 27] have also" ends
  the left column of p0 and resumes at the top of the right column, *below* Figure 1, with "greatly
  benefited from very deep models." They are two blocks with **two polygons and disjoint
  x-extents**, joined by **`continues_in_next_column`** — the relation D18 exists for. There is a
  second instance on p2 ("…in which σ denotes" → "ReLU [29] and the biases…"). Merging them would
  force one polygon across the gutter, which is the highlight-bleed Commitment 2 forbids.
- **Two page continuations.** p0→p1 mid-sentence, and p1→p2 **mid-word**: p1 ends "In addition,
  high-" and p2 opens "way networks have not demonstrated…". `continues_on_next_page`, not a merge.
- **Vector figures.** Figure 1's region is the union of 58 drawing groups (the two loss curves,
  their axes and ticks); Figure 2's is 16 drawing groups **unioned with its label boxes**, because
  the arrows stop short of the "F(x)", "x" and "identity" labels. Both crops were rendered and
  looked at: they contain the whole figure and nothing of the caption. Interior text —
  axis titles, tick values, series keys, the block labels — is `payload.detected_labels`
  (28 and 9 entries) **with polygons**, not blocks, so it never enters the reading order.
- **A nested block.** The inline equation has a `paragraph` parent, so it has **no `doc_order`** and
  does **not** appear in `page.flows.body` (D14 / rule 42). Its parent locates it at characters
  240–251 via a span carrying `role: "inline_equation"` and `block_id` — the span that makes
  "highlight part of an equation" resolvable.
- **`unknown` carries geometry.** The two footnote rules have polygons, `source: "pdf_vector"`,
  `confidence: 0.3` and no `text`. A reader must draw nothing for them and must not crash on them.
- **Metadata is cited, not invented.** `arxiv_id` (`1512.03385`) and `year` (`2015`) both come from
  the **arXiv margin stamp** — the only place on these pages either fact is printed — and each is a
  substring of that block's normalised text (rule 6b). `venue` and `doi` are `null`: this is the
  preprint, neither is printed, and a value from anywhere else is not a PaperIR fact.

### Known limitations, stated so nobody discovers them as bugs

1. **It is a 3-page slice.** `pages[]` is `0..2` and `references[]` is empty — the bibliography is
   on pages 9+. Anything needing a `reference_entry` or a `cites` relation needs a wider range.
2. **No table.** ResNet's Table 1 is on page 4; the D14 `table` / `table_row` / `table_cell` nesting
   rules are exercised by another fixture.
3. **`text` is un-dehyphenated** (see Conventions). This paper hyphenates heavily: 61 line-break
   hyphens over these three pages, of which 5 are **lexical** (`low/mid/high-level`, `multi-layer`,
   `non-trivial`, `152-layer`, `34-layer`) and would have to survive any future `dehyphenate` pass.
   Two were settled from the paper's own usage elsewhere (`multi-layer` appears unbroken on p1;
   the authors write `non-vision` and `non-residual` unbroken, so `non-trivial` is theirs too) —
   which is the kind of judgement a fixture should record rather than bury.
4. **Equation `latex` was hand-transcribed** from the crop and carries `latex_confidence: 0.95`. A
   *declared interpretation*, exactly as ADR-001 intends; the crop is the ground truth. Not model
   output, and no `Derivation` exists for this paper.
5. **The inline equation is `y = W₁x + x`, not the more iconic `F(x) := H(x) − x`.** The choice was
   made by looking at the rendered crop: MuPDF reports a `CMSY10` span's box as the **font's**
   bounding box rather than the glyph's, so any run containing the calligraphic ℱ or ℋ comes back
   ~7 pt taller than its line and its crop catches the top of the following line. This run is
   `CMBX10`/`CMR10`/`CMMI10`/`CMR7` only, so its polygon is the typographic line band. **Epic 1 must
   measure glyph extents, not span boxes, or every calligraphic inline equation will over-claim.**
6. **The display equations' regions include their right-aligned equation numbers,** and their `text`
   therefore ends `\n(1)` / `\n(2)`. `payload.equation_number` carries the number separately. The
   crops were looked at and contain exactly the equation and its number.
7. **`page.confidence` is 0.96 / 1.00 / 0.96, `needs_review: false`.** The two pages below 1.0 are
   the ones carrying an `unknown` rule and a figure whose extent was delimited by hand. Nothing here
   is a placeholder — see the Confidence convention above.
8. **`section.block_ids` for `3. Deep Residual Learning` contains its three subsection headings**
   and no prose, because §3 has no direct content. That follows the engine's rule that a section
   owns the blocks whose `parent_id` is its heading; a reader rendering a section's body list should
   expect heading blocks in it and defer to `sections[]` for the tree.
9. **Limitation 5 is not confined to the inline equation — it is in this fixture's `span.bbox`
   values too, and it was measured, not guessed.** Of ~280 line-granularity spans, **21 come back
   17.28–17.35 pt tall instead of ~9.96 pt** because the line contains a `CMSY10`/`CMMI10` run
   (ℱ, ℋ, σ) and MuPDF reports that run's box as the *font's*. The inflation is almost entirely
   **downward** (measured against the 11.96 pt line pitch: ≤0.2 pt up, ~7.2 pt down), which is why
   **block** polygons are unaffected at the top and were confirmed snug against the printed text at
   6× — but it produces **18 places where one line's span box overlaps the next line's by ~5.2 pt**,
   and it is the sole reason for the **one and only pair of overlapping block bboxes in the
   document**: `blk_ysenwp4ipt7lzwhd` (the p2 paragraph ending "…in which σ denotes") reaches
   `y1 = 701.8` and so encloses the 0.4 pt footnote rule `blk_27vi3aotpyhnc5y4` at 701.12–701.52.
   No text is swallowed (all 2,398 printed words on pages 0–2 fall inside exactly one block).
   **A reader must not paint highlight quads straight from `span.bbox`** on these lines; clamp to
   the typographic line band. The values are left as the extractor reports them rather than
   re-measured from glyph ink, because inventing tighter geometry in a hand-checked fixture is worse
   than declaring the imprecision, and the other two fixtures share the convention.
10. **Figure 1's two `payload.panels` polygons overlap by ~9.9 pt in x** (308.86–434.70 and
    424.80–545.11). They are hand-drawn panel hints for a two-plot float, not a segmentation; the
    `figure` region itself and both crops are exact.
11. **The front matter belongs to no section.** `title`, the four `author` blocks and `affiliation`
    (6 of the 50 body blocks) appear in no `section.block_ids`, because nothing precedes `Abstract`.
    An outline built from `sections[]` is complete; a reader that reconstructs the document by
    concatenating sections would drop the front matter.

### Rebuilding

```
cd "/Volumes/Mrigesh SSD/PaperTree"
uv run --python 3.12 --with pymupdf python packages/document-ir/tools/build_fixture.py \
    --paper resnet-cvpr-2col
```

---

## `neural-odes-mathheavy.paperir.json`

**Neural Ordinary Differential Equations** (Chen, Rubanova, Bettencourt, Duvenaud; NeurIPS 2018),
`arXiv:1806.07366v5`. **Pages 0–2 of 18.** NeurIPS style, 612×792, rotation 0, CropBox == MediaBox.

**Why 0–2.** This is the math-heavy fixture, so what it has to prove is that the `equation` block
type carries real content — and pages 0–2 are the shortest prefix that does. They also happen to be
the densest three pages in the whole corpus: front matter and abstract, three section headings,
**five numbered display equations (1)–(5)**, **three role-tagged inline equations** nested inside
their paragraphs, **both figures with `caption_of`-linked captions**, **a real table with 5 rows and
24 nested cells**, an `algorithm` listing, a paragraph that continues across the page break, two
unclassifiable vector rules, a footnote, page numbers and a rotated arXiv margin stamp. Page 3 would
add a fourth section and a fourth figure and nothing structurally new, at the cost of a third more
geometry to check by eye. Three pages that are right beat twelve that are approximately right.

**This is the fixture with the two-column bands.** Pages 0 and 1 are *not* single-column: each has a
two-column band in the middle of an otherwise full-measure page, and the two pages put the float on
*opposite sides*. On page 0 the left column carries the prose and equations (1) and (2) while
Figure 1 floats right; on page 1 Figure 2 floats **left** while the prose and equations (4) and (5)
run down the right. If a reader's reading order or its highlight geometry is wrong, this is the
fixture that shows it.

### Contents

81 blocks over 3 pages, 71 relations, 3 sections, 259 spans.

| Type              |  n  | Notes                                                                                     |
| ----------------- | :-: | ----------------------------------------------------------------------------------------- |
| `table_cell`      | 24  | **nested** inside `table_row`, which is nested inside `table` (D14)                         |
| `paragraph`       | 23  |                                                                                            |
| `equation`        |  5  | display equations (1)–(5), each with `equation_number` and a 6× crop                       |
| `table_row`       |  5  | header row + four data rows of Table 1                                                     |
| `heading`         |  4  | `Abstract`, `1 Introduction`, `2 Reverse-mode…`, `3 Replacing residual networks…`           |
| `caption`         |  3  | Figure 1, Figure 2, Table 1 — all three linked by `caption_of`                              |
| `inline_equation` |  3  | `z(t)`, `∂L/∂z(t)`, `∂L/∂z(t₀)` — **nested**, each located by a role-tagged span            |
| `figure`          |  2  | **Figure 1** (p0, all-vector two-panel plot) and **Figure 2** (p1, vector diagram)          |
| `page_number`     |  2  | p1 and p2 footers                                                                           |
| `unknown`         |  2  | the two decorative rules around the title, with geometry intact and no text                 |
| `table`           |  1  | Table 1, MNIST results, with a 5×5 `grid` whose cells point at the `table_cell` blocks       |
| `algorithm`       |  1  | Algorithm 1, reassembled from the seven MuPDF runs LaTeX shredded it into                   |
| `title` `author` `affiliation` `abstract` | 1 each | front matter                                                            |
| `footnote`        |  1  | the NeurIPS 2018 conference line                                                            |
| `annotation`      |  1  | the **rotated** arXiv stamp down the left edge of p0                                        |

Flows (`Block.flow`): `body` 74 · `caption` 3 · `footer` 2 · `footnote` 1 · `margin` 1 · `header` 0.
32 of those 74 body blocks are **nested** — 24 cells, 5 rows, 3 inline equations — and therefore
carry no `doc_order` and appear in no `Page.flows` list (D14 / rule 42), while remaining fully
addressable; `Page.flows.body` is 42 across the three pages.
Relations: `parent_of` 67 · `caption_of` 3 · `continues_on_next_page` 1.
Sources: `pdf_text_layer` 77 · `pdf_vector` 4.

### The things a reader is most likely to get wrong, and what this fixture asserts

- **Reading order across a two-column band, in both directions.** `doc_order` runs 0–41, dense over
  the body flow. Page 0: `unknown` rule → title → `unknown` rule → authors → affiliation →
  `Abstract` → abstract → `1 Introduction` → **the whole left column** (paragraph, eq (1),
  paragraph, paragraph, eq (2)) → **then the right column** (Figure 1) → the full-measure paragraphs
  underneath. Page 1 mirrors it: eq (3) full measure → **Figure 2 in the left column** → the right
  column (paragraph, eq (4), paragraph, paragraph, eq (5)) → the full-measure paragraph at the foot.
  A reader that sorts blocks by `y` and then `x` gets both pages wrong.
- **Polygons follow the lines, and do not enter the gutter.** Every multi-line PROSE block gets its
  polygon from `union_of_line_rects`, which steps wherever the lines differ in width (equations,
  table rows and the algorithm frame are typeset boxes and are rectangles on purpose — see
  "Geometry" above). `p2-para-22` ("Model Architectures…") is the sharp case: it is a
  narrow left column for nine lines and then wraps to the full measure *underneath* Table 1, so its
  polygon is **L-shaped**. A bounding box there would paint straight through the table.
- **A display equation's number is part of its region, not of its text.** Each of (1)–(5) has a
  polygon spanning the formula *and* the `(n)` tag flush right — that is what a person means by
  "equation (4)" — while `text` holds only the formula and the number is recorded once, in
  `payload.equation_number`.
- **A paragraph broken across a page.** `…All integrals for solving z, a` ends page 1 and resumes on
  page 2 with `and ∂L/∂θ can be computed in a single call…`. Two blocks, two polygons, joined by
  **`continues_on_next_page`** (D18's cross-page half). Do not merge them; do not read half a
  sentence aloud.
- **A real table, nested two levels deep.** `table` → 5 × `table_row` → 24 × `table_cell`. Every
  cell is an addressable, highlightable block with its own geometry and text, which is what
  `anchoring/targets.spec` needs for "a table cell". `payload.grid` has `rows: 5, cols: 5` and each
  entry carries `cell_id` and the same polygon as the block it names (rule 32). **There is no cell
  for `(0, 0)`** — the corner of the header row is genuinely empty on the page, and inventing an
  empty cell there would have been inventing content.
- **Three inline equations, each located by a span.** Each has a `paragraph` parent, so no
  `doc_order` and no place in `page.flows` — and each parent carries a span with
  `role: "inline_equation"` and `block_id` over exactly its characters. `∂L/∂z(t)` is the paper's
  central definition (the adjoint), so an anchor at *part of* an equation has something worth
  pointing at.
- **`unknown` carries geometry.** The two rules bracketing the title have polygons,
  `source: "pdf_vector"`, `confidence: 0.3` and no `text`. The lower one is a stroked hairline that
  MuPDF reports with zero height; it is inflated by its 0.996 pt stroke width, because a zero-area
  polygon is a rule G6 error and the ink really is that wide.
- **The algorithm is one block, not seven.** LaTeX typesets every fraction in Algorithm 1 as its own
  text run, so MuPDF returns the listing as seven interleaved blocks. The fixture reassembles it in
  reading order into a single `algorithm` block whose polygon is the ruled frame. Its title line
  stays *inside* the block rather than becoming a `caption`: rule 22 restricts `caption_of` to
  `figure` / `table` / `diagram` / `plot`, and an algorithm is none of those.
- **Metadata is cited, not invented.** `title` from the title block, all four `authors` from the
  author line, `arxiv_id` from the margin stamp, `venue` and `year` from the conference footnote —
  each a substring of its cited block's normalised text (rule 6b).

### Known limitations, stated so nobody discovers them as bugs

1. **It is a 3-of-18-page slice**, and it says so: `status` is `"partial"` and `partial_reason`
   names the range. `references[]` is empty because the bibliography is on page 13.
2. **No `cites` relations and no `reference_entry` blocks**, for the same reason: rule 23 requires a
   `cites` edge to land on a `reference_entry`, and there is none in range to land on. The inline
   citations ("(Lu et al., 2017)") are therefore ordinary text inside their paragraphs.
3. **`sections[]` is flat — three level-1 sections.** Pages 0–2 contain no numbered subsection, so
   `Section.parent_heading_block_id` is unexercised *by this fixture*; the Attention fixture covers
   three levels. The bold run-in labels ("Memory efficiency", "Software", "Model Architectures") are
   lead-ins **inside** a paragraph, not headings, and are not promoted into the outline.
4. **No `continues_in_next_column` relation.** No paragraph on these pages actually runs from the
   foot of one column into the head of the next — the columns hold different material — and
   inventing one to exercise rule 24b would be a lie about the page.
5. **Front matter belongs to no section.** Title, authors, affiliation, the `Abstract` heading and
   the abstract have no `parent_id` and appear in no `Section`, per DESIGN.md §4 ("front matter …
   belongs to no `Section`"), so `get_parent_section` returns null for them. *This differs from the
   Attention fixture*, which opens a section at `Abstract`; §4 is ambiguous and both readings are
   recorded here rather than silently diverging.
6. **The five DISPLAY equations carry no `latex`.** Deliberate, and the one place this fixture is
   poorer than Attention on purpose. A hand-written LaTeX rendering of a two-dimensional formula —
   a nested fraction under an integral with a superscript transpose — is an *interpretation*, and
   `EquationPayload.latex` has no authorship channel in PaperIR (DESIGN.md §11.4 leans on `image`
   being the ground truth instead). Epic 1's F1.7 VLM step owns it. What each display equation does
   carry is verbatim glyph `text`, per-run `spans`, `equation_number`, and the 6× crop ADR-001 calls
   the ground truth. The three **inline** equations *do* carry `latex` with a `latex_confidence`:
   each is a handful of symbols that can be checked against its crop at a glance.
7. **Equation (3) is missing two glyphs from its `text`.** MuPDF returns the two large `CMEX10`
   delimiters as the control characters U+0012 and U+0013. They are real ink, so they are part of
   the block's *region*, and they are deliberately absent from its *text* rather than being
   transliterated into `(` and `)`, which would be an invented character.
8. **Figure interiors are not blocks.** Figure 1's axis tick labels and panel titles ("Residual
   Network", "ODE Network"), and Figure 2's "State" / "Adjoint State" legend, sit inside the figure
   region and are not emitted separately — promoting diagram interior text into the reading order is
   `findings.md` B6. They are therefore not individually highlightable.
9. **Table rows and cells are clamped to their own ink, not to MuPDF's line box.** The Memory and
   Time columns of rows 2–4 are set in CMSY/CMR, whose font descent runs ~5.7 pt below the ink of
   `O(L)`. Taken raw, MuPDF's line box for those runs reached into the row below: row 2's polygon
   enclosed row 3's tilde accents, and row 2's Memory cell enclosed part of row 3's — a polygon
   that lies about which region it covers. Verification (F0.7 review) caught this by intersecting
   every polygon with the page's `rawdict` character boxes; the plan now carries a `clip_y` bound
   per row, read off the lowest glyph box actually in that row (595.17 / 605.13 / 615.08). What
   remains is a **0.03 pt** touch between consecutive rows, which is real ink: the tilde of
   `O(L̃)` genuinely rises a hair above the closing paren of the row above.
10. **`text` is un-dehyphenated** (see Conventions) — `differen-\ntial` stays that way.
11. **Figure 2's polygon over-claims ~9.5 pt of blank gutter on its right,** and a little padding
    top and bottom: the block's `x1` is 315.5 while the figure's actual ink (vector drawings plus
    18 embedded label bitmaps) ends at x = 306.0, and it pads 425.0/573.0 against ink at
    431.5/570.15. Nothing is swallowed — the strip is measurably blank (4 non-white pixels in
    23,680 at 4×, zero drawings intersecting it) and the right column does not begin until x = 316.0
    — but the region is a **hand-delimited float extent, not a measured one**, which is why the
    block carries `confidence: 0.95` rather than 1.0. Left as it is: tightening a float to its ink
    is a different judgement, not a more correct one.
12. **The two `unknown` rules bracketing the title are IN the body flow,** at `doc_order` 0 and 2 —
    so a reader walking the body flow emits two text-less blocks around the title. Deliberate:
    `unknown` must retain geometry, and calling a title rule a `header` or `footer` would be a
    worse lie than calling it nothing. A reader must skip text-less blocks, not assume they are
    absent.
13. **Figure 1 has no `payload.panels` and no `detected_labels`,** even though its caption says
    "Left:/Right:" and it is visibly a two-panel figure. Panel hints are exercised by the `resnet`
    and `attention` fixtures instead.

### Rebuilding

```
cd "/Volumes/Mrigesh SSD/PaperTree"
uv run --python 3.12 --with pymupdf python packages/document-ir/tools/build_fixture.py \
    --paper neural-odes-mathheavy --overlay /tmp/overlays
```

`--overlay` writes one PNG per covered page with every polygon drawn and labelled
`type#order dDOC_ORDER`. That render is the only check that catches a polygon which is valid but
around the wrong paragraph, and it is how this fixture was checked. The corpus PDF is gitignored, so
this needs `research/benchmarks/corpus/` populated (`research/benchmarks/fetch_corpus.sh`).

---

## What these fixtures do NOT cover (read this before you plan Epic 2)

Stated flatly, because the cost of discovering it in week three is a rewrite. **Ten pages of 45.**

### Absent from all three fixtures

- **`references[]` is empty, everywhere.** Every bibliography is outside every page range (ResNet
  p9+, Attention p10+, Neural ODEs p13). There is **no `reference_entry` block and no `cites`
  relation in the fixture set at all.** Inline citations (`[8, 12]`, `(Lu et al., 2017)`) are
  ordinary characters inside their paragraph's `text`. Anything Epic 2 builds for citation
  navigation has no test data here and must not be assumed to work.
- **No `header` flow.** All three papers have no running head on their opening pages, so
  `Page.flows.header` is empty on all 10 pages. A reader's header handling is untested.
- **No OCR, no scanned page.** `has_text_layer` is true and `is_scanned` false on every page;
  `source` is only ever `pdf_text_layer`, `pdf_vector` or `pdf_raster`. Nothing exercises the
  `ocr` provenance path.
- **No `Repair`, no `Alternative`, no `Derivation`, no model authorship anywhere.** The repair /
  alternative machinery (D4, rule 30b) and the "an LLM may not write into a source field" path get
  no positive input from these files — only the absence. In particular `text` is **never
  de-hyphenated**: `transduc-\ntion`, `differen-\ntial`, and 61 line-break hyphens in `resnet`
  alone (5 of them lexical and listed there) survive verbatim. A reflow view must handle `-\n`.
- **No diagnostics.** All three fixtures produce zero `validatePaper` diagnostics at every
  severity, so a reader's warning/error rendering path gets nothing to render.
- **These block types appear nowhere:** `list`, `list_item`, `code`, `citation`, `reference_entry`,
  `header`, `diagram`, `plot`. (`footer` appears once, in `attention`.)
- **These relation types appear nowhere:** `next_in_reading_order`, `cites`, and every
  table-specific relation beyond `parent_of`. The full set present is `parent_of`, `caption_of`,
  `continues_in_next_column`, `continues_on_next_page`, `footnote_of` — five of them.
- **Figure interiors are not addressable.** Axis labels, panel titles and legend text live inside
  the figure region and are, at most, `payload.detected_labels` — never blocks. "Highlight the
  words inside a diagram" has no test case in this set (`findings.md` B6, deliberate).
- **Rotated text is geometry only.** The arXiv margin stamp's polygon is a tall narrow box and its
  `text` reads horizontally; no field records that the glyphs are rotated 90°. A reader must infer
  it from the aspect ratio.

### Present exactly once — do not assume redundancy

- **One table**, in `neural-odes`: 1 `table`, 5 `table_row`, 24 `table_cell`, one `payload.grid`
  with `rows: 5, cols: 5` and no cell at `(0,0)` (the corner is genuinely blank on the page). If
  that fixture is wrong about tables, the fixture set is wrong about tables. Nothing anchors to a
  table row or cell in the other two.
- **One `algorithm` block**, in `neural-odes`.
- **One `status: "partial"` document**, in `neural-odes`.
- **`continues_in_next_column` exists only in `resnet`** — the only genuinely two-column layout in
  the set. `neural-odes`' "columns" are text beside a wrapped float, not a column stream.
- **`latex` on a display equation exists only in `resnet` (×2) and `attention` (×1),** is
  hand-transcribed, and carries `latex_confidence: 0.95`. It is a *declared interpretation*; the
  rendered crop is the ground truth. `neural-odes`' five display equations carry none at all.

### Two geometry caveats a highlight renderer must know

1. **`span.bbox` is the extractor's line box, and 21 spans in `resnet` are ~7.2 pt too tall
   downward** because the line contains a CMSY10/CMMI10 run and MuPDF reports that run's box as the
   *font's*, not the glyphs'. That produces 18 places where one line's span box overlaps the next
   line's by ~5.2 pt. **Do not paint highlight quads straight from `span.bbox`;** clamp to the
   typographic line band. Block-level polygons were checked visually at 6× and are snug.
2. **One block bbox in `resnet` over-claims ~5 pt** from the same cause and geometrically encloses
   a 0.4 pt footnote separator rule (`blk_ysenwp4ipt7lzwhd` over `blk_27vi3aotpyhnc5y4`). It is the
   only non-parent/child bbox overlap in that document, and no text is swallowed: all 2,398 printed
   words on `resnet` pages 0–2 fall inside exactly one block.

### The honest summary

These fixtures are enough to build and test the **reader**: page rendering, block highlighting,
reading order, section navigation, figure and equation display with real crops, cross-page and
cross-column continuation, and anchoring down to part of an equation or a single table cell. They
are **not** enough to build citation navigation, a bibliography view, a repair/alternative UI, a
derivation view, an OCR path, or a scanned-document path. For those, Epic 2 needs either a wider
page range or Epic 1's real parser.

They were hand-verified against the rendered pages — all 10 of them — by the two passes described
at the top of this file, and they are re-verified mechanically on every test run by
`test/schema.spec.ts`, `python/tests/test_fixtures.py` and `.github/scripts/validate-fixtures.mjs`.
