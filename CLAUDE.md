# Mento Frontend Monorepo

## Overview

Monorepo for Mento Protocol frontend applications (DeFi on Celo blockchain).

### Apps

- **app.mento.org** — Main swap/exchange app (port 3000)
- **reserve.mento.org** — Reserve dashboard (port 3001)
- **governance.mento.org** — Governance interface (port 3002)
- **ui.mento.org** — Component library showcase (port 3003)

### Shared Packages

- **@repo/ui** — Component library (Radix UI + Tailwind, built with tsup)
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
- **Testing:** Vitest (app.mento.org, @repo/web3, @repo/ui)
- **Monitoring:** Sentry
- **Deployment:** Vercel

## Essential Commands

```bash
pnpm install                          # Install dependencies
pnpm exec turbo run dev --filter <app-name>    # Dev server for one app (use package.json name)
pnpm build                           # Build all
pnpm exec turbo run build --filter <app-name>  # Build one app
pnpm check-types                     # TypeScript type checking
trunk check --fix                     # Lint with autofix
trunk fmt                             # Format
pnpm test                            # Run tests
pnpm fork:mainnet                    # Local anvil fork of Celo mainnet (--celo --auto-impersonate)
pnpm fork:seed                       # Fund fork accounts + re-report oracle prices (idempotent)
```

Always use `--filter` to avoid building/running everything unnecessarily.

## After Making Changes

1. Run `pnpm check-types` — confirm types pass
2. Run `trunk check --fix` — confirm linting passes
3. Verify changes visually on localhost (check the app's package.json `dev` script for the port)

## Visual Regression Testing

Two layers guard against unintended UI changes:

- **DOM/aria snapshots** (`@repo/ui`) — run inside the normal `pnpm test` step. After an _intended_ component change, re-record baselines with `pnpm --filter @repo/ui exec vitest run -u`.
- **Pixel VRT** (`ui.mento.org` showcase and `app.mento.org` disconnected shells) — Playwright + Argos, in CI via `.github/workflows/visual.yml` (pinned Playwright Docker image; baselines live in Argos, not git).
  The workflow plans from changed files and only runs the app checks whose
  rendered surfaces can be affected: `apps/ui.mento.org/**` and `packages/ui/**`
  run the showcase; `apps/app.mento.org/**`, `packages/ui/**`, and
  `packages/web3/**` run the app shells; and root package, workflow, `.npmrc`,
  `turbo.json`, `patches/**`, and `scripts/security-headers.mjs` changes run
  both. `apps/reserve.mento.org/**`-only changes skip the current Argos jobs
  because reserve has no pixel VRT suite yet. Run locally:

  ```bash
  pnpm exec turbo run build --filter ui.mento.org  # build the showcase
  pnpm --filter ui.mento.org test:visual
  pnpm exec turbo run build --filter app.mento.org # build the app shells first
  pnpm --filter app.mento.org test:visual
  ```

  An intended UI change shows as a diff in the Argos dashboard — approve it there to promote the baseline. Requires the `ARGOS_TOKEN` secret + the Argos GitHub App. `ui.mento.org` needs `NEXT_PUBLIC_STORAGE_URL` (CI uses `vars.STORAGE_URL`; locally use `apps/ui.mento.org/.env.local`). `app.mento.org` needs the env vars from `apps/app.mento.org/.env.example`; for local screenshot renders, `NEXT_PUBLIC_SENTRY_DSN_SWAP` and `SENTRY_AUTH_TOKEN` may be empty strings.

  If CI shows all Playwright visual tests passing and then Argos fails with HTTP 402 / Free Plan screenshot capacity, classify it as Argos account quota rather than a visual regression. Report the pass counts and do not disable VRT or change baselines for that failure.

## Wallet-Connected Testing (local fork)

To test connected-wallet flows (swaps, approvals, locking) locally without a real wallet:

1. `pnpm fork:mainnet` — anvil fork of Celo mainnet on port 8545 (Foundry >= 1.4)
2. `pnpm fork:seed` — fund test accounts + refresh oracle rates (re-run after `evm_revert` or when quotes stall)
3. `NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run dev --filter app.mento.org`, then connect the "E2E Test Wallet" (requires `CHAINALYSIS_API_KEY` in `apps/app.mento.org/.env.local`)

Full runbook — localStorage activation, on-chain verification with `cast`, snapshot/revert discipline, safety rules, troubleshooting: [docs/wallet-testing.md](docs/wallet-testing.md)

## Connected-Wallet E2E

Functional connected-wallet Playwright specs (not VRT) that run against a seeded local anvil `--celo` fork. Prerequisites, in order: `pnpm fork:mainnet` (anvil fork), `pnpm fork:seed` (seed balances/oracles).

- **app.mento.org** — a swap E2E. Build with `pnpm exec turbo run build --filter app.mento.org` before the first run — the suite starts `next start` via Playwright's webServer. Then run `pnpm --filter app.mento.org test:connected`.
- **governance.mento.org** — a create-lock E2E (approve MENTO → lock, two-step, single click). Build with `NEXT_PUBLIC_E2E_TEST=true NEXT_PUBLIC_USE_FORK=true pnpm exec turbo run build --filter governance.mento.org` (copy `apps/governance.mento.org/.env.example` to `.env.local` first — values don't need to be real, but URL-typed vars must be syntactically valid). Then run `pnpm --filter governance.mento.org test:connected`. No vote-casting spec yet (needs an active proposal + subgraph/snapshot orchestration; tracked as future work in #441). Lock/proposal LISTS render from a live subgraph, not the fork, so assertions are on-chain (via the rpc helper) and toast-only, never via the lock list.

See [docs/wallet-testing.md](docs/wallet-testing.md) for the full runbook.

In CI, `.github/workflows/e2e.yml` runs the same suite on PRs touching `apps/app.mento.org/**`, `packages/web3/**`, `scripts/fork-seed.mjs`, or the workflow itself (plus manual `workflow_dispatch`), against an anvil fork pinned to `FORK_BLOCK` (bump roughly monthly). The fork source is a keyless public archive RPC probed at run time — forno cannot serve pinned-block forks because it prunes a block's state within minutes. The workflow is intentionally not a required check yet.

## Coding Conventions

- **Naming:** PascalCase for components, camelCase for variables/functions
- **No acronyms:** Use `errorMessage` not `errMsg`, `button` not `btn`, `authentication` not `auth`
- **No `any` type:** Use specific types, or `unknown` in the worst case
- **Components:** Use `@repo/ui` components (Radix UI primitives via shadcn/ui-style components); standard `onClick` handlers.
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
