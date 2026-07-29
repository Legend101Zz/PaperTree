# MinerU / MinerU2.5 — Technical Evaluation for PaperTree

**Research date:** 2026-07-29. **Most recent primary evidence:** repo push 2026-07-29, release `v4.0.0a4` 2026-07-27, stable release `mineru-3.4.4` 2026-07-10, README changelog entry 2026-06-18.

**Verdict up front:** MinerU is now **commercially usable** and is the strongest open-source candidate reviewed so far — but only if you (a) use MinerU ≥ 3.1.0, (b) use the **hybrid** backend rather than pure VLM, and (c) accept one unresolved licence ambiguity on the pipeline weights bundle. Do **not** use MinerU 1.x/2.x: those were AGPL-3.0 code plus AGPL and CC-BY-NC-SA model weights.

---

## 1. What MinerU is, and the three-backend split

MinerU began as a rule-and-model pipeline described in *"MinerU: An Open-Source Solution for Precise Document Content Extraction"* (arXiv:2409.18839, submitted 2024-09-27, 18 authors, OpenDataLab / Shanghai AI Lab) — <https://arxiv.org/abs/2409.18839>. It has since forked into three runtime backends, documented in the repo README (<https://github.com/opendatalab/MinerU>):

| Backend | How it works | OmniDocBench v1.6 overall (vendor-reported) | Pure CPU | Min VRAM |
|---|---|---|---|---|
| `pipeline` | Classical: layout detect → formula detect/recognise → OCR/text-layer → table recognise → rule-based sort | **86.47** | ✅ Yes | 4 GB |
| `hybrid-engine` | Pipeline layout model + **native PDF text layer** + VLM only for formulas/tables/charts | **95.39** (effort=high) / 95.26 (medium) | ❌ No | 8 GB |
| `vlm-engine` | End-to-end MinerU2.5-Pro VLM does everything | **95.30** | ❌ No | 8 GB |
| `*-http-client` | Thin client, inference on a remote OpenAI-compatible server | same as above | ✅ Yes | 2 GB (client) |

Source: README hardware table, <https://github.com/opendatalab/MinerU/blob/master/README.md>. All accuracy numbers here are **self-reported by the MinerU team**, and OmniDocBench is itself an OpenDataLab product (arXiv:2412.07626, CVPR 2025, <https://arxiv.org/abs/2412.07626>) — treat the OmniDocBench wins as home-field results.

### Pipeline components (current master, verified in source)

The authoritative list is `ModelPath` in `mineru/utils/enum_class.py` (<https://raw.githubusercontent.com/opendatalab/MinerU/master/mineru/utils/enum_class.py>):

- **Layout detection + reading order:** `PP-DocLayoutV2` (215 MB), from PaddleOCR (Apache-2.0, <https://github.com/PaddlePaddle/PaddleOCR>). It replaced the old `LayoutLMv3-SFT` / `doclayout_yolo` models and also supplies reading order, replacing the separate LayoutReader model.
- **Formula recognition:** `unimernet_hf_small_2503` (814 MB) — UniMERNet, Apache-2.0 (<https://github.com/opendatalab/UniMERNet>) — plus `pp_formulanet_plus_m` (620 MB) from PaddleOCR.
- **OCR:** `paddleocr_torch` (925 MB), PP-OCRv6 as of 3.4.0, ported via PaddleOCR2Pytorch (Apache-2.0).
- **Tables:** `SlanetPlus` ONNX (7.8 MB), `UnetStructure` ONNX (8.3 MB), `paddle_table_cls` ONNX (6.8 MB).
- **Native text:** `pdftext` (Apache-2.0, <https://pypi.org/project/pdftext/>) over `pypdfium2` — see `mineru/utils/pdf_text_tool.py`, which calls `pdftext.pdf.chars.get_chars` and builds spans/lines with real character bboxes.

**Total pipeline model download ≈ 2.60 GB** (my sum of the active subset of `opendatalab/PDF-Extract-Kit-1.0` file sizes via the HF API — not a vendor figure). The VLM weights `MinerU2.5-Pro-2605-1.2B` are a further **2.33 GB**. README states min 20 GB disk.

There is **no separate formula-detection model any more** — formula regions come from `PP-DocLayoutV2` layout classes. The original YOLOv8-based MFD (arXiv:2409.18839 §2.2.2, AP50 87.7 on academic papers) is gone from the active set.

### The VLM: MinerU2.5 / 2.5-Pro

MinerU2.5 (arXiv:2509.22186 v1 2025-09-26, v2 2025-09-29, <https://arxiv.org/abs/2509.22186>) is a **1.2B** decoupled VLM: 675M NaViT encoder (init from Qwen2-VL) + 2×2 pixel-unshuffle patch merger + 0.5B Qwen2-Instruct LM. Two stages: layout on a 1036×1036 thumbnail, then content recognition on native-resolution crops up to 2048². Tables use an OTSL intermediate (5 structural tokens vs 28+, ~50% shorter sequences) converted to HTML; formulas use Atomic Decomposition & Recombination to LaTeX.

MinerU2.5-Pro (arXiv:2604.04771, <https://arxiv.org/abs/2604.04771>) keeps the architecture identical and improves only data/training (10M → 65.5M samples, three-stage pre-train → hard-sample SFT → GRPO), reaching **95.69** on OmniDocBench v1.6. The HF card for `MinerU2.5-Pro-2605-1.2B` claims **95.72** overall, TextEdit 0.036, Formula CDM 97.15, Table TEDS 93.62, ReadOrder Edit 0.123 (<https://huggingface.co/opendatalab/MinerU2.5-Pro-2605-1.2B>).

Independent-ish corroboration: on **olmOCR-bench** (AllenAI, not OpenDataLab) MinerU2.5 scores **75.2** overall vs dots.ocr 73.6, and **76.6** on arXiv Math vs Qwen2.5-VL-72B's 72.2 (arXiv:2509.22186 §5.1).

Selected OmniDocBench (v1.0-era) comparison from the MinerU2.5 paper, Table 5 — all vendor-run:

| Method | Params | Overall ↑ | TextEdit ↓ | Formula CDM ↑ | Table TEDS ↑ | ReadOrder Edit ↓ |
|---|---|---|---|---|---|---|
| Marker-1.8.2 | – | 71.30 | 0.206 | 76.66 | 57.88 | 0.250 |
| MinerU2-pipeline | – | 75.51 | 0.209 | 76.55 | 70.90 | 0.225 |
| PP-StructureV3 | – | 86.73 | 0.073 | 85.79 | 81.68 | 0.073 |
| Gemini-2.5 Pro | – | 88.03 | 0.075 | 85.82 | 85.71 | 0.097 |
| dots.ocr | 3B | 88.41 | 0.048 | 83.22 | 86.78 | 0.053 |
| **MinerU2.5** | 1.2B | **90.67** | **0.047** | **88.46** | **88.22** | **0.044** |

Note the **academic-papers** column of Table 6 specifically: MinerU2.5 text edit distance **0.0235**, versus Gemini-2.5 Pro 0.0182 and the older MinerU2-VLM **0.0104**. On the one document class PaperTree cares about, MinerU2.5 is not the best number in its own table.

---

## 2. Licensing — the decisive section

Three separate licences must be tracked.

**(a) Code — MinerU Open Source License** (<https://github.com/opendatalab/MinerU/blob/master/LICENSE.md>, © 2026). Apache-2.0 **plus additional terms**:
1. **Revenue/scale cap:** a separate commercial licence is required if you and affiliates exceed **100 million MAU** *or* **USD 20 million monthly revenue**.
2. **Attribution obligation:** any online service built on MinerU must "clearly and prominently indicate… that MinerU is used", in the product UI or public docs.
3. **Automatic termination** if either obligation is breached.

This is a Llama-style threshold licence. For PaperTree the cap is irrelevant; **the attribution obligation is a real, binding product requirement** — you must credit MinerU somewhere visible.

The change is recent and explicitly documented: release 3.1.0 (2026-04-18) "officially moved from `AGPLv3` to the MinerU Open Source License" (README changelog).

**(b) VLM weights — clean.** `MinerU2.5-Pro-2604-1.2B` and `MinerU2.5-Pro-2605-1.2B` are declared **apache-2.0** on Hugging Face. Confirmed via the HF API and the rendered card.

**(c) Pipeline weights — ambiguous, and this is the live risk.** The pipeline backend downloads from `opendatalab/PDF-Extract-Kit-1.0`, whose model card declares **`license: agpl-3.0`** (<https://huggingface.co/opendatalab/PDF-Extract-Kit-1.0>, last modified 2026-06-15). The parent GitHub repo `opendatalab/PDF-Extract-Kit` is also AGPL-3.0. Meanwhile release 3.0.0 (2026-03-29) claims MinerU "completely removed the use of two AGPLv3 models (`doclayoutyolo` and `mfd_yolov8`) and one CC-BY-NC-SA 4.0 model (`layoutreader`)" — and the current `ModelPath` confirms those three are indeed gone. So the *specific* copyleft/NC models are no longer used, but the **container repo still carries a blanket AGPL-3.0 label** over the weights you actually download. This looks like a stale card rather than intent, but it is not something to assume away.

**(d) Superseded weights.** `opendatalab/MinerU2.5-2509-1.2B` (the original 2.5 VLM) is declared **agpl-3.0**. Do not ship it. Only the `-Pro-2604`/`-Pro-2605` weights are Apache-2.0.

**Action required before adopting:** open an issue asking OpenDataLab to correct or clarify the `PDF-Extract-Kit-1.0` card, and pin your model revisions by commit SHA so a future card edit cannot retroactively change what you shipped against.

---

## 3. Does geometry survive? (Checked against the docs and schema)

Yes, comprehensively — this is MinerU's strongest fit with PaperTree. From `docs/en/reference/output_files.md` (<https://github.com/opendatalab/MinerU/blob/master/docs/en/reference/output_files.md>):

- **`middle.json`** — the developer-facing structure. Top level `pdf_info[]`, each page carrying `page_idx` (0-based), `page_size` `[width, height]`, `para_blocks`, `discarded_blocks`, `images`, `tables`, `interline_equations`. Blocks nest **Level-1 (table/image/chart) → Level-2 → lines → spans**, and **every level carries `bbox` `[x0,y0,x1,y1]`**. In the pipeline example the page_size is `[612.0, 792.0]` — i.e. **PDF points**, origin top-left, so conversion to PDF-native coordinates is a single y-flip.
- **`content_list.json`** — flat reading-order list; every entry has `page_idx` and `bbox` **normalised to 0–1000**. Types: `text`, `title`, `equation`, `image`, `table`, `chart`, `code`, `list`, `header`, `footer`, `page_number`.
- **`content_list_v2.json`** (3.0+) — page-grouped, `type` + `content` dict, optional `bbox` and `anchor`.
- **VLM `model.json`** — per-block `type`, `bbox` (normalised `[0,1]`), `angle` (0/90/180/270), `content`, optional `score`.
- **Debug artefacts** `_layout.pdf` and `_span.pdf` render the boxes over the original — genuinely useful for building a QA harness.

**Equations:** interline formulas are first-class blocks with their own bbox, recognised to LaTeX; inline formulas are spans of type `inline_equation`. Source region is retained. UniMERNet's own reported CDM on UniMER-Test is **0.968** vs Mathpix 0.951 and Texify 0.755 (arXiv:2409.18839 Table 5, adapted from the CDM paper).

**Tables:** output as **HTML** (from OTSL internally). Rows and cells are addressable by parsing that HTML, and `<td colspan/rowspan>` survives — but MinerU does **not** emit per-cell bounding boxes. Cell-level geometry is lost; only the table bbox remains.

**Figures, including vector ones:** MinerU rasterises pages with `pypdfium2` at `DEFAULT_PDF_IMAGE_DPI = 200` (`mineru/utils/pdf_image_tools.py`) and crops figure regions from that raster. So a **vector CS architecture diagram is captured** — as a 200-DPI PNG, not as vectors. Captions are linked structurally via `image_caption` / `image_footnote` Level-2 blocks under the same Level-1 `image` block. For PaperTree this is fine as a *detection* result: you get the bbox, so you can re-clip the vector region yourself at any resolution or as SVG.

**Hierarchy:** you get `title` blocks with a `text_level`, not a materialised section tree. Building the tree is a straightforward post-process, but it is post-processing you own.

**Stable block identity: absent.** There is no UUID or persistent id on blocks in `middle.json` or `content_list.json`. The only ordinal is the per-page reading-order `index` in `model.json`, which will shift if layout inference changes between versions. **PaperTree must synthesise its own anchor scheme** (e.g. `sha256(page_idx ‖ quantised bbox ‖ normalised text prefix)`) and treat re-parse migration as a first-class problem.

**Hallucination:** the README explicitly labels `pipeline` "no hallucination" and `hybrid-engine` "native text extraction, low hallucination", while plain `vlm` carries no such claim; the MinerU2.5 paper repeatedly names hallucination as the failure mode of end-to-end VLMs. Source inspection confirms the mechanism: `mineru/backend/hybrid/hybrid_analyze.py` builds `not_extract_list` from `NotExtractType` (TEXT, TITLE, HEADER, FOOTER, PAGE_NUMBER, REF_TEXT, TABLE_CAPTION, IMAGE_CAPTION, …) and passes it to the VLM so those block types are **never generated** — their text comes from the PDF character stream via `pdftext`. The VLM only writes formulas, tables, charts and code. **This is the configuration PaperTree should use.** Uncertainty is only weakly representable: pipeline spans carry a `score` (1.0 for text-layer, OCR confidence otherwise); VLM blocks carry an optional `score`.

---

## 4. Cost, speed and deployment

- **CPU:** only the `pipeline` backend runs CPU-only (86.47 OmniDocBench v1.6). **I found no vendor-published CPU pages/second figure.** The 3.4.0 changelog claims OCR processing is ~100% faster and PP-OCRv6 lifts OCR accuracy ~11% on OmniDocBench v1.6, but gives no absolute CPU latency.
- **GPU throughput (vendor, vLLM, MinerU2.5, 1,355 OmniDocBench pages)** — arXiv:2509.22186 Table 3: RTX 4090 48G **1.70 pages/s** (1875.82 tok/s); A100 80G **2.12 pages/s** (2337.25 tok/s); H200 141G **4.47 pages/s** (4938.31 tok/s). Unoptimised baseline 0.95 pages/s. Claimed 4× MonkeyOCR-Pro-3B and 7× dots.ocr in page throughput.
- **Hybrid `effort=medium`** (default since 3.3) costs 0.13 OmniDocBench points versus `high` while giving 35–220% speedups (macOS text-PDF ~220%, Linux text-PDF ~80%). `medium` disables image/chart analysis.
- **Deployment:** `pip install "mineru[all]"`, Python 3.10–3.13, Docker for Linux/WSL2, base image vLLM 0.11.2 + torch 2.9.0. `mineru-api` exposes sync `POST /file_parse` and async `POST /tasks`; `mineru-router` load-balances across GPUs. Thread-safe since 3.0.0; sliding-window + streaming disk writes cap peak memory on long documents.
- **Realistic PaperTree shape:** CPU `pipeline` for the free tier and cold-start ingestion; a single GPU worker running `hybrid-http-client` against a shared `mineru-api` for the quality path. The `*-http-client` backends need only 2 GB VRAM and ~2 GB disk on the client, which makes the split clean.

## 5. Maintenance

Genuinely healthy and fast-moving. Repo created 2024-02-29; **last push 2026-07-29** (today); stable releases roughly fortnightly — `3.4.4` (2026-07-10), `3.4.3` (07-08), `3.4.2`/`3.4.1` (07-03), `3.4.0` (06-18), `3.3.1`/`3.3.0` (06-11), `3.2.3` (06-04) — plus a `v4.0.0a4` alpha on 2026-07-27. **70 open issues** at time of check.

Issue *character* is the useful signal, and it is mixed. Recent open bugs include: CNKI PDFs losing ~52% of inline digits/punctuation in text mode (fixed only by forcing `--ocr`); "MinerU API — RSS grows unbounded across documents until OOM"; pipeline backend failing at 100% on a 104-page PDF; **"author order recognised incorrectly when analysing research papers"**; formula-number parsing emitting spurious parentheses; and table-internal formulas exported as bare LaTeX / `<eq>` tags that Markdown cannot render. Several are directly in PaperTree's blast radius. Maintainers respond and label promptly, and many items are already tagged `MERGED`.

---

## Implications for PaperTree

**Adopt — with conditions.** MinerU is the first system reviewed that satisfies most hard requirements simultaneously.

| PaperTree requirement | MinerU status |
|---|---|
| Page + bbox on every element | ✅ `middle.json` at block/line/span level, PDF points; `content_list.json` 0–1000 normalised |
| Stable addressable block identity | ❌ **Absent.** Must be synthesised by PaperTree |
| Section hierarchy | ⚠️ Partial — `title` blocks with `text_level`; tree must be assembled |
| Equations → LaTeX + source region | ✅ Interline + inline, bbox retained, UniMERNet-class quality |
| Figures with captions, incl. vector | ⚠️ Detected and caption-linked; delivered as 200-DPI raster crops. Re-clip vectors yourself from the bbox |
| Tables with row/cell addressability | ⚠️ HTML with colspan/rowspan (rows/cells addressable); **no per-cell bboxes** |
| No silent hallucination | ✅ in `pipeline` / `hybrid`; ❌ risk in pure `vlm` |
| Uncertainty representable | ⚠️ Weak — `score` on pipeline spans, optional on VLM blocks |
| Runs without a dedicated GPU | ✅ `pipeline` CPU-only at 86.47; GPU worker optional via `hybrid-http-client` |

**Recommended configuration:** `hybrid-engine` with `effort=high` on the GPU worker; `pipeline` on CPU for the no-GPU path. Pin `mineru>=3.1.0` (never 1.x/2.x — those are AGPL) and pin `MinerU2.5-Pro-2605-1.2B` by revision SHA.

**Non-negotiable follow-ups before committing:**
1. Get written clarification on the `PDF-Extract-Kit-1.0` AGPL-3.0 card, or run hybrid/VLM-only so the only weights you ship are the Apache-2.0 Pro model.
2. Add a visible "Powered by MinerU" attribution — the licence requires it for online services.
3. Design the block-identity/anchor-migration layer yourself; MinerU will not give you one.
4. Build a QA harness on `_layout.pdf` / `_span.pdf` before trusting output, given the open text-loss and author-ordering bugs.

---

## What I could not verify

- **CPU throughput.** No vendor pages/second or seconds/page figure for the `pipeline` backend on CPU exists in the README, docs, or any paper I read. All published throughput numbers are GPU + vLLM. This must be benchmarked locally on representative arXiv PDFs before any costing decision.
- **The AGPL status of the pipeline weights in practice.** I confirmed the card says `agpl-3.0` and that the three named copyleft/NC models were removed, but I could not find any statement from OpenDataLab reconciling the two. I did not obtain legal confirmation of which reading governs.
- **Whether `PP-DocLayoutV2` weights redistributed inside `PDF-Extract-Kit-1.0` carry PaddleOCR's Apache-2.0 terms or the container's AGPL label.** No per-model licence notes exist inside that HF repo.
- **All OmniDocBench figures are vendor-run**, on a benchmark authored by the same lab. Only the olmOCR-bench result (75.2) comes from a third-party benchmark, and even that run was executed by the MinerU team. I found no fully independent third-party evaluation of MinerU 3.x.
- **OmniDocBench version incomparability.** The README quotes v1.6 (86.47 / 95.39 / 95.30); the MinerU2.5 paper quotes an earlier version (90.67); MinerU 3.0.0's changelog quotes v1.5 (86.2). These are **not** directly comparable across benchmark versions, and I did not find a conversion or re-run on a single version.
- **Exact download footprint at runtime.** The 2.60 GB pipeline / 2.33 GB VLM figures are my own sums over the Hugging Face file listings for the paths named in `ModelPath`. MinerU may apply `allow_patterns` narrowing this further; I did not execute `mineru-models-download` to confirm.
- **GitHub API rate limits** truncated my issue survey to the 30 most recent open issues; I did not review the full 70, nor the closed-issue backlog, so the bug characterisation is a sample, not a census.
- **MinerU-Diffusion** (arXiv:2603.22458) and the `v4.0.0` alpha line are cited in the README but I did not evaluate either; v4 may change backends, output schema, or licensing.
