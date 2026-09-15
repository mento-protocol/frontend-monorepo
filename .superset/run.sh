#!/usr/bin/env bash
# Superset "Run" command: start one app's dev server in its own pane.
#
# Usage: ./.superset/run.sh [app-name]
#   app.mento.org         (port 3000, default)
#   reserve.mento.org     (port 3001)
#   governance.mento.org  (port 3002)
#   ui.mento.org          (port 3003)
#
# turbo's dev task depends on ^build, so the shared packages are built (or
# served from cache) before next dev starts. app.mento.org's dev script also
# watches @repo/web3 and @mento-protocol/ui for live rebuilds.

set -euo pipefail

cd "${SUPERSET_WORKSPACE_PATH:-${PWD}}"

# Same pinned-pnpm switch as setup.sh (see the comment there).
export npm_config_manage_package_manager_versions=true

app="${1:-app.mento.org}"

case "${app}" in
app.mento.org) port=3000 ;;
reserve.mento.org) port=3001 ;;
governance.mento.org) port=3002 ;;
ui.mento.org) port=3003 ;;
*)
	echo "Unknown app '${app}'. Expected one of: app.mento.org reserve.mento.org governance.mento.org ui.mento.org" >&2
	exit 1
	;;
esac

if [[ ! -d node_modules ]]; then
	echo "node_modules missing; run ./.superset/setup.sh first" >&2
	exit 1
fi

# Ports are fixed per app, so two workspaces cannot run the same app at once.
if command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :${port} )" 2>/dev/null | grep -q ":${port}"; then
	echo "Port ${port} is already in use (another workspace running ${app}?). Stop it first." >&2
	exit 1
fi

echo "Starting ${app} on http://localhost:${port}"
exec pnpm exec turbo run dev --filter "${app}"
