# EPIC 0 — The Spine

**Wave 0 · sequential · blocks everything · no parallelism within this epic beyond F5/F6/F7**

> Goal: freeze the contracts that every other epic depends on, and ship golden fixtures
> so Wave 1 can run in parallel.

This epic is deliberately small and deliberately slow. Everything downstream inherits
these decisions. Do not add features here.

---

## Features

- [ ] **F0.1 — Monorepo skeleton.** pnpm workspaces + Turborepo for TS; `uv` workspace for Python. `apps/web`, `apps/api`, `services/*`, `packages/*`, `infrastructure/*`. Root scripts: `dev`, `build`, `test`, `lint`, `typecheck`. (`dev` exists and is a `turbo run dev` passthrough that currently executes nothing — there is no app to run until Wave 1. `services/*` is globbed by `pnpm-workspace.yaml` and the directory does not exist yet; Epic 1 owns `services/document-worker`.)
- [ ] **F0.2 — PaperIR JSON Schema.** Single source of truth at `packages/document-ir/schema/paperir-1.0.0.schema.json`. Implements `research/architecture-decisions/ADR-001-canonical-document-representation.md`.
- [ ] **F0.3 — Codegen.** JSON Schema → TypeScript types + Zod validators, and → Pydantic v2 models. Wired into `build`. **A drift test fails CI if generated files are stale.**
- [ ] **F0.4 — Identity + geometry library.** Content-derived stable block IDs; PDF-user-space polygon helpers; the coordinate transform (bottom-left→top-left, rotation, CropBox/MediaBox, userUnit). Shipped as a TS package **and** a Python twin with a shared conformance test vector file.
- [ ] **F0.5 — SQLite schema + migrations.** `papers`, `pages`, `blocks`, `relations`, `block_vectors` (sqlite-vec), `highlights`, `anchors`, `derivations`, `jobs`, `job_steps`, `users`. Forward-only numbered migrations with a runner.
- [ ] **F0.6 — Durable job runner.** Jobs table with per-step checkpointing, retry with backoff, idempotency keys, cancellation, progress. Survives process restart. ~300 lines, not a framework.
- [ ] **F0.7 — Golden fixtures.** Hand-checked PaperIR JSON for **3 papers** (ResNet, Attention, one math-heavy), committed to `packages/document-ir/fixtures/`. **This unblocks Epic 2.**
- [ ] **F0.8 — CI.** Typecheck, lint, unit tests, codegen-drift check, fixture-validation check. GitHub Actions.

F0.5, F0.6 and F0.8 can run in parallel once F0.2–F0.4 have landed.

---

## Resolve before writing code

**The stable-ID formula is unresolved.** Two of the design docs specify different
quantisation grids and hash functions:

| | ADR-001 | synthesis-05 |
|---|---|---|
| Hash | blake2s | sha256 |
| Quantisation | 2 pt | 0.5 pt |
| Inputs | source_hash ‖ page ‖ bbox ‖ type ‖ text[:64] | page ‖ bbox ‖ NFC text prefix |

**Decide this empirically, not by preference.** Re-parse the 8-paper corpus in
`research/benchmarks/corpus/` under perturbed extraction settings, measure collisions and
ID churn at grids of 0.25 / 0.5 / 1 / 2 / 4 pt, and pick **the coarsest grid with zero
collisions**. Write the result into the ADR as an amendment with the measured table.

---

## Owns (exclusive)

```
packages/document-ir/**
packages/db/**
packages/jobs/**
infrastructure/migrations/**
.github/workflows/**
turbo.json  pnpm-workspace.yaml  pyproject.toml (root)
```

No other epic may edit these. Changes are requested via issue.

---

## Acceptance criteria (tests, by name)

| Test | Asserts |
|---|---|
| `document-ir/identity.spec` | Same input ⇒ same ID, 10k times. Different input ⇒ different ID. Cross-language: TS and Python produce identical IDs for the shared vector file. |
| `document-ir/geometry.spec` | Round-trips PDF↔viewport at 8 zoom levels and 4 rotations with <0.01pt error. Handles `userUnit ≠ 1` and `CropBox ≠ MediaBox`. |
| `document-ir/schema.spec` | All 3 fixtures validate. A block with an unknown `type` validates (forward compat). A block missing `polygon` fails. A block with LLM-authored text in a source field fails. |
| `document-ir/codegen-drift.spec` | Regenerating from schema produces no diff. |
| `db/migrations.spec` | Migrate up from empty → head; re-running is a no-op; a paper with 30k blocks inserts in <2s. **MET BY THE MINIMAL FIXTURE ONLY** — with parser-shaped blocks (60 words, 12 spans, 8-point polygon) the same insert measures ~2.3 s TS / ~3.9 s Python. Both numbers are printed by the suite; see `packages/db/test/migrations.spec.ts` and `research/build/EPIC-00-RESULT.md`. |
| `db/ownership.spec` | **Every** query helper requires an owner argument. A query built without one fails to compile (TS) / raises (Python). |
| `jobs/durability.spec` | A job killed mid-step resumes at that step, not from the start. A failed step retries with backoff then dead-letters. Cancellation is honoured within one step. |

---

## Non-goals

No parser. No UI. No LLM calls. No auth beyond a `users` table. If you are tempted to
"just also add" any of these, that is the slop this plan exists to prevent.

---

## Must delete

Nothing yet — Epic 0 builds alongside the existing app. Deletions happen in Epics 1–2
once replacements are proven.

---

# WORKFLOW PROMPT

> Paste everything below into a fresh Claude Code session in ultracode mode.

---

You are building **Epic 0 — the Spine** of PaperTree v2.

**Repo:** `/Volumes/Mrigesh SSD/PaperTree` (note the space; quote it in shell commands).
Work on a branch `epic-0-spine`. The existing app in `apps/` stays running and untouched.

## Read first (do not skip — this is the accumulated design work)

- `research/architecture-decisions/ADR-001-canonical-document-representation.md` — the schema you are implementing. Follow it.
- `research/build/README.md` — constraints and anti-slop rules.
- `findings.md` §A–§E — why the current system is being replaced. Read this so you understand which mistakes you are avoiding.
- `research/synthesis-05-parser-comparison.md` — §"stable IDs" for the competing formula.

## Context

PaperTree is an open-source hobby project: a premium environment for reading and
understanding research papers. It is being rewritten because the current version discards
all document geometry at ingest — production extraction is 13 lines producing a flat
string, and 1,698 lines of geometry-aware code sit unreachable.

Constraints, which override anything in the older docs that contradicts them:
- **SQLite + sqlite-vec.** Not Postgres. No Docker required to run the app.
- **No self-hosted LLM, no GPU.** Cheap and laptop-friendly.
- **Open source.** Licences are not a selection filter.
- Ownership checks are built into the data layer from day one.

## Your scope — build exactly these, nothing more

1. **Monorepo skeleton** — pnpm workspaces + Turborepo (TS), uv workspace (Python).
2. **PaperIR JSON Schema** at `packages/document-ir/schema/paperir-1.0.0.schema.json`, implementing ADR-001.
3. **Codegen** — schema → TS types + Zod, and → Pydantic v2. A CI test must fail if generated output is stale.
4. **Identity + geometry library**, in TypeScript *and* Python, sharing one conformance test-vector file so both languages provably agree.
5. **SQLite schema + forward-only migrations** with a runner.
6. **Durable job runner** — jobs + job_steps tables, per-step checkpointing, retry with backoff, idempotency, cancellation, progress. Roughly 300 lines. **Do not adopt a workflow framework.**
7. **Golden fixtures** — hand-checked PaperIR for 3 papers in `research/benchmarks/corpus/` (resnet-cvpr-2col, attention-is-all-you-need, neural-odes-mathheavy), committed to `packages/document-ir/fixtures/`.
8. **CI** — typecheck, lint, test, codegen-drift, fixture validation.

## The one thing that matters most

**F0.7, the fixtures, unblock the entire Reader epic to run in parallel with the Parser
epic.** They must be real, hand-checked, and complete enough to render a reader against:
correct block types, polygons, reading order, section hierarchy, at least one figure with
a linked caption, and at least one equation. Generate them however you like — including
by hand-correcting a parser's output — but **verify them against the actual PDF pages**
before committing. A wrong fixture poisons Epic 2.

## Resolve empirically, do not guess

The stable-ID quantisation grid is genuinely undecided (ADR-001 says 2pt/blake2s;
synthesis-05 says 0.5pt/sha256). Re-parse the 8 papers in `research/benchmarks/corpus/`
under perturbed extraction settings, measure ID collisions and churn at 0.25/0.5/1/2/4pt,
and pick the **coarsest grid with zero collisions**. Append the measured table to ADR-001
as an amendment. Do not settle this by preference.

## Acceptance — you are done when these pass

[the test table from the Acceptance section above]

Specifically: cross-language ID agreement, geometry round-trip <0.01pt across 8 zooms and
4 rotations, 30k-block insert <2s (minimal fixture; see the acceptance table's note), a job
killed mid-step resuming at that step, and every
query helper structurally requiring an owner.

## Hard rules

- **No LLM writes into PaperIR, ever.** The schema must make it impossible to express
  AI-authored text in a source field — and there must be a test proving it.
- Geometry is PDF user space, origin top-left, normalised once at parse time. Never
  viewport pixels. Regions are polygons, not rectangles.
- `unknown` is a valid block type and must round-trip. A parser that cannot classify a
  region emits `unknown` with geometry intact rather than dropping it.
- Forward compatibility: unknown block/relation types must validate, not fail.
- No new runtime dependency without a one-line justification in the PR body.

## Non-goals — explicitly out of scope

No parser. No UI. No LLM calls. No auth beyond a `users` table. No canvas, no audio.
Resist scope creep; five other epics depend on this one being small and correct.

## How to work

Parallelise F0.5, F0.6 and F0.8 once F0.2–F0.4 land — they touch disjoint paths. Keep
F0.2–F0.4 sequential; they are the contract.

One PR per feature against `epic-0-spine`. Each PR must state which acceptance test it
satisfies. If a PR exceeds ~600 changed lines, split it.

When everything is green, write `research/build/EPIC-00-RESULT.md` recording: the chosen
ID formula with the measured collision table, any deviation from ADR-001 and why, and
anything Wave 1 needs to know.
