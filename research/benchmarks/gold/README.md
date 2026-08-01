# PTUB gold annotations

`ptub-gold.json` — 18 pages, 249 regions, hand-drawn 2026-08-01, single annotator.

This is the file the corpus PDFs are *not*: gold is 60 expert-hours of judgement that cannot be
refetched from arXiv, so it is committed rather than gitignored. The PNG page renders it was drawn
against are not — rebuild them with `python -m papertree_evaluation annotate`, which is
deterministic given the same corpus.

## What it covers

| paper | pages sampled |
|---|---|
| `attention-is-all-you-need` | 0, 3, 6, 8, 11, 14 |
| `neural-odes-mathheavy` | 0, 3, 7, 10, 14, 17 |
| `resnet-cvpr-2col` | 0, 2, 4, 7, 9, 11 |

Six stratified pages per paper, three papers. `README.md` §1.2's full Tier B is 12 papers × 10
pages = 120. **This set is 15% of that**, single-annotator, with no inter-annotator agreement
figure — so it measures, but it does not *authorise*. Every number computed from it carries its n.

## It is scored through `normalise.py`, not directly

The raw file has 55 regions whose `flow` contradicts their `type`, because the annotator tool
shipped the type and flow controls as independent sticky selects (fixed in `annotate.py` at
commit `fc057e7`). `papertree_evaluation.normalise` applies three deterministic rules — all
functions of the annotator's own label and the raw PDF text, never of any parser's output — and
reports every change it makes.

**Do not hand-edit this file to "fix" it.** The raw form is the record of what a human actually
drew; the repairs are reproducible from it and are reported alongside every metric. Editing here
would erase the evidence that the repair was needed and hide its effect on the numbers.

## Known limits, unrepaired

- **Caption association is not evaluable.** `parent` is null on every region; the tool never
  collected caption→float edges. Inferring them would score PaperTree's caption heuristic against
  a copy of itself.
- **Some floats swallowed their captions** (resnet p4/p7, where a figure box opens with axis
  labels and runs on into "Figure 4. Training on ImageNet"). Splitting them means choosing a
  y-coordinate, which is annotation.
- **Reference pages are one box.** `attention` p11 and `neural-odes` p10 carry a single `citation`
  region over the whole bibliography, against a parser that emits one block per entry. Element
  detection on those two pages measures almost nothing.

`python -m papertree_evaluation score` prints all three as warnings on every run.
