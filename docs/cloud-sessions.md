# Claude Code on the web — environment notes

Findings from the first cloud session for this repository. A cloud session runs
in an ephemeral container with a fresh clone, and all outbound HTTPS goes
through a policy-enforcing egress proxy. Two things follow from that, and both
bite immediately: **nothing is installed unless a setup script installs it**,
and **any host not on the egress allowlist fails closed**.

Everything below was observed, not assumed. A blocked host is confirmed against
the proxy's own log (`curl -sS "$HTTPS_PROXY/__agentproxy/status"`, field
`recentRelayFailures`), because `curl` reports a rejected CONNECT tunnel as exit
56 / HTTP `000` and that is indistinguishable from a network error.

## 1. `pnpm install` fails without a workaround

**`node_modules` is empty at session start** — no setup script is configured, so
the first thing any session must do is install. That install then fails:

```
ERR_PNPM_FETCH_403  GET https://codeload.github.com/jmrossy/jazzicon/tar.gz/7a8df28…: Forbidden - 403
```

`codeload.github.com` is not on the egress allowlist. The repository has exactly
one git-hosted dependency, in the `pnpm-workspace.yaml` catalog:

```yaml
"@metamask/jazzicon": github:jmrossy/jazzicon#7a8df28974b4e81129bfbe3cab76308b889032a6
```

pnpm resolves a `github:` specifier to a `codeload.github.com` tarball, so the
install dies after resolving all 2547 packages. Note that `.pnpm/` fills up but
the workspace links are never created, so the failure looks like a _successful_
install followed by every import being missing.

`git` over HTTPS to `github.com` **does** work (the session's git proxy handles
it) — only the tarball endpoints are blocked. `api.github.com`'s
`/tarball/` endpoint is blocked too.

### The fix (setup script / allowlist)

Preferred: **add `codeload.github.com` to the egress allowlist.** It is the
canonical GitHub source-archive host and the dependency is pinned to a full
commit SHA, so this widens the allowlist by one well-understood host.

Until then, the working session workaround — temporarily point the catalog at
git instead of the tarball, install, and restore:

```bash
cp pnpm-workspace.yaml /tmp/ws.bak && cp pnpm-lock.yaml /tmp/lock.bak
sed -i 's|github:jmrossy/jazzicon#|git+https://github.com/jmrossy/jazzicon.git#|' pnpm-workspace.yaml
pnpm install --no-frozen-lockfile      # ~46s, succeeds
cp /tmp/ws.bak pnpm-workspace.yaml && cp /tmp/lock.bak pnpm-lock.yaml
```

`node_modules` keeps the package, and `git status` comes back clean. Do **not**
commit the rewritten specifier or the lockfile it produces: the `github:` form
is what CI and the lockfile-integrity gate expect.

A setup script should therefore run the install (with whichever of the two
resolutions is in force) so sessions start with a linked workspace.

## 2. Trunk cannot run at all

`trunk` is not on `PATH`, and the launcher cannot fetch it:

```
$ npx --yes @trunkio/launcher check --fix
✘ Failed to download trunk binary. (HTTP 403 Forbidden)
```

Both `trunk.io` and `api.trunk.io` are blocked. This means **step 2 of "After
Making Changes" in `CLAUDE.md` (`trunk check --fix`) is impossible in a cloud
session**, and so are `trunk fmt`, `pnpm lint`, and `pnpm format`.

### The fix

Allowlist `trunk.io` and `api.trunk.io`, and have the setup script warm the
binary (`npx @trunkio/launcher --version`) so the first check is not a
multi-minute download. Trunk also pulls its own linter toolchains (Go, Python
and Node runtimes plus each linter release), so expect more hosts to surface
once those two are open; `github.com` releases and `objects.githubusercontent.com`
already work.

Meanwhile, lint with the underlying tools, which **are** in `node_modules` and
use the repository's own configs:

```bash
pnpm exec prettier --write <files>     # what trunk's prettier@3.7.4 does
pnpm exec eslint <files>               # what trunk's eslint@9.39.1 does
```

That covers the linters that matter for `.mjs`/`.md`/`.json`. It does **not**
cover `yamllint`, `markdownlint`, `actionlint`, `checkov`, `shellcheck`,
`gitleaks` or `trufflehog`, so a workflow-file change cannot be fully validated
locally — it has to be checked in CI. Two notes from this session:

- ESLint for `scripts/**` has no Node globals configured, so `process` and
  `Buffer` warn as `no-undef`. The repository convention is an explicit
  `import process from "node:process"` / `import { Buffer } from "node:buffer"`.
- `pnpm exec eslint` always prints a harmless warning that the `react` package
  is not installed at the root. It is not a failure.

## 3. Blocked hosts

Confirmed `403` on CONNECT from the egress proxy:

| Host                                   | What breaks                                      | Priority    |
| -------------------------------------- | ------------------------------------------------ | ----------- |
| `codeload.github.com`                  | `pnpm install` (see §1)                          | **blocker** |
| `trunk.io`, `api.trunk.io`             | all linting and formatting (see §2)              | **blocker** |
| `forno.celo.org`                       | Celo RPC — anything reading mainnet state        | high        |
| `celo.rpc.thirdweb.com`                | the archive RPC the pinned-block fork probes     | high        |
| `rpc.monad.xyz`, `monad.drpc.org`      | Monad RPC (chain 143)                            | high        |
| `api.vercel.com`                       | every Vercel CLI/deployment-state script         | medium      |
| `api.argos-ci.com`                     | pixel VRT baseline upload                        | medium      |
| `sentry.io`, `o4508….ingest.sentry.io` | Sentry source-map upload and DSN validation      | low         |
| `telemetry.vercel.com`                 | nothing — Next.js telemetry, non-fatal but noisy | ignore      |

Reachable and working: `github.com` (git over HTTPS), `api.github.com`,
`raw.githubusercontent.com`, `objects.githubusercontent.com`,
`registry.npmjs.org`, `npm.jsr.io`, `fonts.googleapis.com`.

`telemetry.vercel.com` 403s appear during any `next build` or `next typegen` and
are safe to ignore, but setting `NEXT_TELEMETRY_DISABLED=1` in the environment
would keep the proxy log readable.

## 4. Missing tooling

| Tool                                                 | Present | Needed for                                                        |
| ---------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `node` 22.22.2, `pnpm` 10.34.5                       | yes     | everything                                                        |
| `docker`, `jq`, `unzip`, `python3`, `go`             | yes     | —                                                                 |
| Chromium + Playwright browsers at `/opt/pw-browsers` | yes     | VRT and E2E                                                       |
| `anvil`, `cast`, `forge` (Foundry)                   | **no**  | `pnpm fork:mainnet`, `fork:monad`, and every connected-wallet E2E |
| `trunk`                                              | **no**  | lint/format (see §2)                                              |
| `gh`                                                 | **no**  | not needed — use the GitHub MCP tools                             |

Foundry plus the RPC hosts in §3 are both required before any of the
wallet-connected E2E work described in `CLAUDE.md` can run in a cloud session.
Neither is needed for workflow, script, or unit-test work.

## 5. What does work

With the §1 workaround applied, all of these pass in a cloud session:

```bash
pnpm check-types          # 8/8 tasks, ~76s (Next route typegen included)
pnpm test                 # 1182 tests, 0 failures
pnpm quality:budgets:test # unit/structural gates for the notifier + budgets
pnpm ci:action-pins       # 28 workflow/composite-action files
pnpm dependency:policy:test
```

Missing `.env.local` files are worth knowing about: only `.env.example` is
checked in, and the env schema fails app startup without one.
`pnpm check-types` supplies its own dummy values, so it needs nothing, but
`pnpm build` and `pnpm dev` need `apps/<app>/.env.local` to exist. Dummy values
are enough for a build (`NEXT_PUBLIC_STORAGE_URL=https://example.com`,
`NEXT_PUBLIC_WALLET_CONNECT_ID=dummy`, `CHAINALYSIS_API_KEY=dummy`, Sentry vars
empty); a real `CHAINALYSIS_API_KEY` is needed only to exercise the screening
path.

## 6. Suggested setup script

```bash
#!/usr/bin/env bash
set -euo pipefail

export NEXT_TELEMETRY_DISABLED=1

# Requires codeload.github.com on the egress allowlist; without it, apply the
# git+https catalog workaround in docs/cloud-sessions.md §1 first.
pnpm install --frozen-lockfile

# Requires trunk.io + api.trunk.io on the allowlist. Warm the binary so the
# first `trunk check` is not a multi-minute download.
npx --yes @trunkio/launcher --version || echo "trunk unavailable; see docs/cloud-sessions.md §2"

# Only needed for fork/E2E work.
# curl -L https://foundry.paradigm.xyz | bash && foundryup
```

Order matters: `pnpm install` must come before anything that reads
`node_modules`, and `pnpm check-types` builds workspace package types, so run it
rather than a bare `tsc` if a session wants a warm type cache.
