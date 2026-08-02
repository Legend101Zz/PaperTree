# PTUB gold annotation — how to unblock the parser decision

`README.md` §7: *"Gold annotations: **not started** — the critical path item; ~60 expert-hours"*
and *"No parser selection is authorised until Tier B gold exists."*

This is the only thing blocking four acceptance criteria and the zero-ML-vs-Docling verdict.
Everything else is built and waiting on it.

**You do not need 60 hours.** That figure is for the full 12-paper / 120-page Tier B set. A
useful first answer needs far less — see §5.

---

## 1. Why a human has to do this

The parser must not annotate its own benchmark. Neither may an agent that has read the parser's
output: the decision rule was fixed *before* results precisely so the measurement could not be
shaped by them, and a gold set produced with knowledge of one candidate's behaviour scores that
candidate, not the task.

Docling's output is not gold either. It is another candidate.

---

## 2. Build the bundle

```bash
cd "/Volumes/Mrigesh SSD/PaperTree"

uv run python -m papertree_evaluation annotate \
  --out "/Volumes/Mrigesh SSD/papertree-gold" \
  --pages 6 \
  --papers resnet-cvpr-2col attention-is-all-you-need neural-odes-mathheavy
```

Already run — the bundle exists at `/Volumes/Mrigesh SSD/papertree-gold/`, 18 pages across
three papers. Drop `--papers` for all eight, `--pages 10` for the full README quota.

Keep `--out` **outside the repository**. CI's codegen-drift step is a whole-tree
`git status --untracked-files=all`, and PNGs written inside the repo turn it red.

## 3. Annotate

```bash
open "/Volumes/Mrigesh SSD/papertree-gold/images/annotate.html"
```

For each page: pick a **type** and a **flow**, drag a box, repeat. `undo` removes the last one.
When finished, **download gold JSON** and save it as
`/Volumes/Mrigesh SSD/papertree-gold/gold.json`.

It is one self-contained HTML file — no server, no build, works offline. Boxes are recorded in
**PDF user space** (origin top-left), so they are independent of your window size and of any
parser.

### The three that are genuinely confusing

Found by annotating a real page — all three sit at the top or bottom of the page and look alike.

| looks like | it is | because |
|---|---|---|
| "Google Brain" under the authors | `affiliation`, flow `body` | it says **who the authors are** |
| "∗Equal contribution. Jakob proposed…" | `footnote`, flow `footnote` | it is **content** — the paper is making a point |
| "31st Conference on NIPS 2017, Long Beach" | `footer`, flow `footer` | it is **furniture** — the venue notice, not the paper |
| the rotated "arXiv:1706.03762v7" down the left edge | `margin_note`, flow `margin` | it is the preprint stamp, not the paper |

**Affiliation vs footer** is the pair that catches people: an affiliation belongs to the authors
and is body content; a footer is page furniture that would appear whether or not this paper had
authors.

### `citation` vs `reference_entry` — RULED 2026-08-03, issue #55

**A `citation` is the marker in the running text. A `reference_entry` is one entry in the
bibliography. The bibliography is never one box.**

This is a ruling rather than a preference, because the schema already decides it and this guide
never passed the decision on:

- `Span.role`'s documented vocabulary (`packages/document-ir/DESIGN.md` D17, and
  `Span.role`'s own docstring) is *"`inline_equation`, `citation`, `footnote_marker`, `code`,
  …"* — a list of things that occupy a **character range inside a paragraph**. D17 exists
  because *"inline citations are what `resolve_citation` resolves"*.
- Semantic **rule 23**: `cites.to` must point at a **`reference_entry`** block. So the thing
  that cites is a `citation` and the thing cited is a `reference_entry`; they cannot be the
  same object.

The first gold pass drew the other convention, and it is worth stating what it cost so the next
pass does not repeat it. Measured on the 2026-08-02 gold: **4 `citation` regions, one per
reference page, sized 421 × 660, 446 × 673, 489 × 749 and 506 × 54 pt** — i.e. a whole page of
bibliography as a single box, on `attention-is-all-you-need` p11, `neural-odes-mathheavy` p10,
`bert-2col` p9 and `gpt3-longform-singlecol` p74. Against them the parser emits **17, 2, 13 and
2 `reference_entry` blocks** inside those very boxes. Nothing can match: the types differ and
the granularity differs, so all four score 0.00 and the `citation` row costs
**0.0136–0.0271 macro F1** on four of the six annotated papers while looking like a detection
failure.

**The parser is not the thing to change**, and rule 5 below already says why: *"a wrong type is
worse than an honest `unknown` — it makes a correct parser look wrong."* Concretely, next pass:

| you are looking at | draw | flow |
|---|---|---|
| one entry in the reference list — `[12] K. He, X. Zhang… CVPR, 2016.` | one `reference_entry` per entry | `body` |
| `[12]` or `(He et al., 2016)` sitting inside a sentence | **do not draw a region.** It is a `Span.role` inside its paragraph, and this tool records regions | — |
| the whole reference list, because drawing 40 entries is tedious | **no.** One box per logical region, and a bibliography is forty of them | — |

Until a pass redraws them, `packages/evaluation`'s scorer reports the disagreement explicitly
rather than as a parser miss: `scoring.CONVENTION_SUBSTITUTES` declares it, the report prints
`convention gap  citation: substantiated` with the count of `reference_entry` blocks found
inside each gold box, and **§4.1's macro F1 is left unchanged** — a metric that moves because
someone declared a type inconvenient is worth nothing.

### `equation` vs `inline_equation` — the current gold does not separate them, issue #55

Same shape as the pair above and **not yet ruled**, because unlike `citation` this one needs a
second annotation pass to settle rather than a sentence. Recorded here with its measurement so
the next pass can settle it, and so nobody spends a session trying to make a parser reproduce it.

The 2026-08-02 gold holds **21 `equation` and 13 `inline_equation` regions**. Every feature that
could tell them apart overlaps completely:

| | `equation` (n=21) | `inline_equation` (n=13) |
|---|---|---|
| width | 71.0 – 405.6 pt | 43.7 – **395.5** pt |
| height | 4.8 – 36.5 pt | 9.6 – 30.7 pt *(inside the other range)* |
| symbol density | 0.000 – 0.315 | 0.050 – 0.250 *(inside the other range)* |
| carries an equation number | 17 / 21 | 6 / 13 |
| has a body `reading_order` | 21 / 21 | **13 / 13** |

The clearest single case is on one paper, two pages apart. `neural-odes-mathheavy` p3 `r439` is
typed **`equation`** at 331.2 × 30.7 pt with a number; p3 `r87` is typed **`inline_equation`** at
333.6 × 26.4 pt with a number. Nothing in the PDF distinguishes them. And **9 of the 13
`inline_equation` boxes overlap a gold `paragraph` box** while carrying their own
`reading_order`, so gold asks for two regions over the same glyphs — which the block model
cannot express and `DESIGN.md` D17 exists to avoid (*"fragment the paragraph into three blocks"*
is the measured failure it names, findings.md B1's 59-character median block).

**What to do next pass, when someone rules on it:**

- A **display** equation is set on its own lines, off the paragraph flow: `equation`.
- Math **inside a line of running prose** is a `Span.role`, not a region — the same answer as
  `citation` above. Do not draw it.
- If a form of "inline equation region" is wanted anyway, it needs a written rule that separates
  it from `equation` **before** anything is drawn, because the current 34 boxes do not carry one.

**FLOW MATTERS MORE THAN TYPE.** Flow decides whether a region gets a `reading_order`. Only
`body` is ranked; everything else is nulled. Leave the flow on `body` for a footnote and a
parser that *correctly* excludes it from the reading order scores as if it got the order wrong.
Get the flow right even when unsure of the type.

### The five rules that decide whether the data is usable

1. **`reading_order` ranks the body flow only.** The tool sets it automatically from the order
   you draw, so **draw body regions in reading order**. Captions, footnotes, headers, footers,
   page numbers and margin notes get `null` — set their **flow** correctly and the tool handles
   it. This is what stops a parser being punished for correctly *excluding* a footnote.
2. **One box per logical region, not per line.** A five-line paragraph is one `paragraph`.
3. **A caption is its own region**, typed `caption`, flow `caption` — never part of the figure.
4. **Figures include their axis labels and interior text**, because that is what a reader means
   by "the figure". Table cells are the exception: box the `table`, and box `table_cell`s only
   on the one or two pages where you want cell-level scoring.
5. **When unsure, use `unknown`.** A wrong type is worse than an honest `unknown` — it makes a
   correct parser look wrong.

### Rough effort

~15–25 minutes per page at first, ~10 once the rhythm is there. 18 pages is a focused
afternoon. Do **one page** first and stop — §4 tells you whether it worked before you invest
the afternoon.

## 4. Check it before going further

```bash
cd "/Volumes/Mrigesh SSD/PaperTree"
uv run python -c "
import json
from pathlib import Path
gold = json.loads(Path('/Volumes/Mrigesh SSD/papertree-gold/gold.json').read_text())
for page in gold:
    body = [r for r in page['regions'] if r['reading_order'] is not None]
    print(page['paper_id'], 'p'+str(page['page']), len(page['regions']), 'regions,',
          len(body), 'in body flow,', sorted({r['type'] for r in page['regions']}))
"
```

Sanity checks: every box's `bbox` should fall inside the page size printed beside it (612×792
for these papers), body regions should be numbered `0..n-1`, and a page of a two-column paper
should have roughly 8–20 regions. Hundreds means you boxed lines instead of regions; three
means you missed most of the page.

## 5. How much is enough

| Pages | Buys |
|---|---|
| **1** | a smoke test that the format and the scale are right — do this first |
| **6** | one paper's shape; enough to catch a gross parser failure |
| **18** (current bundle) | a real first answer on element detection and reading order, single-annotator, small-n |
| 120 | README §1.2's full Tier B, which is what "authorised" means |

**18 pages is the recommended target.** It will not settle the decision rule to the README's
standard, and the result document will say so — but it converts "not evaluable" into "measured,
with stated n", which is the difference that matters.

## 5b. Two extra clicks that buy two whole metrics

The first pass (18 pages, `research/benchmarks/gold/`) could not score **caption association** or
**vector-figure recall** at all, because the tool never collected the fields they need. It does
now, and both are one click while the box is fresh:

- **`vector figure`** — a checkbox that appears when the type is `figure`. Tick it when the
  figure is *drawn* (lines, axes, arrows, a plot) rather than a *photograph*. This is the metric
  §4.1 isolates because both of PaperTree's old extractors found **zero** of ResNet's figures,
  every one of which is vector ink. It is the one dimension where this parser is expected to win,
  and right now that is unproven.
- **`describes`** — a dropdown that appears when the type is `caption`, listing the figures and
  tables you have already drawn *on that page*. Pick the one the caption belongs to.

Neither can be added afterwards. Guessing a caption's figure from proximity would score the
parser's own caption heuristic against a copy of itself, and nothing in the PDF records whether
you considered a figure drawn or photographed. **Draw floats before their captions** so the
dropdown is already populated.

## 6. What happens when you hand it back

`packages/evaluation` already implements every metric against this exact format, tested on
hand-computed cases:

- element detection P/R/F1 at IoU ≥ 0.5 and ≥ 0.75, **macro-averaged per type**
- reading order, **pairwise** over body-flow regions
- caption association, **false links reported separately from missed ones**
- **vector-figure recall, isolated** — PaperTree's known catastrophic gap

Then the deterministic path and Docling get scored on identical gold, and the F1 half of the
decision rule becomes a number instead of a gap.

## 7. If you want a second opinion on the gold itself

README §2 asks for **double annotation** of 3 papers to produce an inter-annotator agreement
figure, *"Without it, no metric on this set has a meaningful ceiling."* Reporting a parser at
0.72 means little if two humans only agree at 0.81. Worth doing on one paper if a second
annotator is available; skip it otherwise and note its absence.
