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
pnpm dependabot:process -- evaluate --input path/to/snapshot.json --mode observe  # Evaluate a saved Dependabot snapshot
pnpm dependabot:process:test         # Test Dependabot policy, CLI, and trusted-workflow contracts
pnpm adr:check                       # Advisory reminder for new architecture-significant workflows/workspaces
pnpm adr:check:test                  # Test the offline ADR trigger and repository wiring
pnpm vercel:cost:test                # Test private GitHub capture, saved-page census normalization, target-mix analysis, and closeout gates
pnpm vercel:cost:observe -- init --start <UTC> --end <UTC>  # Initialize, or append a later pre-audit end to, the private #523 GitHub interval
pnpm vercel:cost:observe -- capture-preview --pr <number> --event-run-id <id>  # Freeze one preview event from the live journal or its 14-day receipt artifact
pnpm vercel:cost:observe -- capture-main --run-id <id>  # Freeze every attempt, log, and available journal for one main release
pnpm vercel:cost:observe -- sample-github  # Snapshot visibility, runs, runner labels, caches, and artifacts
pnpm vercel:cost:observe -- audit --end <UTC>  # Preflight GitHub evidence; once clean, freeze and emit the incomplete private evidence-join fragment
pnpm vercel:cost:normalize-deployments --input <private-pages-envelope.json> --output <private-dir/census.jsonl> --proof <private-dir/census-proof.json>  # Crash-resumably normalize saved Vercel v7 pages; rerun the exact command after interruption
pnpm vercel:cost:analyze --input <private-evidence-manifest.json> --format markdown  # Reconcile FOCUS project totals only after complete zero-exclusion censuses
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
pnpm vercel:workflow:test            # Test manual and automatic Vercel workflows, exact-main gating, transactions, and smoke
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
rollback proof and is removed only in #523 cleanup after the required
observation period. A target-local `main` rollback does not change preview
ownership, and a target-local preview rollback uses native-preview/GitHub-main
branch rules so it does not change main ownership. GitHub-built workers call the reusable
workflow directly because a `GITHUB_TOKEN` Deployment status is evidence, not
a downstream trigger contract. The automatic exact-SHA controller, bootstrap,
canary, cutover, and rollback contract is in `docs/vercel-deployments.md`.

Manual staged production URLs use the separate target-aware
`test:production-shadow` command documented in `docs/vercel-deployments.md`; it
never enables the mock wallet.

## Dependabot Processing

Dependabot preparation is human-merge-only. The trusted default-branch
`.github/workflows/dependabot-process.yml` controller supports exact
`observe`, `assist`, and `prepare` modes. Empty, legacy `merge`, unknown,
case, and whitespace variants become `observe`. No processor path merges or
enables auto-merge. A maintainer clicks Merge only while the exact head carries
a successful `Dependabot ALL CLEAR` receipt.

`.github/workflows/dependabot-intake.yml` remains the credentialless v1 event
boundary for exact Dependabot-bot senders. A Refresh or Repair successor uses
`.github/workflows/dependabot-prepared-head-intake.yml`, whose strict
`dependabot-prepared-head` repository dispatch accepts only the configured
Prepare App bot ID/login, exact App slug, nine-key payload, and a completed
digest-bound operation check. The compact display title stays within GitHub's
limit. Both intake completions and `Dependabot Claude Review` completions
resume the processor immediately; the schedule reconciles at minutes
`3,13,23,33,43,53`. Do not add `workflow_dispatch` or broaden either
credentialless intake.

The trusted `.github/workflows/dependabot-claude-review.yml` reviewer accepts
both intake receipts. Its no-token first step authenticates the upstream
workflow event, actor, path, repository, and compact title. For a prepared head,
the exact-workflow-SHA `scripts/dependabot-prepared-review.mjs` helper fetches
and validates canonical Refresh/Repair checks, terminal Actions run provenance,
append-only parents, exact Prepare App bot repair commits, and the verified
Dependabot seed. The read-only Claude job checks out only
`github.workflow_sha`. It restricts built-in tools to Bash, denies every MCP
tool, and uses a trusted fail-closed `PreToolUse` guard to authorize one exact
bound repository-scoped `gh pr diff` command per run attempt. `dontAsk` mode
and the guard block every other Bash call. A paired `PostToolUse` guard and a
later no-token assertion require the same successful, complete foreground diff
result. The post-hook seals the original bytes in a
`dependabot-claude-review-tool-completed:v2` receipt, then delivers those exact
bytes as one `text/plain` document tool result, bypassing Claude Code 2.1.220's
30,000-character Bash text-result persistence. Missing, failed, interrupted,
empty, or persisted/truncated output is retry-first. The job never checks out,
caches, installs, downloads, or executes candidate input. The publisher is isolated
from the Claude secret. It writes canonical structured
JSON to the exact-head `claude-review` check: validated `findings` are
deterministic repair input, while an infrastructure or invalid-schema failure is
retry-first. Human PRs continue to report `claude-review-human`.

Mode authority is:

- `observe`: classify and record evidence only;
- `assist`: classify and publish non-authorizing evidence for human handling;
  it cannot issue an automatic repair packet; and
- `prepare`: refresh, apply up to two bounded repairs, re-review, reply to and
  resolve only packet-bound findings, create the ruleset-required processor
  approval, and publish ALL CLEAR. Refreshes do not consume repair attempts.

The preparable tier includes verified npm updates, including grouped and major
updates. Verified non-sensitive GitHub Actions updates may be refreshed and,
when green, prepared, but autonomous repair never writes `.github/**`; a
failure requiring that surface is `manual-repair-required`. This policy is
deliberately separate from the old automatic tier. Sensitive or self-reviewing Actions and
workflow-policy, deployment, authentication, credential, security, or unknown
changes remain manual. Force-push evidence, a human veto or close/reopen,
malformed identity, unresolved feedback, ambiguous evidence, or exhausted
repairs also blocks preparation. Risk and update metadata remain in the ALL
CLEAR evidence for the maintainer's merge decision.

Configure the repository-scoped Prepare App with Actions variables
`DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID`,
`DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG`,
`DEPENDABOT_PROCESSOR_PREPARE_BOT_ID`, and
`DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN`, plus secret
`DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY`. Install it with only
`contents: write` and `pull-requests: write`, because update-branch needs both.
The refresh token requests both permissions; repair and authenticated-dispatch
tokens are downscoped to Contents write. Grant no bypass, Actions, workflow,
deployment, package, or provider permission. Contents write also makes
GitHub's merge endpoint technically reachable; the reviewed workflows contain
no merge call, isolate the token to the mutation/dispatch jobs, and revoke it
before finalize approval. Never reuse the normal `GITHUB_TOKEN`, preview App,
deployment/provider credential, package credential, or PAT.

Branch mutation and readiness authority must never coexist:

1. a read-only API planner emits a strict bounded plan;
2. a secretless validator binds each patch to permitted paths and exact blobs;
3. an App-only staging job writes one unreachable exact-parent commit without
   moving the ref;
4. a no-App-token job publishes a packet/plan/tree-bound Repair Intent before
   branch mutation;
5. a fresh App-only job revalidates that intent and moves the exact ref without
   force;
6. a no-App-token job publishes the completed receipt, or a checks-only run
   recovers it after an exact post-move failure, cancellation, or timeout; and
7. a later processor finalize phase rejects the repair token, recollects every
   exact-head gate and feedback surface, then alone may clean processor
   approvals, approve, post receipt-bound replies, and publish ALL CLEAR.

Only a trusted `refresh-pending` result starts the mutation/token job. Native
green heads skip it and can finalize without Prepare App configuration. A
same-head `repair-pending` result preserves its original packet/run without
publishing another packet or identical check.

The typed check contracts are `Dependabot Refresh`
(`dependabot-refresh:v1`), `Dependabot Repair Intent`
(`dependabot-repair-intent:v1`), `Dependabot Repair`
(`dependabot-repair:v1`), and `Dependabot ALL CLEAR`
(`dependabot-all-clear:v1`). Canonical JSON and external IDs bind the
repository, PR, ref, old/new/base SHA, exact workflow SHA/run/attempt, App
slug/bot identity for prepared mutations, and operation digests. The check
publisher is github-actions App ID 15368; its generic identity is insufficient
without the exact terminal trusted run and canonical receipt. A Refresh needs a
successful request on the old head and completed receipt on the exact
two-parent result. A Repair needs the exact Processor v2 packet, a durable
pre-mutation intent, one App-authored non-force commit with GitHub verification
`verified=true` and reason `valid`, and a completed or exact-intent recovered
receipt. Normal pre-move work and checks-only recovery each get at most two
exact-evidence infrastructure retries. Those counters do not change the
two-commit repair limit; refresh count is independent.

A valid review finding may be included in a v2 repair packet by exact
finding/thread ID and body digest. Only after the repaired head passes its full
gate and clean re-review may finalize post
`Fixed in <current-head prefix> — <change>` and resolve those exact
packet-bound threads. Generic github-actions or bot comments never establish
lineage or satisfy feedback.

Historical Codex `Reviewed commit` text binds that review's own commit SHA.
Unresolved historical threads still block; resolved ones clear. If a trusted
packet-bound remediation reply already exists, retry only thread resolution and
do not post a duplicate reply.

ALL CLEAR requires current-main ancestry, stable identity, complete green
exact-head gates, clean re-review, clear feedback, one exact processor approval,
satisfied ruleset/review and GitHub mergeability state, no native
`AutoMergeRequest`, and no competing candidate. Its v1 receipt states
`humanAction="merge"`, `mergeAuthorizedByAutomation=false`, and records
either native seed evidence or the complete prepared operation lineage. Keep
one candidate serialized through the maintainer merge and that merge SHA's
default-branch CI and Vercel post-merge proof before another ALL CLEAR candidate
is admitted. ALL CLEAR is a snapshot: a late comment or new `main` commit can
still invalidate it before the click, so strict current-base/ruleset enforcement
at merge time remains required.

A sole valid active ALL CLEAR receipt and exact approval outrank numeric
candidate selection. Targeted runs must collect and preserve that incumbent even
when another PR triggered the run.

Prepare-mode targeted runs collect the bounded set of all open Dependabot PRs
while keeping the triggering expected-head assertion scoped to the original PR.
A pending Refresh request/completion, trusted same-head repair packet, or valid
prepared lineage also retains the lane through check, retry, and re-review
waits. Multiple such incumbents without a valid active ALL CLEAR fail closed.

Use
`pnpm dependabot:process -- evaluate --input path/to/snapshot.json --mode observe`
for a network-free plan and `pnpm dependabot:process:test` for the processor,
workflow, receipt, repair, and reviewer contracts. The complete operating
procedure is `docs/dependabot-automation.md`; the architecture decision is
`docs/adr/0006-dependabot-processing-controller.md`.
The automatic `.github/workflows/vercel-main-deployment.yml` path runs only
from the exact successful `CI/CD` attempt for `main`. Its global mode is
`active`, and the current per-target `mainOwnershipMode` map assigns App,
Governance, Reserve, and UI to `github`. Planning emits
`vercel-main-plan:v2`: all selected targets stage or build, `activeTargets`
mutate public mappings, and `shadowTargets` prove the same candidates without
public mutation. Governance, Reserve, and UI promote exact staged deployments;
App deploys its verified custom `v3` output and verifies or assigns only the
reviewed aliases. Legacy App `v2 -> production` remains native. Planning uses
the SHA each public target actually serves, and every credential-bearing job
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
prior, and every reviewed App alias at one manifest-bound candidate; it grants
App restoration authority only and never forward resumption. It never resumes a
prior journal or treats GitHub artifacts as cross-attempt authority. The compact
terminal receipt and evidence are the only final-verdict handoff and support
final-only reruns. A completed release emits `current-release-verified` only
after fresh mapping, census/state, raw public-runtime-smoke, legacy `v2`, and
freshness proof; it creates no journal and executes no public mutation. App
shadow preparation is build-only terminal evidence and never creates a provider
deployment. Every other non-prefix, ambiguous, conflicting, or incomplete
provider state fails closed before production work continues.

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
