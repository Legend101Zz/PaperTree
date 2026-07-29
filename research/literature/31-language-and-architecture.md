# 31 — Language Boundaries and Monorepo Architecture: TypeScript / Python / Rust

**Research date: 2026-07-29.** Every version number, licence and date below was pulled on this date from the crates.io API, the npm registry, the PyPI JSON API, or the vendor's own documentation. Benchmark numbers are labelled with who reported them. No GitHub star count appears in this report.

---

## 0. The question, stated precisely

PaperTree is a **commercial** product with a **1–3 person team**. The decision is not "which language is best" but "how many language boundaries can this team afford to maintain, and which ones buy something that cannot be bought otherwise."

Two findings reframe the whole question before any performance argument is reached:

1. **The binding constraint is licensing, not speed.** PyMuPDF — the default Python PDF library and, in my experience, the most likely thing already in PaperTree's parser — is **dual-licensed AGPL-3.0 / Artifex commercial** ([PyPI metadata for 1.28.0](https://pypi.org/pypi/pymupdf/json), license field: *"Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License"*). Artifex states plainly: *"You cannot deploy our open-source as part of a server-based application or service, without disclosing your own application's full source code under AGPL"* ([artifex.com/licensing](https://artifex.com/licensing/)). **No price is published.** The same trap exists in Rust (`mupdf` crate 0.8.0 is **AGPL-3.0**) and in JS (`mupdf` npm 1.28.0 is **AGPL-3.0-or-later**). Changing language does not escape it; changing library does.
2. **Rust cannot host the models.** Everything else follows from that.

---

## 1. Python for document AI — how much is genuinely unavailable elsewhere?

Verified library census (PyPI, 2026-07-29):

| Library | Version | Released | Licence | Replaceable outside Python? |
|---|---|---|---|---|
| `pymupdf` | 1.28.0 | — | **AGPL-3.0 / Artifex commercial** | Yes — `mupdf-rs`, `mupdf.js`, all AGPL too |
| `pypdfium2` | 5.12.1 | 2026-07-17 | BSD-3-Clause + Apache-2.0 | Yes — `pdfium-render` (Rust), `@hyzyla/pdfium` (JS) |
| `pdfplumber` | 0.11.10 | 2026-06-15 | MIT (LICENSE.txt verified) | Partially — geometry only |
| `docling` | 2.116.0 | — | MIT | **No** |
| `docling-core` / `docling-parse` / `docling-ibm-models` | 2.88.0 / 7.8.1 / 3.13.3 | 2026-07-27 / 07-20 / 06-04 | MIT | **No** |
| MinerU | — | — | **MinerU Open Source License** (Apache-2.0 + terms) | **No** |
| `marker-pdf` / `surya-ocr` | 2.0.0 / 0.22.1 | both 2026-07-20 | Apache-2.0 (LICENSE verified) | **No** |
| `transformers` | 5.14.1 | 2026-07-16 | Apache-2.0 | Partially — `@huggingface/transformers` 4.2.0 (JS) |
| `torch` | 2.13.0 | 2026-07-08 | BSD/Apache mix | **No** |
| `onnxruntime` | 1.28.0 | 2026-07-25 | MIT | **Yes** — `ort` (Rust), `onnxruntime-web` (JS) |

**Licence flags:** MinerU moved off AGPL to the *MinerU Open Source License* — Apache-2.0 plus a separate commercial licence above **100M MAU or USD 20M monthly revenue**, plus a hard attribution requirement: *"you must clearly and prominently indicate, in the relevant product or service interface or in publicly available documentation, that MinerU is used"* ([LICENSE.md](https://github.com/opendatalab/MinerU/blob/master/LICENSE.md)). The thresholds are irrelevant to PaperTree; **the UI attribution obligation is not** — it is a product constraint, not a legal footnote.

**The honest quantification.** The split is sharper than "Python has more libraries":

- **PDF byte-level parsing: not Python-specific.** Rust (`lopdf` 13.49M downloads, `pdf-extract` 3.38M) and JS (`pdfjs-dist` 6.2.108, Apache-2.0) both do this competently.
- **Model *inference*: not Python-specific.** ONNX Runtime has real Rust and browser bindings. Docling even publishes an ONNX export: [`docling-project/docling-layout-heron-onnx`](https://huggingface.co/docling-project/docling-layout-heron-onnx), Apache-2.0, quantised RT-DETRv2.
- **Model *pipelines*: Python-only, and this is the whole ballgame.** The trained weights are the cheap part. What is Python-only is the ~80% of code around them: image preprocessing at the exact DPI the model was trained at, NMS and class-merge post-processing, TableFormer's structure decoder, formula recognition, the equation/figure/caption association logic, and the evaluation harness you need to know whether a change made things better. Docling's own numbers: five models trained on **150,000 documents**, best model `heron-101` at **78% mAP, 28 ms/image on a single NVIDIA A100** (authors' self-reported figures, [arXiv:2509.11720](https://arxiv.org/abs/2509.11720), 19 authors, submitted 2025-09-15). Reproducing that post-processing in another language is a re-implementation with no reference test suite.
- **GPU: Python or nothing, realistically.** PyTorch + CUDA is the only path where a 1–3 person team can debug a GPU problem using answers that already exist on the internet.

**Verdict: Python stays, non-negotiably, for the document plane.** But note what *isn't* an argument for Python — raw PDF parsing speed. That is where the Rust temptation comes from, and section 3 shows the temptation is smaller than it looks.

---

## 2. TypeScript for the control plane

Verified (npm, 2026-07-29): `@trpc/server` 11.18.0 (2026-06-17, MIT) · `zod` 4.4.3 (2026-05-04, MIT) · `hono` 4.12.32 (2026-07-24, MIT) · `fastify` 5.10.0 (2026-07-05, MIT) · `@orpc/server` 1.14.13 (2026-07-29, MIT) · `@ts-rest/core` 3.52.1 (**2025-03-04** — 17 months stale; treat as maintenance-only) · `openapi-typescript` 7.13.0 (2026-02-11, MIT) · `@hey-api/openapi-ts` 0.99.0 (2026-06-22, MIT, **still 0.x**) · `bullmq` 5.81.2 (2026-07-24, MIT).

**Next.js route handlers vs a separate Node service.** The decisive fact is a hosting limit, not a taste question. Vercel Functions with fluid compute: **Hobby default 300s / max 300s; Pro & Enterprise default 300s / max 800s, extended to 1800s in beta** for `nodejs20/22/24.x` and `python3.12/3.13/3.14` ([Vercel docs](https://vercel.com/docs/functions/configuring-functions/duration), page last_updated 2026-07-01). Document ingestion of a 40-page paper with layout + table + formula models will exceed this on a cold GPU-less worker. **Therefore the parse pipeline can never live in a route handler regardless of language.** Once you accept a queue, the question "Next.js API routes or Fastify/Hono?" shrinks to a preference — the route handlers become a thin BFF that enqueues and reads status.

**The real benefit of one schema language** is not "fewer bugs" — it is that a **1-person on-call rotation holds one mental model**. That benefit is largest when the *same* person edits the React component and the endpoint feeding it, and near-zero across the web↔document-worker boundary, where the payload is a `DocTree` changing on a parser cadence, not a UI cadence.

**tRPC's limit is exact:** it infers types from a TypeScript router, so a Python worker cannot participate. tRPC is therefore only viable if the control plane is Node **and** you accept a second contract mechanism for Node↔Python anyway — two contract systems for a 2-person team.

---

## 3. Rust for deterministic PDF work — a sceptical audit

Full crates.io census, 2026-07-29 (downloads = all-time):

| Crate | Version | Last publish | Licence | Downloads | What it actually is |
|---|---|---|---|---|---|
| `lopdf` | 0.44.0 | 2026-07-10 | MIT | 13.49M | Object/xref toolkit. **Not** extraction |
| `pdf-extract` | 0.12.0 | 2026-06-25 | MIT | 3.38M | Content-stream → text |
| `pdf` (pdf-rs) | 0.10.0 | 2026-03-02 | MIT | 563k | Reader; 0.9.0 → 0.10.0 took 26 months |
| `pdfium-render` | 0.9.3 | 2026-07-14 | MIT OR Apache-2.0 | 1.76M | **The mature option.** Char-level bboxes, WASM |
| `mupdf` | 0.8.0 | 2026-06-22 | **AGPL-3.0** | 1.52M | Same licence trap as PyMuPDF |
| `hayro` | 0.7.1 | 2026-06-05 | Apache-2.0 OR MIT | 1.28M | **Rasteriser only.** Self-described experimental WIP |
| `typst` | 0.15.1 | 2026-07-17 | Apache-2.0 | 1.85M | PDF **writer**. Irrelevant to reading |
| `pdfsink-rs` | 0.2.11 | 2026-07-15 (created 2026-04-05) | MIT | **5,368** total | Single-vendor, 4 months old |
| `pdf-inspector` | 0.1.6 | 2026-07-15 (created 2026-06-05) | MIT | **19,697** total | Firecrawl; 8 weeks old |
| `xycut-plus-plus` | 0.0.2 | 2025-11-16 | **GPL-3.0** | **98** total | The only reading-order crate. Unusable licence, dead |
| `oar-ocr` | 0.8.1 | 2026-07-23 | Apache-2.0 | 260k | OCR + layout **via `ort`** |
| `layoutparser-ort` | 0.1.0 | 2024-06-03 | Apache-2.0 | 1,442 (**7 recent**) | Abandoned |
| `ort` | **2.0.0-rc.13** | 2026-07-28 | MIT OR Apache-2.0 | 14.3M | ONNX Runtime 1.28 — **still RC**; rc.10 shipped 2025-06-01 |

**What is genuinely missing in Rust:**

1. **Reading order.** One crate exists (`xycut-plus-plus`), at **v0.0.2, 98 lifetime downloads, GPL-3.0, untouched since 2025-11-16**. For a commercial product this is equivalent to nothing. You would write it yourself.
2. **Semantic layout.** `pdfsink-rs` advertises a "hierarchical layout tree", but on reading the README this is **geometric grouping — textlines, textboxes, containment** — not heading detection, section hierarchy, or figure/caption association.
3. **A stable ML runtime.** `ort` has been in release-candidate for **at least 14 months** (rc.10 → rc.13 span verified). Betting a commercial core on a pre-1.0 FFI wrapper for a 1-person team is a bad trade.
4. **Evaluation.** No Rust equivalent of the Python benchmarking harnesses. You cannot tell whether your Rust rewrite is *better*, only that it is *faster*.

**Do not dismiss the speed numbers, but do discount them.** Two vendor-self-reported benchmarks:

- `pdfsink-rs` (Clark Labs Inc., own README): **9.6x** aggregate over 13 PDFs vs pdfplumber; US Budget FY2025, 188pp → **775 ms vs 11.1 s (14x)**.
- `pdf-inspector` (Firecrawl, own README, refreshed 2026-07-16 on Apple M4 Pro, opendataloader-bench 200 PDFs): overall **0.875**, reading order **0.915**, tables **0.814**, **2.8 s** total vs pymupdf4llm 0.735 / 0.886 / 0.401 / 15.5 s.

Both are self-reported and unaudited, and the baseline is **pdfplumber — the slowest reasonable Python option**. `pypdfium2` is a C library behind a thin Python binding; the honest comparison is Rust-vs-C-via-Python, which is a much narrower gap. **And PaperTree's latency budget is dominated by model inference (28 ms/image × N pages on a GPU, per Docling), not by byte parsing.** Making a 3% slice 10x faster is a rounding error.

**Cost of writing geometry/reading-order in Rust vs Python (my estimate, not sourced):** the algorithm is identical; the difference is iteration speed. This work is *empirical* — run against 200 papers, inspect failures, tweak a threshold, repeat, 50 times a day. In Python that loop is a notebook cell; in Rust it is `cargo build --release` plus no interactive plotting. I would price a working reading-order implementation at **~3–4 weeks in Python and ~8–12 weeks in Rust** — the gap is tuning cycles, not typing.

**WASM in the browser — the one place Rust has a genuine, non-fashion argument, with a hard caveat.** `pdfium-render` supports WASM, but its README states the bblanchon pdfium-binaries WASM builds use *"a non-growable WASM heap memory allocator. This means that attempting to open a PDF document longer than just a few pages will result in an unrecoverable out of memory error."* That kills naive full-document client-side geometry with pdfium. The pure-Rust route is real but embryonic: `@firecrawl/pdf-inspector-wasm` **0.1.1, published 2026-07-17, 4.87 MB unpacked, 2 versions total**. Against this sits `pdfjs-dist` **6.2.108 (2026-07-28, Apache-2.0)**, which already gives per-character transforms in the browser and which PaperTree's viewer almost certainly already loads. **Conclusion: there is no client-side geometry problem that pdf.js cannot solve today and Rust/WASM can.** Revisit only if profiling shows pdf.js text-layer construction is the bottleneck on 100+ page papers.

---

## 4. Cross-language contracts

| Option | Source of truth | Python side | TS side | Drift risk | DX for 1–3 people |
|---|---|---|---|---|---|
| **OpenAPI 3.1 emitted by FastAPI** | Pydantic models (code-first) | native | `openapi-typescript` 7.13.0 or `@hey-api/openapi-ts` 0.99.0 | **Low** if spec export is a CI artifact and the diff fails the build | **Best.** Zero new concepts |
| **JSON Schema as source of truth** | `.json` files | `datamodel-code-generator` | `json-schema-to-zod` | Low | Two codegen steps; extra build stage nobody enjoys |
| **protobuf / gRPC** | `.proto` | `grpcio` | `connect-es` / `ts-proto` | **Lowest** | Overkill. Adds a proto toolchain, breaks browser fetch, buys strictness you don't need |
| **tRPC** | TS router | ✗ impossible | native | None (within TS) | Excellent — but **cannot cross to Python** |
| **Nothing (hand-written types)** | — | — | — | **Certain** | The status quo failure mode |

**Recommendation: OpenAPI 3.1, code-first from FastAPI, with a committed spec file and a CI drift check.** FastAPI emits 3.1 natively ([FastAPI docs](https://fastapi.tiangolo.com/advanced/generate-clients/)). The discipline that makes this work is one CI step: regenerate `openapi.json`, `git diff --exit-code`. That single check is what converts "we have codegen" into "we cannot ship drift." Note `@hey-api/openapi-ts` is still **0.x** — pin it exactly.

**Separate point: the `DocTree` schema is not the API schema.** The parser output is the durable asset. Define it once as Pydantic v2 models in a shared Python package, export JSON Schema from it, generate Zod for the viewer, and **version it explicitly** (`doctree_version: 3`). Migrations, not drift, are your real risk there.

---

## 5. The four architectures

Scored for a 1–3 person commercial team. **H/M/L = good/medium/bad.**

| | **Opt 1** Next+FastAPI+Mongo, fix parser | **Opt 2** TS control plane + Py workers | **Opt 3** Rust core + TS app + Py models | **Opt 4** (mine) Two-plane FastAPI |
|---|---|---|---|---|
| Implementation effort | **Lowest** (0 new infra) | Medium (+1 service, +queue, +contract) | **Highest** (+language, +FFI, +rewrite of unvalidated algorithms) | Low (+queue, +contract) |
| Library compatibility | H | H | **L** — no reading-order, no layout models in Rust | H |
| Performance (real bottleneck) | M — but bottleneck is inference, not language | M | H on the 3% that doesn't matter | M |
| GPU support | H | H | H (models still Python) | H |
| Operational complexity | **H (best)** — 1 process | M — 3 runtimes to deploy/monitor | **L** — 3 languages, 3 build toolchains | H — 2 processes, 1 image |
| Developer velocity | H | M — every feature touching parse output crosses a boundary | **L** — Rust compile loop kills empirical tuning | H |
| Type safety | L today (hand-written) | H | H | H once OpenAPI codegen lands |
| Deployment | H — one container | M | L — cross-compilation, native deps, WASM artifacts | H — one image, two entrypoints |
| Observability | M | M — trace context must cross HTTP + queue | L — spans across 3 runtimes | H — one OTel SDK |
| Maintainability (1–3 people) | M — monolith rots without seams | M | **L** — bus factor of 1 per language | **H** |
| Migration risk | **Lowest** | Medium | **Highest** — rewrite before the algorithm is validated | Low |

**Option 1 is under-engineered in exactly one place:** long parse jobs inside a request-response process. Everything else about it is right.

**Option 2 is defensible but premature.** It buys tRPC-grade type safety for the web tier at the cost of a third deployable and a second contract mechanism. Revisit at ~5 engineers or when the web tier genuinely needs Node-only libraries.

**Option 3 is over-engineered for this team, and I will say it plainly.** It proposes rewriting, in the language with the *worst* iteration loop, the one component (reading order / layout heuristics) that is *most* empirical and *least* specified — and the Rust ecosystem's only offering there is a GPL-3.0 crate at v0.0.2 with 98 downloads. This is the fashion-driven answer the brief warned against.

**Option 4 — "one language per plane, two processes, one contract" — is my recommendation.**

- Keep **Next.js** for the entire web tier; route handlers are a thin BFF that proxy/enqueue. No separate Node service.
- Keep **FastAPI**, but split it into **two entrypoints from one codebase and one container image**: `api` (sub-second request/response) and `worker` (the parse pipeline). Use **`arq` 0.28.0 (MIT, Redis)** or **`bullmq` 2.26.0 (Python, 2026-07-26)** if you later want a Node producer. Not Celery, not Temporal — those are answers to problems a 2-person team doesn't have yet.
- **Purge AGPL**: replace PyMuPDF with `pypdfium2` 5.12.1 (BSD-3-Clause + Apache-2.0) plus `pdfplumber` 0.11.10 (MIT) for geometry. This is the highest-value single change in this report and it is a library swap, not an architecture change.
- **One contract**: FastAPI → `openapi.json` (committed) → `openapi-typescript`; plus a separately versioned `DocTree` JSON Schema → Zod.
- **MongoDB**: leave it. Migrating it now is unrelated risk. Revisit only when you need relational integrity for annotations.
- **Rust: zero, today.** Reserve exactly one trigger — if profiling shows a *specific* geometry hot loop dominating wall-clock, add it as a **PyO3/maturin extension inside the existing Python package**, not as a service. That keeps the boundary an implementation detail with no new deployable, no new contract, and no new on-call surface.

---

## 6. Monorepo layout and tooling

```
papertree/
├─ apps/
│  └─ web/                     # Next.js — UI + thin BFF route handlers
├─ services/
│  ├─ api/                     # FastAPI: HTTP entrypoint (uvicorn)
│  └─ worker/                  # arq worker entrypoint — SAME image as api/
├─ packages/                   # TypeScript, pnpm workspace
│  ├─ contracts/               #   generated: openapi types + DocTree Zod. Never hand-edited
│  ├─ ui/
│  └─ tsconfig/
├─ libs/                       # Python, uv workspace
│  ├─ papertree-doc/           #   DocTree Pydantic models — the durable asset
│  ├─ papertree-parse/         #   pipeline: pypdfium2 → layout → tables → reading order
│  └─ papertree-agent/         #   tool registry (see report 20)
├─ research/                   # existing
├─ pnpm-workspace.yaml · turbo.json · pyproject.toml (uv workspace root) · docker/
```

`services/api` and `services/worker` are two commands over one image. That is the seam that fixes Option 1's only real defect, at near-zero operational cost.

| Tool | Verified version | Fit | Trade-off |
|---|---|---|---|
| **pnpm workspaces + Turborepo** | `turbo` 2.10.7 (2026-07-25, MIT) | **Recommended for the TS half** | Turborepo *"uses package-manager workspaces and `package.json` scripts to discover most packages and tasks"* and **"does not infer the Go package graph"** ([multi-language guide](https://turborepo.dev/docs/guides/multi-language)) — i.e. it will not read `pyproject.toml` either. Python is cached only at the crude granularity of a wrapper `package.json` script |
| **uv workspaces** | — | **Recommended for the Python half** | One lockfile, fast. Documented limits: *"uv's workspaces enforce a single `requires-python` for the entire workspace"* and *"uv can't ensure that packages don't import dependencies declared by another workspace member"* ([uv docs](https://docs.astral.sh/uv/concepts/projects/workspaces/)) |
| **Nx** | `nx` 23.1.0 (2026-07-13, MIT) | Overkill | Real cross-language support and generators, but a plugin/executor model that is a second thing to learn. Justified at 10+ engineers |
| **Moon** | `@moonrepo/cli` 2.4.6 (2026-07-28, MIT) | The interesting outsider | Genuinely polyglot (Node/Python/Rust/Go) with managed toolchains — the most *correct* answer for a mixed repo. Smaller community means you debug alone |
| **Bazel / Pants** | — | **No** | Correct at Google scale, catastrophic for 2 people |

**Concrete recommendation: pnpm + Turborepo for TS, uv workspace for Python, and a `Makefile`/`just` file at the root as the honest cross-language entrypoint.** Do not pretend one task runner owns both graphs — accept the seam, keep it 20 lines long, and spend the saved time on the parser. Re-evaluate Moon only if the root Makefile exceeds ~100 lines.

---

## 7. What I could not verify

- **Artifex commercial licence pricing.** Not published; the page states only *"Per-copy cost with a quarterly minimum fee."* A secondary blog (pdfmux) quoted "$10,000–$50,000/year" — **I could not corroborate this from any Artifex source and it should not be used for budgeting.**
- **Whether PaperTree currently depends on PyMuPDF.** I inspected `/Volumes/Mrigesh SSD/PaperTree` and found only `research/` — no application code at that path. The AGPL warning in §0 is conditional on that dependency existing.
- **`marker-pdf` / `surya-ocr` licences beyond the LICENSE file.** Both repo LICENSE files are verifiably Apache-2.0 (fetched raw). I did **not** check whether the model weights on Hugging Face carry separate terms, and Datalab has historically used revenue-conditioned licensing. **Verify weights licensing before shipping.**
- **`ort` execution-provider list.** docs.rs did not enumerate CUDA/TensorRT/CoreML/WebGPU providers in the fetched page. That `ort` 2.0.0 has been in RC since at least 2025-06-01 **is** verified from version dates.
- **`pdfsink-rs` and `pdf-inspector` benchmarks are vendor self-reported and unaudited.** I did not run them, did not inspect the harness, and did not verify the corpora. Both crates are under 5 months old; `pdf-inspector` is 8 weeks old.
- **Docling's 78% mAP / 28 ms-per-image figures are the paper authors' own** (arXiv:2509.11720, 2025-09-15). Not independently reproduced here. I could not confirm the authors' institutional affiliation from the abstract page.
- **`docling-layout-heron-onnx` model size and last-updated date** — the HF page did not surface them; only "Apache-2.0", "quantised", and 4,383 downloads last month.
- **Latency for PaperTree specifically.** No number in this report is measured on PaperTree's corpus. All effort estimates in §3 (3–4 weeks Python vs 8–12 weeks Rust) are **my judgement, not sourced data**.
- **Python free-threading relevance.** PEP 779 free-threaded Python is *officially supported* as of 3.14 (released 2025-10-07; 3.14.6 is current, 2026-06-10) with a stated 5–10% single-thread penalty ([What's New in 3.14](https://docs.python.org/3/whatsnew/3.14.html)). I did **not** verify that PyTorch, ONNX Runtime, or pypdfium2 ship working free-threaded wheels — assume process-based parallelism for workers until tested.
- **Moon's Python toolchain maturity** — asserted by secondary sources; I did not read moonrepo's Python documentation or test it.
- **Whether MinerU's attribution clause is satisfied by a docs-page mention** vs requiring in-app UI. The text says "product or service interface **or** in publicly available documentation", which reads as an either/or, but this is a legal reading I am not qualified to give.
