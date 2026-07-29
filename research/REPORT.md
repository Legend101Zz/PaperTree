# PaperTree — Audit, Research and Architecture Report

**Date:** 2026-07-29 · **Repo:** `Legend101Zz/PaperTree` @ `65e097c` (main)
**Scope of this pass:** Stages 1–3 (audit · research · planning). No production
implementation. Stage 4 (Claude Design) brief written; exploration pending.

---

## How to read this report

It is deliberately not one file. The evidence is large and each part must stand on its own.

| § | Section | Where |
|---|---|---|
| 1 | Executive diagnosis | *below* |
| 2 | Current repository map | *below* + `../findings.md` §A–§E |
| 3 | PDF-to-Tree analysis | `literature/01-pdf-to-tree.md` · summary in `../findings.md` §H1 |
| 4 | Document-intelligence literature review | `literature/01–14` (14 reports) |
| 5 | Parser comparison matrix | `synthesis-05-parser-comparison.md` |
| 6 | PaperTree benchmark design (PTUB) | `benchmarks/README.md` |
| 7 | Canonical PaperIR proposal | `architecture-decisions/ADR-001-canonical-document-representation.md` |
| 8 | Parsing-pipeline options | `synthesis-05-parser-comparison.md` |
| 9 | Recommended parsing architecture | `synthesis-05-parser-comparison.md` |
| 10 | Highlight + contextual-Q&A architecture | `synthesis-10-highlight-and-qa.md` |
| 11 | Agent-harness comparison | `literature/20-agent-runtimes.md` |
| 12 | Agent-runtime decision | *below* + `literature/20-agent-runtimes.md` |
| 13 | Memory architecture | `synthesis-13-memory.md` |
| 14 | Technology-stack options | `synthesis-14-stack-monorepo.md` |
| 15 | Recommended stack + ADRs | `synthesis-14-stack-monorepo.md` |
| 16 | Monorepo design | `synthesis-14-stack-monorepo.md` |
| 17 | Audiobook architecture | `synthesis-17-audiobook.md` |
| 18 | Product information architecture | `design/IA-wireframes-and-design-brief.md` §18 |
| 19 | Text wireframes | `design/IA-wireframes-and-design-brief.md` §19 |
| 20 | Claude Design brief | `design/IA-wireframes-and-design-brief.md` §20 |
| 21–24 | Design exploration, direction, canvas, design system | **pending — Stage 4** |
| 25 | File-level change map | `ROADMAP-AND-CHANGE-MAP.md` §25 |
| 26 | Phased roadmap | `ROADMAP-AND-CHANGE-MAP.md` §26 |
| 27 | First implementation milestone | `ROADMAP-AND-CHANGE-MAP.md` §27 |
| 28 | Top ten decisions | `ROADMAP-AND-CHANGE-MAP.md` §28 |

Supporting: `../findings.md` (empirical evidence) · `experiment-results/` (raw data) ·
`audit-*.md` (4 subsystem audits) · `.audit/` (reproducible probes).

---

# 1. Executive diagnosis

## 1.1 The central technical problem

**PaperTree's document-intelligence layer has never executed.**

The repository contains three PDF extractors. Two of them — `papers/extraction.py`
(1,016 lines, with bounding boxes, block IDs, `SourceLocation`, figure extraction and
outline reconstruction) and `papers/services.py` (682 lines) — have **zero importers**.
Verified: no module in the package references either, and `main.py` imports only
`papers.routes`.

What actually runs is 13 lines (`papers/routes.py:25-37`):

```python
text_parts.append(f"[Page {page.number + 1}]\n{page.get_text('text', sort=True)}")
return "\n\n".join(text_parts), page_count
```

A flat string. Measured on ResNet: 99,210 characters, **zero addressable objects** — no
geometry, no block identity, no hierarchy, no figures, no equations, no confidence.

Every product ambition in the brief is blocked by this one fact. Highlights cannot anchor
to document objects. Answers cannot cite regions. The canvas cannot return to source. The
audiobook would have nothing but a string to read. The "semantic outline" is a list of
LLM-invented page titles, because the real structure was never extracted.

**This is the good news.** The task is not to migrate a working system — it is that no
system exists yet. Nothing of value is lost by replacing it.

## 1.2 The central product problem

**The product cannot be trusted, because it cannot show its work — and in three places
it actively disguises generated content as source.**

1. **Book mode is not the paper.** `BookViewer` renders `book_content.page_summaries` —
   pure OpenRouter output — and nothing else. A user "reading the book" never sees the
   paper. Each generated page carries a real PDF page number and a "View in PDF (page 7)"
   affordance, so model prose acquires the authority of a citation. The only signal that
   it is generated is a Sparkles icon in a sub-header.
2. **The model is instructed to invent diagrams.** `llm_service.py:41-55` tells it to
   emit Mermaid for "process flows, system architectures, decision trees". These render
   identically to the paper's real figures.
3. **Failures are stored as content.** A failed generation is persisted as
   `summary: "_Failed to generate summary: …_"` (`llm_service.py:282-292`) and then
   treated as already-generated, so it is never retried.

Add: nothing generated is grounded (the response schema has no block IDs, pages or
citations), context for a question is ±200 raw characters, and pages over 5,000
characters are silently truncated from the middle.

## 1.3 The third problem: it is not safe to run

Independent of the redesign, the running application has **broken multi-tenancy**.
Verified by reading the code:

- `canvas/services.py:544` reads and `:645` **writes** `db.highlights` by `_id` with no
  `user_id` filter — cross-tenant read *and* write.
- `canvas/services.py:170, 219, 464, 901` fetch papers with no ownership filter;
  `POST /canvas/expand-page` copies another user's AI summaries into the caller's canvas.
- `explanations/routes.py:242,246,362,365` traverse explanation trees unfiltered.
- **33 query call sites** lack an ownership filter. There is no data-access layer, no
  `assert_owns()`, no test.
- Every legacy highlight route raises `KeyError: '_id'` → HTTP 500, so **users cannot
  delete a highlight at all**.

`apps/api/.env` holds a live OpenRouter key and Atlas credentials. It is correctly
gitignored and `git log --all` confirms it was never committed — so there is no public
leak — but the credentials should be rotated alongside the fix.

## 1.4 What is genuinely good

Worth stating, because a diagnosis that finds nothing salvageable is usually wrong:

- **The product thesis is right.** "Goodnotes for understanding research papers" is a real
  gap, and the four pillars (fidelity, contextual AI, canvas, audiobook) are coherent.
- **`get_page_image`** (`routes.py:349-409`) already renders a normalised page region at a
  requested scale. That is exactly the `crop_pdf_region` primitive the new architecture
  needs. Keep it, bound the scale, cache it.
- **`TextAnchor`** (`highlights/models.py:78`) is a W3C `TextQuoteSelector` in all but
  name — the right instinct, never wired up.
- The **canvas node vocabulary** (page super-node, exploration, AI response, note) is a
  reasonable starting taxonomy, even though the implementation auto-generates it.
- The **domain modelling instinct** throughout — `SourceLocation`, `BoundingBox`,
  `PDFRegion`, block types — is sound. It was written and then bypassed.

## 1.5 The one-sentence diagnosis

> PaperTree has the right product idea and wrote much of the right domain model, then
> shipped a pipeline that throws all of it away at ingest — so every feature downstream
> is reconstructing, guessing, or fabricating what should have been preserved.

---

# 2. Current repository map

~6,100 lines Python · ~9,000 lines TypeScript/TSX/CSS.

## 2.1 The real flow

```
POST /papers/upload                                   routes.py:40   SYNCHRONOUS
  ├─ file.read()  (no size limit, whole file in memory)
  ├─ write storage/papers/{uuid4}.pdf   (no content hash → no dedup)
  ├─ extract_text_from_pdf()            13 lines, flat string + [Page N]
  └─ insert { extracted_text, page_count }        ← the entire document model

POST /papers/{id}/generate-book                       routes.py:146  SYNCHRONOUS
  ├─ generate_paper_tldr()              1 call,  first 4,000 chars
  └─ generate_multiple_pages()          N SEQUENTIAL calls, 90 s timeout each
       └─ per page: regex-slice on [Page N]
                    truncate to 5,000 (first 2,500 + last 2,500, middle discarded)
                    → LLM → hand-rolled JSON recovery (3 regex fallbacks)
  └─ smart_outline = one entry per PAGE, titled by the LLM

Reader  ── PDF mode ──  react-pdf, every page eagerly mounted, no virtualisation
        └─ Book mode ──  renders ONLY the LLM page summaries

Highlight ── range.getClientRects() ÷ window.innerWidth/Height   read/page.tsx:228
          └─ rendered as a % of the PAGE element                 PDFViewer.tsx:146
             (two different coordinate spaces — wrong on creation, worse on resize)

Canvas   ── POST /canvas/populate on first open
          └─ one node per PDF page, unbidden, + every highlight + every explanation
          └─ whole document PUT back on a 3 s dirty timer
```

**Named vs actual:**

| Name | Actual |
|---|---|
| "Enhanced PDF extraction with proper math, figures, and source mapping" | dead code, never imported |
| "Book mode" | LLM prose rendered *instead of* the paper |
| "SmartOutline" | one flat entry per generated page, level hardcoded to 1, LLM-invented title |
| "structured content" | `extract_structured_content()` — never called |
| "Explanation tree" | parent/child rows with no stored prompt, context, page, tokens or cost |
| "Infinite canvas" | server-generated React Flow tree of the PDF's pages |
| "Research paper reader with AI explanations" | accurate |

## 2.2 Where information is lost

| Step | Lost |
|---|---|
| Ingest | **everything** — geometry, block identity, hierarchy, figures, equations, tables, fonts, reading order, the PDF's own TOC |
| Page slicing | the middle of any page over 5,000 chars |
| Generation | the link between any generated sentence and any source region |
| Highlight capture | PDF coordinates, page dimensions, character offsets, block identity |
| Canvas | all geometry; provenance reduced to one page integer |
| Failure | the distinction between "failed" and "content" |

## 2.3 Duplicated responsibility

Three extractors · two highlight schemas (`book_id`- and `paper_id`-keyed, one collection)
· two `Highlight` TypeScript types with the API layer typed as the wrong one · two canvas
type systems · two API clients with different auth and error behaviour · four independent
OpenRouter clients with four disjoint prompt vocabularies · two canvas routers mounted in
`main.py`.

Full evidence: `../findings.md` §A–§G; per-subsystem detail in `audit-*.md`.

---

# 12. Agent-runtime decision

**Decision: (E→B) a thin runtime over a tool registry we own — specifically
Pydantic AI (MIT), in-process, behind our own tool abstraction.**

**Reasons.**
- PaperTree's agent need is narrow: call ~20 read-only tools over a deterministic
  document system and return structured, grounded output. The loop itself is not the hard
  part — the tools, retrieval and grounding are.
- Pydantic AI is Python-native (matching the document workers), MIT, has **no filesystem
  or shell tools to disable**, treats OpenRouter as a first-class provider, sends
  telemetry nowhere by default, and has the strongest typed structured-output story —
  which matters because PaperTree's tools return document objects, not prose.
- The guardrail that makes this reversible: the ~20 tools live in
  `packages/agent-tools` as a plain registry (name → JSON schema → async callable). Every
  candidate runtime can consume that in under ~100 lines of glue, so the runtime stays a
  swappable dependency rather than a rewrite.

**Rejected.** *Claude Agent SDK* — proprietary TS licence, bundled binary, no OpenRouter
path, filesystem-first defaults. *Managed agent runtimes* — renting a sandbox we would
then have to lock down, with retention and portability questions PaperTree cannot answer
for users' papers. *Codex SDK* — a coding harness; OpenAI's own docs route non-coding
workloads elsewhere. *Mastra / Vercel AI SDK / Pi* — TypeScript-only and therefore the
wrong side of the stack today; **Pi's `pi-agent-core` is the best-shaped OSS runtime in
the survey** (MIT, no built-in dangerous tools, 30+ providers, compaction hook) and would
be the pick if the agent layer ever moves to Node — but it shipped breaking changes in
v0.81.0 and v0.82.0 three days apart, so wait for a stability signal.
*LangGraph* — correct if PaperTree later needs durable multi-stage graph workflows;
today it is a graph runtime bought for a single loop.

**Non-negotiable, whichever is chosen.** The user-facing agent gets **no** shell, no
filesystem, no network egress beyond the model provider, and no write access to trusted
user memory. It operates only over the PaperTree tool surface. The agent runtime is
**not** the job queue — durable pipelines (parsing, audiobook) run in the workflow
engine, and the agent is invoked *by* steps, never the reverse.

**Development savings.** Modest and honest: a tool-calling loop with retries and
streaming is roughly a week to write and a long tail to maintain. What is genuinely not
trivial — and worth buying — is compaction, provider quirk handling, structured-output
retries, and streaming edge cases.

**New complexity introduced.** One dependency in the request path, and a version-pinning
obligation. Mitigated by the registry indirection above.

---

---

# Headline decisions (§5, §8–9, §13–17 in brief)

Full reasoning in the linked files; this is the index of what was decided.

## Parsing (§5, §8, §9) — `synthesis-05-parser-comparison.md`

**Option C, hybrid adaptive with confidence-gated escalation.** A deterministic tier-0
fast path (pypdfium2 + pdfplumber + XY-Cut++ + numbering-first hierarchy) at **~0.6 s/page**
handles clean born-digital pages; specialist models are invoked **per flagged region**.

Crucially: **import Docling's models** (`docling-ibm-models`) rather than adopting its
full `StandardPdfPipeline`. Justified by our own measurement — 19.0 s/page on ResNet and
5.0 s/page on Attention, which puts the 55-page Shannon paper at 4.5–17 minutes — and by
the PDF-to-Tree ablation showing a cheap deterministic pass captures most of the
hierarchy signal.

**PaperTree must own the equation-region layer under every architecture.** Docling's
`do_formula_enrichment` is off by default, and its default detection found only 2 and 5
formula regions against ~10 numbered equations per paper (measured). Enrichment cannot
recognise what detection never proposed.

**Eliminated on licence, not accuracy:** Marker/Surya — OpenRAIL-M §8 share-alike reaches
the *parsed output itself*, plus a §2(c) non-compete; Nougat (CC-BY-NC, dead since Oct
2023); LayoutLMv2/v3 and LayoutReader weights (CC BY-NC-SA); DocLayout-YOLO code (AGPL,
dormant); PDF-to-Tree (no licence at all). GROBID is retained as a **cross-check oracle**
for section tree and bibliography (reference F1 0.87–0.90, unmatched) but never as the
primary parser (DocBank table F1 0.23, equation 0.25).

**PyMuPDF: purge it.** All three options were analysed. Isolating it behind a service was
**rejected** — AGPL §13 is written specifically to reach network users, and the
GROBID/pdfalto GPL-2.0 precedent does not transfer. Buying the Artifex licence is
quote-based with no published price. Recommendation: swap to **pypdfium2 (BSD-3) +
pdfplumber (MIT)** before any new parser code is written.

## Anchoring and Q&A (§10) — `synthesis-10-highlight-and-qa.md`

W3C multi-selector anchor, PDF-user-space quads, resolved through an explicit **T0–T6
tier ladder** to a **≥99% re-anchor bar with loud failure**. Evidence package assembled
under an **~8,100-token ceiling**. Verifier-gated answer schema keeps interpretation
structurally separate from source.

## Memory and injection (§13) — `synthesis-13-memory.md`

The important decision: **the trust boundary is enforced by a Postgres `GRANT`, not by
prompt text.** Detection-based injection defence is measurably broken — >90% attack
success rate under adaptive attack (Nasr et al., USENIX Security 2026) — so only
architectural controls hold. The agent's DB role physically cannot write user-learning
memory.

## Audiobook (§17) — `synthesis-17-audiobook.md`

**Per-segment synthesis + concatenation.** This makes segment-level source sync exact *by
arithmetic* on every TTS engine, which removes vendor lock-in on timestamp APIs and
eliminates the forced-alignment line item entirely. Cost for a fully grounded 60-minute
narration of a 20-page paper: **~$0.53** local-TTS tier, ~$1.41 Azure, ~$3.28 ElevenLabs Flash.

## Stack and monorepo (§14–16) — `synthesis-14-stack-monorepo.md`

**Option D — one Python plane with two entrypoints over one image**, Next.js as a pure
BFF, **PostgreSQL + pgvector** as the spine, **R2** for blobs, **DBOS Transact** for
durable steps. Migrate off MongoDB now, "while the irreplaceable-row count is still ~zero."

---

## Known inconsistency to reconcile before implementation

ADR-001 and `synthesis-05` independently specify the stable block ID and arrived at
slightly different formulas:

| | ADR-001 | synthesis-05 |
|---|---|---|
| Hash | blake2s | sha256 |
| Quantisation | 2 pt | 0.5 pt |
| Inputs | source_hash ‖ page ‖ bbox ‖ type ‖ text[:64] | page ‖ bbox ‖ NFC text prefix |

Both agree on the principle — content-derived, re-parse-stable, PaperTree-minted, because
**no candidate parser supplies stable identity** (Docling uses positional JSON pointers,
Marker per-page counters, MinerU none, GROBID random `xml:id`s per run). The quantisation
grid is an empirical question: too fine and parser jitter breaks IDs, too coarse and
distinct blocks collide. **Resolve it by measurement during the first milestone** —
re-parse the corpus under perturbed configs and pick the coarsest grid with zero
collisions. Do not settle it by preference.

---

## Status and honest limitations

**Complete:** Stage 1 (audit), Stage 2 (research, 20 reports ≈ 64k words), Stage 3
(benchmark design, PaperIR, IA, wireframes, roadmap, change map).

**Provisional:** the parser recommendation. Tier B gold annotations do not exist yet
(~60 expert-hours), so §9 states a direction with an explicit falsification condition,
not a final selection. **No parser should be adopted in production before PTUB runs.**

**Not started:** Stage 4 §21–24 — the Claude Design exploration, selected direction,
canvas redesign and design-system handoff. The brief for it (§20) is written.

**Measured, not assumed:** the capability matrix in `../findings.md` §H2 comes from
actually running four parsers on this machine. Everything in it is reproducible via
`benchmarks/harness/compare_parsers.py`.

**Known gaps:** the corpus is 8 papers against a designed 44; no scanned or non-English
paper has been tested; Docling was measured in its *default* configuration, which
understates it (formula enrichment off, heading hierarchy flattened).
