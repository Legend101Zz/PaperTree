# PaperTree — File-Level Change Map, Roadmap, First Milestone, Top Decisions

Report sections 25, 26, 27, 28.

---

# 25. File-level change map

## 25.1 Retain as-is

| File | Why |
|---|---|
| `apps/api/papertree_api/auth/utils.py` | bcrypt(12) + HS256 is sound. Needs a real secret and `jti`, not a rewrite. |
| `apps/api/papertree_api/auth/routes.py` | Correct and small. |
| `apps/web/src/components/ui/{Button,Input,Card,Modal}.tsx` | Thin, unopinionated; will be restyled by the design system, not replaced. |
| `apps/web/src/components/auth/AuthGuard.tsx` | Works. |
| `docker-compose.yml` | Keep the shape; change the service list. |

## 25.2 Refactor

| File | Change |
|---|---|
| `papers/routes.py` | Strip to thin HTTP handlers. Upload becomes: hash → dedup → store → **enqueue** → return `202` with a job id. Remove `extract_text_from_pdf` (moves to the worker). Fix: JWT out of query strings, bound `scale`, guard `ObjectId`, cascade deletes. |
| `papers/routes.py::get_page_image` | **Keep the idea — this is the best primitive in the codebase.** It already renders a normalised region at a scale, which is exactly `crop_pdf_region`. Bound the scale, cache by `(paper, page, rect, scale)`, move behind signed URLs. |
| `services/ai.py` | Collapse into the single provider layer. Keep the model registry; fix the cost table that structurally reports `$0.00` (`ai.py:162`). |
| `apps/web/src/lib/api.ts` | One client, not two. Token out of `localStorage` and out of URLs → httpOnly cookie. Generated from the OpenAPI/JSON-Schema contract. |
| `apps/web/src/store/readerStore.ts` | Keep Zustand. Persist reading position **per paper**, not globally (`readerStore.ts:269`). |
| `components/reader/PDFViewer.tsx` | Rewrite internals onto `pdfjs-dist` directly with virtualisation; keep the component boundary. |
| `database.py` | Becomes the Postgres connection + migration runner. |

## 25.3 Split

| File | Into |
|---|---|
| `canvas/services.py` (916 lines) | `canvas/nodes.py` · `canvas/edges.py` · `canvas/persistence.py` · `canvas/ai.py`. It currently mixes node creation, layout, persistence and OpenRouter calls in one module. |
| `highlights/routes.py` (432 lines) | `highlights/routes.py` (HTTP) + `highlights/anchoring.py` (the multi-tier resolver). |
| `highlights/models.py` | Split the merged classes; **one** `HighlightCategory`, **one** `CATEGORY_COLORS`. |
| `app/paper/[id]/read/page.tsx` (519 lines) | Route shell + `useSelection` + `useReaderLayout` hooks + region components. |
| `BookViewer.tsx` (725 lines) | `GuidedView` + `GuidedBlock` + `DerivedContentMarker`. |

## 25.4 Delete

| File / code | Reason |
|---|---|
| `papers/extraction.py` (1,016 lines) | Unreachable. Its *ideas* survive in PaperIR; its code does not. Measured: 0 figures on ResNet, 100% font-driven math misclassification. |
| `papers/services.py` (682 lines) | Unreachable duplicate of the above. |
| `apps/web/src/hooks/useCanvas.ts` | Dead; references ~10 non-existent methods. |
| `components/reader/SmartOutlinePanel.tsx` | Renders LLM-invented page titles as an outline. Replaced by a real semantic outline. |
| `components/reader/OutlinePanel.tsx` | Zero importers. |
| `components/reader/SearchResults.tsx` | Dead; would throw on mount. |
| `components/reader/PDFMinimap.tsx` | A third `<Document>` instance for marginal value. |
| `components/reader/ExplanationModal.tsx` | Modals over a reading surface. |
| `components/reader/InlineExplanation.tsx` | Hardcoded viewport positioning. |
| `canvas/routes.py` legacy `canvas_router` | Two routers for one feature (`main.py:52-53`). |
| `globals.css:49-148` | Dead highlight CSS from a previous implementation. |
| `Mermaid.tsx` + `MermaidRenderer.tsx` | The model must not fabricate diagrams. Also `dangerouslySetInnerHTML` under `securityLevel: 'loose'`. |

## 25.5 Create

**Packages**

| Package | Responsibility |
|---|---|
| `packages/document-ir` | PaperIR JSON Schema (source of truth) + generated TS/Pydantic + stable-ID and geometry libraries |
| `packages/anchoring` | Multi-tier anchor resolve/re-anchor, shared by web and API |
| `packages/retrieval` | Structure-aware retrieval: expansion, hybrid search, evidence-package assembly |
| `packages/agent-tools` | The ~20 PaperTree tools as a plain registry (name → JSON schema → async callable), runtime-agnostic |
| `packages/prompts` | Versioned, testable prompt templates with untrusted-content delimiting |
| `packages/shared-types` | Generated API types |
| `packages/ui` | Design system from the Stage-4 handoff |
| `packages/evaluation` | PTUB harness, metrics, adapters |

**Services**

| Service | Responsibility |
|---|---|
| `services/document-worker` | Parse pipeline → PaperIR. Python. The only place parser libraries are imported. |
| `services/audio-worker` | Chapter plan → script → TTS → alignment. Python. |
| `services/vision-worker` | Optional GPU tier for low-confidence pages. |

**Infrastructure**

`infrastructure/migrations/` (Postgres DDL) · `infrastructure/docker/` · `infrastructure/deployment/`

## 25.6 Models to migrate

| From (Mongo) | To (Postgres) | Note |
|---|---|---|
| `papers.extracted_text` | `blocks` + `pages` + `relations` | Not a migration — a **re-parse**. The string contains nothing recoverable. |
| `papers` | `papers` | + `source_hash UNIQUE`, `status`, `ir_version` |
| `highlights` | `highlights` + `anchors` | **Existing anchors are unrecoverable** (viewport pixels ÷ `window.innerWidth`). Users must be told, not silently dropped. |
| `explanations` | `derivations` | + block-level provenance, prompt hash, token/cost accounting |
| `canvases` (one blob doc) | `canvases` + `canvas_nodes` + `canvas_edges` | Row-level so a drag is not a whole-document rewrite |
| `highlight_explanations`, `paper_images` | drop | Indexed but never written |

## 25.7 API changes

| Endpoint | Change |
|---|---|
| `POST /papers/upload` | Returns `202` + job id. Never blocks. |
| `GET /papers/{id}` | Stops shipping the whole document body (`routes.py:140-142`). |
| **new** `GET /papers/{id}/ir` | Paginated PaperIR |
| **new** `GET /papers/{id}/blocks/{block_id}` + `/children` + `/adjacent` + `/parent` | The retrieval primitives |
| **new** `GET /papers/{id}/jobs/{job_id}` | Progress, resumable |
| `POST /papers/{id}/generate-book` | Replaced by `POST /papers/{id}/guided` (async, per-section, resumable) |
| `POST /highlights/papers/{id}` | Body becomes the multi-selector anchor |
| **new** `POST /papers/{id}/ask` | Returns the answer contract (answer + block ids + regions + confidence + interpretation flags) |
| **all** | Ownership enforced at a data-access layer, not per handler |

---

# 26. Phased roadmap

Each phase states objective · user impact · evidence · difficulty · dependencies · risks ·
systems affected · acceptance criteria · tests.

## Phase 0 — Stop the bleeding *(days, not weeks)*

**Objective.** Close the live security holes and stop paying for broken generation.

**User impact.** Invisible, except that highlight deletion starts working.

**Evidence.** `findings.md` §F: 33 query sites without ownership filters; verified
cross-tenant read *and write* at `canvas/services.py:544,645`; every legacy highlight
route 500s on `KeyError: '_id'`.

**Difficulty.** Low. **Dependencies.** None — do this first.

**Systems.** `canvas/services.py`, `explanations/routes.py`, `highlights/routes.py`, `auth/`, `.env`.

**Acceptance.** Rotate OpenRouter + Atlas credentials. Every DB read/write passes through
a helper that requires an owner. `POST /highlights/search` accepts a search. No handler
raises `KeyError`. `scale` bounded. JWT out of query strings.

**Tests.** A cross-tenant test per resource: user B must get 404 for every one of A's
paper, highlight, explanation, canvas, page-image and file endpoints. This test file is
the deliverable.

**Risk.** Low. Not doing it is the risk.

---

## Phase 1 — Correctness and PaperIR *(the foundation; everything depends on it)*

**Objective.** Replace the flat string with PaperIR, behind a benchmarked parser.

**User impact.** Initially none visible — then everything becomes possible. Manage this
expectation explicitly: this phase looks like no progress and *is* the project.

**Evidence.** The live path scores zero on every capability column; Docling recovers 7
figures / 15 tables / 342 cells on ResNet where the current code recovers 0/0/0.

**Difficulty.** High. **Dependencies.** Phase 0.

**Systems.** New `services/document-worker`, `packages/document-ir`, Postgres, job queue,
R2. `papers/routes.py` rewritten.

**Acceptance.**
1. Tier B gold annotations exist (120 pages, 12 papers, with inter-annotator agreement reported).
2. PTUB run over candidates 1–5; the selected parser wins on reading-order, hierarchy and figure recall, with CIs clustered by paper.
3. Re-parsing a paper is deterministic — identical PaperIR, identical block IDs.
4. Zero crash/timeout/empty on the 44-paper Tier A corpus.
5. Upload returns in <500 ms; parsing is a resumable background job.

**Tests.** PTUB harness in CI on a 5-paper subset. Golden-file tests on PaperIR output.
Property test: block IDs stable under re-parse.

**Risks.** Annotation is the critical path and is easy to under-resource — 60 expert-hours.
Docling's CPU cost (5–19 s/page) may force the fast-path design earlier than planned.
*Mitigation:* build the PyMuPDF-fast-path adapter in parallel so the pipeline is not
single-sourced.

---

## Phase 2 — Workspace redesign

**Objective.** Ship the new IA: one document, one navigator, one inspector, one transport.

**User impact.** The first visible transformation. Also the first time the product is
usable on iPad at all.

**Evidence.** 12 competing surfaces, 3 of them dead; zero touch handlers in the codebase;
every canvas and panel action hover-only.

**Difficulty.** Medium-high. **Dependencies.** Phase 1 (the semantic outline needs PaperIR).

**Acceptance.** Navigator consolidates 6 tabs into one panel. Guided view is visually
distinct and every block links to source. Reading position persists per paper. All
targets ≥44pt. Full keyboard operation. WCAG 2.2 AA verified with axe. iPad
landscape+portrait are first-class.

**Tests.** Visual regression per breakpoint. Keyboard-only walkthrough. Touch-target audit.

**Risk.** Redesign scope creep. *Mitigation:* the component inventory from Stage 4 is the
contract; anything not in it is out of phase.

---

## Phase 3 — Grounded contextual AI

**Objective.** Answers cite blocks, pages and regions, and citations navigate.

**User impact.** The core trust promise. This is what makes PaperTree different from a
chat wrapper.

**Evidence.** Nothing generated today is grounded; the prompt returns
`{title, summary, key_concepts}` with no source reference; context is ±200 raw characters.

**Difficulty.** High. **Dependencies.** Phases 1–2.

**Systems.** `packages/retrieval`, `packages/agent-tools`, `packages/prompts`, Pydantic AI runtime.

**Acceptance.** Every answer returns supporting block IDs; every citation navigates to
the correct polygon (≥95%); `verify_answer_grounding` runs on every answer and
unsupported claims are flagged; untrusted paper content is delimited in every prompt and
cannot write to user memory; PTUB Tier C evidence-F1 beats the current system by a
stated margin.

**Tests.** 120 Tier C questions in CI. Prompt-injection suite with adversarial PDFs
(white-on-white instructions, metadata payloads, instructions inside figure images).

**Risk.** Retrieval quality is the hard part, not the LLM call. *Mitigation:* structure-aware
expansion first, embeddings second — measure the delta before adding vector search.

---

## Phase 4 — Audiobook and Paper Replay

**Objective.** Durable, resumable narration mapped to source.

**Dependencies.** Phases 1, 3. **Difficulty.** High (mostly operational).

**Acceptance.** Chapters follow the semantic tree, never pages. Every spoken segment maps
to block IDs. Replay syncs bidirectionally within one block. A failed chapter retries from
its last good step. Equations are spoken via speech rules, not by an LLM reading LaTeX.
Cost per paper is measured and capped.

**Risk.** TTS cost and timestamp fidelity. *Mitigation:* choose a provider with native
word/mark timestamps; forced alignment is the fallback, not the plan.

---

## Phase 5 — Infinite canvas

**Objective.** A spatial research notebook with real provenance.

**Evidence.** Current canvas auto-generates a node per page unbidden, "go to source" is a
dead link, provenance is one integer, and an auto-save⇄invalidate loop rewrites it forever.

**Acceptance.** **No node is ever created without user intent.** Every source-backed node
returns to its exact region. Edges carry labelled meaning. Undo/redo. 500 nodes at 60fps.
Touch-first. Node-level persistence (not whole-document rewrites).

**Risk.** Easy to rebuild the same demo with nicer boxes. *Mitigation:* the 10 canvas
scenes in §23 are acceptance scenarios, not illustrations.

---

## Phase 6 — Advanced document intelligence

Vector-figure semantics, plot data extraction, cross-paper linking, contradiction
detection, multi-paper canvases, scanned-paper quality, non-English support.
**Gate:** only after Phase 1's benchmark shows headroom, and only for capabilities users
have actually asked for.

---

# 27. First implementation milestone

> **"One paper, end to end, with provenance."**
> Two to three weeks. Validates the entire architecture at the smallest possible scope.

**Scope:** one hard-coded paper (ResNet — two-column, all-vector figures, real tables),
one user, no auth changes, no redesign.

**Build:**
1. `packages/document-ir` — PaperIR schema + stable IDs + geometry helpers.
2. `services/document-worker` — Docling adapter → PaperIR → Postgres. One job, resumable.
3. Postgres schema + migration.
4. `GET /papers/{id}/ir` and `/blocks/{id}`.
5. Minimal reader: pdf.js + overlay painting PaperIR polygons.
6. Select text → create a **multi-selector anchor** → persist → reload → re-anchor.
7. Ask one question → structure-aware evidence package → answer with block IDs → click citation → scroll to and outline the polygon.

**Explicitly out of scope:** Guided view, canvas, audio, the redesign, multi-user,
the full corpus.

**Success criteria — all must hold:**

| # | Criterion |
|---|---|
| 1 | Re-parsing produces byte-identical PaperIR and identical block IDs |
| 2 | A highlight survives reload, zoom 50→400%, and 5 viewport widths, with <1pt drift |
| 3 | A highlight created under parser config A re-anchors under config B, or **fails loudly** |
| 4 | An answer's citation navigates to the correct polygon |
| 5 | Figures from the all-vector paper are present with captions linked |
| 6 | Parse runs as a background job with observable progress and survives a worker restart |

**Why this is the right milestone.** It exercises every architectural claim — stable IDs,
geometry survival, durable anchoring, structure-aware retrieval, grounded answers,
durable jobs — on the paper that most thoroughly breaks the current system, while
touching almost no UI. If criterion 3 fails, the anchoring design is wrong and it is
better to learn that in week 3 than month 6.

---

# 28. Top ten decisions, ranked

| # | Decision | Why it ranks here |
|---|---|---|
| **1** | **Adopt PaperIR as the single canonical representation, with source and derivation in separate stores.** | Everything else is downstream. It also makes "AI content looks like source" structurally unrepresentable rather than merely discouraged — the rule the current product violates in three places. |
| **2** | **Fix multi-tenancy now.** | The only decision with a live exploit behind it. Cross-tenant read *and write* verified. Ranked above the parser because it is cheap, urgent, and independent. |
| **3** | **Content-derived stable block IDs + a multi-tier anchor.** | Determines whether users' annotations survive parser upgrades. Get this wrong and every future improvement silently destroys user data — the most unrecoverable class of trust damage. |
| **4** | **Benchmark before selecting a parser; treat the recommendation as provisional.** | Docling currently leads on measured capability, but Tier B gold does not exist yet. The discipline of not deciding yet is itself the decision. |
| **5** | **Move to PostgreSQL.** | Forced by evidence, not taste: ~30k blocks/paper at 300–500 B collides with Mongo's 16 MiB document limit, so blocks leave the document anyway — removing the only reason to stay. Migration costs almost nothing today (3 papers) and grows expensive fast. |
| **6** | **Parsing and generation become durable background jobs.** | Generation currently blocks an HTTP request for up to 450 s (4,950 s with `generate_all`). Docling's 5–19 s/page settles it independently. The agent runtime is **not** the job queue. |
| **7** | **Adopt a thin agent runtime (Pydantic AI) over a tool registry you own.** | The tools are the asset; the runtime is swappable. Keeps the ~20 read-only PaperTree tools behind a plain registry so no runtime becomes a rewrite. Rejects coding harnesses with filesystem/shell defaults outright. |
| **8** | **Rebuild the IA around one document / one navigator / one inspector / one transport.** | 12 competing surfaces is the UX diagnosis. Also the only way iPad becomes real — currently zero touch handlers exist. |
| **9** | **Never let untrusted paper content write to trusted user memory, and delimit it in every prompt.** | Uploaded PDFs are attacker-controlled. Cheap to design in now, very hard to retrofit once a memory system exists. |
| **10** | **Resolve PyMuPDF's AGPL licence.** | The current entire extraction stack is AGPL-3.0 in an intended commercial product. Options: buy the commercial licence, move to pypdfium2 (permissive), or isolate it as a separate service. Ranked tenth only because Phase 1 likely replaces it anyway — but it must be an explicit decision, not a drift. |

**Deliberately not in the top ten:** the frontend framework (Next.js stays — no evidence
justifies churn), the canvas library (`@xyflow/react` stays — tldraw's licence and
watermark disqualify it), and any Rust component (the research found no production-ready
Rust layout-analysis crate; adopting it now would be exactly the fashion-driven rewrite
the brief forbids).
