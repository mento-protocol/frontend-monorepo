#!/usr/bin/env bash
# Two caps, two reasons. The per-machine cap (~/.skein/config.json maxAgents, or
# SKEIN_MAX_AGENTS) protects this laptop and this seat's usage. The per-repo cap
# (.skein/config.json maxAgents) protects the repo: merge rounds, review throughput,
# and how many disjoint tasks exist. A dispatch must fit under both.

machine_cap() { printf '%s' "${SKEIN_MAX_AGENTS:-$(ucfg .maxAgents 3)}"; }
repo_cap()    { printf '%s' "$(cfg .maxAgents 6)"; }

# Counts come from the driver (local agents this machine runs for this repo) and the
# board (claims running anywhere). Both functions are provided by the loaded modules.
check_caps() {  # exits non-zero with a reason on stdout when a dispatch must not happen
  local mc rc local_n board_n
  mc="$(machine_cap)"; rc="$(repo_cap)"
  local_n="$(driver_running_count 2>/dev/null || echo 0)"
  board_n="$(board_running_count 2>/dev/null || echo 0)"
  if [ "$local_n" -ge "$mc" ]; then
    printf 'machine cap reached: %s of %s agents running here (raise maxAgents in %s)\n' "$local_n" "$mc" "$USER_CONFIG"; return 1
  fi
  if [ "$board_n" -ge "$rc" ]; then
    printf 'repo cap reached: %s of %s tasks running across all coordinators (.skein/config.json maxAgents)\n' "$board_n" "$rc"; return 1
  fi
  printf 'caps ok: machine %s/%s, repo %s/%s\n' "$local_n" "$mc" "$board_n" "$rc"
}
