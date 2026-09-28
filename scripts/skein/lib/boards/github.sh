#!/usr/bin/env bash
# Board: GitHub issues. One issue per task, titled "<ID>: <title>". Assigning yourself is
# the claim; an unassigned issue is free. Labels carry the state so the board reads the
# same in the GitHub UI and in `skein status`. Works for teammates who never open Superset.
#
# Interface (every board implements these):
#   board_claim <ID> <title> <branch>   claim or fail; prints the issue url
#   board_release <ID> <state>          drop the running state (gating|blocked|ready)
#   board_close <ID> <pr-url>           close on merge
#   board_owner <ID>                    login holding the claim, or empty
#   board_running_count                 running claims across all coordinators
#   board_list                          tsv: id  state  owner  url
#   board_comment <ID> <text>

need gh jq
BOARD_REPO="$(cfg .board.repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)")"
[ -n "$BOARD_REPO" ] || die "board.repo not set and gh cannot see a repo here"

_gh_labels_ready=""
_ensure_labels() {
  [ -n "$_gh_labels_ready" ] && return 0
  for l in "skein:#5319e7" "state:ready:#0e8a16" "state:running:#1d76db" "state:gating:#fbca04" "state:blocked:#d93f0b"; do
    gh label create "${l%%:#*}" --color "${l##*#}" -R "$BOARD_REPO" >/dev/null 2>&1 || true
  done
  _gh_labels_ready=1
}

_issue_for() {  # _issue_for <ID> -> json {number,url,assignees,labels} or empty
  # Listed, not searched: GitHub's search index lags several seconds behind a create,
  # which made a fresh claim look unowned on the very next call.
  gh issue list -R "$BOARD_REPO" --state open --label skein --limit 200 \
    --json number,title,url,assignees,labels 2>/dev/null \
    | jq -c --arg id "$1" '[.[] | select(.title | ascii_downcase | startswith(($id|ascii_downcase) + ":"))] | .[0] // empty'
}

board_claim() {
  local id="$1" title="$2" branch="$3" me issue num owner
  me="$(me)"; _ensure_labels
  issue="$(_issue_for "$id")"
  if [ -z "$issue" ]; then
    local url
    url="$(gh issue create -R "$BOARD_REPO" --title "$id: $title" --label skein --label state:running --assignee "$me" \
      --body "Task \`$id\` in \`$(cfg .plan docs/plan/wps.json)\`. Branch \`$branch\`. Claimed by @$me via skein dispatch." 2>/dev/null)" \
      || die "could not create the board issue for $id"
    # Creation is not atomic across coordinators: if another open issue for this id has a
    # LOWER number than ours, it won and we close ours. The listing can lag a fresh create,
    # so an empty or partial list is not evidence against us.
    local mine lower
    mine="${url##*/}"
    lower="$(gh issue list -R "$BOARD_REPO" --state open --label skein --limit 200 --json number,title 2>/dev/null \
      | jq -r --arg id "$id" --argjson mine "$mine" '[.[] | select((.title | ascii_downcase | startswith(($id|ascii_downcase) + ":")) and .number < $mine)] | map(.number) | min // empty')"
    if [ -n "$lower" ]; then
      gh issue close "$mine" -R "$BOARD_REPO" --comment "Duplicate claim; #$lower won." >/dev/null 2>&1
      die "$id was claimed by another coordinator at the same moment (issue #$lower)"
    fi
    printf '%s\n' "$url"
    return 0
  fi
  num="$(jq -r .number <<<"$issue")"
  owner="$(jq -r '.assignees[0].login // empty' <<<"$issue")"
  if [ -n "$owner" ] && [ "$owner" != "$me" ]; then
    die "$id is claimed by @$owner (issue #$num). An assigned issue is not yours to dispatch."
  fi
  if jq -e '.labels[] | select(.name=="state:running")' <<<"$issue" >/dev/null && [ "$owner" = "$me" ]; then
    die "$id is already running under your claim (issue #$num). Watch it, or release it first."
  fi
  gh issue edit "$num" -R "$BOARD_REPO" --add-assignee "$me" --add-label state:running \
    --remove-label state:ready --remove-label state:gating --remove-label state:blocked >/dev/null 2>&1 \
    || die "could not claim issue #$num"
  # Assignment is not atomic either: re-read and verify we are the only assignee. If someone
  # else landed at the same time, the lower login wins deterministically and we back out.
  local assignees
  assignees="$(gh issue view "$num" -R "$BOARD_REPO" --json assignees -q '[.assignees[].login] | sort | .[]' 2>/dev/null)"
  if [ "$(wc -l <<<"$assignees" | tr -d ' ')" -gt 1 ] && [ "$(head -1 <<<"$assignees")" != "$me" ]; then
    gh issue edit "$num" -R "$BOARD_REPO" --remove-assignee "$me" >/dev/null 2>&1
    die "$id was claimed by @$(head -1 <<<"$assignees") at the same moment (issue #$num)"
  fi
  jq -r .url <<<"$issue"
}

board_release() {
  # ready = back on the shelf for anyone (assignee cleared); gating/blocked keep the claim.
  local id="$1" state="${2:-gating}" issue num extra=()
  issue="$(_issue_for "$id")"; [ -n "$issue" ] || return 0
  num="$(jq -r .number <<<"$issue")"; _ensure_labels
  [ "$state" = ready ] && extra=(--remove-assignee "$(me)")
  gh issue edit "$num" -R "$BOARD_REPO" --remove-label state:running --remove-label state:gating \
    --remove-label state:blocked --remove-label state:ready --add-label "state:$state" "${extra[@]}" >/dev/null 2>&1 || true
}

board_close() {
  local id="$1" pr="${2:-}" issue num
  issue="$(_issue_for "$id")"; [ -n "$issue" ] || return 0
  num="$(jq -r .number <<<"$issue")"
  gh issue close "$num" -R "$BOARD_REPO" --comment "Merged${pr:+: $pr}. Closed by skein merge." >/dev/null 2>&1 || true
}

board_owner() { _issue_for "$1" | jq -r '.assignees[0].login // empty'; }

board_running_count() {
  gh issue list -R "$BOARD_REPO" --state open --label skein --label state:running --limit 200 --json number 2>/dev/null | jq 'length'
}

board_list() {
  gh issue list -R "$BOARD_REPO" --state open --label skein --limit 200 --json title,url,assignees,labels 2>/dev/null \
    | jq -r '.[] | [(.title|split(":")[0]), (([.labels[]?.name | select(startswith("state:")) | sub("state:";"")] | first) // "none"), (.assignees[0].login // "-"), .url] | @tsv'
}

board_comment() {
  local issue num; issue="$(_issue_for "$1")"; [ -n "$issue" ] || return 0
  num="$(jq -r .number <<<"$issue")"
  gh issue comment "$num" -R "$BOARD_REPO" --body "$2" >/dev/null 2>&1 || true
}
