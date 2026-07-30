#!/usr/bin/env bash
# Fetch the PTUB seed corpus.
#
# The PDFs are NOT committed — arXiv/ACL papers carry varied licences and are better
# fetched than redistributed. This script reproduces the exact corpus the audit measured.
#
#   ./research/benchmarks/fetch_corpus.sh
#
# Verify integrity afterwards with:  shasum -c research/benchmarks/corpus.sha256

set -euo pipefail
cd "$(dirname "$0")"
mkdir -p corpus && cd corpus

UA="PaperTree-research/1.0 (https://github.com/Legend101Zz/PaperTree)"

fetch() {  # $1=name  $2=url
  if [[ -f "$1.pdf" ]]; then
    echo "have  $1"
    return
  fi
  if curl -sSL --max-time 90 -A "$UA" -o "$1.pdf" "$2"; then
    echo "ok    $1  ($(du -h "$1.pdf" | cut -f1))"
  else
    echo "FAIL  $1" >&2
  fi
}

# Tier A seed. Categories per research/benchmarks/README.md §1.3
fetch attention-is-all-you-need https://arxiv.org/pdf/1706.03762   # single-col NeurIPS, vector figs
fetch resnet-cvpr-2col          https://arxiv.org/pdf/1512.03385   # 2-col CVPR, ALL-vector figures
fetch bert-2col                 https://arxiv.org/pdf/1810.04805   # 2-col ACL, tiled raster figures
fetch neural-odes-mathheavy     https://arxiv.org/pdf/1806.07366   # dense derivations, appendices
fetch pdf-to-tree-acl2col       https://aclanthology.org/2024.findings-emnlp.628.pdf

# Tier A extension (Epic 0, block-ID stability): the three shapes the seed lacked.
# Chosen because each stresses a DIFFERENT part of the content-derived block ID —
# repeated short cells, repeated pseudocode tokens, and sheer block count.
fetch superglue-tableheavy      https://arxiv.org/pdf/1905.00537   # §7 complex tables, many near-identical numeric cells
fetch a3c-algorithmheavy        https://arxiv.org/pdf/1602.01783   # algorithm2e pseudocode floats, repeated "end for" lines
fetch gpt3-longform-singlecol   https://arxiv.org/pdf/2005.14165   # 75pp single-column, appendices + supplementary

echo
echo "Seed corpus ready. 36 more papers needed for the full Tier A set —"
echo "see research/benchmarks/README.md §1.3 for the missing categories"
echo "(scanned, non-English, plot-heavy, architecture-diagram-heavy, poorly-encoded)."
