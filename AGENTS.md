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

## Connected fork clock

Both connected-swap seed scripts use `scripts/fork-test-clock.mjs`. The helper
models the deployed `MarketHoursBreaker` UTC calendar. It selects wall time only
when the FX market stays open for two more hours. Otherwise, it advances the
fork to the next safe opening. It never rewinds, and the second seed preserves
an already-safe future timestamp. Keep Celo and Monad on this shared helper.
Derive raw fork transaction deadlines from the latest block timestamp. Changes
to the helper must select the Celo app, Celo governance, and Monad E2E lanes.

## Dependabot preparation

Dependabot opens native npm and GitHub Actions pull requests each Monday at
06:00 UTC. An OpenClaw job is installed for Monday at 10:15 UTC. Keep it
disabled until the one-time cutover in `docs/dependabot-automation.md` passes.
After activation, OpenClaw is the scheduled operator. Manual sweeps may use
Codex, Claude Code, OpenClaw, or another compatible agent runtime. Version 1 has
no event webhook or standing poller.

Invoke the installed, generic `dependabot-prep` skill for each sweep. The skill
defines the runtime-neutral discovery and preparation loop. This section and
[`docs/dependabot-automation.md`](docs/dependabot-automation.md), together with
`.github/dependabot-prep-policy.json`, define the Mento-specific policy,
identity tuples, history rules, and validation. Keep repository-specific rules
out of the generic skill.

The scheduled declaration must bind the canonical skill source path and its
reviewed SHA-256 digest. It must also bind the canonical paths and reviewed
SHA-256 digests of the trusted pre-model launcher, any runtime-specific
instruction-isolation adapter, and the skill's bundled one-shot exact-CAS push
adapter and credential helper. The launcher must verify every pin before it
starts the model.

Every write-capable session must start in an operator-owned,
repository-instruction-free context outside every checkout, or in a clean,
ordinary-file-only checkout proved before model launch to equal the exact live
base SHA. The launcher must keep candidate clones outside the runtime project
root. It must pass a current-host test that proves candidate-path access cannot
auto-import candidate `AGENTS.md`, `CLAUDE.md`, or another supported instruction
file. Bind that result to the exact runtime binary, version, configuration,
launcher, adapter, host, and access operations. A model statement is not proof.
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

Disable the schedule before a skill, launcher, or adapter digest rotation.
Review and install byte-identical copies, update each expected digest, rerun the
current-host boundary test, and complete the supervised rehearsal before
re-enabling it.

The scheduled declaration must also bind the complete repository, checkout,
target, timing, timeout, worker, grant, denial, GitHub operator, credential
source, and repository-lease contract from the runbook. Scheduled and manual
write runs use the same atomic operator-owned lease. Never take over an existing
or stale lease.

The scheduled invocation enables write mode and grants branch updates, review
requests, digest-bound top-level feedback responses, review replies, and one
proven infrastructure rerun. It does not grant status chatter or review-thread
resolution. A manual invocation must grant each required mutation class
explicitly. The scheduled path uses a sanitized standalone clone and must not
execute candidate code. Exact-head secretless CI provides validation. Local
candidate execution requires a separate `execute` grant and a tested isolation
adapter. It must not submit an approval, dismiss a review, enable auto-merge,
merge, or use a merge queue. A maintainer provides the current human approval
and performs the final squash merge.

For each pull request:

1. Query the live pull request. Bind repository instructions and validation
   commands to its exact base SHA. Verify the exact Dependabot bot identity,
   native generation, `dependabot/**` head ref, `main` base, live head SHA, and
   live base SHA. A pre-existing non-native head is `manual`. During one
   uninterrupted invocation, admit only the exact non-force transitions that
   the agent creates and reads back. Require `autoMergeRequest` to be `null`
   before any mutation, immediately before each push, at handoff, and before
   the human merge.
2. Paginate every issue comment, review comment, review, thread, label, and
   timeline page before mutation. Apply the exact maintainer, veto-label,
   close/reopen, branch-command, review-request, and force-push rules in
   `.github/dependabot-prep-policy.json`. Inspect the complete manifest,
   lockfile, workflow, and transitive dependency diff. Review release notes and
   migration guidance. Treat an unknown package, source, ecosystem, or
   unexpected changed path as a blocker.
3. Never mutate a ref whose live inventory contains `.github/workflows/**` or
   `.github/actions/**`. Also require the candidate delta from the authenticated
   old head to contain zero such paths before commit, in the independent
   post-commit quarantine, and immediately before push. A non-sensitive Actions
   update can pass only on a current, unchanged, native and green head. For an
   admitted npm update, merge the current base with no-commit and no-fast-forward
   behavior. Create one two-parent merge commit, one one-parent repair commit on
   an already-current base, or no commit. Never rebase, force-push, or create an
   empty second commit.
4. Apply only changes needed for the dependency update or valid review
   findings. Classify every Next.js, Vercel CLI, or protected pnpm runtime or
   bootstrap rotation as `manual`. Follow
   [`docs/dependency-overrides.md`](docs/dependency-overrides.md)
   only during the maintainer takeover. Keep GitHub Actions on full lowercase
   40-character SHA pins. Classify sensitive or self-reviewing
   Actions as `manual`. This includes OSV scanner/reporter updates. Keep the OSV
   scanner and reporter at one step each and at the same revision.
5. Do not run repository commands in the scheduled no-exec clone. After each
   push, require exact-head CI to run `pnpm dependency:policy:test` plus every
   affected repository gate. Require the override validators from
   `docs/dependency-overrides.md` when a root override changes. If a required
   repair or generated file cannot be produced without candidate execution,
   classify the pull request as `manual`.
6. Push only to the verified pull-request head with an explicit refspec and an
   exact expected-old-head lease after an independent fast-forward proof. Use a
   reviewed one-shot HTTPS credential adapter. Never persist the helper or put
   its token in a URL, argument, log, or file. Remove the adapter immediately
   after the push attempt.
   Do not push when the native head is already current and needs no repair.
   Post the exact `@coderabbitai review` issue comment once per pushed head to
   request a new review from the existing CodeRabbit GitHub App. Bind the
   request to the current invocation, stable comment ID, operator tuple, and
   exact head. Accept only numeric ID `136622811`, login
   `coderabbitai[bot]`, type `Bot`, and a review whose immutable `commit_id`
   equals the pushed head. Reply to every review comment. Never resolve or
   unresolve a review thread. Record each answered thread for the maintainer to
   resolve at the final gate.
7. Re-read the live head and base. Repeat the loop if either differs from the
   prepared state. Handoff requires passing required checks from their expected
   check-run Apps or commit-status creators and workflows, answers for every
   actionable item, a current-head CodeRabbit review, and `MERGEABLE` state on
   the exact final head and base. List every answered but unresolved thread.
   Thread resolution and human approval remain separate final gates.

Report one verdict: `prepared for maintainer decision`, `blocked`, `manual`, or
`read-only`. Include the pull request, exact final head and base SHAs,
dependency risk, validation, feedback state, and any blocker. State that human
approval and the squash merge remain. During an active preparation run, monitor
checks and reviews at intervals shorter than ten minutes. Do not claim
preparation is complete when the head, base, checks, feedback, review, or
mergeability changed after validation.

Dependabot pull requests remain secretless. Do not route them through a
credentialed Vercel Preview worker or broaden the same-repository `User`
author/sender credential rule. `.github/workflows/vercel-preview-intake.yml`
remains the read-only boundary that publishes the exact-head preview-disabled
status from trusted default-branch code.

## Quality budgets and CI failure issues

Run `pnpm quality:budgets:test` for the zero-network structural/unit checks and
`pnpm quality:coverage` for the four tested workspace coverage floors. After a
production `pnpm build`, run `pnpm quality:bundle:check`; the canonical full
gate is `pnpm quality:budgets`. Exact baselines, thresholds, bundle limits, and
the update procedure live in `docs/quality-budgets.md`.

`.github/workflows/ci-failure-notifier.yml` owns one managed issue per monitored
workflow, operational trigger, and target ref for default-branch, scheduled, and
release-tag failures, then closes it only after recovery in that same partition.
`CI/CD` forces the full build, unit-test, type-check, Knip, and Trunk suite on
every default-branch push so a workflow success is valid recovery evidence;
documentation-only scoping applies only to pull requests.
`Visual Regression` filters default-branch pushes to visual-impact paths and
runs both surfaces whenever it starts, making workflow success valid recovery
evidence; pull requests remain path-gated per surface.
When adding or renaming an operational workflow, update its static allowlist and
the structural test in the same PR. Never execute a triggering head SHA from
this privileged `workflow_run` workflow.

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
member may mutate its public mapping. Each active target promotes its exact
staged deployment. Each shadow target stops after staged verification. When App
is active, its promote is verified to leave `app.mento.org` at its prior, and one
transitional bridge alias-set transition then repoints the domain to the
candidate — a carry-over from the retiring App custom `v3` environment, removed
once the domain moves into Production. Before and after each public mutation,
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
protected-state snapshot. App shadow preparation stages and verifies a real
Production candidate, then stops without promotion or protected-domain/public
mapping mutation. Its receipt is terminal non-authorizing evidence. The
terminal receipt and evidence are the only compact final-verdict handoff and
support final-only reruns. A release identity is evidence lookup only; it never
authorizes a prior attempt's mutation sequence.

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

`.github/workflows/vercel-production-shadow.yml` is manual-only and
non-promoting. Ordinary uploads implicitly move the target's reviewed generated
base project/team alias and may also move Vercel's exact creator-scoped alias,
but the workflow issues no explicit alias assignment, promotion,
environment-configuration, ownership, or protected-domain mutation. Candidate
dependency installation and builds must run under its dedicated UID boundary
with exact protected tools, private-umask runner-owned pull staging, raw
Git-object materialization of the exact commit (never archive/checkout filters),
and a runner-owned verified output handoff. Browser smoke must use a fresh
trusted checkout and dependencies, never candidate `node_modules`; tear down
every candidate boundary before upload or later production-token checks. Keep
all build-boundary state below the target-scoped, authenticated
`/var/lib/mento-vercel-runtime-<run>-<attempt>-<target>/work` root, seal
`RUNNER_TEMP` to runner-owned mode `0700` before candidate execution, and
reauthenticate and remove the exact runtime in a final `if: always()` step.
Preserve App's production build as build-only in this manual pilot; only the
automatic main pipeline deploys and activates it.
Governance, Reserve, and UI uploads must avoid custom production domains and
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
