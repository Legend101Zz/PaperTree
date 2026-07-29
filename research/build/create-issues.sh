#!/usr/bin/env bash
# Create the PaperTree v2 epic issues + tracking issue on GitHub.
#
#   gh auth login          # once
#   ./research/build/create-issues.sh --dry-run
#   ./research/build/create-issues.sh
#
# Idempotent-ish: it refuses to run if an issue titled "PaperTree v2 — Build Tracker"
# already exists, so re-running will not duplicate the set.

set -euo pipefail

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

cd "$(dirname "$0")/../.."
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "Repo: $REPO"

run() {
  if [[ $DRY -eq 1 ]]; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# ── guard against duplicates ────────────────────────────────────────────────
if gh issue list --search '"PaperTree v2 — Build Tracker" in:title' --json number -q '.[].number' | grep -q .; then
  echo "Tracker issue already exists. Aborting so nothing is duplicated." >&2
  exit 1
fi

# ── labels ──────────────────────────────────────────────────────────────────
echo "Creating labels…"
create_label() { run gh label create "$1" --color "$2" --description "$3" --force; }
create_label "epic"     "6f42c1" "A tracked epic"
create_label "wave-0"   "b60205" "Sequential — blocks everything"
create_label "wave-1"   "d93f0b" "Parallel-safe"
create_label "wave-2"   "fbca04" "Needs waves 0-1"
create_label "wave-3"   "0e8a16" "Needs waves 0-2"
create_label "spine"    "1d76db" "Contracts everything depends on"

# ── epics ───────────────────────────────────────────────────────────────────
declare -a NUMS=()

make_epic() {  # $1=file  $2=title  $3=wave-label
  local body title
  title="$2"
  # strip the workflow prompt — issues carry the spec, the prompt lives in the repo
  body="$(awk '/^# WORKFLOW PROMPT/{exit} {print}' "$1")"
  body+=$'\n\n---\n\n**Workflow prompt for a dynamic-workflow session:** see [`'"$1"'`](https://github.com/'"$REPO"'/blob/main/'"$1"') §WORKFLOW PROMPT.'
  if [[ $DRY -eq 1 ]]; then
    printf '  [dry-run] gh issue create --title %q --label epic,%s  (%d bytes of body)\n' "$title" "$3" "${#body}"
    NUMS+=("?")
  else
    local url
    url="$(gh issue create --title "$title" --body "$body" --label "epic,$3")"
    echo "  $url"
    NUMS+=("$(basename "$url")")
  fi
}

echo "Creating epic issues…"
make_epic research/build/EPIC-00-spine.md       "EPIC 0 — The Spine (PaperIR, DB, jobs, fixtures)" "wave-0,spine"
make_epic research/build/EPIC-01-ingest.md      "EPIC 1 — Ingest & Document Intelligence"          "wave-1"
make_epic research/build/EPIC-02-reader.md      "EPIC 2 — Reader & Anchoring"                      "wave-1"
make_epic research/build/EPIC-03-grounded-ai.md "EPIC 3 — Grounded AI"                             "wave-2"
make_epic research/build/EPIC-04-audiobook.md   "EPIC 4 — Audiobook & Paper Replay"                "wave-3"
make_epic research/build/EPIC-05-canvas.md      "EPIC 5 — Infinite Canvas"                         "wave-3"

# ── tracker ─────────────────────────────────────────────────────────────────
echo "Creating tracker issue…"
TRACKER_BODY="$(cat <<EOF
# PaperTree v2 — Build Tracker

Full plan: [\`research/build/README.md\`](https://github.com/$REPO/blob/main/research/build/README.md)
Audit and research behind it: [\`research/REPORT.md\`](https://github.com/$REPO/blob/main/research/REPORT.md)

## Why a rewrite

The current pipeline discards all document geometry at ingest. Production extraction is
13 lines producing a flat string; 1,698 lines of geometry-aware code sit unreachable.
Measured on ResNet: the live path yields **0 figures, 0 tables, 0 addressable objects**.
Details in [\`findings.md\`](https://github.com/$REPO/blob/main/findings.md).

## Epics

- [ ] #${NUMS[0]} — EPIC 0: The Spine \`wave-0\`
- [ ] #${NUMS[1]} — EPIC 1: Ingest & Document Intelligence \`wave-1\`
- [ ] #${NUMS[2]} — EPIC 2: Reader & Anchoring \`wave-1\`
- [ ] #${NUMS[3]} — EPIC 3: Grounded AI \`wave-2\`
- [ ] #${NUMS[4]} — EPIC 4: Audiobook & Paper Replay \`wave-3\`
- [ ] #${NUMS[5]} — EPIC 5: Infinite Canvas \`wave-3\`

## Wave order

| Wave | Run | Parallel? |
|---|---|---|
| 0 | Epic 0 | No — blocks everything |
| 1 | Epic 1 ‖ Epic 2 | Yes — Epic 2 builds on Epic 0's fixtures |
| 2 | Epic 3 | No |
| 3 | Epic 4 ‖ Epic 5 | Yes |

**Epic 0 must ship golden PaperIR fixtures.** Without them Wave 1 collapses into a
sequential chain and the parallel plan is theatre.

## Architectural gate (end of Wave 2)

1. Re-parsing produces byte-identical PaperIR and identical block IDs
2. A highlight survives reload, zoom 50→400%, 5 viewport widths — drift <1pt
3. A highlight re-anchors across parser configs **or fails loudly** (≥99%)
4. An answer's citation navigates to the correct polygon
5. Figures from an all-vector paper (ResNet) present, captions linked
6. Parse runs as a durable job surviving a worker restart

If (3) fails, stop and fix anchoring before Wave 3 — everything downstream inherits it.

## Ground rules

- Each epic owns an exclusive set of paths; changes outside it are requested via issue
- Acceptance criteria are **tests that must pass**, not opinions
- The PaperIR schema is frozen after Epic 0; changes need a migration and an ADR
- One issue = one PR; split anything over ~600 changed lines
- Delete what you replace — a PR that adds without removing is incomplete
EOF
)"

if [[ $DRY -eq 1 ]]; then
  printf '  [dry-run] gh issue create --title "PaperTree v2 — Build Tracker" (%d bytes)\n' "${#TRACKER_BODY}"
else
  gh issue create --title "PaperTree v2 — Build Tracker" --body "$TRACKER_BODY" --label "epic"
fi

echo
echo "Done. Next: create a Project board and add these issues —"
echo "  gh project create --owner @me --title 'PaperTree v2'"
echo "  (then add the issues to it; columns: Backlog / Ready / In progress / Review / Done)"
