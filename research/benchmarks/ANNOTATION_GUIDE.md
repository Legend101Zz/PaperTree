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
