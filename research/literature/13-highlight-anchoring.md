# 13 — Durable Text Anchoring and Annotation Standards

**Scope:** W3C Web Annotation Data Model & Selectors, Hypothesis client anchoring, Apache Annotator, PDF.js text layer + coordinate model, PDF QuadPoints, URL text fragments, approximate string matching
**Prepared for:** PaperTree parsing-stack replacement decision
**Date of research:** 2026-07-29. Most recent primary evidence: `hypothesis/client` pushed 2026-07-29 (anchoring dir last touched 2026-05-21); `mozilla/pdf.js` pushed 2026-07-29; `apache/incubator-annotator` **archived**, last push 2024-06-23; `approx-string-match` v2.0.0 published 2021-11-23.

---

## 0. Bottom line up front

1. **There is exactly one live, production-proven reference implementation of PDF text anchoring: the Hypothesis client.** Apache Annotator — the "neutral standard implementation" — is dead: retired from the Apache Incubator on **2025-08-11** ([incubator.apache.org/projects/annotator.html](https://incubator.apache.org/projects/annotator.html)) and the GitHub repo archived (verified via GitHub API: `archived: true`, last push `2024-06-23`, Apache-2.0). Do not build on it.
2. **Licences are clean and are not a constraint here.** Hypothesis client is **BSD-2-Clause** (verified: `package.json` `"license": "BSD-2-Clause"`, [LICENSE](https://github.com/hypothesis/client/blob/main/LICENSE)); PDF.js is **Apache-2.0**; `approx-string-match` is **MIT**. No AGPL, no non-commercial terms, no model weights involved anywhere in this topic. This is the one research area in the PaperTree stack with zero licence risk.
3. **No single selector is durable. The redundancy is the design.** The W3C model explicitly permits an array of alternative selectors, and Hypothesis's whole architecture is a cascade over them.
4. **Text-quote anchoring alone is empirically ~78% reliable over time on the open web** ([Aturban, Nelson & Weigle, arXiv:1512.06195](https://arxiv.org/abs/1512.06195)). PaperTree's situation is much better than that number — a PDF's bytes are immutable — but only if we anchor to something derived from the PDF, not from our parser.
5. **The single highest-leverage decision for PaperTree is to make block IDs content-derived rather than ordinal.** If `blockId = hash(pageIndex, normalized_text, quantized_bbox)`, then a new parser version that produces the same block produces the same ID for free, and requirement (c) mostly evaporates.

---

## 1. Comparison table

| System / standard | Status, most recent evidence | Code licence | Survives zoom / resize | Survives re-parse (new block IDs) | Works in reflowed mode | Carries geometry |
|---|---|---|---|---|---|---|
| **W3C Web Annotation Data Model** | W3C Recommendation, 23 Feb 2017; WG **closed** ([w3.org/annotation](https://www.w3.org/annotation/)) | Spec (W3C Document Licence) | n/a — data model | Depends on selector mix | Yes, if TextQuote used | Only via `FragmentSelector`/`SvgSelector` |
| **Hypothesis client anchoring** | Active; repo pushed 2026-07-29, `src/annotator/anchoring` commits to 2026-05-21; 176 open issues | **BSD-2-Clause** | Yes | Yes (quote-based) | Yes | Yes, via `ShapeSelector` (PDF user space) |
| **Apache Annotator** | **RETIRED 2025-08-11**; repo archived, last push 2024-06-23, 25 open issues | Apache-2.0 | — | — | — | No |
| **PDF.js text layer** | Active; pushed 2026-07-29, 418 open issues | Apache-2.0 | Yes — layer is percentage-positioned, zoom-invariant | n/a (independent of our parser) | n/a | Yes, via `PageViewport` |
| **PDF native annotations (QuadPoints)** | ISO 32000-1:2008 §12.5.6.10 | Spec | Yes | Yes (parser-independent) | **No** | Yes — PDF user space |
| **URL text fragments** | WICG Draft Community Group Report, 13 Dec 2023; *not* a W3C standard ([wicg.github.io/scroll-to-text-fragment](https://wicg.github.io/scroll-to-text-fragment/)) | Spec | Yes | Yes | Yes | No |
| **`approx-string-match`** | v2.0.0, published 2021-11-23; repo pushed 2026-04-08, 3 open issues | **MIT** | n/a | n/a | n/a | No |

---

## 2. W3C Web Annotation Data Model — what it actually mandates

Published as a **W3C Recommendation on 23 February 2017**, alongside the Web Annotation Vocabulary and Web Annotation Protocol; the Working Group is **closed** and no newer version supersedes them ([w3.org/annotation](https://www.w3.org/annotation/)). Errata now go through the Open Annotation Community Group. Treat this as a *stable but frozen* standard.

The selectors relevant to PaperTree ([w3.org/TR/annotation-model](https://www.w3.org/TR/annotation-model/)):

- **`TextQuoteSelector`** — required `exact`; optional `prefix`, `suffix`. The spec is explicit that selection is "in terms of unicode **code points** … not in terms of code units."
- **`TextPositionSelector`** — required `start` (inclusive, 0-based) and `end` (exclusive), also in code points after normalisation.
- **`RangeSelector`** — `startSelector` (inclusive) + `endSelector` (exclusive). In practice this wraps XPath/offset pairs.
- **`FragmentSelector`** — `value` (the IRI fragment) + optional `conformsTo` (which fragment syntax spec applies). This is the hook for `#page=5` / media-fragment style addressing.
- **`SvgSelector`** — `value` = an SVG document describing the selected region. This is the standards-blessed way to record arbitrary shapes, and is what IIIF ecosystems use.
- **`XPathSelector`**, **`CssSelector`**, **`DataPositionSelector`** (byte offsets, *not* characters).

**The multi-selector redundancy strategy.** The spec provides two mechanisms:

1. **An array of alternative selectors** on the target. "Multiple Selectors _SHOULD_ select the same content," and "Consuming user agents _MUST_ pick one of the described segments, if they are different." The rationale, per the spec and [w3c/web-annotation#93](https://github.com/w3c/web-annotation/issues/93), is to "maximize the chances that it will be discoverable later, and that the consuming user agent will be able to use at least one of the Selectors."
2. **`refinedBy` chaining** — "A Selector _MAY_ be `refinedBy` 1 or more other Selectors. If more than 1 is given, then they are considered to be alternatives."

Crucially, **the spec does not define a priority order** among alternatives. It says only "pick one." The resolution order is entirely an implementation concern — which is where Hypothesis's code becomes the de-facto standard.

---

## 3. Hypothesis — the reference implementation, read from source

I read the current source directly rather than relying on documentation.

### 3.1 Selector generation and resolution order (HTML path)

From [`src/annotator/anchoring/html.ts`](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/html.ts), `describe()` emits selectors in the order `MediaTimeAnchor, RangeAnchor, TextPositionAnchor, TextQuoteAnchor`, silently skipping any that fail. `anchor()` then resolves in a deliberately different order — the file's own comment says "we build up catch clauses to try selectors in order, from **simple to complex**": `RangeSelector → TextPositionSelector → TextQuoteSelector → MediaTimeSelector`.

Two details worth stealing:

- A `TextPositionSelector` in the input sets `options.hint = position.start`, which is fed to the fuzzy quote matcher as a **positional prior**.
- `maybeAssertQuote()` re-validates every Range/Position hit against `quote.exact` and throws `'quote mismatch'` on failure. **The fast selectors are never trusted; the quote is the validator.** This is the most important architectural idea in the whole file.

### 3.2 Fuzzy matching — `diff-match-patch` is *history*, not current

The 2013 post ["Fuzzy Anchoring"](https://web.hypothes.is/blog/fuzzy-anchoring/) (22 April 2013) describes a modified google-diff-match-patch with the Bitap algorithm. That is no longer what ships. Current [`match-quote.ts`](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/match-quote.ts) imports **`approx-string-match`**, a bit-parallel implementation of **Myers (1999), "A Fast Bit-Vector Algorithm for Approximate String Matching Based on Dynamic Programming"**, running in *O((k/w)·n)* expected time with *w* = 32 in JavaScript. (google/diff-match-patch is itself now **archived**, last push 2024-05-22.) Cite Myers, not diff-match-patch.

The exact scoring, read from source:

- `maxErrors = Math.min(256, quote.length / 2)`
- Weights: **quote 50, prefix 20, suffix 20, position 2**. Position is explicitly "used as a tie-breaker."
- `posScore = 1 − |match.start − hint| / text.length`
- Exact `indexOf` matches short-circuit the expensive search entirely.
- Prefix/suffix context length is a hard-coded **`contextLen = 32`** characters ([`types.ts`](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/types.ts)), with a source comment conceding it would be better to use logical boundaries (sentence via `Intl.Segmenter`) instead.

### 3.3 PDF path — the details that matter most for PaperTree

From [`src/annotator/anchoring/pdf.ts`](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/pdf.ts):

- `describe()` returns exactly **`[TextPositionSelector, TextQuoteSelector, PageSelector]`**. The position selector's offsets are **document-global** (`pageOffset + startPos.offset`), not page-local.
- **All whitespace is stripped before matching.** The source comment is decisive evidence for PaperTree: *"text extracted from a PDF by different PDF viewers, **including different versions of PDF.js**, can often differ in the whitespace between characters and words."* Any offset-based anchor into extracted PDF text is therefore fragile across extractor versions.
- Search order is **page-ordered by distance from the hinted page**, with the hint translated from whitespace-inclusive to whitespace-stripped offsets via `translateOffsets`.
- Early termination requires an **exact** quote match *plus* an exact prefix or suffix match — "context matching helps to avoid incorrectly stopping the search early if the quote is a word or phrase that is common in the document."
- A session-level `quotePositionCache` keyed on `` `${quote}:${offset}` `` avoids re-searching.
- `PageSelector` carries both `index` (0-based) and `label` (the printed page number, e.g. roman numerals) — [`src/types/api.ts`](https://github.com/hypothesis/client/blob/main/src/types/api.ts).

### 3.4 `ShapeSelector` — region anchoring, added 2025

Hypothesis added shape/region anchoring in April 2025 ([#6964](https://github.com/hypothesis/client/pull/6964)). The type documentation states the rule PaperTree should adopt verbatim: coordinates are stored in *"the natural coordinate system for the anchor element … enabling an annotation made in one viewer to be resolved to the same location in a different viewer, with different view settings (zoom, rotation etc.)"* — and for PDFs that is **"PDF user space coordinates (points), with the origin at the bottom-left corner of the page."**

It additionally stores a `view` box: *"the intersection of the media and crop box."* In code, `pageBoundingBox()` reads `page.view` as `[viewLeft, viewBottom, viewRight, viewTop]`. Storing the view box alongside the shape is what makes the coordinates re-normalisable. [PR #6968](https://github.com/hypothesis/client/pull/6968) (2025-04-10) is a bug fix for exactly the failure mode of forgetting it: *"Conversion of Y coordinates … was incorrect if the bottom-left corner of the page bounding box, in PDF user space, was not at (0, 0)."*

### 3.5 Published failure rates and the performance trap

- **The only rigorous published number** is [Aturban, Nelson & Weigle, "Quantifying Orphaned Annotations in Hypothes.is" (arXiv:1512.06195, 19 Dec 2015)](https://arxiv.org/abs/1512.06195), over 20,953 highlighted-text annotations: **~22% could no longer be attached to their live web pages**; of those, only ~12% were recoverable from public web archives, leaving 88% orphaned; and **53% of still-attached annotations were "in danger of becoming orphans"** if the page changed. This is third-party research on *live web pages*, not on PDFs.
- Hypothesis's own [Showing Orphaned Annotations](https://web.hypothes.is/blog/showing-orphaned-annotations/) (1 March 2017) publishes no rates; its contribution is the product decision — an **orphans tab**, i.e. never delete a failed anchor, surface it. PaperTree should copy this.
- **Performance is the real hazard.** [Issue #3919](https://github.com/hypothesis/client/issues/3919) (open since 2021-11-11, last active 2023-06-29): fuzzy quote anchoring "can be very inefficient in long documents for short, generic quotes," producing >10 s of blocked execution, with **~60% of load time in imperfect-match resolution**. A contributor confirmed that disabling approximate search removed a ~5 s CPU spike. PaperTree must not re-run fuzzy search on every document open — resolved positions must be cached per `(anchor_id, parser_version)`.

---

## 4. PDF.js text layer and the exact coordinate transform

### 4.1 The page box

`PDFPageProxy.view` is documented as *"the visible portion of the PDF page in user space units [x1, y1, x2, y2]"*. The core implementation ([`src/core/document.js`](https://github.com/mozilla/pdf.js/blob/master/src/core/document.js)) computes it as **`intersect(CropBox, MediaBox)`**, falling back to MediaBox if the intersection is empty, quoting the spec: *"The crop, bleed, trim, and art boxes should not ordinarily extend beyond the boundaries of the media box. If they do, they are effectively reduced to their intersection with the media box."* `Rotate` is normalised to a multiple of 90 in [0, 360).

**Consequence: any geometry PaperTree stores must record which box it is relative to.** A parser that emits boxes relative to MediaBox while the viewer renders relative to CropBox will silently offset every highlight — and academic PDFs from journal typesetters frequently have CropBox ≠ MediaBox.

### 4.2 The exact transform

From [`src/display/page_viewport.js`](https://github.com/mozilla/pdf.js/blob/master/src/display/page_viewport.js), with `s = scale × userUnit`, `viewBox = [x0, y0, x1, y1]`, `centerX = (x1+x0)/2`, `centerY = (y1+y0)/2`:

```
transform = [ rotA·s, rotB·s, rotC·s, rotD·s,
              offCanvasX − rotA·s·centerX − rotC·s·centerY,
              offCanvasY − rotB·s·centerX − rotD·s·centerY ]
```

with `(rotA,rotB,rotC,rotD)` = `(1,0,0,−1)` at 0°, `(0,1,1,0)` at 90°, `(−1,0,0,1)` at 180°, `(0,−1,−1,0)` at 270°. At rotation 0 this reduces to `[s, 0, 0, −s, −s·x0, s·y1]`, i.e.

```
viewportX = s · (x − x0)
viewportY = s · (y1 − y)          ← the bottom-left → top-left flip
```

and the inverse `x = viewportX/s + x0`, `y = y1 − viewportY/s`. Note **`userUnit`** is folded into the scale — a detail most home-grown implementations miss, and which matters for large-format figures.

The zoom-independent normalised form PaperTree should persist is therefore:

```
nx = (x − x0) / (x1 − x0)          ny = (y1 − y) / (y1 − y0)
```

### 4.3 Why the text layer is already zoom-invariant

[`src/display/text_layer.js`](https://github.com/mozilla/pdf.js/blob/master/src/display/text_layer.js) sets `#transform = [1, 0, 0, −1, −pageX, pageY + pageHeight]` and then positions each `<span>` as a **percentage** of page width/height (`divStyle.left = ((100 * left) / pageWidth) + '%'`). Font size is `calc(var(--text-scale-factor) * var(--font-height))` ([`web/text_layer_builder.css`](https://github.com/mozilla/pdf.js/blob/master/web/text_layer_builder.css)).

**This means the text-layer DOM does not change when the user zooms or resizes — only CSS custom properties change.** Requirements (a) and (b) are therefore satisfied *for free* by any DOM-offset or PDF-user-space anchor. Anything stored in CSS pixels is what breaks.

`getTextContent()` items are `{str, dir, transform, width, height, fontName, hasEOL}`, and there is a `disableNormalization` option — meaning **the same PDF can yield two different text streams from the same library depending on one flag**. Record which extraction produced your offsets.

---

## 5. PDF native annotation QuadPoints

ISO 32000-1:2008 §12.5.6.10 defines `QuadPoints` for text-markup annotations as an array of 8·n numbers in PDF user space. The spec's stated order is counter-clockwise from lower-left; **real files disagree**, and PDF.js documents the mess in [`src/core/annotation.js`](https://github.com/mozilla/pdf.js/blob/master/src/core/annotation.js):

> *"The PDF specification states in section 12.5.6.10 (figure 64) that the order of the quadpoints should be bottom left, bottom right, top right and top left. However, in practice PDF files use a different order, namely bottom left, bottom right, top left and top right … the situation is even worse since Adobe's own applications and other applications violate the specification and create annotations with other orders…"*

PDF.js's fix is to discard the ordering entirely and renormalise via `min`/`max` to `[minX, maxY, maxX, maxY, minX, minY, maxX, minY]`. **PaperTree should do the same: never trust quad vertex ordering; store axis-aligned min/max rects.** Multi-line highlights are n quads, one per line — which is what makes them look right across column breaks.

Native quadpoints are the right *export* format (they make PaperTree highlights visible in Preview, Acrobat, Zotero) but the wrong *primary* store, because they carry no text and cannot be resolved in reflowed mode.

---

## 6. URL text fragments

Syntax: `#:~:text=[prefix-,]textStart[,textEnd][,-suffix]`, multiple directives joined by `&`. Note the CSS pseudo-element is **`::target-text`**, not `::text-fragment`.

Status: **WICG Draft Community Group Report, 13 December 2023** — explicitly "not a W3C Standard nor is it on the W3C Standards Track." Restrictions per the spec and [MDN](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment/Text_fragments): user-activated navigations only; top-level browsing contexts only (not iframes); `text/html` and `text/plain` only; cross-origin links require `noopener`; each of `textStart`/`textEnd`/`prefix`/`suffix` must lie wholly within a single block-level element. Feature-detect via `document.fragmentDirective`.

**Assessment for PaperTree:** this is *conceptually* the same prefix/exact/suffix model as `TextQuoteSelector` and is worth supporting as a **share/deep-link format** for Guided (HTML) mode. It is useless as the storage format — no geometry, no page, no fallback, no iframe support, and not applicable to a canvas-rendered PDF at all.

---

## 7. Approximate string matching for re-anchoring

- **Myers (1999) bit-vector algorithm**, as implemented in [`approx-string-match`](https://github.com/robertknight/approx-string-match-js) (MIT, v2.0.0 published 2021-11-23, repo pushed 2026-04-08). *O((k/w)·n)* expected time, `w = 32`. **It operates on UTF-16 code units, not code points** — the README states an emoji counts as two edits.
- This directly conflicts with the W3C spec's code-point requirement. Hypothesis's own type definition concedes the deviation: `TextPositionSelector` is documented as *"UTF-16 character offsets in the document body's `textContent`."* **PaperTree must pick one unit and record it explicitly in the anchor record**, or offsets will silently drift when exchanged.
- Hypothesis maintains a `normalize.ts` utility doing NFKD-aware offset translation with forward and reverse offset maps — the right pattern: normalise for *matching*, keep offsets mappable back to *raw* for rendering.

---

## 8. Implications for PaperTree

### 8.1 The anchor record to persist

Store a **selector array**, W3C-shaped, ordered cheapest-first, with an explicit `anchor_version`:

```jsonc
{
  "anchor_version": 1,
  "offset_unit": "utf16",                 // declare it; do not leave implicit
  "doc": { "paper_id": "...", "pdf_sha256": "...", "parser_version": "3.2.1" },
  "selectors": [
    { "type": "BlockSelector",            // T1 — ours, O(1), breaks on re-parse
      "blockId": "...", "blockTextHash": "sha256:...",
      "startOffset": 142, "endOffset": 233 },

    { "type": "PageSelector", "index": 4, "label": "5" },

    { "type": "TextPositionSelector",     // T2 — doc-global offsets
      "start": 18422, "end": 18513,
      "textStreamId": "pdfjs-4.x-normalized" },   // WHICH extraction produced these

    { "type": "TextQuoteSelector",        // T3 — the durable one
      "exact": "...", "prefix": "...(64)", "suffix": "...(64)" },

    { "type": "ShapeSelector",            // T4 — parser-independent geometry
      "anchor": "page", "pageIndex": 4,
      "quads": [{ "x0":..,"y0":..,"x1":..,"y1":.. }],   // PDF user space, origin bottom-left
      "view": { "left":x0,"bottom":y0,"right":x1,"top":y1 },  // CropBox ∩ MediaBox
      "viewBoxSource": "cropbox_media_intersect",
      "rotate": 0, "userUnit": 1.0 },

    { "type": "SectionPathSelector",      // T5 — reflowed/Guided mode
      "path": ["3","3.2"], "headingText": "3.2 Attention",
      "paraIndexInSection": 4, "charOffsetInPara": 12 }
  ],
  "provenance": { "created_mode": "pdf", "created_at": "...",
                  "last_resolved": { "tier": 1, "score": 1.0, "at": "..." } }
}
```

Deviations from Hypothesis worth making deliberately: **prefix/suffix of 64 chars, not 32** (academic prose is dense in repeated phrasing — "we show that", "as shown in Figure"), snapped to word boundaries; and store `exact` **raw** for display while matching against a normalised form (NFC, whitespace-collapsed, ligatures folded `ﬁ→fi`, line-break hyphens joined).

### 8.2 Make block IDs content-derived

`blockId = base32(sha256(pageIndex ‖ normalized_text ‖ round(bbox, 0.5pt)))[:16]`. This is the change that answers requirement (c) most cheaply: a new parser version that segments the same text into the same block reproduces the same ID with no migration. Keep `blockTextHash` separate so a block whose *ID* survives but whose *text* changed is detected rather than silently mis-anchored.

### 8.3 Re-anchoring algorithm — fallback tiers

```
T0  Resolution cache keyed (anchor_id, parser_version, textStreamId) → hit, done.
T1  BlockSelector: blockId present AND blockTextHash matches
      → slice by offsets. Verify against quote.exact. score 1.00
T2  TextPositionSelector: slice doc text by start/end.
      Accept ONLY if it equals quote.exact after normalisation.  (Hypothesis's rule:
      the position is a hint, the quote is the judge.)            score 0.95
T3  TextQuoteSelector, fuzzy:
      - pages ordered by |page − hintPage| from the T2 offset
      - compare whitespace-stripped strings
      - approx-string-match, maxErrors = min(256, len/2)
      - score = (50·quote + 20·prefix + 20·suffix + 2·pos) / 92
      - early-exit on exact quote AND (exact prefix OR exact suffix)
      - accept if score ≥ 0.72; 0.60–0.72 → accept as "approximate", flag in UI
T4  ShapeSelector geometry: re-project stored quads through the NEW parse.
      Take blocks whose bbox overlaps ≥ 60% of quad area. Parser-independent,
      so this survives (c) even when all text tiers fail.          score 0.50
T5  SectionPathSelector: match heading text fuzzily, then locate the paragraph.
      This is the tier that carries a highlight into Guided/reflowed mode.
T6  ORPHAN. Never delete. Persist, surface in an "unanchored" tray with the
      stored quote and a page-level jump. (Hypothesis's 2017 orphans-tab lesson.)
```

Cache the resolved result at T0 immediately, and **run T3+ off the main thread** — issue #3919 is the documented cost of not doing so.

### 8.4 Direct answers to the four requirements

| Requirement | How it is met | Which tier |
|---|---|---|
| **(a) Zoom** | Nothing is stored in CSS pixels. PDF.js's text layer is percentage-positioned and thus zoom-invariant; geometry is in PDF user space, re-projected at render time via `viewport.convertToViewportPoint`. | Any |
| **(b) Window resize** | Identical mechanism — resize changes only `scale`/`--total-scale-factor`. In reflowed layouts, T5 re-locates by section path rather than geometry. | Any / T5 |
| **(c) New parser version, new block IDs** | Content-derived IDs mean most blocks keep their ID. Where they don't: T2 (if the text stream is unchanged), then T3 quote matching, then T4 geometry — which is *entirely independent of our parser* because it lives in PDF user space. | T1 → T3 → T4 |
| **(d) Guided / reflowed mode** | T1 if the block ID is shared across representations (it should be — same content hash); otherwise T5 section-path + T3 quote match against reflowed text. Geometry tiers are simply skipped. Export/share via `#:~:text=`. | T1 → T5 → T3 |

### 8.5 Against PaperTree's hard requirements

Positive: the selector array carries `pageIndex` + bbox in PDF coordinates (geometry requirement); `blockId` + content hash gives stable addressable identity; `SectionPathSelector` encodes hierarchy; `ShapeSelector` anchors non-text objects, so **vector figures, equation regions and table cells anchor by exactly the same mechanism as text** — a table cell is just a `BlockSelector` with a `cellRef`, an equation is a `ShapeSelector` plus the LaTeX as `exact`. Uncertainty is representable via the per-tier `score` and the T6 orphan state, so nothing is silently rewritten. Cost: pure CPU string matching, **no GPU, no model weights, no vendor** — the cheapest component in the entire stack.

Negative / to watch: T3 is superlinear in practice on long documents with short quotes; minimum-quote-length enforcement (reject quotes < ~10 chars unless prefix+suffix present) is required.

---

## 9. What I could not verify

- **Hypothesis has published no anchoring failure rate of its own.** The 22%/53% figures are third-party ([arXiv:1512.06195](https://arxiv.org/abs/1512.06195)), from **December 2015**, over *live web pages* — not PDFs, and now over ten years stale. **Do not quote them as a PDF anchoring failure rate.** I found no published PDF-specific anchoring success rate from any source.
- I could not verify any acceptance-threshold constant in Hypothesis's scoring. The `0.72` / `0.60` thresholds in §8.3 are **my proposal, not measured values** — `match-quote.ts` returns the top-scored match unconditionally and the calling code decides. These need calibration against a PaperTree corpus.
- `hypothesis/anchoring-test-tools` exists ([repo](https://github.com/hypothesis/anchoring-test-tools)) but has **no LICENSE file** (GitHub API returns `license: null`) and was last pushed **2023-03-03**. I did not find published results produced by it.
- The QuadPoints ordering discrepancy is verified from PDF.js's source comment and implementation, which is a strong secondary source. I did **not** read ISO 32000-1:2008 §12.5.6.10 directly (paywalled), so the spec's exact wording is quoted at one remove.
- I did not benchmark anything. The >10 s and ~60% figures in §3.5 are **user-reported** in issue #3919, not instrumented measurements by the Hypothesis team, and date from 2021 — the code has changed since.
- MDN's browser-compatibility table for text fragments did not render in my fetch, so I could not confirm specific browser versions; I report only the spec's own restrictions and MDN's prose.
- `hypothesis/client`'s GitHub API `license` field reads `NOASSERTION`; I resolved this to **BSD-2-Clause** by reading `package.json` and the LICENSE text directly. Individual bundled dependencies were not audited.
