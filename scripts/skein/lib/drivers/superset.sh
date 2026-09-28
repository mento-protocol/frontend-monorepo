#!/usr/bin/env bash
# Driver: Superset. Workspaces are Superset worktrees, agents run in Superset terminals,
# and the coordinator reads and drives them through the CLI. Needs the desktop app running
# on this machine (the CLI is a shim into it).
#
# Interface (every driver implements these):
#   driver_project_id                       Superset project id for this repo, resolved
#   driver_create <name> <branch> <base> <tag>   -> json {ws, setup, path}
#   driver_wait_setup <ws> <setup> [secs]   wait for the readiness marker
#   driver_path <ws>                        worktree path
#   driver_launch <ws> <agent> <model> <effort> <prompt>   -> terminal/session id
#   driver_read <ws> <term> [lines]         screen text
#   driver_send <ws> <term> <text>
#   driver_tag <ws> <tag>
#   driver_delete <ws>
#   driver_find <ID>                        ws id whose name carries "(ID)"
#   driver_list                             tsv: ws  name  path  tags
#   driver_running_count                    workspaces tagged running for this repo here

need superset jq
READY_RE="$(cfg .readyMarker "workspace '.*' ready")"
FATAL_RE="$(cfg .setupFatal "ERR_PNPM|ELIFECYCLE|npm ERR!|npm error|command not found|error TS[0-9]+")"

driver_project_id() {
  local id="${SKEIN_PROJECT_ID:-}"
  [ -n "$id" ] && { printf '%s' "$id"; return 0; }
  id="$(ucfg ".projects[\"$ROOT\"].supersetProjectId")"
  [ -n "$id" ] && { printf '%s' "$id"; return 0; }
  # Resolve by path: the desktop app knows which project this checkout is.
  id="$(superset projects list --json 2>/dev/null | jq -r --arg p "$ROOT" '.[] | select(.path==$p) | .id' | head -1)"
  [ -n "$id" ] || die "cannot resolve the Superset project for $ROOT: add this repo in Superset, or set SKEIN_PROJECT_ID"
  printf '%s' "$id"
}

driver_create() {
  local name="$1" branch="$2" base="${3:-main}" tag="${4:-running}" P out ws setup
  P="$(driver_project_id)"
  out="$(superset ws create --local --project "$P" --name "$name" --branch "$branch" --base-branch "$base" --tag "$tag" --json 2>&1)" \
    || die "superset ws create: $out"
  ws="$(jq -r '.workspace.id // empty' <<<"$out")"; [ -n "$ws" ] || die "no workspace id: $out"
  [ "$(jq -r '.alreadyExists // false' <<<"$out")" = "true" ] && die "workspace '$name' already exists ($ws)"
  setup="$(jq -r '.terminals[0].terminalId // empty' <<<"$out")"
  emit --arg ws "$ws" --arg setup "$setup" --arg path "$(driver_path "$ws")" '{ws:$ws, setup:$setup, path:$path}'
}

driver_wait_setup() {
  local ws="$1" setup="$2" secs="${3:-300}" txt="" i
  [ -n "$setup" ] || return 0
  for ((i=0; i<secs; i+=3)); do
    txt="$(superset terminals read --workspace "$ws" --terminal "$setup" --max-lines 80 --json 2>/dev/null | jq -r '.text // ""')"
    grep -q -E "$READY_RE" <<<"$txt" && return 0
    grep -q -E "$FATAL_RE" <<<"$txt" && { grep -E "$FATAL_RE" <<<"$txt" | head -3 >&2; return 1; }
    sleep 3
  done
  echo "setup did not print the readiness marker in ${secs}s" >&2; return 1
}

driver_path() { superset ws get "$1" --json 2>/dev/null | jq -r '.worktreePath // empty'; }

# Interactive Claude Code asks whether to trust a folder it has not seen, and arrow keys do
# not arrive through `terminals send`. Trust is per path in ~/.claude.json, so record the
# worktree there before launching. (Headless `claude -p`, the local driver, never asks.)
_pretrust_claude() {
  local path="$1" cfg="$HOME/.claude.json" tmp
  [ -n "$path" ] || return 0
  [ -f "$cfg" ] || printf '{}' > "$cfg"
  tmp="$(mktemp)"
  jq --arg p "$path" '.projects = (.projects // {}) | .projects[$p] = ((.projects[$p] // {}) + {hasTrustDialogAccepted: true})' "$cfg" > "$tmp" \
    && mv "$tmp" "$cfg" || { rm -f "$tmp"; warn "could not pre-trust $path in $cfg"; }
}

driver_launch() {
  local ws="$1" agent="$2" model="$3" effort="$4" prompt="$5" a term t started="" attempt cmd
  [ "$agent" = "claude" ] && _pretrust_claude "$(driver_path "$ws")"
  local args=(--workspace "$ws" --agent "$agent" --json --prompt "$prompt")
  [ -n "$model" ] && [ "$model" != "-" ] && args+=(--model "$model")
  [ -n "$effort" ] && [ "$agent" = "claude" ] && args+=(--effort "$effort")
  a="$(superset agents create "${args[@]}" 2>&1)" || die "superset agents create: $a"
  term="$(jq -r '.sessionId // empty' <<<"$a")"; [ -n "$term" ] || die "no session id: $a"

  # Codex asks to trust a new directory once; answer it.
  if [ "$agent" = "codex" ]; then
    for _ in 1 2 3 4 5 6; do sleep 3
      t="$(driver_read "$ws" "$term" 40)"
      grep -q "Do you trust" <<<"$t" && { superset terminals send --workspace "$ws" --terminal "$term" --text "" --json >/dev/null 2>&1; break; }
      grep -q -E "Working|esc to interrupt|Starting MCP" <<<"$t" && break
    done
  fi
  # Confirm the agent started. Superset has typed the launch before the shell put the
  # agent binary on PATH; retype once, then fail loudly.
  for attempt in 1 2; do
    for _ in 1 2 3 4 5 6 7 8; do sleep 3
      t="$(driver_read "$ws" "$term" 40)"
      grep -q -E "not found in PATH|command not found" <<<"$t" && break
      grep -q -E "bypass permissions|esc to interrupt|… \(|Working|Starting MCP|gpt-|Opus|Sonnet|Fable" <<<"$t" && { started=1; break; }
    done
    [ -n "$started" ] && break
    [ "$attempt" = 2 ] && break
    cmd="$agent"; [ "$agent" = "claude" ] && cmd="claude --dangerously-skip-permissions"
    [ -n "$model" ] && [ "$model" != "-" ] && cmd="$cmd --model $model"
    superset terminals send --workspace "$ws" --terminal "$term" --text "clear; $cmd '${prompt//\'/\'\\\'\'}'" --json >/dev/null 2>&1
  done
  [ -n "$started" ] || die "the agent did not start in terminal $term: read it with 'superset terminals read'"
  printf '%s' "$term"
}

driver_read() { superset terminals read --workspace "$1" --terminal "$2" --max-lines "${3:-240}" --json 2>/dev/null | jq -r '.text // ""'; }
driver_send() { superset terminals send --workspace "$1" --terminal "$2" --text "$3" --json >/dev/null; }
driver_tag()  { superset ws update "$1" --local --tag "$2" --json >/dev/null 2>&1 || true; }
driver_delete() { superset ws delete "$1" --local --json 2>&1 | jq -r '.warnings[]? // empty' >&2; return 0; }

driver_list() {
  local P; P="$(driver_project_id)"
  superset ws list --local --json 2>/dev/null \
    | jq -r --arg p "$P" '.[] | select(.projectId==$p and .type=="worktree") | [.id, .name, (.worktreePath // ""), (.tags // "")] | @tsv'
}
driver_find() { driver_list | awk -F'\t' -v id="($1)" 'index($2, id) {print $1; exit}'; }
driver_running_count() { driver_list | awk -F'\t' '$4 ~ /(^|,)running(,|$)/' | wc -l | tr -d ' '; }

# The agent's terminal in a workspace: the newest live one that is not a plain shell.
driver_agent_terminal() {
  superset terminals list --workspace "$1" --json 2>/dev/null \
    | jq -r '[.sessions[] | select((.exited|not) and ((.title // "")|test("^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:")|not))] | sort_by(.createdAt) | last | .terminalId // empty'
}
