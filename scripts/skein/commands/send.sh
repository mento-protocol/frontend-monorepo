#!/usr/bin/env bash
# skein send <TASK> "message"   — deliver one line to a running worker, quoting handled.
. "$SKEIN_HOME/lib/common.sh"; require_config; load_driver
TASK="${1:-}"; MSG="${2:-}"; [ -n "$TASK" ] && [ -n "$MSG" ] || die 'usage: skein send <TASK> "message"'
ID="$(task_id_norm "$TASK")"
WS="$(driver_find "$ID")"; [ -n "$WS" ] || die "no workspace found for $ID"
TERM_ID="$(driver_agent_terminal "$WS")"; [ -n "$TERM_ID" ] || die "no agent terminal in workspace $WS"
driver_send "$WS" "$TERM_ID" "$(tr '\n' ' ' <<<"$MSG")" && log "sent to $ID"
