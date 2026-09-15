#!/usr/bin/env bash
# Superset workspace setup. Runs once, in the new worktree, each time a
# workspace is created. Keep it fast: install, copy env files, build the
# shared packages. Dev servers belong in run.sh, not here.
#
# Environment provided by Superset:
#   SUPERSET_ROOT_PATH       path to the root checkout (source of env files)
#   SUPERSET_WORKSPACE_PATH  path to this worktree
#   SUPERSET_WORKSPACE_NAME  workspace name
#
# Optional:
#   SUPERSET_SKIP_PACKAGE_BUILD=1  skip the shared package build

set -euo pipefail

cd "${SUPERSET_WORKSPACE_PATH:-${PWD}}"

step() { printf '\n==> %s\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }

if [[ ! -f package.json || ! -f pnpm-workspace.yaml ]]; then
	echo "setup.sh must run from the frontend-monorepo root" >&2
	exit 1
fi

step "Checking toolchain"
if ! command -v node >/dev/null 2>&1; then
	echo "Node.js >= 22 is required (see package.json engines)" >&2
	exit 1
fi
node_version=$(node -v)
node_major="${node_version#v}"
node_major="${node_major%%.*}"
if ((node_major < 22)); then
	echo "Node.js >= 22 is required, found ${node_version}" >&2
	exit 1
fi
if ! command -v pnpm >/dev/null 2>&1; then
	echo "pnpm is required: npm install -g pnpm (any 9.7+ works, it switches to the pinned version below)" >&2
	exit 1
fi
# package.json pins pnpm (packageManager). The lockfile is written by that
# version and a frozen install with an older pnpm on PATH fails with
# ERR_PNPM_LOCKFILE_CONFIG_MISMATCH, so let pnpm itself download and run the
# pinned version. This is pnpm 10's default and is honoured by pnpm >= 9.7;
# corepack is not used because its bundled signing keys go stale.
export npm_config_manage_package_manager_versions=true
pnpm_version=$(pnpm -v)
pinned_pnpm=$(node -p 'require("./package.json").packageManager')
ok "node ${node_version}, pnpm ${pnpm_version} (pinned: ${pinned_pnpm})"

step "Installing dependencies (frozen lockfile)"
pnpm install --frozen-lockfile
ok "dependencies installed"

# Each app keeps its local environment in a gitignored apps/<app>/.env (or
# .env.local). Copy whatever the root checkout has so the workspace starts
# with the same working values; fall back to .env.example so the env schema
# at least loads. Existing files in the workspace are never overwritten.
step "Copying app environment files"
root="${SUPERSET_ROOT_PATH-}"
for app_dir in apps/*/; do
	app="${app_dir%/}"
	for env_name in .env .env.local; do
		target="${app}/${env_name}"
		if [[ -e ${target} ]]; then
			ok "${target} already present"
			continue
		fi
		if [[ -n ${root} && -f "${root}/${target}" ]]; then
			cp "${root}/${target}" "${target}"
			ok "${target} copied from root checkout"
		fi
	done
	if [[ ! -e "${app}/.env" && ! -e "${app}/.env.local" && -f "${app}/.env.example" ]]; then
		cp "${app}/.env.example" "${app}/.env"
		warn "${app}/.env created from .env.example; fill in the real values"
	fi
done

# apps depend on the built output of @mento-protocol/ui and @repo/web3.
# turbo's dev/check-types/test tasks build them on demand, but doing it once
# here (turbo cache makes reruns cheap) means the first Run, type check, and
# test in the workspace are all immediately usable.
if [[ ${SUPERSET_SKIP_PACKAGE_BUILD:-0} != 1 ]]; then
	step "Building shared packages"
	pnpm exec turbo run build --filter './packages/*'
	ok "shared packages built"
fi

printf '\nWorkspace %s ready.\n' "${SUPERSET_WORKSPACE_NAME:-${PWD##*/}}"
echo "  Run button starts app.mento.org on http://localhost:3000 (edit .superset/config.json to pick another app)."
echo "  Optional local fork for wallet flows: pnpm fork:mainnet && pnpm fork:seed (see docs/wallet-testing.md)."
