# Mento Frontend Monorepo

## Overview

Monorepo for Mento Protocol frontend applications (DeFi on Celo blockchain).

### Apps

- **app.mento.org** — Main swap/exchange app (port 3000)
- **reserve.mento.org** — Reserve dashboard (port 3001)
- **governance.mento.org** — Governance interface (port 3002)
- **ui.mento.org** — Component library showcase (port 3003)

### Shared Packages

- **@mento-protocol/ui** — Component library (Radix UI + Tailwind, built with tsup)
- **@repo/web3** — Web3 hooks and transaction logic (wagmi/viem)
- **@repo/eslint-config** — Shared ESLint configs
- **@repo/typescript-config** — Shared TS configs
- **@repo/vitest-config** — Shared Vitest configs

## Tech Stack

- **Framework:** Next.js 15, React 19, TypeScript 5.9
- **Package management:** pnpm 10, Turborepo, Node >= 22
- **Styling:** Tailwind CSS 4
- **Web3:** wagmi, viem, @mento-protocol/mento-sdk, RainbowKit
- **State:** jotai (atoms), @tanstack/react-query (data fetching)
- **Linting/Formatting:** Trunk CLI (ESLint + Prettier)
- **Testing:** Vitest (app.mento.org, governance.mento.org, @repo/web3, @mento-protocol/ui)
- **Monitoring:** Sentry
- **Deployment:** Vercel

## Essential Commands

```bash
pnpm install                          # Install dependencies
pnpm exec turbo run dev --filter <app-name>    # Dev server for one app (use package.json name)
pnpm build                           # Build all
pnpm exec turbo run build --filter <app-name>  # Build one app
pnpm check-types                     # TypeScript type checking; builds workspace package types first
pnpm ci:action-pins                  # Verify third-party GitHub Actions use documented SHA pins
pnpm ci:action-pins:test             # Test the action-pin scanner and REST materializer
pnpm dependency:policy:test          # Test Dependabot schedule, grouping, and dependency policy
pnpm ci:change-plan:test             # Test PR scoping, full main pushes, mandatory Trunk, and fail-closed behavior
pnpm adr:check                       # Advisory reminder for new architecture-significant workflows/workspaces
pnpm adr:check:test                  # Test the offline ADR trigger and repository wiring
trunk check --fix                     # Lint with autofix
trunk fmt                             # Format
pnpm test                            # Run tests (both CI unit shards, serially)
pnpm test:ci:workspaces              # CI unit shard 1: ADR/dependency-policy/lockfile suites + turbo workspace tests
pnpm test:ci:vercel                  # CI unit shard 2: Vercel deployment contract suites
pnpm quality:budgets:test            # Unit/structural tests for quality gates + notifier
pnpm quality:coverage                # Enforce measured coverage floors in tested workspaces
pnpm quality:budgets                 # Coverage + production builds + route bundle limits
pnpm fork:mainnet                    # Local anvil fork of Celo mainnet (--celo --auto-impersonate, port 8545)
pnpm fork:seed                       # Select a safe FX-open clock, fund fork accounts, and re-report oracles
pnpm fork:monad                      # Local anvil fork of Monad mainnet (chain 143, port 8546; no --celo)
pnpm fork:seed:monad                 # Same safe clock; Reserve collateral + real swap-to-seed
pnpm pr:description:test             # Test the required PR-description format validator
pnpm vercel:deployment-state:test    # Test canonical read-only Vercel state and alias-drift evidence
pnpm vercel:primitives:test          # Test affected planning, custom deployment IDs, and build-env contracts
pnpm vercel:workflow:test            # Test Vercel preview and main workflows, exact-main gating, transactions, and smoke
pnpm vercel:preview:test             # Test preview state plus reusable smoke trust, native-adapter, and Git-ownership boundaries
pnpm vercel:production-shadow:test   # Test the staged-candidate toolkit and shared candidate-build actions
pnpm vercel:versions:check           # Verify pinned Next.js/Vercel CLI custom-ID prerequisites
pnpm vercel:plan --base <sha> --head <sha>  # Emit the fail-closed Vercel target plan
gh pr view --json body --jq .body | pnpm pr:description:check  # Validate the current PR body
```

The full custom-CI primitive contract, environment matrix, and prebuilt-output
assertion are documented in [docs/vercel-deployments.md](docs/vercel-deployments.md).

Always use `--filter` to avoid building/running everything unnecessarily.

## After Making Changes

1. Run `pnpm check-types` — confirm types pass. This also builds upstream workspace package types and generates Next route types for apps that need them; route typegen uses dummy local env values only for config loading. The `check-types` Turbo task is intentionally uncached so Next route typegen and `tsc` run after local cleans.
2. Run `trunk check --fix` — confirm linting passes
3. Verify changes visually on localhost (check the app's package.json `dev` script for the port)

## Cloud Sessions (Claude Code on the Web)

Cloud sessions start from a fresh clone with no `node_modules`. The
`SessionStart` hook in [.claude/settings.json](.claude/settings.json) runs
[scripts/cloud-session-setup.sh](scripts/cloud-session-setup.sh), which does
three things when `CLAUDE_CODE_REMOTE=true` and exits immediately otherwise:
points Trunk at a plugin checkout it can actually reach, installs dependencies,
and aliases the Playwright browsers. The last two are covered below; the install
runs `pnpm install --frozen-lockfile` when the
`node_modules/.cloud-session-setup-complete` stamp does not match the current
install inputs: the `pnpm-lock.yaml` digest, the configuration that shapes the
tree (`.npmrc`'s `public-hoist-pattern` entries and `pnpm-workspace.yaml`'s
`onlyBuiltDependencies`, either of which can move without the lockfile moving),
the pnpm that actually ran the install, and the `packageManager` pin. Recording
the running pnpm rather than the pin keeps the stamp honest when the two differ,
so correcting a drifted environment reinstalls instead of certifying a tree the
pinned version never built. A partial tree from a failed install and a resumed
session whose lockfile, install configuration, pnpm, or pin moved are all
reinstalled rather than mistaken for a finished install. The stamp is cleared
before pnpm runs and rewritten only on success, so an install that dies partway
through cannot leave an older revision's stamp standing over the tree it
changed. A failed install prints its last log lines to stdout, where the session
can see them. Local sessions exit the script immediately.

The cloud environment's setup script is a separate file. It is configured per
environment at claude.ai/code, not in this repository. It runs as root before
the repository is cloned, so it must not read repository files, and it must
exit 0 or the session fails to start. Keep it to VM provisioning, such as
Foundry and the Trunk launcher. Install tools into a shared path such as
`/opt`, then symlink them into `/usr/local/bin`: the environment cache keeps
files but not an exported `PATH`, and the session user cannot read `/root`.
The session's Custom network allowlist is configured in the same place and is
just as invisible from the tree; the entries this repository needs are
tabulated under the Trunk runtimes below.

Cloud sessions gate GitHub by _repository_, not by host, and the gate is far
wider than a tarball path: the proxy fronts `github.com` as if it were the
GitHub _API_, so ordinary web URLs are intercepted too. A request for a
repository outside the session's scope is answered by the proxy itself with HTTP
403 and the body `GitHub access to this repository is not enabled for this
session`. That covers `codeload.github.com` tarballs, but equally
`github.com/vercel/next.js`, `github.com/pnpm/pnpm/issues/13567`, and even
`github.com/features/actions`, which the gateway parses as an owner/repo pair. An
in-scope repository is not exempt either: a request for
`github.com/mento-protocol/frontend-monorepo/actions/runs/<id>` returns a
_different_ 403 — `This GitHub API path is not available: sessions are bound to
their configured repositories` — because it is not a repository-scoped API
endpoint. The network allowlist cannot lift any of this: `github.com` is on the
allowlist and is still intercepted.

Exactly two paths pass through, and every workaround below rests on them. The
git protocol is not intercepted, so anonymous `git clone` and `git ls-remote` of
any public repository succeed. And GitHub **release assets** under
`releases/download/` are served normally, which several hermetic runtimes rely
on.

This used to break `pnpm install` outright. The catalog pinned
`@metamask/jazzicon` to `github:jmrossy/jazzicon#<sha>`, which pnpm resolves to
a `codeload.github.com` tarball, so every cloud session died mid-install and
left an unusable `node_modules`. That fork is now vendored at
`packages/jazzicon` and consumed as a `workspace:*` dependency, so the install
needs no GitHub fetch at all. See
[packages/jazzicon/README.md](packages/jazzicon/README.md) for provenance and
the rejected alternatives. Its upstream `.js` files are kept byte-for-byte and
are excluded from Trunk in `.trunk/trunk.yaml`; do not reformat them.

One consequence of the same gating affects Trunk: **`trunk check` and `trunk fmt`
do not work out of the box in a cloud session,** because Trunk fetches its plugin
bundle from `https://github.com/trunk-io/plugins/archive/<ref>.zip` and that is
refused with the repository-scope 403, so the CLI exits before linting anything.

Adding `trunk-io/plugins` to the session's GitHub repository scope is **not** the
way out, despite being the obvious one: `add_repo` refuses it with `cross-tier
adds are not supported in v1`, because a session may hold repositories from only
one owner and `trunk-io` is not `mento-protocol`. No allowlist entry or admin
setting lifts that.

What works is the git protocol, which the gateway passes through: clone the same
bundle, then point Trunk at the checkout with a `.trunk/user.yaml`.
[scripts/cloud-session-setup.sh](scripts/cloud-session-setup.sh) does both on
`SessionStart`, so **Trunk needs no manual step in a cloud session.** The rest of
this section is what that file does and why, for when it needs changing. It
writes:

```yaml
# generated by scripts/cloud-session-setup.sh
version: 0.1
plugins:
  sources:
    - id: trunk
      local: /tmp/trunk-plugins-v1.7.3
actions:
  disabled:
    - trunk-check-all-pre-push
```

`user.yaml` rather than `.trunk/trunk.yaml`, the other file that can carry a
plugin source: `.trunk/.gitignore` already ignores `user.yaml`, so the override
leaves the tree clean and cannot be committed by accident. A `user.yaml` without
the generated marker line is left alone, so a hand-written override survives.

`local` is Trunk's field for an on-disk plugin repository, and it takes
precedence over `uri` and `ref`. Two consequences are worth knowing. The pinned
`ref` is ignored once `local` is set, so the checkout alone decides which plugin
version you get — which is why the script reads the ref out of `.trunk/trunk.yaml`
instead of hardcoding one, and keys the clone path on it so a moved pin re-clones
rather than reusing the bundle before it. And `local` reads `plugin.yaml` from the
working tree, so the clone must be an ordinary checkout: a `--bare` one fails with
`plugin load failed; expected plugin.yaml to be present`.

The same generated file disables `trunk-check-all-pre-push`, which matters more
than it looks. The repository enables that action, so `git push` runs
`trunk check --all` — which cannot pass here (see below). Before this was
automatic, running Trunk armed a push-blocker and that was the fastest way to
wedge a session: several minutes of linting, then `✖ Push blocked by git hook
'trunk-check-all-pre-push'`.

Two things about the hook are still worth knowing, because they mislead. Trunk
does not write into `.git/hooks`, so an empty `.git/hooks` proves nothing: it
sets `core.hooksPath` in `.git/config` to a directory under `~/.cache/trunk`
holding `pre-push`, `pre-commit`, and `commit-msg`. And **any** successful
`trunk` invocation arms it, including a single-file `trunk check README.md`, with
every later invocation re-arming it — so `git config --unset core.hooksPath` is a
one-shot escape that the next Trunk run undoes, which is why the action is
disabled in configuration instead.

The pre-push actions that can pass here stay enabled, so a push is still gated on
real checks rather than on nothing: `check-types-pre-push`, `check-knip-pre-push`,
and `adr-reminder-pre-push`. Budget a couple of minutes for a push, most of it
`check-types`.

Disabling the first blocker exposed a second one, worth knowing if you add an
action. Trunk runs git hooks without the workspace's `node_modules/.bin` on
`PATH`, so an action invoking a bare workspace binary is not found and the action
fails closed — blocking the push it was meant to gate. `check-types-pre-push` ran
`turbo run check-types` and died with `turbo: command not found`; it now goes
through `pnpm exec`, like every other action in `.trunk/trunk.yaml`. Invoke
workspace tooling through `pnpm` in an action's `run`, never directly.

The hermetic runtimes in `.trunk/trunk.yaml` then need to be downloadable, which
is a _network allowlist_ question rather than a repository-scope one. The two
failures look different and should not be confused: an allowlist refusal appears
as `CONNECT tunnel failed, response 403` with no HTTP body, whereas the
repository gate returns a real body naming the session's scope. Of the three
enabled runtimes, only `go` ever needed an allowlist entry:

| Runtime         | Downloads from                                            | Notes                                                                                                                                                       |
| --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node@22.16.0`  | `nodejs.org`                                              | Reachable by default.                                                                                                                                       |
| `go@1.21.0`     | `golang.org/dl` → `go.dev/dl` → `dl.google.com`           | Two redirects, not one. **`dl.google.com` must be on the allowlist**; it is the final target, so allowlisting `golang.org` or `go.dev` alone is not enough. |
| `python@3.10.8` | `github.com/…/python-build-standalone/releases/download/` | Reachable by default — a release asset, so the GitHub gateway does not apply. `www.python.org` is on the allowlist but Trunk never uses it.                 |

With `dl.google.com` allowlisted and the generated `user.yaml` in place, `trunk
check` runs and passes in a cloud session; both the `go` and `python` runtimes
install normally. Measured from cold caches: a mixed markdown/yaml/shell/mjs/json check
takes about 1m30s including every runtime and linter download, `trunk fmt
--no-fix --all` about 30s over 1172 files, and `trunk check --all` about 2m45s
cold or about 2m15s warm over 1235 files.

The allowlist itself lives with the environment at claude.ai/code, not in this
repository, so a fresh environment starts with none of it and nothing in the
tree will tell you what is missing. The entries this repository needs:

| Entry                                                   | Needed by                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `dl.google.com`                                         | Trunk's `go` runtime                                                     |
| `forno.celo.org`, `rpc.monad.xyz`, `monad.drpc.org`     | the anvil fork suites                                                    |
| `turborepo.dev`                                         | the `turbo.build` and `turborepo.com` links in the docs                  |
| `getfoundry.sh`                                         | the `book.getfoundry.sh` link — the apex, which `*.getfoundry.sh` misses |
| `notion.com`                                            | the `www.notion.so` link — Notion rebranded onto another TLD             |
| `www.typescriptlang.org`, `www.conventionalcommits.org` | the remaining documentation links                                        |

One entry is deliberately absent: `cdn.playwright.dev`. Without it a session
cannot download the browser revision the workspace pins, which is why the
`SessionStart` hook aliases the shipped build instead. Add it if you need a
locally installed browser that genuinely matches the pin.

The last four rows exist only to keep `markdown-link-check` honest. Two of them
are the plain hosts the links name, but `turborepo.dev`, `getfoundry.sh`, and
`notion.com` are not written in any document: each is where a documented URL
_redirects_ to, and the linter follows the redirect. So **allowlist the final
host in the chain, not the one written in the markdown** — it may be a different
subdomain, the bare apex (a wildcard does not cover the apex it sits under), or
an entirely different domain.

Editing the allowlist takes effect in sessions that are already running; there
is no need to start a new one to pick up an entry.

`trunk check --all` is therefore fast enough to be practical, but it **cannot
pass in a cloud session** — not because of anything in the repo, but because two
of the enabled linters depend on network the session does not have:

- **`markdown-link-check`** cannot verify a `github.com` link, and 15 of this
  repository's markdown links are GitHub links. Each returns the repository-gate
  403 described above, whether or not the link is good, so none of it is
  evidence of a broken link. That 15 is the floor: with the allowlist entries
  above in place, every _non_-GitHub external link passes. On any other host,
  read the status before concluding: a 403 is the proxy answering — an allowlist
  refusal or the repository gate — and usually means a missing entry for the
  final host in a redirect chain. Any other status came from the origin, so a
  404 on a link this change adds is a real broken link, not an artifact.
- **`trufflehog`** reports pinned GitHub Action SHAs and placeholder commit SHAs
  in test fixtures as verified secrets. Trunk runs it with `--only-verified`, and
  verification is precisely what should rule these out — but the proxy
  authenticates GitHub API calls on the session's behalf (`api.github.com/user`
  returns 200 with no `Authorization` header at all), so every 40-hex candidate
  verifies.

Skip exactly those two and the repository is clean — 1235 files, no issues:

```bash
trunk check --all --filter=-markdown-link-check,-trufflehog
```

That command is an iteration loop, not a substitute for the real gate: it
disables both linters wholesale, including the parts of them that work fine here
and that do catch real problems. Use it while iterating, then triage an
unfiltered run before pushing. The cloud-session artifacts are distinguishable
from genuine findings by their signature:

- A `markdown-link-check/403` means the request never reached the origin, so on
  its own it proves nothing: either the host is off the allowlist, or the GitHub
  gateway answered first. On a link that was already in the tree, treat it as a
  known-baseline artifact. On a link this change **adds or edits**, it is simply
  unverified — a typo under an out-of-scope repository returns exactly the same
  403 as a working URL — so confirm that link outside the cloud session, or let
  CI's full-network run confirm it for you.
- A **`markdown-link-check/400` is a broken relative link**: the file it points
  at does not exist. Relative links need no network and are validated correctly
  in a cloud session, so a 400 is always real and must be fixed.
- `trufflehog/Github` verification fails in one direction only here: the proxy
  makes candidates verify that should not, and never the reverse. So a hit is
  never cleared by the tool and every one is triaged by reading the flagged line.
  A 40-hex string that is a pinned action SHA, a placeholder SHA in a fixture, or
  an upstream commit referenced by a documentation link is a known non-secret.
  Anything you cannot account for that way is treated as a real credential until
  it is checked outside the session. Never dismiss a secret-scanner finding you
  have not looked at, and never disable a scanner to obtain a green run —
  `.trunk/trunk.yaml` holds that same rule for the vendored files.

If Trunk is unavailable anyway — the `SessionStart` hook did not run, or its
clone of the plugin bundle failed and said so — use the underlying tools
directly, scoped to the files you changed: `pnpm exec prettier --check <files>`
and `pnpm exec eslint <files>`, and rely on CI for the full Trunk run. Repo-wide invocations are not equivalent
to Trunk: Trunk applies the ignore list in `.trunk/trunk.yaml` and pins its own
prettier (3.7.4, against the workspace's 3.9.6), so a bare `pnpm exec prettier
--check .` reports pre-existing differences in generated and unrelated files.
`pnpm exec eslint .` is clean repo-wide.

Everything else in the ordinary dev loop works unmodified: `pnpm check-types`,
`pnpm knip`, `pnpm adr:check`, `pnpm test:ci:workspaces`, every `*:test`
script, every `*:check` script including `format:check` (which runs
`@trunkio/launcher`, so it depends on the plugin source above), and a real
`pnpm exec turbo run build --filter app.mento.org`
(create `apps/app.mento.org/.env.local` from `.env.example` first; the values
need only be syntactically valid). Three cloud-specific gotchas are worth
knowing:

- **`pnpm test:ci:vercel` and Node's own warnings.** The environment sets
  `NODE_USE_ENV_PROXY=1`, so every Node process prints an experimental
  `EnvHttpProxyAgent` warning to stderr. Any test that asserts a spawned
  process's stderr exactly will fail on that warning alone, with a diff whose
  only difference is the warning. Such a test sets `NODE_NO_WARNINGS: "1"` on
  the child (see `scripts/vercel-main-release-cli.test.mjs`); prefer that over
  running the shard with the variable unset, which only hides the problem.
- **Playwright browsers are aliased for you.** The image ships one chromium
  build under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, and the Playwright the
  workspace installs wants a newer revision, so `launch()` used to fail with
  `Executable doesn't exist`.
  [scripts/cloud-session-setup.sh](scripts/cloud-session-setup.sh) now symlinks
  every wanted revision onto the shipped build, so suites run unmodified and need
  no `executablePath` and no `PLAYWRIGHT_BROWSERS_PATH` override.

  **The alias is an approximation, not the pinned browser.** It makes the shipped
  build answer at the wanted revision's path; the binary is still the older one.
  Treat it as good enough to run and debug a suite, and never as evidence about
  pixel output or about behaviour that depends on the browser revision. This does
  not weaken CI: every Playwright job in `visual.yml` and `e2e.yml` runs inside
  the pinned `mcr.microsoft.com/playwright:v1.62.1-noble` container, so Argos
  baselines and the fork E2E suites never see the approximation. A local pixel
  diff against an Argos baseline is therefore not a regression on its own.

  Installing the true revision would be better, and the hook defers to it: an
  existing revision directory is never shadowed, so the real build wins as soon as
  there is one. Today there cannot be — `npx playwright install` is refused with
  `no rule or allowlist entry allows host "cdn.playwright.dev"`. Adding that host
  to the session allowlist is what would fix this properly; until then do **not**
  run `playwright install` expecting it to work.

  Two more things if it ever stops working: more than one revision can be wanted
  at once, because workspaces pin different Playwright versions (the apps are on
  1.62.1, wanting 1234, while the root catalog resolves 1.61.1, wanting 1228, and
  both get aliased); and `launch()` naming a path under a revision that does not
  exist means the alias was not built — check `ls /opt/pw-browsers` against the
  `revision` fields in
  `node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json`.

- **The anvil fork suites do run here.** Foundry is installed and
  `forno.celo.org`, `rpc.monad.xyz`, and `monad.drpc.org` are all reachable, so
  `pnpm fork:mainnet` + `pnpm fork:seed` +
  `pnpm --filter app.mento.org test:connected` completes green, given the
  Playwright shim above and a build carrying `NEXT_PUBLIC_E2E_TEST=true
NEXT_PUBLIC_USE_FORK=true`. The first seed takes several minutes; later ones
  are quick, and oracle reports go stale in 360s, so re-seed immediately before
  the suite rather than before the build.

## Visual Regression Testing

Two layers guard against unintended UI changes:

- **DOM/aria snapshots** (`@mento-protocol/ui`) — run inside the normal `pnpm test` step. After an _intended_ component change, re-record baselines with `pnpm --filter @mento-protocol/ui exec vitest run -u`.
- **Pixel VRT** (`ui.mento.org` showcase and `app.mento.org` disconnected shells) — Playwright + Argos, in CI via `.github/workflows/visual.yml` (pinned Playwright Docker image; baselines live in Argos, not git).
  On pull requests, the workflow plans from changed files and only runs the app
  checks whose rendered surfaces can be affected: `apps/ui.mento.org/**` and
  `packages/ui/**` run the showcase; `apps/app.mento.org/**`,
  `packages/ui/**`, `packages/web3/**`, and `packages/jazzicon/**` run the app
  shells; and root package,
  workflow, `.npmrc`, `turbo.json`, `patches/**`, and
  `scripts/security-headers.mjs` changes run both. On `main`, the push trigger
  uses that union of visual-impact paths and every started run executes both
  suites, so a workflow-level success can safely recover its managed CI failure
  issue. `apps/reserve.mento.org/**`-only changes do not start the visual
  workflow because reserve has no pixel VRT suite yet. Run locally:

  ```bash
  pnpm exec turbo run build --filter ui.mento.org  # build the showcase
  pnpm --filter ui.mento.org test:visual
  pnpm exec turbo run build --filter app.mento.org # build the app shells first
  pnpm --filter app.mento.org test:visual
  ```

  An intended UI change shows as a diff in the Argos dashboard — approve it there to promote the baseline. Requires the `ARGOS_TOKEN` secret + the Argos GitHub App. `ui.mento.org` needs `NEXT_PUBLIC_STORAGE_URL` (CI uses `vars.STORAGE_URL`; locally use `apps/ui.mento.org/.env.local`). `app.mento.org` needs the client env vars from `apps/app.mento.org/.env.example`; for local screenshot renders, `NEXT_PUBLIC_SENTRY_DSN_SWAP` may be an empty string and `SENTRY_AUTH_TOKEN` may be omitted.

  If CI shows all Playwright visual tests passing and then Argos fails with HTTP 402 or a screenshot-capacity error, classify it as an Argos account or billing failure rather than a visual regression. Report the pass counts and do not disable VRT or change baselines for that failure.

## Wallet-Connected Testing (local fork)

To test connected-wallet flows (swaps, approvals, locking) locally without a real wallet:

1. `pnpm fork:mainnet` — anvil fork of Celo mainnet on port 8545 (Foundry >= 1.4)
2. `pnpm fork:seed` — select a safe FX-open timestamp, fund test accounts, and refresh oracle rates (re-run after `evm_revert` or when quotes stall)
3. `NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run dev --filter app.mento.org`, then connect the "E2E Test Wallet" (first run: copy `apps/app.mento.org/.env.example` to `.env.local` and fill it — the env schema fails startup otherwise; `CHAINALYSIS_API_KEY` needs a real key, the Sentry vars may stay empty — see the runbook's prerequisites). For governance flows (lock/voting power), start `governance.mento.org` (port 3002) the same way.

For Monad (chain 143) instead of Celo, use `pnpm fork:monad` + `pnpm fork:seed:monad` (port 8546), and dev/build with `NEXT_PUBLIC_MONAD_RPC_URL=http://localhost:8546` in place of `NEXT_PUBLIC_USE_FORK` — Monad has no `--celo`/`USE_FORK` redirect, so that env override is the seam that points both wagmi and the mento-sdk at the fork. Both seed commands use `scripts/fork-test-clock.mjs`. During real FX closures, it advances the fork to the next opening with two hours of runway and preserves that timestamp on the second seed. Monad seed-swap deadlines use the latest fork block time. The mock wallet still connects on Celo, so `/swap/monad` shows a "Switch to Monad" banner you click to move to chain 143.

Full runbook — localStorage activation, on-chain verification with `cast`, snapshot/revert discipline, safety rules, troubleshooting: [docs/wallet-testing.md](docs/wallet-testing.md)

## Connected-Wallet E2E

Functional connected-wallet Playwright specs (not VRT) that run against a seeded local anvil `--celo` fork. Prerequisites, in order: `pnpm fork:mainnet` (anvil fork), `pnpm fork:seed` (seed balances/oracles).

- **app.mento.org** — a swap E2E. Build with `pnpm exec turbo run build --filter app.mento.org` before the first run — the suite starts `next start` via Playwright's webServer. Then run `pnpm --filter app.mento.org test:connected`.
- **app.mento.org on Monad** — a Monad (chain 143) swap E2E against a `pnpm fork:monad` + `pnpm fork:seed:monad` fork (port 8546). Build with `NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_MONAD_RPC_URL=http://localhost:8546 pnpm exec turbo run build --filter app.mento.org`, then run `pnpm --filter app.mento.org test:connected:monad` (its own Playwright project + spec, so the Celo `test:connected` job never needs the 8546 fork). The spec drives the "Switch to Monad" banner before swapping.
- **governance.mento.org** — a create-lock E2E (approve MENTO → lock, two-step, single click). Build with `NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run build --filter governance.mento.org` (copy `apps/governance.mento.org/.env.example` to `.env.local` first — values don't need to be real, but URL-typed vars must be syntactically valid). Then run `pnpm --filter governance.mento.org test:connected`. No vote-casting spec yet (needs an active proposal + subgraph/snapshot orchestration; tracked as future work in #441). Lock/proposal LISTS render from a live subgraph, not the fork, so assertions are on-chain (via the rpc helper) and toast-only, never via the lock list.

See [docs/wallet-testing.md](docs/wallet-testing.md) for the full runbook.

In CI, `.github/workflows/e2e.yml` triggers on every PR (plus the nightly schedule and manual `workflow_dispatch`) and always reports both check runs. An `e2e-plan` job computes `run_app`/`run_gov`/`run_monad` from changed files (`apps/app.mento.org/**` -> `run_app` + `run_monad`; `apps/governance.mento.org/**` -> `run_gov`; `packages/web3/**`, `packages/ui/**`, `packages/jazzicon/**`, and `scripts/fork-test-clock.*` -> all three; `scripts/fork-seed-monad.*` -> `run_monad`; root-level files like `package.json`/`turbo.json`/the workflow itself -> all three) and fast-no-ops the fork jobs to a green skip when their surface didn't change — that "always reports" property is the prerequisite for eventually adding these checks to the required-checks ruleset (`strict_required_status_checks_policy` would otherwise deadlock non-matching PRs). Scheduled and manually-dispatched runs force both outputs true (no "changed files" concept for a cron trigger, and a manual run's point is to run regardless of what changed). A cheap `fork-seed-self-test` job (no anvil, no network) runs the shared clock boundaries and both encoder suites on every trigger; if it fails, the fork jobs still start (so the failure surfaces as a real check failure, not a silently-passing skip) but bail out in their first step instead of running the full 30-minute anvil suite. `e2e-connected` ("Connected swap (anvil fork)") and `e2e-governance` ("Connected governance (anvil fork)") both fork Celo mainnet pinned to `FORK_BLOCK` (bump roughly monthly). The fork source is a keyless public archive RPC probed at run time — forno cannot serve pinned-block forks because it prunes a block's state within minutes. A nightly scheduled run (04:20 UTC) repeats the suites at a freshly resolved recent block instead of the pin, to catch chain drift (oracle config, pool, or contract changes) that plan-gated PR runs never see. `e2e-connected-monad` ("Connected swap (Monad anvil fork)") is the Monad sibling: it forks Monad mainnet (chain 143) on port 8546 via `scripts/fork-seed-monad.mjs`, gated on `run_monad`. Unlike the Celo jobs it resolves a fresh block near `finalized` on every trigger (rpc.monad.xyz primary, monad.drpc.org fallback) rather than pinning, because Monad's public RPCs' deep archive retention is unproven while forking near finalized is the verified-servable window. Before oracle reports or swaps, both seed scripts use the shared UTC calendar to select a timestamp that stays FX-open for two hours. None of these checks is a required check yet.

All preview verification lives in the secretless reusable
`.github/workflows/_vercel-preview-smoke.yml`: common immutable-URL, metadata,
header, asset, console, and browser checks plus target-specific App/Governance
wallet flow, Reserve tab/data interaction, or UI deployment-identity flow. The
`.github/workflows/preview-smoke.yml` adapter calls that reusable
workflow only for exact native Vercel App/Governance successes created during
a bounded target-local rollback; it performs no status lookup or reuse and
receives no deployment credential. Ordinary previews for all four targets are
GitHub-owned and do not use this adapter. This adapter exists only for
documented App and Governance target-local preview rollback proof. A
target-local `main` rollback does not change preview
ownership, and a target-local preview rollback uses native-preview/GitHub-main
branch rules so it does not change main ownership. GitHub-built workers call the reusable
workflow directly because a `GITHUB_TOKEN` Deployment status is evidence, not
a downstream trigger contract. The automatic exact-SHA controller, bootstrap,
canary, cutover, and rollback contract is in `docs/vercel-deployments.md`.

## CI failure notifications

A failing `main`, scheduled, or release-tag run of a watched operational
workflow reaches two places. `.github/workflows/ci-failure-notifier.yml` opens
or updates one managed GitHub issue per partition and closes it after recovery.
`.github/workflows/notify-slack-on-main-failure.yml` posts the same failure to
Slack's `#ci-failures` with links to the run and to the managed issue. It waits
15 minutes and suppresses a recovered failure after the wait. Every sustained
failure otherwise posts. Both watch the same static workflow
allowlist and use the same target-ref, run-order, decisive-conclusion, and
repository-ownership rules. Therefore,
adding or renaming an operational workflow means updating both lists and
`scripts/quality-workflows.test.mjs` in the same PR. Run the Slack workflow's
bare `workflow_dispatch` from the Actions tab to smoke-test the wiring; it
posts a fixed "🧪 wiring test" message and changes nothing else. Only the
default-branch copy can post: every event is gated on `github.ref`, and the job
runs in the `main`-only `slack-ci-notifications` environment.
`docs/quality-budgets.md` records why that is hardening rather than a complete
control while `SLACK_BOT_TOKEN` remains org-shared. Vercel alerts label the
nested workflow's `head_sha` as the controller commit.

## Dependabot preparation

Use [the preparation playbook](docs/dependabot-automation.md) and
`.github/dependabot-prep-policy.json` from the live default branch. The
`trusted-openclaw-agent` workflow uses the ordinary coding session and existing
GitHub authentication; its prohibitions are procedural, not a credential sandbox.
Use the portable `dependabot-prep` skill, revision `trusted-agent-v1`, with that
playbook's repository overrides in OpenClaw, Codex or Claude. The historical
execution-model identifier remains for compatibility. Never invoke the retired
`/opt/dependabot-prep` launcher or the archived sealed skill procedure.

Within the playbook's scope, normal installs, lockfile generation, builds, tests,
conflict resolution, and dependency-related compatibility fixes are permitted.
Majors, red CI, and documented runtime coupling are work to attempt, not automatic
exclusions. Never weaken security or validation to obtain a green result.
Never approve, dismiss reviews, merge, close, alter auto-merge, or resolve or
unresolve review threads. Publish only fast-forward updates to the authenticated
existing PR branch. Human approval, thread resolution, and merge remain separate.

The weekly OpenClaw job stays disabled until this policy is merged, a supervised
preparation succeeds, and the operator separately confirms activation. Its
reviewed entry prompt is `scripts/prompts/dependabot-weekly.md`. Never run the
legacy launcher and the ordinary workflow concurrently. Follow the playbook's
single-batch lock, recovery, budgets, progress, exact-head verification, and
research requirements.

Dependabot CI remains secretless. Do not admit these PRs to credentialed Vercel
Preview workers or broaden the existing author/sender rules.

The automatic `.github/workflows/vercel-main-deployment.yml` path starts when
the exact `CI/CD` push run for `main` is requested and runs read-only planning
and release preparation concurrently with CI. A separate credential-free
`Require the exact successful CI attempt` gate job must succeed before candidate
uploads, activation, and recovery. Inherited restoration is bound by the same
`require-success` check invoked in-job, before any credentialed or mutating
step, rather than by a `needs` edge on that gate job. A later `completed`
delivery for a successful CI attempt deploys with full
terminal verification
unless a deployment run for that exact upstream attempt both passed the gate and
concluded `success`, so a run that failed after the gate is taken over rather
than deduplicated away; a failed CI attempt's `completed` delivery is never
admitted. Its global mode is
`active`, and the current per-target `mainOwnershipMode` map assigns App,
Governance, Reserve, and UI to `github`. Planning emits
`vercel-main-plan:v2`: all selected targets stage or build, `activeTargets`
mutate public mappings, and `shadowTargets` prove the same candidates without
public mutation. Governance, Reserve, UI, and App all stage and promote exact
staged deployments; App's `stage-app` build and upload work exactly like the
other three. App promotes last and is verified at `candidate`, exactly like
every other target: `promote` and `ordinary_rollback` are the only operation
types, and there is no bridge alias and no custom `v3` environment. Planning
uses the SHA each public target actually serves, and every credential-bearing job
uses only `vercel-cli-production` with `deployment: false`. The exact-attempt
gate, repeated freshness checks, durable journal, active duplicate census,
canonical redacted evidence, public runtime smoke, App real-wallet check,
target-local main rollback, and separate full-native restoration procedures
are in `docs/vercel-deployments.md`. Ordinary previews remain GitHub-owned
during either rollback procedure. The removed Governance QA environment is not
part of the deployment topology.

Active-main release identity is stable across downstream reruns: it binds
repository, exact SHA, and validated upstream CI run ID; target-specific
candidate identity adds the target. The provider-side stable release manifest
is the sole durable cross-attempt authority. Mutation transaction IDs and
journals remain downstream run-and-attempt scoped. Before planning, a later
attempt reconciles provider mappings and candidates with that manifest. It
reuses a completed release, resumes or restores an interrupted forward prefix
as appropriate, or restores the exact terminal App recovery residual through a
fresh current-attempt journal before new planning. That residual requires at
least one active non-App target, every active non-App target at its original
prior, and every reviewed App alias at either its captured prior or one
manifest-bound candidate, with at least one alias at the candidate; it grants
App restoration authority only and never forward resumption. It never resumes
a prior journal or treats GitHub artifacts as cross-attempt authority. The compact
terminal receipt and evidence are the only final-verdict handoff and support
final-only reruns. A completed release emits `current-release-verified` only
after fresh mapping, census/state, raw public-runtime-smoke, and
freshness proof; it creates no journal and executes no public mutation. In the
automatic pipeline's shadow mode, App preparation is build-only terminal
evidence and creates no provider deployment. Every other non-prefix, ambiguous,
conflicting, or incomplete provider state fails closed before production work
continues.

## Coding Conventions

- **Naming:** PascalCase for components, camelCase for variables/functions
- **No acronyms:** Use `errorMessage` not `errMsg`, `button` not `btn`, `authentication` not `auth`
- **No `any` type:** Use specific types, or `unknown` in the worst case
- **Components:** Use `@mento-protocol/ui` components (Radix UI primitives via shadcn/ui-style components); standard `onClick` handlers.
- **Block explorer links:** Use `AddressLink` and `TransactionLink` components
- **Dependencies:** Never add new npm dependencies without explicit approval
- **Commits:** Conventional Commits enforced by commitlint (`feat|fix|docs|chore(scope): message`)

## Audit Team

When the user says **"Spin up the audit team"** (or similar: "start the audit", "run the audit agents", "launch audit team"):

1. Read the full agent specifications from the `audit-team.md` file in your auto-memory directory
2. Launch **Tier 1 agents (1-4) in parallel** using the Agent tool with `subagent_type: "general-purpose"`
3. Each agent should **read files, analyze, and produce a findings report** with severity ratings
4. After Tier 1 completes, launch **Tier 2 (Agent 5)** which consumes all Tier 1 findings and produces a consolidated report
5. Present the consolidated findings and ask the user which issues to fix

The audit covers three codebases:

- `apps/app.mento.org` — Main DeFi app
- `packages/web3` — Shared web3 hooks and transaction logic
- `../mento-sdk` — Mento protocol SDK (external, relative to monorepo root)

The SDK repo is external at `../mento-sdk` — agents auditing it should read but NOT modify files there unless explicitly told to.

Before auditing `../mento-sdk`, check whether it is current. If it is stale, report that to the user; do not pull or otherwise mutate the SDK checkout unless explicitly told to.
