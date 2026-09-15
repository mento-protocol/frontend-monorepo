#!/usr/bin/env bash
# Superset workspace teardown. Runs when a workspace is deleted.
#
# setup.sh starts no services and leaves nothing outside the worktree
# (dependencies come from the shared pnpm store, env files live inside the
# worktree, turbo cache lives in .turbo inside the worktree), so deleting the
# worktree undoes everything. The optional anvil fork and otterscan explorer
# are started by hand and shared across workspaces, so they are deliberately
# not stopped here; use `make stop-all-services` for that.

set -euo pipefail

cd "${SUPERSET_WORKSPACE_PATH:-${PWD}}"

echo "Nothing to tear down for ${SUPERSET_WORKSPACE_NAME:-${PWD##*/}}."
