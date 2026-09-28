#!/usr/bin/env bash
# Driver: local. No Superset. A workspace is a git worktree under ~/.skein/worktrees, the
# worker is Claude Code headless (claude -p) writing stream-json to a log, and "reading the
# terminal" is reading that log. Lets a teammate without Superset coordinate, and lets CI
# or a server run a worker with no desktop app. Same interface as drivers/superset.sh.
#
# ws id  = the worktree path.   term id = the run log path.

need git jq claude
WT_ROOT="${SKEIN_WORKTREES:-$HOME/.skein/worktrees}/$(basename "$ROOT")"
RUN_ROOT="${SKEIN_RUNS:-$HOME/.skein/runs}/$(basename "$ROOT")"
READY_RE="$(cfg .readyMarker "workspace '.*' ready")"
FATAL_RE="$(cfg .setupFatal "ERR_PNPM|ELIFECYCLE|npm ERR!|npm error|command not found|error TS[0-9]+")"
SETUP_SCRIPT="$(cfg .setupScript .superset/setup.sh)"

driver_project_id() { printf 'local'; }

driver_create() {
  local name="$1" branch="$2" base="${3:-main}" tag="${4:-running}" path
  mkdir -p "$WT_ROOT" "$RUN_ROOT"
  path="$WT_ROOT/${branch//\//__}"
  [ -e "$path" ] && die "workspace already exists at $path"
  git -C "$ROOT" fetch -q origin 2>/dev/null
  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$ROOT" worktree add -q "$path" "$branch" || die "git worktree add failed"
  else
    git -C "$ROOT" worktree add -q -b "$branch" "$path" "origin/$base" || die "git worktree add failed (is origin/$base fetched?)"
  fi
  # Driver state lives OUTSIDE the worktree: anything inside shows as untracked, and a
  # worker chasing a clean tree for the gate will delete it (seen on the first run).
  local meta="$RUN_ROOT/$(basename "$path").meta.json" setuplog="$RUN_ROOT/$(basename "$path").setup.log"
  jq -n --arg name "$name" --arg tag "$tag" --arg path "$path" --arg branch "$branch" '{name:$name, tag:$tag, path:$path, branch:$branch}' > "$meta"
  # Setup runs synchronously here; wait_setup just checks its log.
  ( cd "$path" && SUPERSET_ROOT_PATH="$ROOT" SUPERSET_WORKSPACE_NAME="$name" SUPERSET_WORKSPACE_PATH="$path" \
      bash "$SETUP_SCRIPT" ) > "$setuplog" 2>&1
  emit --arg ws "$path" --arg setup "$setuplog" --arg path "$path" '{ws:$ws, setup:$setup, path:$path}'
}

driver_wait_setup() {
  local log="$2" txt; txt="$(cat "$log" 2>/dev/null)"
  grep -q -E "$READY_RE" <<<"$txt" && return 0
  grep -E "$FATAL_RE" <<<"$txt" | head -3 >&2
  echo "setup did not print the readiness marker (see $log)" >&2; return 1
}

driver_path() { printf '%s' "$1"; }

driver_launch() {
  local ws="$1" agent="$2" model="$3" effort="$4" prompt="$5" log
  [ "$agent" = "claude" ] || die "the local driver runs claude only (got '$agent')"
  log="$RUN_ROOT/$(basename "$ws").jsonl"; : > "$log"
  local args=(-p "$prompt" --dangerously-skip-permissions --output-format stream-json --verbose)
  [ -n "$model" ] && [ "$model" != "-" ] && args+=(--model "$model")
  # stdout is the JSON stream; stderr goes to its own file so one warning line cannot break
  # the parser. setsid (own process group) where it exists; plain nohup on macOS.
  ( cd "$ws" && _bg claude "${args[@]}" >> "$log" 2>> "$log.err" & echo $! > "$log.pid" )
  sleep 2; kill -0 "$(cat "$log.pid")" 2>/dev/null || die "claude exited immediately; see $log.err"
  printf '%s' "$log"
}
_bg() { if command -v setsid >/dev/null 2>&1; then setsid "$@"; else nohup "$@"; fi; }

# Render the stream-json log as the text a terminal would show: assistant text blocks,
# tool names, and the final result.
driver_read() {
  local log="$2" lines="${3:-240}"
  [ -f "$log" ] || return 0
  jq -R -r 'fromjson? |
    if .type=="assistant" then (.message.content[]? | if .type=="text" then .text elif .type=="tool_use" then "● \(.name)(…)" else empty end)
    elif .type=="result" then "--- result (\(.subtype // "done")) ---\n\(.result // "")"
    else empty end' "$log" 2>/dev/null | tail -n "$lines"
}

driver_send() {
  local log="$2" text="$3" sid
  sid="$(jq -r 'select(.type=="system" and .subtype=="init") | .session_id' "$log" 2>/dev/null | head -1)"
  [ -n "$sid" ] || die "no session id in $log yet"
  ( cd "$1" && _bg claude -p "$text" --resume "$sid" --dangerously-skip-permissions --output-format stream-json --verbose >> "$log" 2>> "$log.err" & echo $! > "$log.pid" )
}

driver_tag() { local m="$RUN_ROOT/$(basename "$1").meta.json"; [ -f "$m" ] && { jq --arg t "$2" '.tag=$t' "$m" > "$m.tmp" && mv "$m.tmp" "$m"; }; return 0; }

driver_delete() {
  local ws="$1" log pid
  log="$RUN_ROOT/$(basename "$ws").jsonl"
  pid="$(cat "$log.pid" 2>/dev/null)"; [ -n "$pid" ] && { kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null; }
  [ -x "$ws/.superset/teardown.sh" ] && ( cd "$ws" && SUPERSET_WORKSPACE_PATH="$ws" bash .superset/teardown.sh ) >/dev/null 2>&1
  git -C "$ROOT" worktree remove --force "$ws" 2>/dev/null || rm -rf "$ws"
  git -C "$ROOT" worktree prune
  rm -f "$RUN_ROOT/$(basename "$ws").meta.json" "$RUN_ROOT/$(basename "$ws").setup.log" "$log.pid"
}

driver_list() {
  local m
  for m in "$RUN_ROOT"/*.meta.json; do
    [ -f "$m" ] || continue
    jq -r '[.path, .name, .path, .tag] | @tsv' "$m"
  done
}
driver_find() { driver_list | awk -F'\t' -v id="($1)" 'index($2, id) {print $1; exit}'; }
driver_running_count() {
  local n=0 log pid
  for log in "$RUN_ROOT"/*.jsonl; do
    [ -f "$log.pid" ] || continue; pid="$(cat "$log.pid")"
    kill -0 "$pid" 2>/dev/null && n=$((n+1))
  done
  printf '%s' "$n"
}
driver_agent_terminal() { printf '%s' "$RUN_ROOT/$(basename "$1").jsonl"; }
