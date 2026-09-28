#!/usr/bin/env bash
# skein merge <TASK> [--no-gate]
# The coordinator's merge: rerun the gate in the worker's worktree, squash-merge the PR,
# close the claim, delete the workspace, mark the task done in the plan and log it.
# Refuses a task claimed by someone else, never merges a money/pii task without the review
# marker on its PR, and honours --no-gate only when the PR's CI gate check succeeded.
. "$SKEIN_HOME/lib/common.sh"; require_config; load_board; load_driver
need gh jq git node
TASK=""; NOGATE=""
while [ $# -gt 0 ]; do case "$1" in --no-gate) NOGATE=1; shift ;; -*) die "unknown flag $1" ;; *) TASK="$1"; shift ;; esac; done
[ -n "$TASK" ] || die "usage: skein merge <TASK> [--no-gate]"
t="$(task_json "$TASK")"; ID="$(jq -r .id <<<"$t")"; BRANCH="$(task_branch "$t")"
BASE="$(cfg .baseBranch main)"; GATE_ENTRY="$ROOT/$(cfg .vendor scripts/skein)/skein"

owner="$(board_owner "$ID")"; me="$(me)"
[ -z "$owner" ] || [ "$owner" = "$me" ] || die "$ID is claimed by $owner, not you"

PR="$(gh pr list --head "$BRANCH" --state open --json number,url,reviews,comments -q '.[0]' 2>/dev/null)"
[ -n "$PR" ] || die "no open PR for branch $BRANCH"
PRNUM="$(jq -r .number <<<"$PR")"; PRURL="$(jq -r .url <<<"$PR")"
if [ "$(task_field "$t" money)" = "true" ] || [ "$(task_field "$t" pii)" = "true" ]; then
  # Evidence is the marker `skein review` posts, from a collaborator, naming this task.
  n="$(gh pr view "$PRNUM" --json comments -q "[.comments[] | select((.body | test(\"<!-- skein-review task=$ID \")) and (.authorAssociation | IN(\"OWNER\",\"MEMBER\",\"COLLABORATOR\")))] | length" 2>/dev/null || echo 0)"
  [ "$n" -gt 0 ] || die "$ID is money/pii and PR #$PRNUM carries no skein review marker from a collaborator: run 'skein review $ID' first"
fi

WS="$(driver_find "$ID")"; WPATH=""; [ -n "$WS" ] && WPATH="$(driver_path "$WS")"
if [ -n "$NOGATE" ]; then
  ok="$(gh pr checks "$PRNUM" --json name,state -q '[.[] | select((.name | test("gate"; "i")) and .state=="SUCCESS")] | length' 2>/dev/null || echo 0)"
  [ "$ok" -gt 0 ] || die "--no-gate needs a successful CI gate check on PR #$PRNUM; none found"
  log "--no-gate: CI gate check succeeded on PR #$PRNUM"
else
  [ -n "$WPATH" ] && [ -d "$WPATH" ] || die "no local worktree for $ID to run the gate in (use --no-gate only if CI ran it)"
  git -C "$WPATH" fetch -q origin
  [ -x "$WPATH/$(cfg .vendor scripts/skein)/skein" ] && GATE_ENTRY="$WPATH/$(cfg .vendor scripts/skein)/skein"
  ( cd "$WPATH" && bash "$GATE_ENTRY" gate "$ID" ) || die "gate failed for $ID; not merging"
fi

gh pr ready "$PRNUM" >/dev/null 2>&1 || true
gh pr merge "$PRNUM" --squash --delete-branch >/dev/null || die "merge failed for PR #$PRNUM"
log "merged $PRURL"
board_close "$ID" "$PRURL"
[ -n "$WS" ] && driver_delete "$WS"

# Record: done in the plan, a line in the log, pushed by the coordinator.
( cd "$ROOT" && git pull -q --rebase origin "$BASE" 2>/dev/null
  tmp="$(mktemp)"; jq --arg id "$ID" '(.tasks[] | select(.id==$id)).done = true' "$PLAN" > "$tmp" && mv "$tmp" "$PLAN"
  mkdir -p "$(dirname "$PLAN")"; printf '%s  %s merged %s by %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$ID" "$PRURL" "$me" >> "$(dirname "$PLAN")/LOG.md"
  git add "$PLAN" "$(dirname "$PLAN")/LOG.md" && git commit -q -m "plan: $ID merged ($PRURL)" \
    && env "$COORD_ENV=1" git push -q origin "HEAD:$BASE" && log "plan updated on $BASE" ) || warn "could not record the merge in the plan; do it by hand"
emit --arg task "$ID" --arg pr "$PRURL" '{task:$task, ok:true, merged:$pr}'
