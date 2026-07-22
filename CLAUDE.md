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
pnpm ci:change-plan:test             # Test PR scoping, full main pushes, mandatory Trunk, and fail-closed behavior
pnpm adr:check                       # Advisory reminder for new architecture-significant workflows/workspaces
pnpm adr:check:test                  # Test the offline ADR trigger and repository wiring
pnpm vercel:cost:test                # Test redacted Vercel cost normalization and closeout gates
pnpm vercel:cost:analyze --input <private-evidence-manifest.json> --format markdown  # Reconcile raw private #523 evidence into a public-safe report
trunk check --fix                     # Lint with autofix
trunk fmt                             # Format
pnpm test                            # Run tests
pnpm quality:budgets:test            # Unit/structural tests for quality gates + notifier
pnpm quality:coverage                # Enforce measured coverage floors in tested workspaces
pnpm quality:budgets                 # Coverage + production builds + route bundle limits
pnpm fork:mainnet                    # Local anvil fork of Celo mainnet (--celo --auto-impersonate, port 8545)
pnpm fork:seed                       # Fund fork accounts + re-report oracle prices (idempotent)
pnpm fork:monad                      # Local anvil fork of Monad mainnet (chain 143, port 8546; no --celo)
pnpm fork:seed:monad                 # Monad sibling of fork:seed (Reserve collateral + swap-to-seed, idempotent)
pnpm pr:description:test             # Test the required PR-description format validator
pnpm vercel:deployment-state:test    # Test canonical read-only Vercel state and alias-drift evidence
pnpm vercel:primitives:test          # Test affected planning, custom deployment IDs, and build-env contracts
pnpm vercel:workflow:test            # Test the manual prebuilt pilot, REST lifecycle, CLI args, and HTTP/browser smoke
pnpm vercel:preview:test             # Test preview state plus reusable smoke trust, native-adapter, and Git-ownership boundaries
pnpm vercel:production-shadow:test   # Test state allowlisting, shadow helpers, and workflow invariants
pnpm --filter app.mento.org test:production-shadow:routing  # Prove bypass headers do not cross Chromium redirects
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

## Visual Regression Testing

Two layers guard against unintended UI changes:

- **DOM/aria snapshots** (`@mento-protocol/ui`) — run inside the normal `pnpm test` step. After an _intended_ component change, re-record baselines with `pnpm --filter @mento-protocol/ui exec vitest run -u`.
- **Pixel VRT** (`ui.mento.org` showcase and `app.mento.org` disconnected shells) — Playwright + Argos, in CI via `.github/workflows/visual.yml` (pinned Playwright Docker image; baselines live in Argos, not git).
  On pull requests, the workflow plans from changed files and only runs the app
  checks whose rendered surfaces can be affected: `apps/ui.mento.org/**` and
  `packages/ui/**` run the showcase; `apps/app.mento.org/**`,
  `packages/ui/**`, and `packages/web3/**` run the app shells; and root package,
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

  If CI shows all Playwright visual tests passing and then Argos fails with HTTP 402 / Free Plan screenshot capacity, classify it as Argos account quota rather than a visual regression. Report the pass counts and do not disable VRT or change baselines for that failure.

## Wallet-Connected Testing (local fork)

To test connected-wallet flows (swaps, approvals, locking) locally without a real wallet:

1. `pnpm fork:mainnet` — anvil fork of Celo mainnet on port 8545 (Foundry >= 1.4)
2. `pnpm fork:seed` — fund test accounts + refresh oracle rates (re-run after `evm_revert` or when quotes stall)
3. `NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run dev --filter app.mento.org`, then connect the "E2E Test Wallet" (first run: copy `apps/app.mento.org/.env.example` to `.env.local` and fill it — the env schema fails startup otherwise; `CHAINALYSIS_API_KEY` needs a real key, the Sentry vars may stay empty — see the runbook's prerequisites). For governance flows (lock/voting power), start `governance.mento.org` (port 3002) the same way.

For Monad (chain 143) instead of Celo, use `pnpm fork:monad` + `pnpm fork:seed:monad` (port 8546), and dev/build with `NEXT_PUBLIC_MONAD_RPC_URL=http://localhost:8546` in place of `NEXT_PUBLIC_USE_FORK` — Monad has no `--celo`/`USE_FORK` redirect, so that env override is the seam that points both wagmi and the mento-sdk at the fork. The mock wallet still connects on Celo, so `/swap/monad` shows a "Switch to Monad" banner you click to move to chain 143.

Full runbook — localStorage activation, on-chain verification with `cast`, snapshot/revert discipline, safety rules, troubleshooting: [docs/wallet-testing.md](docs/wallet-testing.md)

## Connected-Wallet E2E

Functional connected-wallet Playwright specs (not VRT) that run against a seeded local anvil `--celo` fork. Prerequisites, in order: `pnpm fork:mainnet` (anvil fork), `pnpm fork:seed` (seed balances/oracles).

- **app.mento.org** — a swap E2E. Build with `pnpm exec turbo run build --filter app.mento.org` before the first run — the suite starts `next start` via Playwright's webServer. Then run `pnpm --filter app.mento.org test:connected`.
- **app.mento.org on Monad** — a Monad (chain 143) swap E2E against a `pnpm fork:monad` + `pnpm fork:seed:monad` fork (port 8546). Build with `NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_MONAD_RPC_URL=http://localhost:8546 pnpm exec turbo run build --filter app.mento.org`, then run `pnpm --filter app.mento.org test:connected:monad` (its own Playwright project + spec, so the Celo `test:connected` job never needs the 8546 fork). The spec drives the "Switch to Monad" banner before swapping.
- **governance.mento.org** — a create-lock E2E (approve MENTO → lock, two-step, single click). Build with `NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run build --filter governance.mento.org` (copy `apps/governance.mento.org/.env.example` to `.env.local` first — values don't need to be real, but URL-typed vars must be syntactically valid). Then run `pnpm --filter governance.mento.org test:connected`. No vote-casting spec yet (needs an active proposal + subgraph/snapshot orchestration; tracked as future work in #441). Lock/proposal LISTS render from a live subgraph, not the fork, so assertions are on-chain (via the rpc helper) and toast-only, never via the lock list.

See [docs/wallet-testing.md](docs/wallet-testing.md) for the full runbook.

In CI, `.github/workflows/e2e.yml` triggers on every PR (plus the nightly schedule and manual `workflow_dispatch`) and always reports both check runs. An `e2e-plan` job computes `run_app`/`run_gov`/`run_monad` from changed files (`apps/app.mento.org/**` -> `run_app` + `run_monad`; `apps/governance.mento.org/**` -> `run_gov`; `packages/web3/**` and `packages/ui/**` -> all three; `scripts/fork-seed-monad.*` -> `run_monad`; root-level files like `package.json`/`turbo.json`/the workflow itself -> all three) and fast-no-ops the fork jobs to a green skip when their surface didn't change — that "always reports" property is the prerequisite for eventually adding these checks to the required-checks ruleset (`strict_required_status_checks_policy` would otherwise deadlock non-matching PRs). Scheduled and manually-dispatched runs force both outputs true (no "changed files" concept for a cron trigger, and a manual run's point is to run regardless of what changed). A cheap `fork-seed-self-test` job (no anvil, no network) runs unconditionally on every trigger; if it fails, the fork jobs still start (so the failure surfaces as a real check failure, not a silently-passing skip) but bail out in their first step instead of running the full 30-minute anvil suite. `e2e-connected` ("Connected swap (anvil fork)") and `e2e-governance` ("Connected governance (anvil fork)") both fork Celo mainnet pinned to `FORK_BLOCK` (bump roughly monthly). The fork source is a keyless public archive RPC probed at run time — forno cannot serve pinned-block forks because it prunes a block's state within minutes. A nightly scheduled run (04:20 UTC) repeats the suites at a freshly resolved recent block instead of the pin, to catch chain drift (oracle config, pool, or contract changes) that plan-gated PR runs never see. `e2e-connected-monad` ("Connected swap (Monad anvil fork)") is the Monad sibling: it forks Monad mainnet (chain 143) on port 8546 via `scripts/fork-seed-monad.mjs`, gated on `run_monad`. Unlike the Celo jobs it resolves a fresh block near `finalized` on every trigger (rpc.monad.xyz primary, monad.drpc.org fallback) rather than pinning, because Monad's public RPCs' deep archive retention is unproven while forking near finalized is the verified-servable window. None of these checks is a required check yet.

All preview verification lives in the secretless reusable
`.github/workflows/_vercel-preview-smoke.yml`: common immutable-URL, metadata,
header, asset, console, and browser checks plus target-specific App/Governance
wallet flow, Reserve tab/data interaction, or UI deployment-identity flow. The
temporary `.github/workflows/preview-smoke.yml` adapter calls that reusable
workflow only for exact native Vercel App/Governance successes created during
a bounded target-local rollback; it performs no status lookup or reuse and
receives no deployment credential. Ordinary previews for all four targets are
GitHub-owned and do not use this adapter. The adapter remains temporarily for
rollback proof and is removed only in #523 cleanup, after the #522 production
cutover and required observation period. GitHub-built workers call the reusable
workflow directly because a `GITHUB_TOKEN` Deployment status is evidence, not
a downstream trigger contract. The automatic exact-SHA controller, bootstrap,
canary, cutover, and rollback contract is in `docs/vercel-deployments.md`.

Manual staged production URLs use the separate target-aware
`test:production-shadow` command documented in `docs/vercel-deployments.md`; it
never enables the mock wallet.

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
