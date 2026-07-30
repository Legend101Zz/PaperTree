# EPIC 1 — progress record (NOT the result doc)

**Status: INCOMPLETE.** Branch `epic-1-ingest`, 4 commits, `63be37d..4c0984f`, pushed.

This file exists because `EPIC-01-RESULT.md` is the *hand-off* document and writing one now
would be a claim of completion. Three of ten deliverables are done; the rest are not started or
not finished. `research/build/EPIC-01-ingest.md` is unedited — no acceptance criterion has been
weakened, and no test file claims a criterion it does not meet.

Everything below was measured on this machine, at `pymupdf 1.28.0`, against the 8-paper /
195-page corpus in `research/benchmarks/corpus/`.

---

## 1. Acceptance criteria — honest status

| Test | Status | Note |
|---|---|---|
| `worker/repairs.spec` | **MET** | `tests/worker/test_block_text.py`, 44 tests over all 8 papers |
| `worker/determinism.spec` | not started | needs assembly; must call `canonical_json_for_determinism`, not re-derive it |
| `worker/reading-order.spec` | **NOT MET** | worst cross-column alternation is 5 on ResNet; criterion forbids **any** |
| `worker/hierarchy.spec` | not started | |
| `worker/figures.spec` | partially | ResNet yields 12 vector regions (≥5 required) but no caption linking, no figure/table separation |
| `worker/equations.spec` | not started | |
| `worker/perf.spec` | on track, unclaimed | 18–75 ms/page against a 1500 ms/page p95 budget, but on the *parse*, not on a full assemble+persist |
| `worker/robustness.spec` | partially | classification covers scanned/blank/vector-only routing |
| `eval/ptub.spec` | not started | see §4 — it has a blocking dependency the brief does not mention |
| `ingest/source-authenticity.spec` | not started | design settled (§3.2), issue #27 already tracks it |

## 2. What landed

- **`pdf.py`** — the only module importing PyMuPDF. Typed, IR-space primitives.
- **`classify.py`** (F1.1) — digital / scanned / vector-only / blank routing, font census,
  per-page confidence, and the `partial_reason` a deferred scan implies.
- **`text.py`** (F1.2) — block text, character-range spans, dehyphenation proposals.
- **`layout.py`**, **`figures.py`** — committed as WIP, defects named in the commit message.

## 3. Findings that change what later epics should do

### 3.1 A geometry bug that would have shipped invisibly

`page.mediabox` is the raw `/MediaBox`; **`page.cropbox` has already been y-flipped into MuPDF's
top-left space**. Feeding the flipped box to `normalise_page_frame` intersects a top-left rect
with a bottom-left one. On `negative-mediabox.pdf` that produced a **400 pt** frame against a true
**450 pt** — a document that then fails validator rule G4 and whose every block id is computed
against the wrong page.

It is invisible on **8 of 8 corpus papers and 7 of 9 synthetic fixtures**, because the flip is
the identity whenever the MediaBox starts at `(0,0)` and the CropBox equals it. ADR-001
Amendment 1's P9 priced a wrong frame at **99.93 % of block ids**.

`tests/worker/test_geometry_contract.py` is the standing guard and is an oracle rather than a
tautology: it compares the worker's rects, read back through MuPDF, against `normalise_rect()`
applied to the raw content-stream operands recorded in `conformance/geometry-vectors.json`.
9 of 9 fixtures agree, including `combined.pdf` (/Rotate 270 + /UserUnit 1.5 + CropBox offset +
negative MediaBox).

### 3.2 `EPIC-02-RESULT.md` §2.3's span rule is wrong as stated, and the fix is different

The brief asks Epic 1 to "not emit spans that exceed 1.3 × their declared `size`". Applied to
`bbox` height that rule **destroys data**:

- The tallest spans in the corpus are **rotated text**. ResNet's worst is `h/size = 17.55` and it
  is the **arXiv margin stamp**; the next are matplotlib axis labels (`training error (%)`,
  `Samples`, `Density`). Their extent *across* the writing direction is `1.00–1.33 × size` —
  exactly one line. A height rule deletes the arXiv stamp and every rotated axis label.
- Among horizontal spans the tallest are `{`, `}` and big operators at `h/size ≈ 1.73`. Those
  glyphs really are that tall. Rejecting them deletes the delimiters from every display equation.
- **`size` is never missing from MuPDF**: 0 of 84,395 spans across all 8 papers. Epic 2's
  "118 of 727 spans lack `size`" is a property of Epic 0's hand-built fixtures, not of anything
  a PyMuPDF parser emits.

What Epic 2 actually needed is delivered by a different route: `Span.line_band`, computed from
the baseline and the font's own ascender/descender, is exactly one line high by construction, so
consecutive lines cannot overlap. `bbox` stays truthful; the polygon stops bleeding.

Corroborating: an independent verification pass could not reproduce the **"19.24 pt line-band
overlap"** figure under any definition. It is the *height* of two spans on the **same visual
line** in neural-odes' algorithm block; the shipped `sameLine()` groups them into one band, so it
is not an overlap at all. The over-tall **counts** (17 resnet / 0 attention / 12 neural-odes) and
the `1.3×` threshold do reproduce.

### 3.3 `doc_order` is body-only, and that is mandated, not incidental

Validator **rule 15**: `doc_order` is present on **exactly** the top-level blocks whose
`flow == "body"`. Verified against the fixtures with 0 violations: the `doc_order`-bearing set is
exactly `union(Page.flows.body)` (43/42/50 of 57/81/61 blocks).

So the brief's F1.3 question — "either populate `doc_order` on everything you emit, or document
loudly that it is body-only" — has only one legal answer. **Populating it on captions, footnotes
or nested blocks would be a rule-15 ERROR.** Epic 2's rebuild from `Page.flows` plus parent/child
descent is the correct consumer pattern and must stay.

### 3.4 The epic's stated feature dependency is backwards

`EPIC-01-ingest.md` says "F1.5, F1.6, F1.7 are parallel-safe once F1.2/F1.3 land". **F1.5 must
run before F1.3.** ResNet p3's Figure 3 has ~40 interior labels at 4.92 pt interleaved *in y*
with both columns' body text; fed to paragraph segmentation they shredded the page into 95 blocks
against a true ~15. Figure interiors must leave the body stream before columns are assigned.

### 3.5 CMEX10 private-use glyphs are real content, not corruption

ResNet page 4 carries 48 glyphs at U+F8EE/U+F8F0/U+F8F9/U+F8FB — TeX's private-use code points
for the **pieces** of a large delimiter. They have no Unicode meaning by construction. Two
consequences: they are a positive display-math signal for F1.7, and
`ingest/source-authenticity.spec` must expect them in `Block.text` rather than treat undecodable
text as model prose.

### 3.6 `Block.text` is the glyph stream, and that is the fixtures' own convention

All three golden fixtures keep the newline, the ligature (U+FB01) **and** the line-break hyphen,
and carry **zero repairs**. Normalisation lives in `text_normalised`. findings.md B7's silent
U+2212 → ASCII-hyphen rewrite is therefore fixed by **not rewriting**, not by recording the
rewrite — which also reduces `source-authenticity.spec` to an identity check.

Hyphenation is proposed, never applied: a `dehyphenate` repair with `applied: false`, consumed
via `resolved_text(block, apply_proposed=True)`. 749 proposals across the corpus; rules 25, 26,
27 and 30b hold on every one, 30b checked against `validate._dehyphenate` itself.

## 4. `eval/ptub.spec` has a blocking dependency the brief does not mention

`research/benchmarks/README.md` §7 states: **"Gold annotations: not started — the critical path
item; ~60 expert-hours"**, and §7's closing line is *"No parser selection is authorised until
Tier B gold exists and rows 1–5 have been run."*

The brief's decision rule needs **F1 on element detection, reading order and figure recall** —
all Tier B metrics, all requiring gold that does not exist and that this session cannot
legitimately manufacture. An agent annotating its own benchmark is precisely the bias the rule
was written in advance to prevent.

The speed half (**≥20×**) is measurable without gold and is on track by two orders of magnitude:
the deterministic parse runs at 18–75 ms/page against Docling's measured 19 s/page on ResNet and
5 s/page on Attention (findings.md H2) — roughly **250–1000×**, not 20×.

**Recommendation, for a human to decide:** build the annotation tool and metrics, annotate a
small hand-checked subset (well short of 120 pages), report the verdict against it, and state
explicitly that it does not clear §7's authorisation bar. Do not report a Docling comparison as
if Tier B existed.

## 5. Files changed outside Epic 1's ownership

All four are declared on **issue #45**, additive, and change no behaviour for existing packages:
`pyproject.toml` (workspace member + `testpaths`), `.github/workflows/ci.yml` (ruff/mypy path
args, so `services/` is checked rather than silently green), `uv.lock` (+`pymupdf`, +2 members;
25 packages total), `package.json` (`py:lint`/`py:format:check` had drifted behind CI and gave a
false green; `py:typecheck` added).

**Docling is deliberately absent from the lockfile in every form** — one `docling>=2.0` line took
it from 22 packages to 100+, because uv locks a group whether or not it installs it. It stays an
opt-in probe venv per findings.md §E.

## 6. What the next session must do

In dependency order: finish F1.3 against the two named defects → F1.4 hierarchy → F1.6 tables →
F1.7 equations → F1.8 joining → assembly into a validator-clean `Paper` → durable job + `put_paper`
→ the three deletions in `apps/api` → `ingest/source-authenticity.spec` → F1.9 and the PTUB
verdict → `EPIC-01-RESULT.md`.

Two contract details that will otherwise cost an hour each:

- `paper.model_dump(mode="json", by_alias=True, exclude_unset=True)` is the **only** correct
  serialisation. `model_dump_json()` emits `from_` for every `Relation` and `null` for every
  absent optional — 1,241 ajv errors.
- Every optional field is non-nullable: pass **absent**, never `None`, and `[]` is invalid for
  every optional array (`minItems: 1`). Build kwargs conditionally.
