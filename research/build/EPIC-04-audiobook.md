# EPIC 4 — Audiobook & Paper Replay

**Wave 3 · parallel with Epic 5 · depends on Epics 1–3**

> Goal: a listenable, source-mapped narration generated from the section tree — where
> tapping a paragraph jumps the audio there, and every spoken segment knows which blocks
> it came from.

---

## The architectural insight this epic is built on

**Per-segment synthesis + concatenation.** Instead of synthesising a whole chapter and
then trying to recover timings, synthesise each segment separately and concatenate.
Segment boundaries are then known *by arithmetic* — exact on every TTS engine.

This removes vendor lock-in on timestamp APIs, eliminates forced alignment
(WhisperX/MFA) entirely, and makes the segment→block mapping trivially correct. It also
makes per-segment regeneration cheap: fix one paragraph without re-rendering a chapter.

Cost for a grounded 60-minute narration of a 20-page paper: **~$0.53** on a local-TTS
tier, ~$1.41 Azure, ~$3.28 ElevenLabs Flash. Given "cheap and low-resource", default to
the cheapest tier that sounds acceptable and make the provider pluggable.

---

## Features

- [ ] **F4.1 — Chapter planner.** Chapters from PaperIR's **semantic section tree**, never PDF pages. Split over-long sections; merge trivially short ones. Deterministic and reviewable before any audio is generated.
- [ ] **F4.2 — Grounded script generation.** Per section, using Epic 3's evidence packages. Every script segment records `derived_from` block IDs. Runs as durable job steps.
- [ ] **F4.3 — Equation verbalisation.** MathML → speech via a speech-rule engine (SRE / MathJax a11y, ClearSpeak or MathSpeak rulesets). **Not an LLM reading LaTeX aloud** — this is a solved accessibility problem; reuse it. Fallback for equations without MathML: read the crop's caption context and say so.
- [ ] **F4.4 — Figure description.** Generated from the figure crop + caption + referencing paragraphs. **Announced as AI-generated in the audio itself**, not silently narrated as if from the paper.
- [ ] **F4.5 — Script validation.** Grounding check before synthesis — the narration must not assert what the paper does not say. Cheaper to catch here than after paying for TTS.
- [ ] **F4.6 — TTS + concatenation.** Pluggable provider. Per-segment synthesis, concatenation, exact segment offsets by arithmetic. Per-segment retry and regeneration.
- [ ] **F4.7 — Player + Paper Replay.** Persistent transport. Bidirectional sync: audio position ↔ Guided view ↔ outline ↔ PDF page ↔ current source region. Tap a paragraph → audio jumps there.

F4.3 and F4.4 are parallel-safe. F4.7 depends on F4.6.

## Owns

```
services/audio-worker/**   apps/web/src/components/audio/**   packages/audio-types/**
```

## Acceptance

| Test | Asserts |
|---|---|
| `audio/chapters.spec` | Chapters follow the section tree. **No chapter boundary coincides with a page boundary except by genuine coincidence.** |
| `audio/mapping.spec` | Every spoken segment maps to ≥1 PaperIR block ID; offsets are exact (arithmetic, not estimated). |
| `audio/replay.spec` | Audio position → highlighted source block within one block. Tapping a paragraph seeks to the right segment. |
| `audio/equations.spec` | Equations are spoken via speech rules; output is deterministic and matches golden strings. |
| `audio/attribution.spec` | Every AI-generated figure description is audibly marked as such. |
| `audio/durability.spec` | A chapter failing mid-generation retries **from its last good step**, not from scratch. Killing the worker loses no completed segment. |
| `audio/cost.spec` | Cost per paper is measured, logged and capped; exceeding the cap stops generation and reports. |

## Non-goals

No voice cloning. No self-hosted GPU TTS. No music, no sound design.

---

# WORKFLOW PROMPT

You are building **Epic 4 — Audiobook & Paper Replay** for PaperTree v2.
**Repo:** `/Volumes/Mrigesh SSD/PaperTree` (quote the path). Branch: `epic-4-audiobook`.
Epics 0–3 merged. Safe to run alongside Epic 5.

## Read first
- `research/synthesis-17-audiobook.md` — the full pipeline design and cost model
- `research/literature/14-audiobook-tts.md` — TTS providers, timestamps, speech rules for maths
- `research/architecture-decisions/ADR-001-…md` — PaperIR, the source of chapters

## Context
Open-source hobby project, cheap and low-resource. No GPU. TTS is an API call or a light
local engine — pluggable, defaulting to the cheapest acceptable tier.

## The design decision that shapes everything
**Synthesise per segment and concatenate.** Segment offsets are then exact by arithmetic
on any engine — no forced alignment, no dependence on a vendor's word-timestamp API, and
per-segment regeneration is cheap. Build it this way from the start; retrofitting
timestamp recovery is the expensive path.

## Hard rules
- Chapters come from the **semantic section tree**, never from PDF pages.
- Every spoken segment maps to PaperIR block IDs, section IDs and page ranges.
- **Equations are spoken via a speech-rule engine** (SRE / MathJax a11y with ClearSpeak or MathSpeak), not by an LLM improvising from LaTeX. This is a solved accessibility problem — reuse it.
- **AI-generated figure descriptions are announced as AI-generated in the audio.** A listener must never be unable to tell what came from the paper.
- Script validation runs *before* synthesis — catch ungrounded narration before paying for TTS.
- Generation is a **durable job with per-step checkpointing** via `packages/jobs`. The agent runtime is not the job queue. A failed chapter resumes from its last good step.
- Cost is measured, logged, and capped per paper.

## Acceptance
Chapters follow the section tree · exact segment→block offsets · replay syncs within one
block, bidirectionally · deterministic equation speech matching golden strings · every AI
figure description audibly marked · a killed worker loses no completed segment · cost
capped and enforced.

## Non-goals
No voice cloning, no self-hosted GPU TTS, no sound design.

## How to work
F4.3 and F4.4 are parallel-safe — use worktrees. Build F4.1 and F4.5 early; a reviewable
chapter plan and a validation gate prevent expensive mistakes downstream.

One PR per feature. Finish with `research/build/EPIC-04-RESULT.md`: measured cost per
paper by provider tier, replay sync accuracy, and any PaperIR gaps you hit.
