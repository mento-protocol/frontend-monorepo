# Mento Frontend Monorepo Instructions

Read `CLAUDE.md` for repo-local frontend conventions and commands.

## Architecture decisions

Architectural decisions live under `docs/adr/`. Use
`docs/pr-checklists/architecture-decisions.md` to decide whether a change needs
one, and run the advisory `pnpm adr:check` reminder before publishing.

When an app-level Turbo task adds `passThroughEnv`, include
`"$TURBO_EXTENDS$"` before app-specific names. A child `passThroughEnv` array
replaces the root array. Without the sentinel, the task drops root build secrets
such as `CHAINALYSIS_API_KEY` and `ETHERSCAN_API_KEY`.

## Pull request state

Always create pull requests as normal, ready-for-review PRs directly. Never
create a draft PR, never pass `--draft`, and never use a draft as a temporary
staging state. Draft PRs suppress automated AI reviews.

After creating or locating a PR, verify `isDraft: false`. If a pre-existing PR
is unexpectedly draft, run `gh pr ready <number>` immediately before requesting
reviews or starting the babysit loop.
Exception: draft Dependabot PRs are maintainer holds. The preparation workflow
must report `needs decision`, leave them draft, and never run `gh pr ready`.

## Connected fork clock

Both connected-swap seed scripts use `scripts/fork-test-clock.mjs`. The helper
models the deployed `MarketHoursBreaker` UTC calendar. It selects wall time only
when the FX market stays open for two more hours. Otherwise, it advances the
fork to the next safe opening. It never rewinds, and the second seed preserves
an already-safe future timestamp. Keep Celo and Monad on this shared helper.
Derive raw fork transaction deadlines from the latest block timestamp. Changes
to the helper must select the Celo app, Celo governance, and Monad E2E lanes.

## Dependabot preparation

Use [the preparation playbook](docs/dependabot-automation.md) and
`.github/dependabot-prep-policy.json` from the live default branch. The
`trusted-openclaw-agent` workflow uses the ordinary coding session and existing
GitHub authentication; its prohibitions are procedural, not a credential sandbox.
Do not invoke the retired `/opt/dependabot-prep` launcher or the generic sealed
`dependabot-prep` write path for this workflow.

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

## Quality budgets and CI failure issues

Run `pnpm quality:budgets:test` for the zero-network structural/unit checks and
`pnpm quality:coverage` for the four tested workspace coverage floors. After a
production `pnpm build`, run `pnpm quality:bundle:check`; the canonical full
gate is `pnpm quality:budgets`. Exact baselines, thresholds, bundle limits, and
the update procedure live in `docs/quality-budgets.md`.

`.github/workflows/ci-failure-notifier.yml` owns one managed issue per monitored
workflow, operational trigger, and target ref for default-branch, scheduled, and
release-tag failures, then closes it only after recovery in that same partition.
Its failure body carries a `## What failed` section listing, per failed job of
the reconciled run, the job name, its failed step names, and a job link. The
failure issue never contains raw log text: the notifier downloads no logs and
publishes only GitHub's own job/step structure, because a failing job can print
anything into its log and can equally print the annotations and table syntax a
line-selector would key on. Job and step names are still rendered defensively
(control characters stripped, whitespace collapsed, capped at 200 characters,
Markdown escaped) so a name cannot forge the managed marker; a job link is
emitted only for an `https:` URL. Jobs come from `filter: all` and are selected
by `run_attempt`, so a rerun cannot report its jobs under the completed attempt
the issue names. At most 10 jobs and 10 steps per job are listed and the body is
held under 60 KiB, with counted notes for anything dropped. The job listing is
the only evidence call, carries a 20-second abort signal, and degrades to an
inline note; a degradation reason is scanned whole before it is shortened and
reported as `redacted error` when it looks like a credential. The managed marker
only routes when it sits on its own line outside a fenced block, and the
recovery note is inserted above it so it stays the last line.
`CI/CD` forces the full build, unit-test, type-check, Knip, and Trunk suite on
every default-branch push so a workflow success is valid recovery evidence;
documentation-only scoping applies only to pull requests.
`Visual Regression` filters default-branch pushes to visual-impact paths and
runs both surfaces whenever it starts, making workflow success valid recovery
evidence; pull requests remain path-gated per surface.
`.github/workflows/notify-slack-on-main-failure.yml` watches that same static
allowlist and posts the same failures to Slack's `#ci-failures` with a link to
the run and to the managed issue; it opens no issue and duplicates no issue
logic. It alerts on exactly the `FAILURE_CONCLUSIONS` set from
`scripts/ci-failure-issue.mjs`, mirrors that script's `targetRefFor()` fallback
in jq, and mirrors its latest-decisive-run reconciliation so an out-of-order
callback cannot announce a failure the managed issue has already closed; all
three are pinned by parity tests. That reconciliation is the only reason the
job holds `actions: read`. Its bare `workflow_dispatch` posts
a fixed "🧪 wiring test" message so the Slack wiring can be smoke-tested from
the Actions tab. Every event is gated on `github.ref` being the default branch,
and the job runs in the `main`-only `slack-ci-notifications` environment, so a
branch-selected dispatch cannot reach `SLACK_BOT_TOKEN`; that becomes airtight
only once the token is an environment secret there rather than org-shared.
When adding or renaming an operational workflow, update both static allowlists
and the structural tests in the same PR. Never execute a triggering head SHA
from these privileged `workflow_run` workflows.

`.github/workflows/vercel-main-deployment.yml` starts on the exact `CI/CD`
`main` attempt's `requested` delivery, runs read-only admission, pre-plan, and
release preparation concurrently with CI, and runs with the global controller in
`active` mode. A
successful `completed` delivery is the takeover or deduplication path. The
credential-free `require-ci-success` check binds the event run/attempt, literal
`Build and Test` job, workflow definition, checked-out source, and `DEPLOY_SHA`,
and must succeed before any provider write. Three credentialed jobs may start
before the gate job concludes: the read-only `provider-preplan` and
`prepare-release` censuses, and `restore-inherited-release`, which runs the same
credential-free `require-success` CLI as its own second step before any
credentialed or mutating step. The command allowlist, the index ordering of
every in-job gate against the credentialed and mutating steps that follow it,
and the gate edge on every other public-mutation job are pinned by the
structural workflow test. Planning starts from each
target's actual served SHA. The strict `vercel-main-plan:v2` handoff contains
the canonical four-target `mainOwnershipMode` map and deterministic
`stagedTargets`, `activeTargets`, and `shadowTargets` partitions. The current
map assigns all four targets to `github`; global `shadow` is valid only when all
four targets are `shadow`. Ambiguous path planning selects a target; ambiguous
ownership or protected state aborts the whole run.

Release identity is stable across reruns—repository, exact SHA, and validated
upstream CI run ID—and the target-specific candidate identity adds the target.
The provider-side stable release manifest is the sole durable cross-attempt
authority. Mutation transaction IDs and journals remain downstream
run-and-attempt scoped. Before planning, a later attempt reconciles the
provider's protected mappings and candidates against that manifest. It reuses
a complete release, resumes or restores an interrupted forward prefix as
appropriate, or restores the exact terminal App recovery residual through a
fresh current-attempt journal before new planning can proceed. That residual
requires at least one active non-App target, every active non-App target at its
original prior, and every reviewed App alias at either its captured prior or one
manifest-bound candidate, with at least one alias at the candidate; it grants
App restoration authority only and never forward resumption. It never
resumes or treats a prior attempt's journal artifact as cross-attempt authority.
Every other non-prefix, ambiguous, conflicting, or incomplete provider state
fails closed before the release continues.

Every selected target — Governance, Reserve, UI, and App — stages and verifies
an immutable candidate with `--prod --skip-domain`. Only an `activeTargets`
member may mutate its public mapping: every target promotes its exact staged
deployment. App's promote is verified at `candidate`, exactly like every other
target — `promote` and `ordinary_rollback` are the only operation types, and
there is no bridge alias and no custom `v3` environment. Before and after each
public mutation,
the controller rechecks freshness and protected state and persists the next
durable journal transition. Recovery restores exact captured mappings in reverse
mutation order and treats unknown operator-owned state as manual intervention.
The final evidence includes an active duplicate-deployment census
and fails if Vercel produced an unexpected serving or pending deployment for a
replaced `main` path. If the release plan has no expected candidate for a
project, an exact-project, exact-SHA deployment in terminal `CANCELED` state
remains visible as `inertCanceled` evidence. It cannot satisfy the required
candidate or protected-mapping proof.

Ordinary reruns reuse only the exact stable candidate identified by the release
manifest, one provider candidate, and fresh deployment inspection/smoke. A
complete release takes the journal-free `current-release-verified` route: it
rechecks current mappings, deployment census/state, raw public runtime smokes,
and freshness without replaying a mutation. An
interrupted release uses a new current-attempt journal and current
protected-state snapshot. In the automatic pipeline's shadow mode, App
preparation is build-only terminal evidence and creates no provider deployment.
The terminal receipt and evidence are
the only compact final-verdict handoff and support final-only reruns. A release
identity is evidence lookup only; it never authorizes a prior attempt's
mutation sequence.

Target-local main rollback restores only that target's reviewed native `main`
configuration and changes only its `mainOwnershipMode` to `shadow`; ordinary
previews remain GitHub-owned. Target-local preview rollback uses the exact
native-preview/GitHub-main branch rules and does not restore native `main`. A
full-native rollback is a separate coordinated procedure. For ordinary
targets, the public custom domain is the only protected
runtime and rollback alias; generated project/team and creator-scoped aliases
are candidate evidence only. Never recreate the removed
Governance QA environment. The historical PR-A canary, active transaction,
public runtime proof, journal, recovery, target-local rollback, and full-native
restoration contracts live in `docs/vercel-deployments.md`.

Staged main candidates are non-promoting. Ordinary uploads implicitly move the
target's reviewed generated base project/team alias and may also move Vercel's
exact creator-scoped alias, but the workflow issues no explicit alias
assignment, promotion, environment-configuration, ownership, or protected-domain
mutation. Candidate
dependency installation and builds must run under their dedicated UID boundary
with exact protected tools, private-umask runner-owned pull staging, raw
Git-object materialization of the exact commit (never archive/checkout filters),
and a runner-owned verified output handoff. Candidate smoke must use a fresh
trusted checkout and dependencies, never candidate `node_modules`; tear down
every candidate boundary before upload or later production-token checks. Keep
all build-boundary state below the target-scoped, authenticated
`/var/lib/mento-vercel-runtime-<run>-<attempt>-<target>/work` root, seal
`RUNNER_TEMP` to runner-owned mode `0700` before candidate execution, and
reauthenticate and remove the exact runtime in a final `if: always()` step.
`stage-app` stages an App production candidate with `--prod --skip-domain` like
every ordinary target; only the activation turn promotes it.
Governance, Reserve, UI, and App uploads must avoid custom production domains and
must expose the immutable deployment hostname through the deployment URL/state
identity. The provider alias list must contain the target's reviewed literal
base project/team alias and may contain at most one author alias derived exactly
from the canonical Vercel deployment `creator.username`; reject every other
alias.
Every candidate Vercel build must use `--standalone`; reject invalid, oversized,
or non-empty-`filePathMap` `.vc-config.json` files before handoff and again on
the runner-owned upload tree.
The protected Vercel CLI must come only from the exact standalone manifest and
lockfile under `scripts/vercel-cli-runtime`; never install it through the root
workspace, admit workspace links, or weaken recursive symlink containment.
Never copy a raw Vercel-pulled `.env.*.local` into candidate storage. One-way
materialize only the exact `vercel-pull` allowlist, prove the raw source is
unchanged, reassert candidate canonical bytes, and remove raw pull and derived
environment state during candidate teardown.
Preflight must bind workflow, requested, fetched-main, and source SHAs before
downstream jobs consume its single SHA output. Reachable browser smokes must
verify both the custom build ID and exact deployed-SHA response header. Candidate
builds must emit one canonical Turbo cache summary for per-target evidence.
The full contract and commands live in `docs/vercel-deployments.md`.

## Pull request descriptions

Every non-draft, non-Dependabot pull request body must start with the exact
top-level headings `## The Problem` then `## The Solution` as its first two H2
sections. Only HTML comments may appear before `## The Problem`. Validate the
current PR with
`gh pr view --json body --jq .body | pnpm pr:description:check`; run the
validator tests with `pnpm pr:description:test`. The `PR description format`
job is designed to be a required status and therefore must keep running without
path filters.
