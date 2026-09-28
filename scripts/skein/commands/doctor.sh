#!/usr/bin/env bash
# skein doctor — check this machine and this repo before coordinating. Read-only.
. "$SKEIN_HOME/lib/common.sh"
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAILS=$((FAILS+1)); }
FAILS=0
echo "skein doctor ($(cat "$SKEIN_HOME/VERSION" 2>/dev/null || echo dev)) in $ROOT"
for b in git node jq; do command -v "$b" >/dev/null && ok "$b $(command -v "$b")" || bad "$b missing"; done
have_config && ok ".skein/config.json ($(cfg .name), prefix $PREFIX, board $BOARD_TYPE, driver $DRIVER_TYPE)" || { bad "no .skein/config.json: run skein init"; exit 1; }
[ -f "$PLAN" ] && ok "plan $PLAN ($(jq '.tasks|length' "$PLAN") tasks)" || bad "plan missing: $PLAN"
[ -x "$ROOT/$(cfg .vendor scripts/skein)/skein" ] && ok "vendored skein $(cat "$ROOT/$(cfg .vendor scripts/skein)/VERSION" 2>/dev/null)" || bad "vendored scripts missing: run skein init"
[ "$(git config core.hooksPath)" = "scripts/githooks" ] && ok "hooks path set" || bad "git config core.hooksPath scripts/githooks (not set)"
git ls-remote origin >/dev/null 2>&1 && ok "origin reachable" || bad "origin not reachable"
case "$BOARD_TYPE" in
  github) command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && ok "gh authenticated as $(gh api user -q .login 2>/dev/null)" || bad "gh not authenticated (gh auth login)" ;;
  superset) command -v superset >/dev/null && superset auth whoami --json >/dev/null 2>&1 && ok "superset authenticated" || bad "superset CLI not authenticated (superset auth login)" ;;
  none) ok "board: none (single coordinator)" ;;
esac
case "$DRIVER_TYPE" in
  superset)
    if command -v superset >/dev/null && superset auth whoami --json >/dev/null 2>&1; then
      load_driver; pid="$(driver_project_id 2>/dev/null)" && ok "superset project $pid" || bad "superset project for this repo not found (add it in the app, or SKEIN_PROJECT_ID)"
    else bad "superset CLI not usable: is the desktop app running and logged in?"; fi ;;
  local) command -v claude >/dev/null && ok "claude on PATH (local driver)" || bad "claude CLI missing" ;;
esac
codex --version >/dev/null 2>&1 && ok "codex $(codex --version 2>/dev/null | head -1) (cross-model review)" || printf '  \033[33m•\033[0m codex not installed: skein review falls back to claude %s\n' "$(cfg .review.fallbackModel)"
. "$SKEIN_HOME/lib/caps.sh"; ok "caps: machine $(machine_cap) ($USER_CONFIG), repo $(repo_cap) (.skein/config.json)"
[ "$(jq '.standard|length' "$CONFIG")" -gt 0 ] && ok "standard: $(jq -r '.standard|join(" && ")' "$CONFIG")" || bad "no standard commands: the gate cannot judge work"
[ "$FAILS" -eq 0 ] && echo "all good" || { echo "$FAILS problem(s)"; exit 1; }
