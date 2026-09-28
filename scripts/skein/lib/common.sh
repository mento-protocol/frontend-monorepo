#!/usr/bin/env bash
# Shared helpers for every skein command. Sourced, never executed.
# Requires: git, node, jq. Commands that touch a board or a driver require gh or superset.

set -uo pipefail

: "${SKEIN_HOME:?SKEIN_HOME must be set by bin/skein}"

log()  { printf 'skein: %s\n' "$*" >&2; }
warn() { printf 'skein: warning: %s\n' "$*" >&2; }
die()  { printf 'skein: %s\n' "$*" >&2; exit "${2:-1}"; }
need() { for b in "$@"; do command -v "$b" >/dev/null 2>&1 || die "needs '$b' on PATH"; done; }

# Repo root and config. Every command runs from anywhere inside the repo.
repo_root() { git rev-parse --show-toplevel 2>/dev/null || die "not inside a git repository"; }
ROOT="$(repo_root)"
CONFIG="$ROOT/.skein/config.json"
USER_CONFIG="${SKEIN_USER_CONFIG:-$HOME/.skein/config.json}"

have_config() { [ -f "$CONFIG" ]; }
require_config() { have_config || die "no .skein/config.json here: run 'skein init' first"; }

# cfg <jq-path> [default]  — read one value from the repo config.
cfg() {
  local path="$1" def="${2:-}"
  local v
  v="$(jq -r "$path // empty" "$CONFIG" 2>/dev/null)"
  [ -n "$v" ] && printf '%s' "$v" || printf '%s' "$def"
}
# ucfg <jq-path> [default] — read one value from the per-machine config.
ucfg() {
  local path="$1" def="${2:-}"
  local v=""
  [ -f "$USER_CONFIG" ] && v="$(jq -r "$path // empty" "$USER_CONFIG" 2>/dev/null)"
  [ -n "$v" ] && printf '%s' "$v" || printf '%s' "$def"
}

PLAN="$ROOT/$(cfg .plan docs/plan/wps.json)"
BRIEFS="$ROOT/$(cfg .briefs docs/plan/briefs)"
PREFIX="$(cfg .prefix TASK)"
ENVELOPE="$(cfg .envelope "${PREFIX}_WORKER")"
BOARD_TYPE="${SKEIN_BOARD:-$(cfg .board.type github)}"
DRIVER_TYPE="${SKEIN_DRIVER:-$(cfg .driver.type superset)}"   # SKEIN_DRIVER=local for a machine without Superset
COORD_ENV="$(cfg .coordinatorEnv "${PREFIX}_COORDINATOR")"

# Task helpers over the plan file.
task_json() {  # task_json <ID> -> the task object, or dies
  local id="$1"
  [ -f "$PLAN" ] || die "plan file not found: $PLAN"
  local t
  t="$(jq -c --arg id "$id" '.tasks[] | select((.id|ascii_downcase) == ($id|ascii_downcase))' "$PLAN")"
  [ -n "$t" ] || die "task '$id' not found in $PLAN"
  printf '%s' "$t"
}
task_field() { jq -r --arg k "$2" '.[$k] // empty' <<<"$1"; }   # task_field <json> <key>
task_id_norm() { task_json "$1" | jq -r .id; }                    # canonical casing

# Naming (COORDINATOR.md, "Naming"): branch <type>/<slug>-<id>, workspace "<type>: <slug words> (<ID>)".
task_branch() {
  local t="$1" id type slug
  id="$(jq -r '.id|ascii_downcase' <<<"$t")"; type="$(task_field "$t" type)"; slug="$(task_field "$t" slug)"
  if [ -n "$type" ] && [ -n "$slug" ]; then printf '%s/%s-%s' "$type" "$slug" "$id"; else printf '%s' "$id"; fi
}
task_ws_name() {
  local t="$1" id type slug
  id="$(jq -r .id <<<"$t")"; type="$(task_field "$t" type)"; slug="$(task_field "$t" slug)"
  if [ -n "$type" ] && [ -n "$slug" ]; then printf '%s: %s (%s)' "$type" "${slug//-/ }" "$id"; else printf '%s' "$(tr '[:upper:]' '[:lower:]' <<<"$id")"; fi
}

# Load the board and driver implementations named in config.
load_board()  { local f="$SKEIN_HOME/lib/boards/$BOARD_TYPE.sh";  [ -f "$f" ] || die "unknown board type '$BOARD_TYPE'";  . "$f"; }
load_driver() { local f="$SKEIN_HOME/lib/drivers/$DRIVER_TYPE.sh"; [ -f "$f" ] || die "unknown driver type '$DRIVER_TYPE'"; . "$f"; }

# Who am I, for claims. GitHub login when gh is present, else the OS user.
me() { gh api user -q .login 2>/dev/null || id -un; }

# One JSON line to stdout: the machine-readable result every running command ends with.
emit() { jq -cn "$@"; }
