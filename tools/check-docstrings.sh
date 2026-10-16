#!/usr/bin/env bash
# Docstrings on NEW Python modules (v0.2 S0): ruff's pydocstyle rules (D, Google convention).
#
# Usage: tools/check-docstrings.sh [file.py ...]   (no args = every module under packages/ and services/)
#
# Why a baseline list instead of `select = ["D"]` in pyproject: the 114 modules that existed before
# v0.2 carry about 1,000 D findings (measured 2026-10-16 at 79f637d), and fixing them is a separate
# mechanical pass, not something to fold into feature PRs. tools/docstring-baseline.txt lists
# those modules; everything NOT in it must pass. The list may only shrink: when you document a
# baseline module fully, delete its line. Tests are exempt (their names are the documentation).
# CI runs this in the Python job, so a new undocumented module fails the build.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

# Arguments are paths as the caller typed them (relative to the caller's directory, `./`-prefixed or
# absolute); make each repo-relative BEFORE changing directory, so the baseline lookup compares like
# with like. A path that does not exist is an error, not a silent skip.
candidates=()
for arg in "$@"; do
  if [[ ! -f "$arg" ]]; then
    echo "docstrings: no such file: $arg" >&2
    exit 2
  fi
  abs="$(cd "$(dirname "$arg")" && pwd)/$(basename "$arg")"
  candidates+=("${abs#"$root"/}")
done
cd "$root"

baseline="tools/docstring-baseline.txt"
if [[ $# -eq 0 ]]; then
  candidates=()
  while IFS= read -r f; do candidates+=("$f"); done < <(
    find packages services -name '*.py' -not -path '*/.venv/*' -not -path '*/node_modules/*' | LC_ALL=C sort
  )
fi

targets=()
for f in "${candidates[@]}"; do
  case "$f" in
    */tests/* | */test_*.py | */conftest.py) continue ;;
  esac
  /usr/bin/grep -a -qxF -- "$f" "$baseline" && continue
  targets+=("$f")
done

if [[ ${#targets[@]} -eq 0 ]]; then
  echo "docstrings: no new modules to check"
  exit 0
fi
echo "docstrings: checking ${#targets[@]} new module(s)"
uv run ruff check --select D "${targets[@]}"
