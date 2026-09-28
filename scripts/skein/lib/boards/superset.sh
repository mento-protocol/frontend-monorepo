#!/usr/bin/env bash
# Board: Superset's organization task queue. One task per skein task, titled "<ID>: <title>",
# assigned to the claiming user, with labels carrying the state. Every member sees it in
# their sidebar. Best-effort on field names: the CLI's task JSON has changed before.
# Same interface as boards/github.sh.

need superset jq
_ss_me() { superset auth whoami --json 2>/dev/null | jq -r '.userId // empty'; }
_ss_task_for() {  # -> json or empty
  superset tasks list --json 2>/dev/null \
    | jq -c --arg id "$1" '(if type=="array" then . else (.tasks // .items // []) end) | map(select((.title // "") | ascii_downcase | startswith(($id|ascii_downcase) + ":"))) | .[0] // empty'
}
_ss_labels() { jq -r '(.labels // []) | if type=="array" then map(if type=="object" then .name else . end) else split(",") end | join(",")' <<<"$1"; }
_ss_set_state() {  # <task-json> <state>
  local id labels
  id="$(jq -r '.id' <<<"$1")"
  labels="$(_ss_labels "$1" | tr ',' '\n' | grep -v '^state:' | grep -v '^$' | paste -sd, -)"
  superset tasks update "$id" --labels "${labels:+$labels,}skein,state:$2" --json >/dev/null 2>&1
}

board_claim() {
  local id="$1" title="$2" branch="$3" me t owner
  me="$(_ss_me)"; [ -n "$me" ] || die "superset auth whoami failed"
  t="$(_ss_task_for "$id")"
  if [ -z "$t" ]; then
    superset tasks create --title "$id: $title" --labels "skein,state:running" --assignee "$me" \
      --description "Task $id. Branch $branch. Claimed via skein dispatch." --json >/dev/null 2>&1 \
      || die "could not create the Superset task for $id"
    return 0
  fi
  owner="$(jq -r '.assigneeId // .assignee.id // .assignee // empty' <<<"$t")"
  if [ -n "$owner" ] && [ "$owner" != "$me" ]; then die "$id is claimed by another member on the Superset board"; fi
  if _ss_labels "$t" | grep -q 'state:running' && [ "$owner" = "$me" ]; then die "$id is already running under your claim"; fi
  superset tasks update "$(jq -r .id <<<"$t")" --assignee "$me" --json >/dev/null 2>&1 || die "could not claim $id"
  _ss_set_state "$t" running || die "claimed $id but could not mark it running; fix the task's labels on the board"
  # Verify exclusive ownership after the write (assignment is not atomic across coordinators).
  t="$(_ss_task_for "$id")"; owner="$(jq -r '.assigneeId // .assignee.id // .assignee // empty' <<<"$t")"
  [ "$owner" = "$me" ] || die "$id was claimed by another member at the same moment"
}
board_release() { local t; t="$(_ss_task_for "$1")"; [ -n "$t" ] && { _ss_set_state "$t" "${2:-gating}" || true; }; return 0; }
board_close() {
  local t id; t="$(_ss_task_for "$1")"; [ -n "$t" ] || return 0; id="$(jq -r .id <<<"$t")"
  _ss_set_state "$t" done || true
  [ -n "${2:-}" ] && superset tasks update "$id" --pr-url "$2" --json >/dev/null 2>&1 || true
}
board_owner() { _ss_task_for "$1" | jq -r '.assigneeId // .assignee.id // .assignee // empty'; }
board_running_count() {
  superset tasks list --json 2>/dev/null \
    | jq '(if type=="array" then . else (.tasks // .items // []) end) | map(select(((.labels // []) | tostring) | test("state:running"))) | length'
}
board_list() {
  superset tasks list --json 2>/dev/null \
    | jq -r '(if type=="array" then . else (.tasks // .items // []) end) | .[] | select(((.labels // [])|tostring)|test("skein")) | [(.title|split(":")[0]), (((.labels // [])|tostring|capture("state:(?<s>[a-z]+)").s) // "none"), (.assigneeId // .assignee // "-"), (.url // .id)] | @tsv'
}
board_comment() { return 0; }
