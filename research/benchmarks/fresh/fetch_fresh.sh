#!/usr/bin/env bash
# Fetch the S2 fresh (out-of-sample) paper set.
#
# Six born-digital arXiv PDFs that are NOT in research/benchmarks/corpus/, each pinned to a
# VERSIONED arXiv URL so the bytes are stable. They carry the pages 1-2 gold in
# gold-pp12.json, which was written from page images before any parser output was viewed.
# As with the corpus, the PDFs are NOT committed: they are fetched, not redistributed.
#
#   ./research/benchmarks/fresh/fetch_fresh.sh            # into pdfs/ next to this script
#   ./research/benchmarks/fresh/fetch_fresh.sh DIR        # into DIR (or FRESH_PDF_DIR=DIR)
#
# Files already present are skipped. Every file, fetched or skipped, is verified against
# fresh.sha256 (next to this script) at the end, and the script exits non-zero on any
# mismatch or failed download. To re-check by hand:
#   (cd research/benchmarks/fresh/pdfs && shasum -a 256 -c ../fresh.sha256)
#
# In the repo, research/benchmarks/fresh/pdfs/ must be git-ignored, like
# research/benchmarks/corpus/*.pdf. CI's whole-tree `git status --untracked-files=all` check
# goes red otherwise.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-${FRESH_PDF_DIR:-$HERE/pdfs}}"
SUMS="$HERE/fresh.sha256"

[[ -f "$SUMS" ]] || { echo "missing $SUMS" >&2; exit 1; }
mkdir -p "$DEST"
cd "$DEST"

UA="PaperTree-research/1.0 (https://github.com/Legend101Zz/PaperTree)"
failed=0

fetch() {  # $1=name  $2=versioned url
  if [[ -f "$1.pdf" ]]; then
    echo "have  $1"
    return
  fi
  # Download to a temp name, so an interrupted fetch never leaves a truncated $1.pdf
  # that the next run would skip as "have".
  if curl -fsSL --max-time 120 -A "$UA" -o "$1.pdf.part" "$2"; then
    mv "$1.pdf.part" "$1.pdf"
    echo "ok    $1  ($(du -h "$1.pdf" | cut -f1))"
  else
    rm -f "$1.pdf.part"
    echo "FAIL  $1  $2" >&2
    failed=1
  fi
}

# Layouts per research/build/reader-release/slice-plan.md, S2 "Paper sets (b)".
fetch ddpm-2006.11239           https://arxiv.org/pdf/2006.11239v2   # maths-heavy NeurIPS 2020 (single column)
fetch yolo-1506.02640           https://arxiv.org/pdf/1506.02640v5   # CVPR 2016 two-column
fetch flashattention-2205.14135 https://arxiv.org/pdf/2205.14135v2   # single-column NeurIPS style
fetch sbert-1908.10084          https://arxiv.org/pdf/1908.10084v1   # ACL/EMNLP 2019 two-column
fetch adam-1412.6980            https://arxiv.org/pdf/1412.6980v9    # maths-heavy single-column (ICLR 2015)
fetch maskrcnn-1703.06870       https://arxiv.org/pdf/1703.06870v3   # IEEE/ICCV 2017 two-column

if [[ "$failed" -ne 0 ]]; then
  echo "one or more downloads failed; not verifying" >&2
  exit 1
fi

echo
echo "verifying against $(basename "$SUMS")"
if ! shasum -a 256 -c "$SUMS"; then
  echo "checksum mismatch: delete the listed file(s) and re-run" >&2
  exit 1
fi
echo "Fresh set ready in $DEST"
