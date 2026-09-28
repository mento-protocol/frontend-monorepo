#!/usr/bin/env bash
. "$SKEIN_HOME/lib/common.sh"
exec node "$SKEIN_HOME/lib/plan.mjs" "$@"
