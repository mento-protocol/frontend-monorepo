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

# pnpm creates node_modules/.pnpm before it links anything, so that directory
# exists even after a failed install and cannot stand in for success. Gate on a
# stamp this script writes itself, so a partial tree is retried rather than
# mistaken for a finished install.
#
# The stamp holds the lockfile digest the install was made from. A resumed
# session whose lockfile moved since — a pull or a branch switch — therefore
# reinstalls instead of running against dependencies from the previous
# revision. An unreadable digest stays empty and never matches, so the
# uncertain case reinstalls too.
stamp_file="node_modules/.cloud-session-setup-complete"
lockfile_digest="$(sha256sum pnpm-lock.yaml 2>/dev/null | cut -d' ' -f1)"
if [[ -n ${lockfile_digest} ]] && [[ -f ${stamp_file} ]] &&
	[[ "$(cat "${stamp_file}" 2>/dev/null)" == "${lockfile_digest}" ]]; then
	echo "cloud-session-setup: dependencies already installed"
	exit 0
fi

# The hook's output becomes session context, so keep the install log on disk and
# print only a summary. A cold install of this workspace runs for minutes, which
# is why the hook sets a 600 second timeout.
log_file="${TMPDIR:-/tmp}/cloud-session-setup.log"
echo "cloud-session-setup: running pnpm install --frozen-lockfile (log: ${log_file})"
if pnpm install --frozen-lockfile >"${log_file}" 2>&1; then
	printf '%s\n' "${lockfile_digest}" >"${stamp_file}"
	echo "cloud-session-setup: dependencies installed"
	exit 0
fi

# Report the failure on stdout as well: only stdout reaches the session context,
# and an agent that cannot see the failure will read the empty node_modules as a
# repository problem instead of an install that never finished.
echo "cloud-session-setup: pnpm install FAILED; node_modules is incomplete."
echo "cloud-session-setup: builds, type checks and tests will not run until it succeeds."
echo "cloud-session-setup: last lines of ${log_file}:"
tail -20 "${log_file}"
exit 0
