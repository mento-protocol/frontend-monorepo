#!/usr/bin/env bash
# Installs workspace dependencies at the start of a Claude Code cloud session.
#
# Cloud sessions start from a fresh clone with no node_modules. The cloud
# environment's setup script cannot do this install: it runs before Claude Code
# launches and before the repository is cloned, so the working tree does not
# exist yet. This hook runs after the clone, so it is the right place for any
# step that needs repository files.
#
# Local sessions exit immediately.
set -uo pipefail

if [[ ${CLAUDE_CODE_REMOTE-} != "true" ]]; then
	exit 0
fi

repository_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [[ -z ${repository_root} ]] || [[ ! -f "${repository_root}/package.json" ]]; then
	echo "cloud-session-setup: no repository root found, skipping install" >&2
	exit 0
fi

cd "${repository_root}" || exit 0

if [[ -d node_modules/.pnpm ]]; then
	echo "cloud-session-setup: dependencies already installed"
	exit 0
fi

# The hook's output becomes session context, so keep the install log on disk and
# print only a summary. A cold install of this workspace runs for minutes, which
# is why the hook sets a 600 second timeout.
log_file="${TMPDIR:-/tmp}/cloud-session-setup.log"
echo "cloud-session-setup: running pnpm install --frozen-lockfile (log: ${log_file})"
if pnpm install --frozen-lockfile >"${log_file}" 2>&1; then
	echo "cloud-session-setup: dependencies installed"
else
	echo "cloud-session-setup: pnpm install failed; last lines of ${log_file}:" >&2
	tail -20 "${log_file}" >&2
fi

exit 0
