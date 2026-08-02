#!/usr/bin/env bash
#
# #81 — assert that every recently merged PR actually reached `main`.
#
# THE INCIDENT. Epic 3 shipped four PRs. All four reported MERGED. `main` received one of
# them and sat 12,564 lines short for a day while every signal was green — because GitHub
# merged each PR into ITS STATED BASE, and three of those bases were each other:
#
#     #67  epic-3/f3.7-memory      -> main    05:04:13   the only one that reached main
#     #68  epic-3/f3.2-retrieval   -> epic-3/f3.7-memory      05:04:35
#     #69  epic-3/f3.6-inspector   -> epic-3/f3.2-retrieval   05:04:44
#     #70  epic-3/f3.1-agent-tools -> epic-3/f3.6-inspector   05:04:54
#
# Every merge succeeded. Every CI run was green — legitimately, because CI ran on the
# BRANCHES and the branches genuinely had the code. The only artefact that disagreed was
# `git ls-tree origin/main packages/`, and nobody had a reason to run it.
#
# THE ROOT CAUSE was the repo setting `deleteBranchOnMerge: false`, now true. GitHub
# auto-retargets an open PR when its base branch is DELETED, so merging #67 and deleting
# its branch would have re-pointed #68 at `main` on its own and the stack would have
# unwound correctly however fast the merges were clicked. This script is the belt to that
# braces: it assumes the setting can be turned off again, or fail, or be worked around.
#
# WHAT IT DOES NOT DO. It runs when something reaches `main`. During the incident nothing
# reached `main` between #67 and the remediation a day later, so this guard would have
# fired at the NEXT push to main rather than at the moment of breakage. It converts "silent
# for a day" into "loud at the next merge". It does not make the window zero.
#
# ─────────────────────────────────────────────────────────────────────────────────────────
# EVERY DESIGN CHOICE BELOW IS A FAILURE MODE THAT MAKES A GREEN RUN MEANINGLESS.
#
#   * AN EMPTY LOOP AND A CLEAN BILL OF HEALTH ARE BYTE-IDENTICAL IN A CI LOG. A `gh`
#     failure, an unauthenticated token, a missing `pull-requests: read` scope or a typo in
#     the --jq expression all produce zero iterations and exit 0. So `gh`'s exit status is
#     checked explicitly rather than swallowed by a pipe into `while read`, the examined
#     count is printed on every run, and zero is a HARD FAILURE. This repo has been bitten
#     by this exact shape three times: #26's fixture script that passed while validating
#     nothing, a cross-language test that SKIPPED and reported green, and `perf.spec`
#     asserting `peak_mb < 2000` against a 500 MB bar for months (AGENTS.md §2).
#
#   * `git merge-base --is-ancestor` RETURNS WRONG ANSWERS SILENTLY ON A SHALLOW CLONE, and
#     actions/checkout is shallow by default. The workflow sets fetch-depth: 0; this script
#     does not trust it and asserts it.
#
#   * A MERGE COMMIT ON A DELETED BRANCH IS NOT PRESENT LOCALLY EVEN AT fetch-depth: 0 —
#     checkout fetches refs, and that commit is unreachable from every ref. `git merge-base
#     --is-ancestor` then exits 128, not 1, which is indistinguishable from "not an
#     ancestor" if you only test for non-zero. Absence does imply "not on main", so the
#     alarm is right, but it is reported as its own case so the reason is right too.
#
#   * MERGE, SQUASH AND REBASE ARE ALL ENABLED ON THIS REPO. `mergeCommit.oid` is the commit
#     created ON THE BASE in all three cases, so the ancestor test holds for all three. Note
#     honestly: at the time of writing this repo has NO squash-merged or rebase-merged PR —
#     all 22 merged PRs have two parents. The squash and rebase paths are reasoned about,
#     not observed.
#
# WATCH IT FAIL (this is the point; a guard nobody has seen fire is a guard nobody tested):
#
#     TARGET_REF=921bd9d8 SINCE=2026-08-01T00:00:00Z AS_OF=2026-08-02T05:05:00Z \
#       .github/scripts/assert-merged-prs-reached-main.sh
#
# 921bd9d8 is `main` immediately after #67 and immediately before #73 — i.e. the broken
# state. It must name #68, #69 and #70 and stay silent about #67.
#
# NOTE: #81 names `14c1f3c` for this. That commit is the merge of #63, ten hours and one PR
# BEFORE #67 — at `14c1f3c` a correct guard names all four, because #67 had not merged yet.
# #81's own standard ("if it names all four or none, the guard is wrong") therefore rejects
# any guard tested at the commit #81 nominates. Use 921bd9d8 = `git rev-parse 8573ffcc6^1`.
#
# ENVIRONMENT (all optional; defaults are what CI uses)
#   TARGET_REF     ref the merge commits must be ancestors of.     default origin/main
#   LOOKBACK_DAYS  how far back to look, when SINCE is not given.  default 14
#   SINCE          ISO8601 Z lower bound on mergedAt.              default now - LOOKBACK_DAYS
#   AS_OF          ISO8601 Z upper bound on mergedAt (replay).     default now
#   PR_LIMIT       how many merged PRs to ask GitHub for.          default 50

set -euo pipefail

TARGET_REF="${TARGET_REF:-origin/main}"
LOOKBACK_DAYS="${LOOKBACK_DAYS:-14}"
PR_LIMIT="${PR_LIMIT:-50}"

# GNU date first, BSD date second. Both are one call and neither needs a dependency.
iso_days_ago() {
  date -u -d "$1 days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -v-"$1"d +%Y-%m-%dT%H:%M:%SZ
}
SINCE="${SINCE:-$(iso_days_ago "$LOOKBACK_DAYS")}"
AS_OF="${AS_OF:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

# ── The allowlist ────────────────────────────────────────────────────────────────────────
#
# #68 and #69 are PERMANENTLY not ancestors of `main` and always will be. #73 remediated the
# incident by merging `epic-3/f3.6-inspector`, which contains #70's merge commit but not
# #68's or #69's — those two live on `f3.2-retrieval-pr` and `f3.7-memory`, branches that no
# longer exist. Their CONTENT reached main; their MERGE COMMITS never will.
#
# Without these two entries this guard is red on `main` from the day it lands, forever, over
# two already-fixed PRs — and a permanently-red guard is switched off within a week, which
# is the same degradation-into-noise this repo is trying to stop.
#
# AN ENTRY IS NOT A MUTE BUTTON. It names the commit that remediated the PR, and it
# SUPPRESSES ONLY ON A HISTORY THAT ACTUALLY CONTAINS THAT REMEDIATION. On a ref where #73
# has not landed, these entries do nothing and #68/#69 fire — which is what makes the replay
# above a real test rather than a demo of a suppressed list. An entry whose PR has become an
# ancestor by other means is reported as stale, so the list cannot quietly rot.
#
# Both entries expire on their own: once #68 and #69 fall outside LOOKBACK_DAYS they are
# never examined again and these lines can be deleted.
#
#   <merge commit>  <commit that remediated it>  <why>
ALLOWLIST=$(
  cat <<'EOF'
55f48d290 8573ffcc6 PR #68 merged into epic-3/f3.7-memory (deleted); content reached main via #73
f58da99e5 8573ffcc6 PR #69 merged into epic-3/f3.2-retrieval-pr (deleted); content reached main via #73
EOF
)

echo "── #81 post-merge guard ─────────────────────────────────────────────────────────────"
echo "target ref     : $TARGET_REF"
echo "merged window  : $SINCE .. $AS_OF"
echo "gh query limit : $PR_LIMIT"
echo

# ── Preconditions. Each of these, unchecked, turns a real answer into a plausible one. ────

if [ "$(git rev-parse --is-shallow-repository)" != "false" ]; then
  echo "::error title=Shallow clone::git merge-base --is-ancestor answers WRONG, silently, on a shallow history. Set 'fetch-depth: 0' on actions/checkout for this job."
  exit 1
fi
echo "clone is complete (not shallow)"

if ! TARGET_SHA="$(git rev-parse --verify "${TARGET_REF}^{commit}" 2>/dev/null)"; then
  echo "::error title=Target ref missing::'$TARGET_REF' does not resolve to a commit in this checkout."
  exit 1
fi
echo "target resolves : $TARGET_REF -> ${TARGET_SHA:0:9}"

# `gh pr list` into a file, checking ITS exit status. Piping it straight into `while read`
# discards that status and turns "gh is broken" into "no PRs to check" — a pass.
PR_TSV="$(mktemp)"
trap 'rm -f "$PR_TSV"' EXIT

if ! gh pr list --state merged --limit "$PR_LIMIT" \
  --json number,mergeCommit,baseRefName,mergedAt,title \
  --jq '.[] | [.number, (.mergeCommit.oid // "NULL"), .baseRefName, .mergedAt] | @tsv' \
  >"$PR_TSV" 2>"$PR_TSV.err"; then
  echo "::error title=gh pr list failed::The guard could not enumerate merged PRs, so it verified NOTHING. This is a failure, not a pass."
  sed 's/^/  gh: /' "$PR_TSV.err" || true
  rm -f "$PR_TSV.err"
  exit 1
fi
rm -f "$PR_TSV.err"

FETCHED=$(wc -l <"$PR_TSV" | tr -d ' ')
echo "merged PRs returned by gh : $FETCHED"

if [ "$FETCHED" -eq 0 ]; then
  echo "::error title=gh returned no merged PRs at all::This repository has merged PRs, so an empty list means the query, the token or the 'pull-requests: read' permission is wrong — not that everything is fine. Refusing to report a pass on zero evidence."
  exit 1
fi

# ── The check ────────────────────────────────────────────────────────────────────────────

examined=0
ok=0
suppressed=0
violations=0
stale_entries=0

while IFS=$'\t' read -r num sha base merged_at; do
  [ -n "${num:-}" ] || continue

  # mergedAt is always ISO8601 in UTC with a Z suffix, so lexicographic order is chronological.
  [[ "$merged_at" > "$SINCE" ]] || continue
  [[ "$merged_at" < "$AS_OF" ]] || continue

  examined=$((examined + 1))

  if [ "$sha" = "NULL" ]; then
    echo "::error title=PR #$num has no merge commit::GitHub reports PR #$num as MERGED into '$base' but exposes no mergeCommit, so whether it reached main CANNOT BE DETERMINED. Treated as a failure: an unverifiable claim is not a verified one."
    violations=$((violations + 1))
    continue
  fi

  # Presence before ancestry: --is-ancestor exits 128 on an absent object, and reading that
  # as "not an ancestor" gets the right verdict for the wrong reason.
  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    state="absent"
  elif git merge-base --is-ancestor "$sha" "$TARGET_SHA" 2>/dev/null; then
    state="ok"
  else
    state="not-ancestor"
  fi

  entry="$(printf '%s\n' "$ALLOWLIST" | awk -v s="$sha" '$1 == substr(s, 1, length($1)) { print; exit }')"

  if [ "$state" = "ok" ]; then
    if [ -n "$entry" ]; then
      echo "::warning title=Stale allowlist entry for PR #$num::PR #$num is now an ancestor of $TARGET_REF, so its entry in ALLOWLIST in $0 no longer suppresses anything. Delete it."
      stale_entries=$((stale_entries + 1))
    fi
    ok=$((ok + 1))
    printf '  ok         PR #%-4s %s  base=%-28s merged=%s\n' "$num" "${sha:0:9}" "$base" "$merged_at"
    continue
  fi

  # Not on the target ref. Only a remediation that is ITSELF on the target ref may excuse it.
  if [ -n "$entry" ]; then
    fix_sha="$(printf '%s' "$entry" | awk '{ print $2 }')"
    fix_why="$(printf '%s' "$entry" | cut -d' ' -f3-)"
    if git cat-file -e "${fix_sha}^{commit}" 2>/dev/null &&
      git merge-base --is-ancestor "$fix_sha" "$TARGET_SHA" 2>/dev/null; then
      suppressed=$((suppressed + 1))
      printf '  known      PR #%-4s %s  %s (%s is on %s)\n' \
        "$num" "${sha:0:9}" "$fix_why" "${fix_sha:0:9}" "$TARGET_REF"
      continue
    fi
    printf '  ALLOWLISTED BUT UNREMEDIATED  PR #%-4s: %s is NOT on %s, so the entry does not apply\n' \
      "$num" "${fix_sha:0:9}" "$TARGET_REF"
  fi

  violations=$((violations + 1))
  if [ "$state" = "absent" ]; then
    echo "::error title=PR #$num reports MERGED but its merge commit is not in this history::PR #$num says MERGED into '$base', but $sha is not present in a full clone at all — it is unreachable from every ref, which happens when it was merged into a branch that was later deleted. It is not on $TARGET_REF. Its content may have reached main by another route; verify with 'git log --oneline $TARGET_REF -- <a path the PR touched>' and either land it or add an ALLOWLIST entry naming what remediated it."
  else
    echo "::error title=PR #$num reports MERGED but never reached main::PR #$num says MERGED into '$base', but its merge commit $sha is NOT an ancestor of $TARGET_REF. It merged into a branch, not into main — the #81 trap. Re-target and re-merge it, or land the base branch."
  fi
  printf '  VIOLATION  PR #%-4s %s  base=%-28s merged=%s  (%s)\n' \
    "$num" "${sha:0:9}" "$base" "$merged_at" "$state"
done <"$PR_TSV"

# ── The report. The counts are the deliverable; the exit code alone cannot show an empty loop. ──

echo
echo "examined   : $examined merged PRs in [$SINCE .. $AS_OF]"
echo "on $TARGET_REF : $ok"
echo "known-good : $suppressed (allowlisted AND their remediation is on $TARGET_REF)"
echo "violations : $violations"

if [ "$examined" -eq 0 ]; then
  echo "::error title=The guard examined zero PRs::$FETCHED merged PRs were returned but NONE fell inside [$SINCE .. $AS_OF], so every assertion below was skipped and this step would otherwise have reported a pass on an empty loop. Widen LOOKBACK_DAYS, or confirm the push to main really did come from a PR merge."
  exit 1
fi

if [ "$violations" -gt 0 ]; then
  echo "::error title=$violations merged PR(s) did not reach main::See the annotations above. Verify by hand with: git merge-base --is-ancestor <mergeCommit> $TARGET_REF"
  exit 1
fi

echo "PASS: all $examined merged PR(s) in the window are accounted for on $TARGET_REF."
[ "$stale_entries" -eq 0 ] || echo "(with $stale_entries stale allowlist entr(y|ies) to delete — see warnings above)"
