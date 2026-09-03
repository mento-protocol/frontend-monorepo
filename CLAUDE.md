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

In CI, `.github/workflows/e2e.yml` triggers on every PR (plus the nightly schedule and manual `workflow_dispatch`) and always reports both check runs. An `e2e-plan` job computes `run_app`/`run_gov`/`run_monad` from changed files (`apps/app.mento.org/**` -> `run_app` + `run_monad`; `apps/governance.mento.org/**` -> `run_gov`; `packages/web3/**`, `packages/ui/**`, and `scripts/fork-test-clock.*` -> all three; `scripts/fork-seed-monad.*` -> `run_monad`; root-level files like `package.json`/`turbo.json`/the workflow itself -> all three) and fast-no-ops the fork jobs to a green skip when their surface didn't change — that "always reports" property is the prerequisite for eventually adding these checks to the required-checks ruleset (`strict_required_status_checks_policy` would otherwise deadlock non-matching PRs). Scheduled and manually-dispatched runs force both outputs true (no "changed files" concept for a cron trigger, and a manual run's point is to run regardless of what changed). A cheap `fork-seed-self-test` job (no anvil, no network) runs the shared clock boundaries and both encoder suites on every trigger; if it fails, the fork jobs still start (so the failure surfaces as a real check failure, not a silently-passing skip) but bail out in their first step instead of running the full 30-minute anvil suite. `e2e-connected` ("Connected swap (anvil fork)") and `e2e-governance` ("Connected governance (anvil fork)") both fork Celo mainnet pinned to `FORK_BLOCK` (bump roughly monthly). The fork source is a keyless public archive RPC probed at run time — forno cannot serve pinned-block forks because it prunes a block's state within minutes. A nightly scheduled run (04:20 UTC) repeats the suites at a freshly resolved recent block instead of the pin, to catch chain drift (oracle config, pool, or contract changes) that plan-gated PR runs never see. `e2e-connected-monad` ("Connected swap (Monad anvil fork)") is the Monad sibling: it forks Monad mainnet (chain 143) on port 8546 via `scripts/fork-seed-monad.mjs`, gated on `run_monad`. Unlike the Celo jobs it resolves a fresh block near `finalized` on every trigger (rpc.monad.xyz primary, monad.drpc.org fallback) rather than pinning, because Monad's public RPCs' deep archive retention is unproven while forking near finalized is the verified-servable window. Before oracle reports or swaps, both seed scripts use the shared UTC calendar to select a timestamp that stays FX-open for two hours. None of these checks is a required check yet.

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
Slack's `#ci-failures` with links to the run and to the managed issue. Both
watch the same static workflow allowlist, alert on the same conclusion set, and
reconcile an out-of-order callback to the latest decisive run the same way, so
adding or renaming an operational workflow means updating both lists and
`scripts/quality-workflows.test.mjs` in the same PR. Run the Slack workflow's
bare `workflow_dispatch` from the Actions tab to smoke-test the wiring; it
posts a fixed "🧪 wiring test" message and changes nothing else. Only the
default-branch copy can post: every event is gated on `github.ref`, and the job
runs in the `main`-only `slack-ci-notifications` environment.
`docs/quality-budgets.md` records why that is hardening rather than a complete
control while `SLACK_BOT_TOKEN` remains org-shared.

## Dependabot preparation

Dependabot opens native npm and GitHub Actions pull requests each Monday at
06:00 UTC. An OpenClaw job is installed for Monday at 10:15 UTC. Keep it
disabled until the one-time cutover in `docs/dependabot-automation.md` passes.
After activation, OpenClaw is the scheduled operator. Manual sweeps may use
Codex, Claude Code, OpenClaw, or another compatible agent runtime. Version 2 has
no event webhook or standing poller.

Use the installed, generic `dependabot-prep` skill. The skill defines the
runtime-neutral loop. Repository policy remains in `AGENTS.md` and
[`docs/dependabot-automation.md`](docs/dependabot-automation.md). The exact
identity and history contract is `.github/dependabot-prep-policy.json`.

The scheduled declaration binds the canonical skill source path and reviewed
SHA-256 digest. It also binds the canonical paths and reviewed SHA-256 digests
of the trusted pre-model launcher, root `authorized-run` orchestrator, any
runtime-specific instruction-isolation adapter, and the skill's bundled
one-shot exact-CAS push adapter and credential helper. The launcher verifies
every pin before it starts the model.

Every write-capable session starts in an operator-owned,
repository-instruction-free context outside every checkout, or in a clean,
ordinary-file-only checkout proved before model launch to equal the exact live
base SHA. The launcher keeps candidate clones outside the runtime project root.
It passes a current-host test that proves candidate-path access cannot
auto-import candidate `AGENTS.md`, `CLAUDE.md`, or another supported instruction
file. Bind that result to the exact runtime binary, version, configuration,
authorizer, launcher, adapter, host, and access operations. A model statement is
not proof.
The same test must prove that candidate-path read, edit, and command access
starts no candidate process, loads no candidate configuration, and makes no
candidate-triggered network request. Never start a shell or PTY in the
candidate clone.
An instruction-free launch must discard stale policy, candidate state, and
evidence, then rebind policy and restart classification after `main` moves. An
exact-base launch must stop writes and relaunch from the new base. A multi-base
invocation requires the instruction-free context or one launcher process per
exact base.
An existing manual session without this pre-model proof stays read-only. Exit
and relaunch it through the trusted launcher before granting a write class.

A skill, authorizer, launcher, or adapter update requires a disabled schedule,
complete review, byte-identical installation, expected-digest update, a
repeated current-host boundary test, and a supervised rehearsal.

The declaration also binds the exact repository, checkout, target, timing,
timeout, worker limit, grants, denials, GitHub operator, credential source, and
operator-owned repository lease. Scheduled and manual write runs use the same
atomic lease. Never take over an existing or stale lease.

Read-only is the skill default. The scheduled invocation explicitly grants
branch updates, one broker-fixed Dependabot recreation per exact eligible native
generation, review requests, digest-bound top-level feedback responses, and
review replies. It grants neither check reruns, status chatter, nor
review-thread resolution. A manual invocation must grant each required mutation
class. The scheduled path uses a sanitized standalone clone and does not execute
candidate code. Exact-head CI validates the pushed result.

Every write run uses exact argv
`["sudo", "/opt/dependabot-prep/authorized-run"]`. That executable wrapper runs
the separately pinned implementation at
`/opt/dependabot-prep/authorized-run.mjs`. The root orchestrator issues a
short-lived, non-model-writable nonce whose `mode` is `write`, bound to the exact
grants, run ID, and its live root PID, kernel boot ID, and process start time;
the mutation broker requires it. Direct
launcher write mode must refuse. Direct `run --read-only` and `status` remain
permitted. Run the activation test only as
`sudo /opt/dependabot-prep/selftest-run`; it drops to the model identity with no
supplementary groups or capabilities and publishes a root-owned, pin-bound
`/etc/dependabot-prep/selftest-attestation.json`. `pin` and `selftest-run` are
root-only maintenance; `lease-clear` is explicit `dependabot` maintenance.

The model UID keeps `/var/lib/dependabot/gh` empty, so direct `/usr/bin/gh` has
no credential. Only the separate `dependabot-mutator` nologin UID may read the
repository PAT at `/var/lib/dependabot-mutator/gh`. Model GitHub access goes
through the pinned broker clients: fixed-repository REST `GET` and sealed
one-page `pull-request-force-push-history` and `pull-request-review-threads`
GraphQL templates only;
capability-bound CodeRabbit review request, bounded comment, and bounded reply
operations; and exact-CAS `push` or exact-head-and-base
`sync-base` for branch writes. `sync-base` constructs and verifies a clean
two-parent merge in root quarantine, then exact-CAS pushes it; it never calls
the pull-request branch-update API. Never expose the PAT or bypass the broker.

Local candidate execution requires an `execute` grant and a tested adapter. The
agent must not approve, dismiss a review, enable auto-merge, merge, or use a
merge queue. A maintainer provides the current human approval and performs the
final squash merge.

For each pull request:

1. Query the live pull request. Keep `generationBaseSha` (native-generation
   ancestry), `currentTargetBaseSha` (live `main` used for this attempt), and
   `policySha` (the policy file's exact 40-character Git blob OID) distinct.
   Verify the exact bot identity, native lineage, `dependabot/**` head ref, live
   head, and `autoMergeRequest: null`. Admit a pre-existing non-native head only
   through the pinned root-owned broker's complete `dependabot-lineage`
   receipt-chain proof; same-UID logs are not authority.
2. Paginate all comments, reviews, threads, labels, and history. Collect force
   pushes through GraphQL `HeadRefForcePushedEvent` with exact
   `beforeCommit.oid`/`afterCommit.oid` values and complete cursor pagination.
   Read applicable rules from `/rules/branches/{branch}` plus every completely
   enumerated full ruleset, not the legacy branch-protection endpoint. Stop on
   the exact veto, intervention, malformed-feedback, or force-push outcomes in
   `.github/dependabot-prep-policy.json`. Inspect the full dependency, lockfile,
   workflow, and transitive diff.
   Require the sealed normalizer identity, status, and note. Rejected or
   incomplete evidence and literal `unknown` `generationBaseSha`/`policySha`
   are valid only for a non-prepared blocked row; `currentTargetBaseSha` remains
   required, and prepared evidence permits no unknown SHA.
3. Select `full`, `sync-only`, `review-only`, or `manual`. An initial conflict,
   stale base, or red CI result is admissible work for ordinary npm. The exact
   final head must still contain the target base and pass required checks,
   CodeRabbit review, feedback, mergeability, and absent-auto-merge gates.
4. Never mutate a ref for a direct PR change below `.github/workflows/**` or
   `.github/actions/**`. Only an authenticated minor or patch version update in
   `github-actions-routine` may use `review-only`, and only with full lowercase
   40-character old and new SHA refs on its unchanged native green exact head.
   Major, security, sensitive, self-reviewing, ambiguous, and local-Action
   updates remain manual. For npm, the protected subtrees at the exact old head
   must already match `currentTargetBaseSha` byte-for-byte and mode-for-mode.
   GitHub requires workflow-write authority even for base-sourced workflow
   bytes, and this controller deliberately has none. A mismatch may use only the
   broker's fixed `recreate` operation once for the exact authenticated native
   npm generation, followed by complete authentication of the replacement
   Dependabot-native head; otherwise it is manual.
   Verify equality before commit, in quarantine, and immediately before
   mutation. For npm,
   merge the base with no-commit and no-fast-forward behavior. Create one merge
   commit, one repair commit on an already-current base, or no commit. Never
   create an empty second commit.
   A clean `sync-only` branch may use only the root broker's `sync-base`
   operation bound to the exact head and base. The broker builds and verifies
   the two-parent merge in root quarantine, exact-CAS pushes it, and records the
   receipt. Never grant `Workflows: write`; a protected-tree mismatch or
   conflict may use fixed `recreate`, but direct ref mutation fails closed.
5. Preserve the requested update while fixing conflicts and valid findings.
   A semver-patch-only `next` update may use `full` only when its authenticated
   original delta is confined to the exact coupled Next declaration, override,
   lockfile-closure, and derived runtime-contract digest tuple. Keep every
   other byte and mode identical to `currentTargetBaseSha`, including Vercel
   identity/configuration, `packageManager` and pnpm/runtime pins, workflows,
   Actions, and security policy, subject to the protected-tree precondition
   above. A bounded data-only repair inside that tuple is allowed only when it
   is deterministic without candidate or package-manager execution; otherwise
   use `manual`. Next minor/major rotations are always `manual`, as are Vercel
   CLI, protected Playwright, protected pnpm runtime or bootstrap rotations,
   and packages matching the exact wallet, signing, transaction, or bridge risk
   patterns.
   Ordinary npm requires a strict forward stable-semver change with the same
   range prefix; downgrade, prerelease, source/protocol, and ambiguous changes
   are manual. An ordinary compatibility repair requires a separate clean base
   sync and one child commit of the exact old head. It may modify only existing
   non-protected files below `apps/` or `packages/`, never a dependency manifest
   or lockfile, and its final
   manifest tuples must exactly match the authenticated native tuples.
   Follow [`docs/dependency-overrides.md`](docs/dependency-overrides.md) only
   during the maintainer takeover. Keep Actions on full SHA pins. Classify
   sensitive or self-reviewing Actions, including OSV
   scanner/reporter updates, as `manual`. Move the OSV scanner action and the
   OSV reporter action together, to the same pinned revision, in one update.
   That is a version-pin rule about those two actions. It places no limit on
   how many times a workflow may invoke either one.
   A manual verdict must still research every package from authoritative
   upstream changelogs, releases, migration guides, or advisories. At least one
   authoritative upstream HTTPS URL per exact name/from/to tuple must be fetched
   and live-verified. Only when none of those desired source classes exists may
   an authoritative upstream project or package page be used as the explicit
   fallback; record the exact missing classes and lower confidence. Report the
   changelog or release-note links, breaking changes, repository impact,
   recommendations, risk (`low`/`medium`/`high`/`critical`/`unknown`),
   confidence and rationale, plus explicit missing or ambiguous sources. If no authoritative link can be
   live-verified, research is operationally incomplete and the sweep exits `1`.
   Do not execute candidate code for research. The exact name/from/to tuples in
   `manualResearch.packages` must equal the result's complete `dependencies`
   inventory.
6. Do not run repository commands in the scheduled no-exec clone. Require
   exact-head CI to run `pnpm dependency:policy:test` and all affected gates.
   Require the override validators for root override changes. Use `manual` when
   a required repair needs local candidate execution.
7. Push only to the verified head ref with an explicit refspec and an exact
   expected-old-head lease, through the root broker's exact-CAS `push` or
   `sync-base` operation. Independently prove the update is a fast-forward.
   The broker worker activates the reviewed one-shot HTTPS credential adapter
   under `dependabot-mutator` and removes it after the attempt; never hold or
   expose that credential. Request a new
   CodeRabbit review once per eligible exact head, including an unchanged
   `review-only` or no-op head, and again after every push, with one exact
   `@coderabbitai review` issue comment. Bind that request to this invocation's stable comment ID,
   authenticated operator tuple, and exact head. Require numeric ID
   `136622811`, login `coderabbitai[bot]`, type `Bot`, and an immutable review
   `commit_id` for the current head. Reply to every comment. Never resolve or
   unresolve a review thread. Record each answered thread for the maintainer to
   resolve at the final gate. Do not push when no new commit exists.
8. Re-read the live head, base, and `autoMergeRequest`. Repeat the loop on
   drift. Handoff only when required check runs or commit statuses from their
   expected producers pass, every actionable item is answered, the exact-head
   CodeRabbit review exists, and GitHub reports `MERGEABLE`. List every answered
   but unresolved thread. Report thread resolution and final human approval as
   separate gates.

Report `prepared for maintainer decision`, `blocked`, `manual`, or `read-only`,
plus the processing mode, all three SHA roles, normalized
force-push/rules/mutation-lineage evidence, exact final head and base, dependency
risk, checks, feedback, and blockers. Include the complete research packet for
`manual`. During an active preparation run, monitor checks and reviews at
intervals shorter than ten minutes. Human approval and squash merge remain.

A complete schema-valid exact-inventory sweep exits `0` even when individual
PRs are manual or blocked. Exit `1` is operational or result failure, exit `2`
is pin/self-test drift, and exit `3` is active lease contention. Keep verdict
and processing-mode counts separate from launcher operational status.
Dependabot pull requests stay secretless. Do not admit them to credentialed
Vercel Preview workers or broaden
the same-repository `User` author/sender credential rule.

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
