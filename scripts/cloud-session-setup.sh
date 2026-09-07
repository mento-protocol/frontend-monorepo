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

# The environment provides its own pnpm; package.json pins the one this
# workspace expects. Read both before the fast path below, so a revision that
# moves only the pin is still reported and still reinstalls.
pinned_pnpm="$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"pnpm@\([^"]*\)".*/\1/p' package.json)"
running_pnpm="$(pnpm --version 2>/dev/null)"
if [[ -n ${pinned_pnpm} ]] && [[ ${running_pnpm} != "${pinned_pnpm}" ]]; then
	echo "cloud-session-setup: pnpm ${running_pnpm:-not found} does not match the pinned pnpm@${pinned_pnpm}"
fi

# pnpm creates node_modules/.pnpm before it links anything, so that directory
# exists even after a failed install and cannot stand in for success. Gate on a
# stamp this script writes itself, so a partial tree is retried rather than
# mistaken for a finished install.
#
# The stamp records both inputs that decide the tree: the lockfile the install
# was made from and the pnpm that made it. A resumed session whose lockfile
# moved — a pull or a branch switch — or whose pin moved without touching the
# lockfile therefore reinstalls instead of running against the previous
# revision's dependencies. An unreadable digest stays empty and never matches,
# so the uncertain case reinstalls too.
stamp_file="node_modules/.cloud-session-setup-complete"
lockfile_digest="$(sha256sum pnpm-lock.yaml 2>/dev/null | cut -d' ' -f1)"
stamp_expected="${lockfile_digest} pnpm@${pinned_pnpm}"
stamp_actual=""
if [[ -f ${stamp_file} ]]; then
	read -r stamp_actual <"${stamp_file}"
fi
if [[ -n ${lockfile_digest} ]] && [[ ${stamp_actual} == "${stamp_expected}" ]]; then
	echo "cloud-session-setup: dependencies already installed"
	exit 0
fi

# Drop the stamp before pnpm touches node_modules. An install that fails partway
# has already changed the tree, and a stamp left over from the revision before
# it would otherwise match again after a switch back and skip the repair.
rm -f "${stamp_file}"

# The hook's output becomes session context, so keep the install log on disk and
# print only a summary. A cold install of this workspace runs for minutes, which
# is why the hook sets a 600 second timeout.
log_file="${TMPDIR:-/tmp}/cloud-session-setup.log"
echo "cloud-session-setup: running pnpm install --frozen-lockfile (log: ${log_file})"
if pnpm install --frozen-lockfile >"${log_file}" 2>&1; then
	printf '%s\n' "${stamp_expected}" >"${stamp_file}"
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
