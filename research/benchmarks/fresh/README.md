# Fresh (out-of-sample) set: pages 1–2 gold

> **Status: OWNER REVIEW PENDING (#54).** This gold does not gate anything until the owner
> has reviewed it. The data says so itself: `_provenance.owner_review == "pending"`. Every
> number computed on it is reported as *provisional, 2 model annotators + adjudicator, owner
> review pending*.

Six born-digital arXiv papers that are **not** in `research/benchmarks/corpus/`, each pinned to
a versioned arXiv URL. Slice-plan §S2 "Paper sets (b)".

| paper | layout | pages |
|---|---|---|
| `ddpm-2006.11239` | single-column NeurIPS 2020, maths-heavy | 25 |
| `yolo-1506.02640` | two-column CVPR 2016 | 10 |
| `flashattention-2205.14135` | single-column, NeurIPS style | 34 |
| `sbert-1908.10084` | two-column ACL/EMNLP 2019 | 11 |
| `adam-1412.6980` | single-column ICLR 2015, maths-heavy | 15 |
| `maskrcnn-1703.06870` | two-column ICCV 2017 (IEEE/CVF) | 12 |

## Files

| file | what |
|---|---|
| `fetch_fresh.sh` | fetches the six PDFs into `pdfs/` (gitignored) and verifies them against `fresh.sha256`; exits 1 on any mismatch |
| `fresh.sha256` | the pinned bytes |
| `gold-pp12.json` | the consensus gold for pages 1–2 (1-based) of every paper; provenance, IAA, conventions and the three open owner rulings are inside it under `_provenance` |

```bash
./research/benchmarks/fresh/fetch_fresh.sh
```

## How the gold was made (summary; the full record is `_provenance`)

- Written from **page images** (130 dpi `pdftoppm`, 200–300 dpi crops where ambiguous) before
  any parser output was viewed. No text was extracted from any PDF by any of the three agents.
- **Two model annotators + one adjudicator**, all Claude Opus 5.5 subagents from one workflow
  run. κ(kind) 0.986 between the annotators is an **upper bound** on what two independent people
  would reach, not a human ceiling for parser scores. Agreement is not correctness: the
  adjudicator overrode both annotators on two DDPM units, from a pixel measurement.
- The unit is an **anchor**: the first words of a printed paragraph, heading or front-matter
  group, as printed. It is not a bounding box, so it is scored by normalised substring match
  against the parser's block text, not by IoU.

## Rules for scoring it (from `_provenance.conventions`)

- Compare **case-insensitively** (small caps are written in typographic case).
- A unit is `[page, kind, anchor]` or `[page, kind, anchor, {extras}]`; read `u[:3]`.
- `cont` continues the previous unit's paragraph. Three `cont` units follow a display equation
  and carry `alt_kind: "body"`; that reading is an **open owner ruling**, so scorers report
  **both** readings.
- Match anchors by substring after normalisation, never by prefix: SBERT's `cont` anchor is the
  fragment `tic similarity comparison` of a word split across a column break.

## Do not edit the units

A unit may be changed only to fix a **provable transcription error**, with page-image evidence,
logged in `_provenance` and in the S2 report. Never to suit a parser: that scores a
reimplementation of the annotator (`ANNOTATION_GUIDE.md` §1, `benchmarks/README.md` §4.4).

The page crops behind each adjudication ruling live outside the repository with the S2 evidence;
PNGs are not committed here (a whole-tree `git status --untracked-files=all` in CI, and
`ANNOTATION_GUIDE.md` §2).
