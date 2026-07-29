# Wave 0 — pasteable prompt

Paste everything below the line into a fresh Claude Code session, ultracode mode,
with the working directory set to `/Volumes/Mrigesh SSD/PaperTree`.

---

ultracode

Build **Wave 0 / EPIC 0 — The Spine** of PaperTree v2. Tracking issue:
https://github.com/Legend101Zz/PaperTree/issues/1 (tracker: #7)

Repo: `/Volumes/Mrigesh SSD/PaperTree` — **the path contains a space, quote it in every
shell command.** Work on a new branch `epic-0-spine`. The existing app under `apps/` keeps
running and must not be touched.

## Read these first — they are the accumulated design work, not background reading

- `research/build/EPIC-00-spine.md` — your full scope, acceptance tests, and non-goals
- `research/build/README.md` — constraints and the anti-slop rules
- `research/architecture-decisions/ADR-001-canonical-document-representation.md` — **the schema you are implementing; follow it**
- `findings.md` §A–§E — the measured failures of the system being replaced. Read this so you understand which mistakes you are avoiding
- `research/synthesis-05-parser-comparison.md` — search for "stable ID" for the competing formula

## What PaperTree is, and why this epic exists

PaperTree is an **open-source hobby project**: a premium environment for reading,
understanding, annotating and listening to research papers. It is being rewritten because
the current version discards all document geometry at ingest — production extraction is
13 lines producing a flat string, while 1,698 lines of geometry-aware code sit unreachable
with zero importers. Measured on the ResNet paper, the live path yields **0 figures,
0 tables, 0 addressable objects**.

Epic 0 freezes the contracts that all five remaining epics depend on. It is deliberately
small and deliberately slow. **Do not add features.**

## Constraints — these override anything in the older docs that contradicts them

- **SQLite + sqlite-vec.** Not Postgres. No Docker needed to run the app: `git clone && install && run`.
- **No self-hosted LLM, no GPU.** Cheap and laptop-friendly.
- **Open source** — licences are not a selection filter. PyMuPDF is fine.
- Ownership checks are built into the data layer from day one (the old app has 33 query sites with no owner filter; we are not repeating that).
- No new runtime dependency without a one-line justification in the PR body.

## Scope — build exactly these eight, nothing more

1. **Monorepo skeleton** — pnpm workspaces + Turborepo (TS), uv workspace (Python). `apps/`, `services/`, `packages/`, `infrastructure/`. Root scripts: `dev build test lint typecheck`.
2. **PaperIR JSON Schema** at `packages/document-ir/schema/paperir-1.0.0.schema.json`, implementing ADR-001.
3. **Codegen** — schema → TS types + Zod, and → Pydantic v2. A CI test fails if generated output is stale.
4. **Identity + geometry library** in **TypeScript and Python**, sharing one conformance test-vector file so both languages provably agree.
5. **SQLite schema + forward-only migrations** with a runner.
6. **Durable job runner** — `jobs` + `job_steps`, per-step checkpointing, retry with backoff, idempotency keys, cancellation, progress. ~300 lines. **Do not adopt a workflow framework.**
7. **Golden fixtures** — hand-checked PaperIR for 3 papers already in `research/benchmarks/corpus/`: `resnet-cvpr-2col`, `attention-is-all-you-need`, `neural-odes-mathheavy`. Committed to `packages/document-ir/fixtures/`.
8. **CI** — typecheck, lint, test, codegen-drift, fixture validation. GitHub Actions.

## How to orchestrate this (dynamic workflows)

The dependency structure is real; respect it or you will produce incompatible work.

**Phase A — Decide (sequential, no fan-out).**
Resolve the stable-ID formula empirically. See "The decision" below. Nothing else starts
until the ID formula is fixed, because item 4 and item 7 both depend on it.

**Phase B — Contract (sequential, no fan-out).**
Items 2 → 3 → 4, in that order. This is the contract every other epic consumes. Fanning
out here produces divergent interpretations of the same schema, which is precisely the
failure already in this repo (two `Highlight` types, two canvas type systems, three
extractors). One agent, one coherent design.

**Phase C — Fan out (parallel, 3 workers, worktrees).**
Items 5, 6 and 8 touch disjoint paths and can run concurrently once B has landed.

**Phase D — Fixtures (parallel per paper, then verify).**
Item 7: one worker per paper, then a **separate verification pass** that checks each
fixture against the actual rendered PDF pages. Do not let the agent that produced a
fixture also be the one that certifies it.

**Phase E — Adversarial review.**
Before declaring done, run independent reviewers against the acceptance tests, prompted to
*refute* that the criteria are met. Anything they can break is not done.

## The decision you must make with measurement, not preference

The stable block-ID formula is genuinely undecided. Two design docs disagree:

| | ADR-001 | synthesis-05 |
|---|---|---|
| Hash | blake2s | sha256 |
| Quantisation | 2 pt | 0.5 pt |
| Inputs | source_hash ‖ page ‖ bbox ‖ type ‖ text[:64] | page ‖ bbox ‖ NFC text prefix |

Re-parse the 8 papers in `research/benchmarks/corpus/` under perturbed extraction
settings. Measure ID collisions and ID churn at grids of 0.25 / 0.5 / 1 / 2 / 4 pt.
**Pick the coarsest grid with zero collisions.** Append the measured table to ADR-001 as
an amendment. Do not settle this by preference — every future highlight depends on it, and
guessing wrong breaks them silently.

## The single most important deliverable

**The fixtures (item 7) are what let Epic 2 (Reader) run in parallel with Epic 1 (Parser).**
Without them the waves collapse into a sequential chain and the whole parallel plan is
theatre.

They must be real and complete enough to render a reader against: correct block types,
polygons in PDF user space, reading order, section hierarchy, **at least one figure with a
linked caption**, and **at least one equation**. Produce them however you like — including
by hand-correcting a parser's output — but **verify them against the actual PDF pages
before committing.** A wrong fixture poisons Epic 2 silently.

## Acceptance — done means these pass

| Test | Asserts |
|---|---|
| `document-ir/identity.spec` | Same input ⇒ same ID over 10k runs. Different input ⇒ different ID. **TS and Python produce identical IDs** for the shared vector file. |
| `document-ir/geometry.spec` | PDF↔viewport round-trip at 8 zoom levels × 4 rotations, error <0.01pt. Handles `userUnit ≠ 1` and `CropBox ≠ MediaBox`. |
| `document-ir/schema.spec` | All 3 fixtures validate. Unknown block `type` **validates** (forward compat). Missing `polygon` fails. **LLM-authored text in a source field fails.** |
| `document-ir/codegen-drift.spec` | Regenerating from schema produces no diff. |
| `db/migrations.spec` | Empty → head; re-run is a no-op; 30k blocks insert in <2s. |
| `db/ownership.spec` | Every query helper **structurally requires** an owner — a query built without one fails to compile (TS) / raises (Python). |
| `jobs/durability.spec` | A job killed mid-step resumes **at that step**. A failed step retries with backoff then dead-letters. Cancellation honoured within one step. |

## Hard rules

- **No LLM ever writes into PaperIR.** The schema must make AI-authored text in a source field *impossible to express*, and there must be a test proving it.
- Geometry is **PDF user space, origin top-left**, normalised once at parse time. Never viewport pixels. Regions are **polygons**, not rectangles.
- `unknown` is a valid block type and must round-trip. Unclassifiable regions keep their geometry rather than being dropped.
- Forward compatibility: unknown block and relation types must validate, not fail.
- One PR per feature against `epic-0-spine`. Each PR states which acceptance test it satisfies. Split anything over ~600 changed lines.

## Non-goals — explicitly out of scope

No parser. No UI. No LLM calls. No retrieval or embeddings. No canvas, no audio. No auth
beyond a `users` table. Five other epics depend on this one being small and correct —
resist every temptation to "just also add" something.

## Finish by writing `research/build/EPIC-00-RESULT.md`

Recording: the chosen ID formula **with the measured collision table**; any deviation from
ADR-001 and why; what the fixtures do and do not cover; and anything Wave 1 needs to know
before Epics 1 and 2 start in parallel.
