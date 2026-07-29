# 11 — Multimodal and Late-Interaction Retrieval over Document Pages

**Research date:** 2026-07-29. **Most recent primary evidence found:** VisRAG repo commit 2026-07-17; `colpali-engine` release v0.3.17 on 2026-06-08 and last commit 2026-06-10; NanoVDR (arXiv 2603.12824v2, 2026-05-28); Visual RAG Toolkit (arXiv 2602.12510, 2026-02-16).

**Framing correction up front.** This topic cannot "replace a production parsing stack." Every system below is a *ranking* layer: it returns a page (occasionally a region), not a structured document. None of them produce section hierarchy, LaTeX, table cell addressability, stable block IDs, or caption linkage. ColPali's own authors describe it as page-level retrieval ([arXiv:2407.01449](https://arxiv.org/abs/2407.01449)). So the decision in front of PaperTree is *complement or not*, and at what price — not *replace*.

---

## 1. The late-interaction foundation: ColBERT / ColBERTv2

ColBERT stores one vector per token and scores with MaxSim (sum over query tokens of the max dot product against all document vectors). The cost is storage. ColBERTv2 attacks exactly that with residual compression — each vector is stored as a centroid ID plus a quantised residual — reducing "the space footprint of late interaction by 6–10× while preserving quality" ([arXiv:2112.01488](https://arxiv.org/pdf/2112.01488)). PLAID adds centroid-pruning to cut latency ([arXiv:2205.09707](https://arxiv.org/pdf/2205.09707)). Code at [stanford-futuredata/ColBERT](https://github.com/stanford-futuredata/ColBERT) is MIT but slowing: last commit 2025-10-14 (verified via the repo commit feed). Everything ColPali does with storage is inherited from here.

## 2. ColPali and the ViDoRe benchmark

ColPali feeds a page *image* to PaliGemma-3B, keeps all 1,024 patch embeddings projected to D=128, and scores with MaxSim. Headline result on ViDoRe v1: **81.3 nDCG@5 average vs 67.0 for the best text baseline** (Unstructured + Claude-3-Sonnet captioning + BGE-M3) ([arXiv:2407.01449v3](https://arxiv.org/html/2407.01449v3), Table 2).

The per-dataset breakdown matters far more to PaperTree than the average, because ViDoRe contains **ArxivQA** — figure-grounded questions over arXiv papers:

| System (ViDoRe v1, nDCG@5) | ArxivQA | TabFQuAD | Avg |
|---|---|---|---|
| Unstructured + Captioning + BM25 | 40.1 | 35.4 | 65.1 |
| Unstructured + Captioning + BGE-M3 | 35.7 | 69.1 | 67.0 |
| SigLIP (vanilla, zero-shot) | 43.2 | 58.1 | 51.4 |
| BiSigLIP (fine-tuned single-vector) | 58.5 | 62.7 | 58.6 |
| BiPali (single-vector VLM) | 56.5 | 76.9 | 58.8 |
| **ColPali** | **79.1** | **83.9** | **81.3** |

Source: [arXiv:2407.01449v3](https://arxiv.org/html/2407.01449v3) Table 2. **On arXiv-style figure retrieval, caption+OCR pipelines score 35.7–40.1 and ColPali scores 79.1 — a ~2× gap.** This is the single strongest argument for visual retrieval in PaperTree's exact domain.

Cost side, all self-reported by the authors on an NVIDIA L4 ([arXiv:2407.01449v3](https://arxiv.org/html/2407.01449v3) §5.2, Table 5):

- **Index size: 257.5 KB per page** (1024 patches × 128 dims, bfloat16).
- **Indexing: 0.39 s/page** vs 7.22 s/page for the Unstructured pipeline (layout 0.81 + OCR 2.67 + captioning 3.71 + encoding 0.03) and 0.12 s/page for SigLIP.
- **Query: ~30 ms** to encode (BGE-M3: 22 ms), plus **≈1 ms per 1,000 pages** for MaxSim.
- Halving patches to 512 costs **−24.8 nDCG@5**; ColIdefics2 with only 64 patches is just −4.7 vs ColPali(1024) but ~2× slower. Patch count is not a free storage dial — backbone quality buys more than patch count.

ViDoRe v1 is now saturated ("exceeding 90% nDCG@5", [arXiv:2505.17166](https://arxiv.org/abs/2505.17166), v2 revised 2025-09-19); ViDoRe v2 and v3 are the discriminating benchmarks in 2026.

## 3. Comparison table

Index/page figures are computed from the cited token-count × dim × precision unless the source states them directly.

| System | Arch | Weights licence | Index / page | ViDoRe v1 · v2 · v3 (nDCG@5) | CPU query encode | Maintenance |
|---|---|---|---|---|---|---|
| **ColPali v1.x** | PaliGemma-3B, 1024×128 multi-vector | **Gemma Terms** (backbone) + MIT adapters ([card](https://huggingface.co/vidore/colpali-v1.3)) | **257.5 KB** | 84.2 · 54.7 · 42.0 | **7,284 ms** (1 thread) | active |
| **ColQwen2-v1.0** | Qwen2-VL-2B, ≤768×128 | **Apache-2.0** backbone + MIT adapters ([card](https://huggingface.co/vidore/colqwen2-v1.0)) | ~192 KB | +5.1 over ColPali-v1.1 (vendor) | not measured | active |
| **ColQwen2.5-v0.2** | Qwen2.5-VL-3B | ⚠️ **Qwen RESEARCH LICENSE** — non-commercial ([card](https://huggingface.co/vidore/colqwen2.5-v0.2)) | ~192 KB | 89.5 · 61.5 · — | 158 ms (128-core) | active |
| **ColModernVBERT** | ModernVBERT-250M, early fusion | **MIT** ([card](https://huggingface.co/ModernVBERT/colmodernvbert)) | 80 KB @1024px (320 tok) | 81.2 · 56.0 (eng) · 17.4 | **20 ms** | repo last commit 2025-10-16 |
| **Tomoro-ColQwen3-4B** | Qwen3-VL-4B multi-vector | **Apache-2.0** ([card](https://huggingface.co/TomoroAI/tomoro-colqwen3-embed-4b)) | ~256 KB | 90.6 · 66.0 · 59.3 (vendor) | ~7 s class | new |
| **ColNomic-3B / Jina-v4** | Qwen2.5-VL-3B | ⚠️ **Qwen Research Licence** ([jina-v4](https://huggingface.co/jinaai/jina-embeddings-v4)) | ~192–256 KB | 89.8 · 61.2 · — | — | active |
| **DSE-Qwen2** | Qwen2-VL-2B, **single 1536-d vector** | Apache-2.0 backbone | **6.1 KB** (fp32) | 85.1 · 55.7 · 41.3 | 2,539 ms | — |
| **DSE (orig.)** | Phi-3-vision-4B, single vector | MIT backbone ([arXiv:2406.11251](https://arxiv.org/html/2406.11251v1)) | single vector | +17 pts top-1 over BM25 (Wiki-SS); 75.3 nDCG@10 SlideVQA | — | — |
| **VisRAG-Ret** | MiniCPM-V 2.0, single vector | ⚠️ **MiniCPM Model Licence** — commercial free *after registration form* ([repo](https://github.com/OpenBMB/VisRAG)) | single vector | 20–40% e2e gain (self-reported) | — | commit 2026-07-17 |
| **M3DocRAG** | ColPali + Qwen2-VL-7B + FAISS | Apache-2.0 code | inherits ColPali | 36.5 F1 vs 23.7 text-RAG on M3DocVQA | — | **stale: last commit 2025-02-15** |
| **SigLIP2-so400m** | contrastive, single 1152-d | **Apache-2.0** ([card](https://huggingface.co/google/siglip2-so400m-patch16-512)) | **4.6 KB** | 44.6 · 20.1 · 14.8 | 952 ms | Google |
| **JinaCLIP** | CLIP-ViT-L | non-commercial variants exist | ~1–3 KB | 53.7 · 26.7 · 20.7 | 14 ms | — |
| **NanoVDR-S** | 69M text-only student, distilled | CC-BY-4.0 paper; weights unverified | 8.2 KB (teacher index) | 82.2 · 61.9 · 46.5 | **51 ms** | 2026-05 preprint |

Deployment-cost columns (CPU single thread, index/1M pages) are from [NanoVDR Table 2](https://arxiv.org/pdf/2603.12824); ViDoRe v1/v2/v3 from its Table 1; ColModernVBERT latency from [arXiv:2510.01149](https://arxiv.org/pdf/2510.01149) Tables 3, 11, 12.

## 4. Licences — the decisive filter

- **Qwen2.5-VL-3B is non-commercial.** Its LICENSE grants rights "FOR NON-COMMERCIAL PURPOSES ONLY" (§2a) and adds "If you are commercially using the Materials, you shall request a license from us" (§2b) ([LICENSE](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE)). This disqualifies **ColQwen2.5, ColNomic-3B, and jina-embeddings-v4** — much of the top of the public leaderboard — for PaperTree without a negotiated licence.
- **Gemma Terms (ColPali) are not OSI-approved.** Commercial use is allowed, but you must flow the restrictions down to every recipient, ship the notice file, and accept that "Google reserves the right to restrict (remotely or otherwise) usage of any of the Gemma Services" it believes violate the agreement ([Gemma Terms](https://ai.google.dev/gemma/terms)). Acceptable but not clean.
- **Clean for commercial use:** ColQwen2-v1.0 (Apache-2.0 + MIT), ColSmol (Apache-2.0 + MIT), **ColModernVBERT (MIT)**, Tomoro-ColQwen3 (Apache-2.0), SigLIP2 (Apache-2.0), MonoQwen2-VL reranker (Apache-2.0 adapter on Apache-2.0 Qwen2-VL-2B), `colpali-engine` code (MIT), ColBERT (MIT).
- **VisRAG-Ret** requires filling a registration questionnaire before free commercial use — a licence you must actively obtain, not one you inherit.

## 5. Index size — the real blocker, quantified for a 20-page paper

A 20-page CS paper, roughly 11k words, ≈30 chunks of 512 tokens.

| Layer | Bytes/page | 20-page paper | ×  text baseline |
|---|---|---|---|
| Text chunks (1024-d fp32) + BM25 postings | ~8 KB | **~0.17 MB** | 1× |
| + SigLIP2 crops for ~16 figures/tables + 20 page vectors | ~8 KB | **~0.34 MB** | 2× |
| ColModernVBERT multi-vector @1024px | 80 KB | 1.60 MB | 9× |
| ColPali + token pooling ×3 | ~86 KB | 1.72 MB | 10× |
| **ColPali (naive)** | **257.5 KB** | **5.15 MB** | **30×** |
| ColPali + pool×3 + ColBERTv2 residual (6–10×) | 9–14 KB | 0.17–0.29 MB | 1–1.7× |

Compression is well evidenced. **Hierarchical token pooling with pool factor 3 removes 66.7% of vectors while retaining 97.8% of ColPali's performance** ([arXiv:2407.01449v3](https://arxiv.org/html/2407.01449v3) §5.2, following [arXiv:2409.14683](https://arxiv.org/html/2409.14683)). The Visual RAG Toolkit takes this further with training-free spatial pooling — 1024 → 32 row vectors (32×) for ColPali, ~832 → ~13 tile vectors (64×) for ColSmol — used as a cheap prefetch stage with exact MaxSim rerank on full embeddings, "up to ~4× throughput improvement with negligible quality loss at practical cutoffs (k ≤ 10)" ([arXiv:2602.12510](https://arxiv.org/pdf/2602.12510)). HPC-ColPali reports K-Means centroid indices giving up to 32× storage reduction and ≤2% nDCG@10 loss with attention-guided pruning ([arXiv:2506.21601](https://arxiv.org/html/2506.21601v1)).

**But note where the cost actually lands.** 5.15 MB/paper × 10,000 papers = 51.5 GB — trivial as cold object storage (~$1/month at $0.02/GB-month), *expensive as resident RAM for a MaxSim index*. The blocker is hot-index memory and per-query CPU, not $/GB.

## 6. Compute and the "no GPU initially" constraint

This is where the naive answer dies. On a **single CPU thread**, ColPali takes **7,284 ms to encode one query** and 2,786 ms to score 10K candidates; ColModernVBERT takes 183 ms; NanoVDR-S takes 51 ms ([NanoVDR Table 2](https://arxiv.org/pdf/2603.12824)). On a 128-core / 2 TB-RAM cloud CPU the ModernVBERT authors measure ColPali at 175 ms and ColModernVBERT at 20 ms, and warn that "models above 3B parameters must rely on memory offloading" on 12 GB-RAM machines, "which adds up to dozens of seconds of latency per query" ([arXiv:2510.01149](https://arxiv.org/pdf/2510.01149) §4.2, Table 12). Both numbers are self-reported; the 40× spread is a hardware artefact, and PaperTree's realistic server sits nearer the low-core end.

Indexing: ColModernVBERT encodes a 1024px page in **1,016 ms on CPU / 150 ms on an L4** ([arXiv:2510.01149](https://arxiv.org/pdf/2510.01149) Table 11) — ~20 s of CPU per 20-page paper, genuinely feasible without a GPU. ColPali is 0.39 s/page on an L4; DSE reaches 4.3 pages/s on an H100 ([arXiv:2406.11251](https://arxiv.org/html/2406.11251v1)). At a nominal $0.80/hour L4 (price *not* verified from a primary pricing page), 7.8 GPU-seconds/paper ≈ **$0.0017 per paper** — indexing compute is not the constraint; index residency is.

M3DocRAG is the useful scale datapoint: over 40K pages, exact FlatIP search took ~20 s/query and IVFFlat approximate search brought it under 2 s, on an H100 80 GB ([arXiv:2411.04952](https://arxiv.org/html/2411.04952v1)). Its repo has not been touched since 2025-02-15 — treat it as a paper, not a dependency.

## 7. Geometry: can visual retrieval satisfy PaperTree's bbox requirement?

Partly, and only as a hint. ColPali's patch grid is a 32×32 lattice over the page, and the MaxSim heatmap is interpretable per query token — the paper demonstrates this ([arXiv:2407.01449v3](https://arxiv.org/html/2407.01449v3) §5.3). Georgiou formalises the propagation: intersect ColPali patch relevance with OCR-derived regions to return page **+ bounding box**. With ColQwen3-4B and percentile-50 thresholding on BBox-DocVQA: **59.7% hit rate at IoU@0.5, 84.4% at IoU@0.25, 35.8% at IoU@0.7, mean IoU 0.569, vs ~6.7% for random regions**; context tokens drop 52.3% vs full-page retrieval ([arXiv:2512.02660](https://arxiv.org/pdf/2512.02660), v3 dated 2026-01-05, CC BY 4.0, code at github.com/athrael-soju/Snappy).

Read that honestly: 59.7% at IoU 0.5 is a *ranking* signal, not an anchor. PaperTree's bounding boxes must still come from the parser. Visual retrieval scores blocks the parser already found; it never defines them. That also means visual retrieval is compatible with stable block IDs — the identity comes from the parse, the score from the patches.

## 8. Hybrid retrieval and reranking

- **Fusion:** Bruch et al. find convex combination of normalised lexical and semantic scores outperforms RRF in-domain and out-of-domain, and that "RRF is sensitive to its parameters" while convex combination is agnostic to score normalisation ([arXiv:2210.11934](https://arxiv.org/pdf/2210.11934), TOIS 2023). Prefer a tuned convex combination over default RRF constants.
- **BM25 is not a legacy baseline.** On a 23,088-query / 7,318-document text-and-table benchmark, BM25 beat state-of-the-art dense retrieval, and hybrid + neural reranking reached **Recall@5 0.816, MRR@3 0.605**, beating every single-stage method; prepending LLM-generated context to chunks at index time added +2.8pp Recall@5 dense / +2.2pp hybrid ([arXiv:2604.01733](https://arxiv.org/html/2604.01733v1)).
- **Visual reranking works and is cheap to bolt on.** MonoQwen2-VL-v0.1 (LoRA on Qwen2-VL-2B, MonoT5 objective, Apache-2.0 adapter) reranking the top-10 of a DSE first stage lifted mean ViDoRe nDCG@5 from **85.8 → 90.5 (+4.7)** ([model card](https://huggingface.co/lightonai/MonoQwen2-VL-v0.1)). Because it only touches k=10, it is a GPU-worker job of ~10 forward passes per query — the cheapest quality lever available.
- **Structural expansion** (pull the parent section, the referring paragraph for a figure, the caption for a plot) has no benchmark here, but it is the one lever PaperTree's parse tree gives it that none of these systems have.

---

## Implications for PaperTree

**1. Do not replace the parser.** Nothing here yields hierarchy, LaTeX, cell addressability, caption links, or vector-figure extraction. Visual retrieval is strictly additive.

**2. Yes, visual signal should complement text — but the evidence points at *region* embeddings, not full-page ColPali, as the first move.** The ArxivQA gap (35.7–40.1 caption+OCR vs 79.1 ColPali) proves text-only retrieval fails on figure-dense content. But that baseline is a *generic* pipeline; PaperTree already has figure crops with linked captions and a section tree, which the ViDoRe baseline did not.

**3. Cheapest architecture that gets most of the benefit (recommended v1):**
   - Keep BM25 + text chunk embeddings as the spine; fuse by tuned convex combination, not default RRF.
   - Add **one SigLIP2 (Apache-2.0) embedding per figure/table/equation crop**, plus one per page. ~4.6 KB each → **+0.17 MB per 20-page paper, doubling the index rather than 30×-ing it**. SigLIP2 encodes on CPU and needs no adapter.
   - Add structural expansion from the parse tree (caption ↔ figure ↔ referring paragraph ↔ parent section).
   - Reserve reranking for the top-10.

**4. Storage/cost delta, 20-page paper:** text-only ~0.17 MB → text + figure crops ~0.34 MB (**+0.17 MB, 2×**) → full ColPali ~5.15 MB (**+4.98 MB, 30×**). ColPali with token pooling ×3 plus residual compression lands at 0.17–0.29 MB, i.e. *cheaper than the naive crop approach*, but requires a compression pipeline and a GPU indexing worker.

**5. If and when a GPU worker exists, the right upgrade is ColModernVBERT (MIT, 250M, 20 ms CPU query, 1.0 s CPU / 150 ms L4 per page, ViDoRe v1 81.2 ≈ ColPali's 81.6) — not ColPali.** It is the only late-interaction model that is simultaneously permissively licensed, CPU-viable, and within ~0.4 nDCG@5 of ColPali on v1. Its weakness is ViDoRe v3 (17.4 vs ColPali 42.0), so validate on PaperTree's own queries before trusting it on hard, cross-document questions. If maximum quality is later required with a clean licence, Tomoro-ColQwen3-4B (Apache-2.0, ViDoRe v1 90.6) is the target — at ~256 KB/page and multi-second CPU queries, i.e. GPU-only.

**6. Hard licence rule:** any model whose backbone is Qwen2.5-VL-3B (ColQwen2.5, ColNomic-3B, jina-embeddings-v4) is off the table. Prefer MIT/Apache-2.0 over the Gemma Terms.

---

## What I could not verify

- **ColModernVBERT's exact index size per page.** I computed 80 KB from 320 visual tokens (1024px) × 128 dims × fp16, but [NanoVDR Table 2](https://arxiv.org/pdf/2603.12824) lists ColModernVBert at 1,000 tokens/page → 256 KB. The two use different resolution settings; I could not find an authoritative default. Treat 80–256 KB as a range and measure it.
- **ColQwen2-v1.0's absolute ViDoRe v1 nDCG@5.** The model card states "+5 nDCG@5 over ColPali" but gives no absolute number, and the leaderboard I could reach did not list v1.0 specifically.
- **Whether ColNomic-3B's weights carry CC-BY-NC-4.0 or another tag.** The card says "available for research use" without an explicit licence field; its base model's Qwen Research Licence is non-commercial regardless, which is what matters.
- **Tomoro-ColQwen3-4B's "13× smaller storage footprint" claim** — vendor self-reported on the model card, mechanism unexplained, and it conflicts with the ~256 KB/page implied by NanoVDR's table.
- **Any GPU pricing.** The $0.80/hour L4 figure is my assumption, not a fetched price. Re-derive from a current cloud pricing page before budgeting.
- **NanoVDR weight licence.** The paper is CC BY 4.0; I found no released checkpoint or weight licence. It is a 2026-05 preprint — do not plan on it.
- **DSE's embedding dimensionality in the original paper** (the 1536-d figure is for the later DSE-Qwen2 variant per NanoVDR's table, not necessarily the Phi-3-vision original).
- **VisRAG's own ViDoRe numbers.** VisRAG reports a 20–40% end-to-end RAG gain, self-reported, on its own benchmark set — not a ViDoRe nDCG@5, so it is not directly comparable to the table above.
- **`illuin-tech/modernvbert` maintenance beyond 2025-10-16.** ColModernVBERT support ships inside `colpali-engine` (release 2026-03-31), which is active, but the standalone research repo has been quiet for ~9 months.
- I could not retrieve a clean ViDoRe v2/v3 public leaderboard page; all v2/v3 figures here come from the NanoVDR and Tomoro tables and inherit their evaluation harness choices.
