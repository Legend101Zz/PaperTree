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

echo
echo "Seed corpus ready. 39 more papers needed for the full Tier A set —"
echo "see research/benchmarks/README.md §1.3 for the missing categories"
echo "(scanned, non-English, plot-heavy, table-heavy, algorithm-heavy)."
