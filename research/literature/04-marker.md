# Marker / Surya (Datalab) — Technical Evaluation for PaperTree

**Research date:** 2026-07-29. **Most recent evidence:** Marker `v2.0.0` (released 2026-07-20), Surya `v0.22.1` (2026-07-20), last commit on `master` 2026-07-20T23:00:20Z ([marker](https://github.com/datalab-to/marker), [surya](https://github.com/datalab-to/surya)).

> **Bottom line up front:** Marker v2 is technically the closest OSS pipeline to PaperTree's geometry/hierarchy requirements — PDF-coordinate polygons on every block, a real block tree, section hierarchy, LaTeX equations with source regions, figure+caption groups that include vector drawings. But the **model weights are not open source**. They carry a modified AI Pubs Open RAIL-M licence with a $5M revenue/funding cap, a **non-compete clause**, and a **share-alike clause that reaches the parsed output itself**. That is a licensing blocker for a commercial PaperTree, not a footnote.

---

## 1. What Marker v2 actually is (as of 2026-07-20)

Marker v2.0.0 is a **rewrite**. Everything written about Marker before 2026-07-20 (v1.10.2, released 2026-01-31 — [PyPI history](https://pypi.org/pypi/marker-pdf/json)) is stale. The v2 pipeline, per the repo's own "How it works" section ([README](https://github.com/datalab-to/marker/blob/master/README.md)):

1. Extract embedded text with `pdftext` in the PDF's reading order.
2. Detect layout — a lightweight **rf-detr** detector (~20M params) in `fast` mode, the Surya VLM in `balanced` mode.
3. Decide per page whether embedded text is usable; garbled/scanned pages get VLM OCR (full-page in balanced, per-block in fast).
4. Equations and inline math recognised by the VLM (`pdftext` cannot represent math).
5. Tables reconstructed from the text layer with CPU heuristics; low-confidence reconstructions fall back to the VLM.
6. Optional LLM pass (`--use_llm`).
7. Block combination and postprocessing.

**Surya 2** is now a single **650M-param VLM** (Qwen3.5-style architecture per the [Surya README](https://github.com/datalab-to/surya/blob/master/README.md)) that does layout, reading order, full-page OCR *and* table recognition from one checkpoint, prompt-switched. `model.safetensors` is **1.37 GB**; the GGUF build is **1.27 GB + 0.20 GB mmproj** ([HF file tree](https://huggingface.co/datalab-to/surya-ocr-2/tree/main)). Text-line detection remains a separate small torch model (modified EfficientViT/SegFormer). It is served by **vLLM (NVIDIA, via Docker) or llama.cpp (CPU/Apple Silicon)**, auto-spawned on first use.

**Texify is dead.** `grep -ri texify` across the Marker v2 tree returns nothing. The [texify repo was archived 2025-01-29](https://github.com/VikParuchuri/texify) with the note that functionality "has been migrated to surya". Equation OCR is now inline in Surya's full-page HTML output, wrapped in `<math>…</math>` as KaTeX-compatible LaTeX ([Surya README, Math/equations](https://github.com/datalab-to/surya/blob/master/README.md)).

There is **no peer-reviewed paper** for either project — Surya's own citation block is a `@misc` GitHub entry.

---

## 2. Output formats and whether geometry survives

Four renderers: `markdown | json | html | chunks`.

The JSON renderer's actual schema (`marker/renderers/json.py`, `JSONBlockOutput`) is:

| Field | Present? | Notes |
|---|---|---|
| `id` | ✅ | String of form `/page/10/SectionHeader/0` |
| `block_type` | ✅ | 32 types incl. `Equation`, `Figure`, `Picture`, `Diagram`, `TableCell`, `Bibliography`, `ChemicalBlock` |
| `polygon` | ✅ | 4-corner, clockwise from top-left |
| `bbox` | ✅ | axis-aligned `[x0,y0,x1,y1]` (**present in code, omitted from the README example — README is stale here**) |
| `children` | ✅ | tree |
| `section_hierarchy` | ✅ | `{1: "/page/10/SectionHeader/1"}` — maps each block to its enclosing headings |
| `images` | ✅ | base64 crops keyed by block id |
| `confidence` | ❌ | **not emitted by any renderer** |

**Coordinates are PDF coordinates.** `marker/builders/layout.py:253` rescales every layout polygon from the render-image size to `provider_page_size` (the PDF page box) and clips to bounds. The README's worked example shows a page polygon of `[[0,0],[612,0],[612,792],[0,792]]` — US Letter in PDF points. This satisfies PaperTree's geometry requirement at **block** granularity.

**Line/span geometry is not in the JSON.** `extract_json` collapses any leaf-derived block (`cls.__base__ == Block`) into a single HTML string, so `Line`/`Span` polygons never reach the file. They exist on the in-memory `Document` — reachable via the Python API (`converter.build_document(path)`) or `--debug`, which writes a separate JSON of line/span bboxes (`marker/processors/debug.py`). Word-level highlight anchoring would require the Python path, not the CLI.

**Metadata** carries a computed `table_of_contents` (title, heading_level, page_id, polygon) and `page_stats` (per-page `text_extraction_method` and block counts) — useful for telling "this page came from the text layer" vs "this page was VLM-OCR'd".

---

## 3. The block-identity problem (important for PaperTree)

Block IDs are **positional, not content-derived**. `BlockId.__str__` is `/page/{page_id}/{BlockType}/{block_id}` (`marker/schema/blocks/base.py`), and `block_id` comes from a per-page counter incremented on every `add_block` in creation order (`marker/schema/groups/page.py:120-134`). Any change in layout detection — a model upgrade, a different mode, `--use_llm` on/off, even nondeterminism in VLM layout decoding — reshuffles the integers. **Marker IDs cannot be used as durable highlight anchors across re-parses.** PaperTree would have to compute its own content+geometry hash and treat Marker IDs as intra-run handles only.

The HTML renderer has an `add_block_ids` option that stamps `data-block-id` attributes onto emitted tags (`marker/renderers/html.py:58-73`, and `data-block-id` on `<td>`/`<th>` via `marker/schema/blocks/tablecell.py:24`) — handy for mapping rendered HTML back to blocks *within* a run.

---

## 4. Figures (including vector), tables, equations

**Figures — vector works.** Block images are produced by cropping the *rendered page raster* at the block polygon (`marker/schema/blocks/base.py:135-155`), not by pulling embedded XObjects. So a vector architecture diagram is captured correctly, at whatever DPI the page was rendered at (`page.render(scale=dpi/72)` in `marker/providers/pdf.py:427`). Output is raster, not SVG — fine for display, not for infinite zoom. `Figure`, `Picture` and `Diagram` are all treated as image blocks by the JSON renderer.

**Captions are linked by proximity heuristic, not semantics.** `group_caption_blocks` (`marker/builders/structure.py:95-147`) merges a `Table`/`Figure`/`Picture` with an immediately-adjacent-in-reading-order `Caption`/`Footnote` if the minimum polygon gap is under `gap_threshold * page_height`, producing a `FigureGroup`/`TableGroup`/`PictureGroup` with a merged polygon. It does **not** match "Figure 3:" text to a figure number. Expect misses on two-column layouts where the caption is separated, and on captions above-and-below arrangements.

**Tables.** `TableCell` carries `row_id`, `col_id`, `rowspan`, `colspan`, `is_header` and a polygon internally. In the JSON file the table is emitted as an HTML `<table>` string with rowspan/colspan attributes — **per-cell polygons are lost in the JSON path** (same leaf-collapse as above). Cell-level geometry requires the Python API. Surya's standalone `surya_table` does emit `rows`/`cols`/`cells` with `row_id`/`col_id`/`cell_id` and polygons.

**Equations.** `Equation` blocks keep their polygon (so the source region is retained), and the markdown renderer converts `<math>` to `$…$` / `$$…$$` with configurable delimiters (`marker/renderers/markdown.py:109-125`). Recoverability is **mode-dependent** — see the numbers below.

**Uncertainty is not representable in the output.** Surya returns a per-block `confidence` (mean per-token probability); Marker stores it on the block as `top_k` but no renderer serialises it. PaperTree would have to patch a renderer or use the Python API to surface "this block is low-confidence".

---

## 5. `--use_llm` hybrid mode

`--use_llm` adds LLM processors on top of Marker's output: `llm_table`, `llm_table_merge` (cross-page merges), `llm_equation`, `llm_mathblock`, `llm_form`, `llm_complex`, `llm_handwriting`, `llm_image_description`, `llm_sectionheader`, `llm_page_correction`. Default service is Gemini (`gemini-3.5-flash`); Claude, OpenAI-compatible, Azure, Vertex, OpenRouter and Ollama are supported. `--block_correction_prompt` lets you inject arbitrary custom rewriting.

**This is a rewrite path, and PaperTree should treat it as such.** The LLM is handed a crop and asked to return corrected HTML. Guardrails exist but are structural, not semantic — `llm_table.py` rejects a response if it lacks `corrected_html`, doesn't end in `</table>`, or parses to ≤1 cell (lines 199-271). Nothing checks that the returned text is *faithful to the crop*. Per-block `llm_request_count` / `llm_error_count` / `llm_tokens_used` are tracked in `BlockMetadata` but, again, are not emitted in the JSON output. `--disable_image_extraction` combined with `--use_llm` replaces images with LLM-written *descriptions* — an explicit hallucination surface.

Notably, `--use_llm` is **not exposed on Marker's bundled `marker_server` API** (README, API server section) — CLI or Python only.

---

## 6. Benchmarks, and how much to trust them

Datalab reports on [olmOCR-bench](https://github.com/allenai/olmocr/tree/main/olmocr/bench) (1,403 single-page PDFs, ~8,400 pass/fail tests, macro-average over 8 categories). **All numbers in the Marker README are self-reported by the vendor**, run on Datalab's own harness on a single B200:

| System | Overall | Digital-only | Throughput (sustained, 1×B200) | Source |
|---|---:|---:|---:|---|
| Chandra 2 (Datalab, hosted) | 85.8 | — | — | vendor |
| Gemini Flash 3.5 (API) | 76.4 | 79.1 | — | vendor |
| **Marker balanced (GPU)** | **76.0** | **83.5** | **2.9 pg/s** (341 ms/pg) | vendor |
| MinerU — *pipeline* backend | 72.7 | 83.3 | 0.54 pg/s | vendor |
| **Marker fast (GPU)** | **66.6** | **71.6** | **7.4 pg/s** (134 ms/pg) | vendor |
| docling | 50.3 | 64.0 | 2.1 pg/s | vendor |
| **Marker fast, no OCR (CPU only)** | **43.6** | **55.8** | **23.7 pg/s** (42 ms/pg) | vendor |
| Marker 1.10.1 | 76.1 ± 1.1 | — | — | **AI2, reproduced in-house** |
| MinerU 2.5.4 | 75.2 ± 1.1 | — | — | AI2 table, *author-reported* |

The last two rows come from AI2's own leaderboard in [olmocr/bench/README.md](https://github.com/allenai/olmocr/blob/main/olmocr/bench/README.md), where results are "reproduced in-house, except those marked with \*". **AI2 independently measured Marker 1.10.1 at 76.1 — essentially identical to Datalab's self-reported 76.0 for v2 balanced.** That is meaningful corroboration of the headline score.

The **competitive** framing is disputed. [Marker issue #1066](https://github.com/datalab-to/marker/issues/1066), opened 2026-07-21 by MinerU's maintainer, argues Datalab's runner "explicitly forces the `pipeline` backend" while MinerU 3.4.4's default is `hybrid-engine`/`medium`, so 72.7 understates MinerU. **No maintainer response as of 2026-07-29.** AI2's table listing MinerU 2.5.4 at 75.2 supports the complaint. Treat "beats MinerU and docling" as vendor marketing; treat "≈76 on olmOCR-bench" as credible.

Marker's own per-category table is the decisive one for PaperTree, because papers are math-heavy:

| Category | balanced (GPU) | fast | no-OCR (CPU) |
|---|---:|---:|---:|
| arXiv math | **83.9** | **23.4** | **0.0** |
| Tables | 73.4 | 69.0 | 46.1 |
| Multi-column | 76.6 | 76.0 | 67.0 |
| Long tiny text | 71.3 | 68.3 | 43.2 |

**Without a GPU (or at least a llama.cpp VLM), equations are simply not recoverable.** `--disable_ocr` scores literally 0.0 on arXiv math because the text layer has no LaTeX.

**Hardware/throughput reality.** Surya alone, full-page OCR at 96 DPI (~2,400 output tokens/page): RTX 5090 + vLLM at concurrency 128 → **5.35 pg/s, p50 18.9 s, p95 42.5 s**. Apple Silicon + llama.cpp Metal at `--parallel 8` → **0.108 pg/s, p50 59.3 s, p95 129 s, ~30 W**. VRAM is not published anywhere I could find; the benchmarks used a 32 GB RTX 5090 and a B200.

---

## 7. Licensing — read this twice

**Code: Apache-2.0.** Verified by fetching `LICENSE` from both repos — genuine Apache 2.0 text, no addenda.

**Weights: modified AI Pubs Open RAIL-M.** The same file appears at [marker/MODEL_LICENSE](https://github.com/datalab-to/marker/blob/master/MODEL_LICENSE), [surya/MODEL_LICENSE](https://github.com/datalab-to/surya/blob/master/MODEL_LICENSE), and as `LICENSE` inside [datalab-to/surya-ocr-2](https://huggingface.co/datalab-to/surya-ocr-2/blob/main/LICENSE) and [datalab-to/surya_layout2](https://huggingface.co/datalab-to/surya_layout2) — byte-identical. Attachment A, Use Restrictions:

- **§2(a)** — no use "for any purpose if You (your employer, or the entity you are affiliated with) generated more than five million US Dollars ($5,000,000) in gross revenue in the prior year, except where Your Use is limited to personal use or research purposes".
- **§2(b)** — same bar for "more than five million US dollars ($5,000,000) in total equity or debt funding from any source".
- **§2(c)** — **non-compete:** no use "for any purpose if You … provide[] or otherwise make[] available any product or service that competes with any product or service offered by or made available by Licensor or any of its affiliates."
- **§8 Share-a-Like** — "You agree to apply this License (to the exclusion of all others) to any and all copies of the Model, Derivatives of the Model … **and to the Output and any derivatives, changes or improvements to or of the Output**."
- **§7 Attribution** — "In connection with any Output … You agree to give appropriate credit and attribution to Licensor, provide a link to the original Model … provide a copy of this License".
- **§9** — Licensor "reserves the right to restrict (remotely or otherwise) usage of the Model".

Three of these are showstoppers for PaperTree, in ascending order of severity:

1. **§2(a)/(b)** — a soft ceiling. Fine pre-revenue; a forced renegotiation at $5M.
2. **§2(c) non-compete** — Datalab sells document conversion, structured extraction and a hosted parsing API. PaperTree is a reading environment, arguably not a competing parser — but "any product or service that competes with any product or service offered by … Licensor or any of its affiliates" is drafted broadly enough that the question is a lawyer's, not an engineer's. Datalab could also unilaterally widen the overlap by shipping a reader product.
3. **§8 share-alike over Output** — this is the one that should stop the conversation. Read literally, the parsed representation of every user's paper, and every downstream derivative of it (embeddings, summaries, the anchored highlight index), must be licensed under the modified RAIL-M "to the exclusion of all others", with §5 use restrictions passed on to PaperTree's own users. That is incompatible with a normal commercial product ToS.

**There is no configuration of Marker that avoids RAIL-M weights.** Even `--mode fast --disable_ocr`, the pure-CPU no-VLM path, loads `hf://datalab-to/surya_layout2` (`FAST_LAYOUT_MODEL_CHECKPOINT` in `surya/settings.py`), which is RAIL-M.

**Additional licence noise worth flagging:**
- Datalab's *own docs* contradict its repos: [documentation.datalab.to/docs/on-prem/overview](https://documentation.datalab.to/docs/on-prem/overview) says free tier is "Research, personal use, startups **< $2M** ARR/funding" and licence is "**GPL** + custom RAILs" — versus $5M and Apache-2.0 in the repos. The threshold has evidently moved before; nothing stops it moving again for new weight releases.
- The **legacy** small models on HF are **CC BY-NC-SA-4.0** — flatly non-commercial, no revenue carve-out: [ocr_error_detection](https://huggingface.co/datalab-to/ocr_error_detection), [surya_layout](https://huggingface.co/datalab-to/surya_layout), [surya_tablerec](https://huggingface.co/datalab-to/surya_tablerec), [line_detector0](https://huggingface.co/datalab-to/line_detector0), [inline_math_det0](https://huggingface.co/datalab-to/inline_math_det0).
- Current small models are **not** fetched from HF at all: `surya/settings.py` sets `OCR_ERROR_MODEL_CHECKPOINT = "s3://ocr_error_detection/2025_02_18"` and `DETECTOR_MODEL_CHECKPOINT = "s3://text_detection/2025_05_07"`, served from `https://models.datalab.to`. **I could not locate any licence text accompanying those S3 artefacts.** So the licence status of two models that actually run in Marker's pipeline is undetermined, with a CC BY-NC-SA-4.0 precedent on the same model families.

Datalab's commercial route is an Enterprise on-prem contract ("Commercial license to use our models on-prem (Marker/Surya/Chandra) without sublicensing"). **Prices are not published** — datalab.to/pricing is a JS-only shell that returns no text.

---

## 8. Maintenance

Healthy and fast-moving, with the churn that implies. Marker: 439 open issues; 6 releases since 2025-09; v2.0.0 a full rewrite 9 days ago. Surya: 182 open issues; **6 releases in the 8 weeks to 2026-07-20** (v0.20.0 05-27 → v0.22.1 07-20). Development is essentially one person (Vik Paruchuri) merging `dev` branches, plus a CLA bot.

Open-issue character is the concern, not the count:
- [marker#1069](https://github.com/datalab-to/marker/issues/1069) (2026-07-27, v2.0.0) — the **markdown renderer silently discards the rest of the document on malformed HTML and exits 0**. Reporter lost ~90% of a 219-page PDF (57 of 211 extracted pages survived) while 461 image crops and 122 tables were logged as extracted. Deterministic and positional. Unanswered.
- [marker#1065](https://github.com/datalab-to/marker/issues/1065) — v2.0.0 fails on macOS after clean install.
- Unauthenticated path traversal / arbitrary file read+write in the bundled `marker_server`: [#1058](https://github.com/datalab-to/marker/issues/1058), [#1059](https://github.com/datalab-to/marker/issues/1059), [#1047](https://github.com/datalab-to/marker/issues/1047); same class in [surya#518](https://github.com/datalab-to/surya/issues/518). The README already says the server is "not very robust" — never expose it.
- Surya open issues skew to backend crashes (vLLM SIGSEGV #543, llama.cpp grammar parse failure #542), plus [#541](https://github.com/datalab-to/surya/issues/541) "How to reproduce the 83.3% olmOCR-bench score?" — i.e. a user could not reproduce the headline number.

---

## 9. Implications for PaperTree

| PaperTree hard requirement | Marker v2 verdict |
|---|---|
| Page + bbox in PDF coords | ✅ block-level, rescaled to PDF points. Line/span only via Python API or `--debug`. |
| Stable, addressable block identity | ❌ IDs are per-page creation-order counters. Must build our own content+geometry anchor. |
| Section tree, not flat text | ✅ real block tree + `section_hierarchy` + computed `table_of_contents`. Best-in-class here. |
| Equations as LaTeX with source region | ⚠️ Yes in `balanced` (83.9 arXiv math) — **requires a GPU/VLM**. `fast` = 23.4, `--disable_ocr` = 0.0. |
| Figures incl. **vector**, captions linked | ✅ vector captured (page-raster crop). ⚠️ captions linked by proximity heuristic only; raster output, no SVG. |
| Tables with row/cell addressability | ⚠️ rowspan/colspan in HTML; per-cell polygons only via Python API. |
| No silent rewriting; uncertainty representable | ❌ confidence never serialised; `--use_llm` rewrites blocks with only structural validation; open bug #1069 is *silent* content loss with exit 0. |
| Acceptable cost, CPU-first | ⚠️ CPU-only is viable at 23.7 pg/s but scores 43.6 overall and **0.0 on math** — useless for papers. Apple-Silicon VLM path is ~0.1 pg/s (p95 129 s/page). Realistically needs the GPU worker from day one. |
| **Licence** | ❌ **Blocker.** RAIL-M $5M caps, non-compete, share-alike over *Output*. |

**Recommendation: do not adopt as PaperTree's production parser.** Not because of quality — architecturally it is the best fit of any OSS pipeline reviewed — but because §8's share-alike-over-Output and §2(c)'s non-compete are structurally incompatible with shipping a commercial reading product on top of the parsed representation, and no Marker configuration avoids the weights.

Three defensible uses remain:
1. **Reference implementation.** The Apache-2.0 *code* is free. The block schema, `group_caption_blocks`, the PDF-coordinate rescaling, and the renderer design are all worth copying outright — that is legal and cheap.
2. **Ground-truth harness.** Use it under research use to generate reference parses for evaluating whatever PaperTree ships. Research use is explicitly permitted.
3. **Buy the commercial path** — Datalab's Enterprise on-prem contract, or the hosted API — if a quote comes back cheap enough. This also removes the ambiguity around the unlicensed S3 models. Get pricing before writing this off entirely; it is the only way to use these weights commercially.

If we go the "build our own" route, the two things to steal are the **PDF-coordinate rescale discipline** and the **`section_hierarchy` field**; and the two things to do better are **content-derived stable block IDs** and **serialised per-block confidence**.

---

## 10. What I could not verify

- **Commercial licence pricing.** `datalab.to/pricing` and the self-serve on-prem blog post are JS-rendered and return no text to a fetcher; `documentation.datalab.to/docs/platform/billing` 404s. No per-page rate, minimum commitment, or on-prem licence fee obtained. **Must be obtained by contacting Datalab directly.**
- **Legal reading of §2(c) and §8.** I am reporting the licence text verbatim; whether a paper-reading app "competes" with Datalab, and how far §8's share-alike over Output actually reaches, are questions for counsel. Do not treat my severity ranking as legal advice.
- **Licence of the S3-hosted models** (`ocr_error_detection/2025_02_18`, `text_detection/2025_05_07`) served from `models.datalab.to`. No licence file found. The HF ancestors of those model families are CC BY-NC-SA-4.0, which would be worse than RAIL-M, but I could not confirm the current artefacts inherit it.
- **VRAM requirements.** Not published in either README. 650M params / 1.37 GB bf16 weights is the model size, but vLLM's actual resident footprint (KV cache, `VLLM_MAX_MODEL_LEN=18000`) was not measured, and I did not run it.
- **No hands-on run.** Every claim about output shape here is from reading Marker v2.0.0 source and the READMEs, not from executing the pipeline on a real paper. In particular I have not confirmed empirically that block IDs shift between runs — that is inferred from the counter-based assignment in `page.py`, and should be tested before relying on it either way.
- **Whether bug #1069 also affects the JSON/chunks renderers.** The report is specific to the markdown renderer's BeautifulSoup re-parse; the JSON path may be unaffected. Unconfirmed, and unanswered by maintainers as of 2026-07-29.
- **Gemini 3.5 Flash pricing** for the `--use_llm` path — not researched, so no per-page cost estimate for hybrid mode.
- **CPU-mode throughput for Marker specifically on a typical cloud vCPU.** The 23.7 pg/s figure is CPU-bound work measured on a B200 *host* (a large server CPU), not a small worker instance.
