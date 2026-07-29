# 06 — Nougat, olmOCR / olmOCR 2, and VLM-based Document OCR

**Research date:** 2026-07-29. Most recent primary evidence found: olmOCR release v0.4.27 (2026-03-12), MinerU repo push (2026-07-29), MonkeyOCR repo push (2026-07-20), PaddleOCR-VL model card update (2026-06-27), Chandra 2 (2026-03), Dolphin-v2 (2025-12-12).

**Bottom line up front:** end-to-end VLM OCR is now genuinely accurate on the text/math/table axis, but the *architecture family* splits into two groups with completely different consequences for PaperTree. Group A (Nougat, olmOCR, olmOCR 2, Mistral OCR's markdown path) emits a **linearised text blob with no geometry** — structurally incompatible with PaperTree's highlight-anchoring requirement. Group B (dots.ocr/dots.mocr, PaddleOCR-VL, Dolphin-v2, Chandra, GOT-OCR2.0's fine-grained mode, DeepSeek-OCR grounding mode) emits **`{bbox, label, content}` JSON**, which is compatible in principle. Within Group B, licensing prunes the field hard.

---

## 1. Nougat (Meta AI, 2023)

**Paper:** Blecher, Cucurull, Scialom, Stojnic, "Nougat: Neural Optical Understanding for Academic Documents", arXiv 2308.13418, submitted 25 Aug 2023 — https://arxiv.org/abs/2308.13418

**Architecture.** Donut-style encoder–decoder. Swin Transformer encoder at 896×672 px (96 DPI), mBART-style decoder with cross-attention. Small = 250M params / 4 decoder layers / 3,584 max sequence length; Base = 350M params / 10 layers / 4,096 max seq len (https://ar5iv.labs.arxiv.org/html/2308.13418).

**Training data.** 8,204,854 pages: arXiv 7,511,745 (from 1,748,201 articles with LaTeX source), PMC 536,319, IDL 446,777 (same source).

**Reported accuracy** (authors' own arXiv-derived test set, so vendor-reported):

| System | Modality | Edit dist ↓ | BLEU | F1 |
|---|---|---|---|---|
| PDF embedded text | All | 0.255 | 65.8 | 79.2 |
| GROBID | All | 0.312 | 55.6 | 73.0 |
| GROBID + LaTeX-OCR | Math | 0.727 | 0.3 | 9.7 |
| Nougat small | All | 0.073 | 88.9 | 92.9 |
| Nougat base | All | 0.071 | 89.1 | 93.1 |
| Nougat base | Math | 0.128 | 56.9 | 76.5 |
| Nougat base | Tables | 0.211 | 69.7 | 78.0 |

Math is where Nougat genuinely beats the classical stack (F1 76.5 vs 9.7). Tables are its weakest modality.

**Failure modes, stated by the authors.** "The primary challenge to solve is the tendency for the model to collapse into a repeating loop." Repetition observed on **1.5% of in-domain test pages, rising out-of-domain**; anti-repetition training augmentation cut out-of-domain failed conversions by 32%. Inference-time detection uses a logit-variance sliding window (B=15, threshold 6.75) which emits `[MISSING_PAGE]` rather than text. The model is trained **one page at a time with no cross-page state**, producing "inconsistencies across the document". Non-Latin scripts cause "instant repetitions" (same source).

**Bounding boxes: none.** The inference package (`nougat/`: `model.py`, `postprocessing.py`, `transforms.py`, `metrics.py`, `utils/`, `dataset/`) contains no geometry-output module (https://github.com/facebookresearch/nougat/tree/main/nougat). Output is a `.mmd` Mathpix-Markdown-compatible file only (https://github.com/facebookresearch/nougat). The paper itself notes GROBID provides formula bounding boxes as a *contrast* to Nougat.

**Licence — decisive.** Code: MIT. **Model weights: CC-BY-NC** per the README, confirmed by the model card `license: cc-by-nc-4.0` on https://huggingface.co/facebook/nougat-base. **Non-commercial. PaperTree cannot ship Nougat weights.**

**Speed.** NVIDIA A10G 24GB, 6 pages in parallel, 19.5 s/batch for base ≈ **0.31 pages/s** (~1,400 tokens/page). GROBID is cited at 10.6 PDF/s. Nougat is roughly 30× slower per page than a classical parser and is not viable CPU-only.

**Maintenance — effectively abandoned.** Only two releases ever, both 2023-08-22 (`0.1.0-small`, `0.1.0-base`) — https://github.com/facebookresearch/nougat/releases. Commit history: a cluster in Oct 2023, then a single commit on 2025-02-21 and nothing since (commits atom feed). 143 open issues. Recent issues are dependency rot and quality complaints: #263 "PDFDocument object has no attribute 'render'" (pdfium breakage, Dec 2025), #264 a *community-authored* "Installation and Stability Report 2025: Fixes for pypdfium2, API crashes, and Transformers segfaults", #260 "nougat giving lots of incorrect latex tables", #271 empty predictions (Apr 2026) — https://github.com/facebookresearch/nougat/issues. **Verdict: dead project, non-commercial weights, no geometry. Reject.**

---

## 2. olmOCR and olmOCR 2 (Allen Institute for AI)

**Papers:** Poznanski et al., "olmOCR: Unlocking Trillions of Tokens in PDFs with Vision Language Models", arXiv 2502.18443 (25 Feb 2025, rev. 2 Jul 2025) — https://arxiv.org/abs/2502.18443 ; Poznanski, Soldaini, Lo, "olmOCR 2: Unit Test Rewards for Document OCR", arXiv 2510.19817 (22 Oct 2025) — https://arxiv.org/abs/2510.19817

**Document anchoring — the key technique, and the key irony.** olmOCR uses `pypdf` to extract **text blocks with their coordinates and image-block positions** from the born-digital PDF, concatenates them, and injects them into the VLM prompt alongside the page raster. Budget: 6,000 characters during training (~1,800 tokens of anchor text vs ~1,000 tokens of page image, ~3,000 input tokens total), with exponential backoff on overflow (https://arxiv.org/html/2502.18443v3). Ablation: GPT-4o unanchored 68.9 → anchored 69.9 on olmOCR-Bench (+1.0 pt). **So geometry is consumed as input and then discarded — the output contains none of it.** For PaperTree this is exactly backwards: we already have the coordinates olmOCR is throwing away.

**olmOCR 2 training.** Base model Qwen2.5-VL-7B-Instruct; SFT on olmOCR-mix-1025 (267,962 pages from 100k+ PDFs); then RLVR with GRPO on olmOCR2-synthmix-1025 — 2,186 synthetic PDF pages yielding 30,381 binary unit tests, generated by having Claude Sonnet 4 produce semantically-equivalent HTML (~$0.12/page). 28 completions per document, KL β=0.01, one epoch on an **8×H100 node**, then weight-averaging ("model souping") of six seeds (https://arxiv.org/html/2510.19817v1).

**olmOCR-Bench results** (7,000+ test cases over 1,400 documents), from the maintained table at https://github.com/allenai/olmocr:

| System | ArXiv | Old scans math | Tables | Old scans | Multi-col | Overall |
|---|---|---|---|---|---|---|
| Mistral OCR API | 77.2 | 67.5 | 60.6 | 29.3 | 71.3 | 72.0 ±1.1 |
| MinerU 2.5.4 | 76.6 | 54.6 | 84.9 | 33.7 | 78.2 | 75.2 ±1.1 |
| DeepSeek-OCR | 77.2 | 73.6 | 80.2 | 33.3 | 66.4 | 75.7 ±1.0 |
| Marker 1.10.1 | 83.8 | 66.8 | 72.9 | 33.5 | 80.0 | 76.1 ±1.1 |
| PaddleOCR-VL | 85.7 | 71.0 | 84.1 | 37.8 | 79.9 | 80.0 ±1.0 |
| **olmOCR 2 (v0.4.0)** | 83.0 | 82.3 | 84.9 | 47.7 | 83.7 | **82.4 ±1.1** |
| Chandra OCR 0.1.0 | 82.2 | 80.3 | 88.0 | 50.4 | 81.2 | 83.1 ±0.9 |
| dots.mocr (self-reported) | — | — | — | — | — | 83.9 ±0.9 |

Reference points from the olmOCR 2 paper: GPT-4o 68.9, Qwen2.5-VL 65.5, Gemini Flash 2 57.8, GOT-OCR 48.3. **olmOCR-Bench is a text-property benchmark** — its unit tests assert things like "table structure preserved", "math faithfully transcribed", "reading order consistent" (https://allenai.org/blog/olmocr-2). It contains no geometric assertions, so a high score says nothing about whether a system can anchor a highlight.

**Cost and hardware.** Published: L40S 906 tok/s → **$176 per million pages**; H100 3,050 tok/s → $178/M (paper Table 6), vs GPT-4o batch at $6,240/M. olmOCR 2 blog claims 3,400 output tok/s on a single H100 and "10,000 pages for less than $2" (= $200/M), consistent. README: **minimum 12 GB VRAM**, tested on RTX 4090 / L40S / A100 / H100, 30 GB disk. **These are all GPU numbers — there is no meaningful CPU path for a 7B VLM.**

**Geometry: none.** Output is YAML front-matter (`primary_language`, `is_rotation_valid`, `rotation_correction`, `is_table`, `is_diagram`) followed by linearised markdown text (https://huggingface.co/allenai/olmOCR-2-7B-1025). No coordinates anywhere.

**Hallucination handling.** Repetition is mitigated by dynamic temperature escalation (0.1 → 0.8) triggered by failure to emit EOS. The v0.3.0 release notes explicitly list "fixes ... hallucinations on blank documents" — a real, shipped bug where the model invented content on empty pages (https://github.com/allenai/olmocr). That is a concrete instance of the exact failure PaperTree cannot tolerate.

**Licence — clean.** Code Apache-2.0 (repo SPDX). Weights Apache-2.0 (`license: apache-2.0` on the model card). Data (olmOCR-mix-1025, olmOCR2-synthmix-1025) Apache-2.0. The model card adds "intended for research and educational use in accordance with Ai2's Responsible Use Guidelines" — this is a *stated intent*, not a licence restriction; Apache-2.0 grants commercial rights. Worth a legal skim before shipping, but this is the most commercially usable weight licence in the field.

**Maintenance — healthy.** Repo pushed 2026-03-25, 87 open issues, releases v0.4.19 → v0.4.27 between 2026-01-20 and 2026-03-12 (https://github.com/allenai/olmocr/releases).

---

## 3. The rest of the field

| System | Code licence | Weights licence | Geometry output? | Params | Latest evidence |
|---|---|---|---|---|---|
| **Nougat** | MIT | **CC-BY-NC-4.0** ✗ | **No** | 250M / 350M | Last commit 2025-02-21 |
| **olmOCR 2** | Apache-2.0 | Apache-2.0 ✓ | **No** | 7B | v0.4.27, 2026-03-12 |
| **dots.ocr / dots.mocr** | MIT | **MIT** ✓ | **Yes** — JSON `{bbox:[x1,y1,x2,y2], category, text}` | 3B (1.7B LLM) | Repo push 2026-03-24 |
| **PaddleOCR-VL** | Apache-2.0 | Apache-2.0 ✓ | **Yes** — `block_bbox`, `block_label`, `block_content`, `block_id`, `block_order` | ~0.9–1.0B (NaViT + ERNIE-4.5-0.3B) | Card 2026-06-27 |
| **DeepSeek-OCR** | MIT | MIT ✓ | **Partial** — `<\|grounding\|>` prompt mode | 3B MoE (A570M active) | Repo push 2026-01-27 |
| **GOT-OCR2.0** | Apache-2.0 (badge); data CC-BY-NC-4.0 | Apache-2.0 | Box as **input** (crop), not output | 0.58–0.7B | Last push 2025-02-10, 232 open issues — stale |
| **Dolphin-v2** | README badge says MIT; **repo `LICENSE` is the Qwen RESEARCH LICENSE (non-commercial)**, committed 2025-12-17 ✗ | Built on Qwen2.5-VL-3B, which is itself Qwen Research (non-commercial) | **Yes** — absolute pixel coords, 21 element classes | 3–4B | Repo push 2026-03-25 |
| **MonkeyOCR** | Apache-2.0 | **"academic research and non-commercial evaluation only"** ✗ | Yes (SRR triplet) | 1.2B / 3B | Repo push 2026-07-20 |
| **Marker / Chandra** (Datalab) | Apache-2.0 | **Modified AI-Pubs OpenRAIL-M — free only under $5M funding/revenue** ⚠ | Yes — "markdown, html, or json with detailed layout information" | — | Chandra 2, 2026-03 |
| **MinerU** | Apache-2.0 **+ additional terms**: commercial licence required above 100M MAU **or** $20M/month revenue; online services must attribute ⚠ | same | Yes | — | Push 2026-07-29 |
| **Mistral OCR** | Proprietary API | N/A (self-host "selectively available") | **Yes** — `include_blocks=True` returns `top_left_x/y`, `bottom_right_x/y`, `type`, `content` | — | Docs current |

Sources: https://github.com/studio-dots-ai/dots.ocr (LICENSE = MIT, © rednote-hilab) and https://huggingface.co/dots-studio/dots.mocr (`license: mit`); https://huggingface.co/PaddlePaddle/PaddleOCR-VL and https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/PaddleOCR-VL.en.md; https://arxiv.org/abs/2510.18234; https://huggingface.co/stepfun-ai/GOT-OCR2_0 and https://github.com/Ucas-HaoranWei/GOT-OCR2.0; https://github.com/bytedance/Dolphin/blob/master/LICENSE and https://huggingface.co/ByteDance/Dolphin-v2; https://github.com/Yuliang-Liu/MonkeyOCR (README §"License and Commercial Use"); https://github.com/datalab-to/marker (§"Commercial usage"); https://github.com/opendatalab/MinerU/blob/master/LICENSE.md; https://docs.mistral.ai/capabilities/OCR/basic_ocr/ and https://mistral.ai/news/mistral-ocr.

**Notes on individual systems.**

- **DeepSeek-OCR** (arXiv 2510.18234) is the interesting research result rather than the best parser: <10× token compression → 97% OCR precision, 20× → ~60%. Claims 200k+ pages/day on a single A100-40G, and beats GOT-OCR2.0 on OmniDocBench with 100 vision tokens vs 256. Scores 75.7 on olmOCR-Bench. The 20×/60% figure is an explicit statement that the model *degrades into paraphrase* under compression — an unusually honest hallucination disclosure.
- **Mistral OCR** self-reports 94.89 overall on its own internal benchmark vs GPT-4o 89.77 and Google Document AI 83.42, and 2,000 pages/min/node at $1 per 1,000 pages. Independently, olmOCR-Bench places it at **72.0 — last in the current table**. Treat the vendor numbers with suspicion. Its saving grace is that `include_blocks=True` returns real bounding boxes for paragraphs, titles, lists, tables, images, equations, captions, code, references, headers, footers and signatures.
- **Dolphin-v2 is the trap.** README badge says MIT; the actual `LICENSE` file in the repo is Alibaba's Qwen RESEARCH LICENSE — "FOR NON-COMMERCIAL PURPOSES ONLY", governed by the law of China, Hangzhou courts — and it was committed on 2025-12-17, five days after Dolphin-v2 shipped. Dolphin-v2 is built on Qwen2.5-VL-**3B**, which (unlike the 7B, which is Apache-2.0) carries the Qwen Research licence. Dolphin **v1** (0.4B Swin+mBART, https://huggingface.co/ByteDance/Dolphin) is MIT. Do not rely on the badge.
- **dots.mocr's SVG mode** parses charts and diagrams into *generated* SVG code (Unisvg 0.902). This is a reconstruction, not an extraction — precisely the kind of plausible-but-invented artefact PaperTree must not present as source.

---

## 4. Critical analysis: where VLM OCR conflicts with PaperTree

| PaperTree hard requirement | Group A (Nougat, olmOCR 2) | Group B (dots.mocr, PaddleOCR-VL) |
|---|---|---|
| Page + bbox in PDF coords for every element | **Fails outright** — no coordinates at any granularity | Partial: block-level bbox in *image pixel* space; needs an affine map back to PDF user space, and gives no word/char-level geometry |
| Stable block identity across re-parses | **Fails** — output is sampled from a stochastic decoder; re-running can renumber, resegment or reword. Highlights would drift silently | Partial: `block_id`/`block_order` exist but are positional, not content-stable; IDs shift when segmentation changes |
| Section tree | Inferred from markdown heading levels only | Layout labels give element classes; tree must still be reconstructed |
| Equations as LaTeX **with source region** | LaTeX yes (Nougat math F1 76.5; olmOCR 2 old-scans-math 82.3), **source region no** | LaTeX + bbox for the formula block — usable |
| Figures with captions, **including vector** | No | Bbox for `picture`/`figure` blocks. **No system extracts vector drawing primitives** — you get a rectangle, and must clip/render the original PDF content stream yourself. dots.mocr's SVG regeneration is a hallucination risk, not a solution |
| Table cell addressability | HTML/LaTeX table string; no per-cell geometry | Table bbox + HTML; per-cell geometry still absent |
| No silent rewriting; representable uncertainty | **This is the fundamental conflict.** An autoregressive decoder cannot distinguish "the source said X" from "X is the likeliest continuation". Nougat: repetition on 1.5% of in-domain pages. olmOCR: shipped a hallucination-on-blank-pages fix in v0.3.0. There is no calibrated per-token confidence exposed by any of these pipelines | Same generative risk, but bbox-scoped: an error is at least localised to a region you can re-render and show the user |
| Runs without a dedicated GPU | Nougat 0.31 pages/s on an A10G; olmOCR 2 needs ≥12 GB VRAM. **Neither is CPU-viable** | PaddleOCR-VL at ~0.9B is the only plausible near-CPU candidate, and even that is slow |

The deeper structural point: **PaperTree's PDF already contains the geometry as ground truth.** olmOCR's own document-anchoring result proves this — AI2 goes to the trouble of extracting text-block coordinates with `pypdf` and feeding them to the model, then produces output that contains none of them. Using a Group-A VLM means discarding verified geometry to obtain a *guess* at the same text. For a born-digital arXiv PDF, that is a strictly worse trade on every axis except math and table markup.

### Where a VLM is nonetheless the right answer

1. **Scanned / image-only PDFs**, where there is no text layer to preserve. Here geometry must be invented regardless, and a VLM is competitive with any alternative. olmOCR 2's old-scans scores (47.7 old scans, 82.3 old-scans-math) are the strongest published in the table.
2. **Equation regions specifically.** Crop the formula bbox from the deterministic layout pass and send *only that crop* to a VLM for LaTeX. Geometry is retained by construction (the crop's bbox is the provenance), the failure is contained to one equation, and the user can be shown the source pixels beside the rendered LaTeX. This is the single highest-value VLM use in PaperTree.
3. **Complex table structure**, same pattern — bbox-scoped, HTML out, rendered crop kept as provenance.
4. **A quality-check oracle**, not a producer: run a VLM over a page and diff its text against the deterministic extraction to flag pages needing review. The VLM's output is never shown to the user.

**Recommended posture:** deterministic geometry-first extraction as the spine; VLM as a *bbox-scoped* recogniser invoked on regions, never as a whole-page replacement. Every VLM-produced string must be tagged in the data model with `source: vlm`, `model_id`, `region_bbox` and a `verified: false` flag, so provenance and uncertainty are first-class rather than lost.

**If a full-page VLM fallback is needed** (scans), the shortlist on licence + geometry is: **PaddleOCR-VL** (Apache-2.0 both, emits `block_bbox`, ~1B so cheapest to host) and **dots.mocr** (MIT both, emits bbox JSON, top olmOCR-Bench self-report). **olmOCR 2** is the accuracy/licence leader but is geometry-blind, so it only fits use (4) or a text-only path. **Nougat, MonkeyOCR and Dolphin-v2 are eliminated on licence alone.** Marker/Chandra and MinerU are usable now but carry revenue triggers to re-check before scale.

---

## 5. Implications for PaperTree

- **Do not replace the parsing stack with a full-page VLM.** No Group-A system satisfies requirement #1 (geometry) or #7 (no silent rewriting). Adopting one would make stable highlight anchoring impossible, not merely hard.
- **Nougat is a dead end twice over**: CC-BY-NC weights block commercial use, and the project has had two commits since October 2023.
- **olmOCR 2 is the best-licensed, best-benchmarked open VLM** and worth keeping as an evaluation oracle and a scanned-PDF fallback, but its output shape is wrong for our data model.
- **Budget for a GPU worker if scans matter.** $176–200 per million pages is genuinely cheap, but it is a GPU-only number; there is no honest CPU path for a 7B VLM.
- **Vector figures remain unsolved by every system reviewed.** The correct implementation is a deterministic clip of the PDF content stream by bbox, with the VLM used at most to generate a caption or alt-text — clearly labelled as generated.
- **Design the schema now** so any VLM-derived field carries model id, region bbox, and an unverified flag. Retrofitting provenance after the fact is much harder than designing for it.

---

## 6. What I could not verify

- **olmOCR-Bench's exact unit-test taxonomy.** I confirmed the categories and scores from the maintained README table and the AI2 blog, but did not read the benchmark source to confirm that *no* test asserts geometric properties. My claim that it is a text-only benchmark is a strong inference from the described test types, not a verified fact.
- **The Dolphin licence contradiction.** I verified that `LICENSE` at `bytedance/Dolphin@master` is the Qwen Research License (non-commercial), last touched by commit "Update LICENSE" on 2025-12-17, while the README still shows an MIT badge. I could not find a statement from ByteDance reconciling the two. Treat Dolphin-v2 as non-commercial until they clarify. The Dolphin-v2 HF card did not surface an explicit `license:` tag in my fetch.
- **Qwen2.5-VL-3B's licence** returned `null` from the HuggingFace API `cardData`; my statement that it is Qwen Research (vs Apache-2.0 for the 7B) is inferred from the Dolphin repo's licence choice and is not directly confirmed here.
- **DeepSeek-OCR's grounding coordinate format.** The README shows `<|grounding|>` and `<|ref|>` prompts, but does not document the coordinate encoding (normalised 0–999? absolute pixels?). I did not read the model code to confirm.
- **Mistral OCR self-hosting terms and pricing** — described only as "selectively available", no terms published.
- **MonkeyOCR-pro-1.2B's HF card carries no `license:` field**; the non-commercial restriction comes from the GitHub README's "License and Commercial Use" section, which refers to "MonkeyOCR v1 model weights". Whether newer `pro` checkpoints are covered by the same restriction is ambiguous.
- **Nougat maintainer responsiveness** — I could see issue titles and dates but could not confirm from the listing page whether maintainers replied. GitHub API rate limits blocked deeper inspection; no authenticated token was available.
- **dots.ocr / dots.mocr benchmark numbers (olmOCR-Bench 83.9, OmniDocBench TextEdit 0.031) are self-reported** by the model authors and do not appear in AI2's independently-run table.
- **Mistral OCR's 94.89 benchmark** is on an undisclosed internal benchmark and is not reproducible from public data.
- **No independent third-party reproduction** of any of these leaderboard numbers was found; every figure here traces to either the model authors or AI2's olmOCR-Bench harness.
