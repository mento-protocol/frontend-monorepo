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
Codex, Claude Code, OpenClaw, or another compatible agent runtime. Version 2 has
no event webhook or standing poller.

Invoke the installed, generic `dependabot-prep` skill for each sweep. The skill
defines the runtime-neutral discovery and preparation loop. This section and
[`docs/dependabot-automation.md`](docs/dependabot-automation.md), together with
`.github/dependabot-prep-policy.json`, define the Mento-specific policy,
identity tuples, history rules, and validation. Keep repository-specific rules
out of the generic skill.

The scheduled declaration must bind the canonical skill source path and its
reviewed SHA-256 digest. It must also bind the canonical paths and reviewed
SHA-256 digests of the trusted pre-model launcher, root `authorized-run`
orchestrator, any runtime-specific instruction-isolation adapter, and the
skill's bundled one-shot exact-CAS push adapter and credential helper. The
launcher must verify every pin before it starts the model.

Every write-capable session must start in an operator-owned,
repository-instruction-free context outside every checkout, or in a clean,
ordinary-file-only checkout proved before model launch to equal the exact live
base SHA. The launcher must keep candidate clones outside the runtime project
root. It must pass a current-host test that proves candidate-path access cannot
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

Disable the schedule before a skill, authorizer, launcher, or adapter digest
rotation. Review and install byte-identical copies, update each expected digest,
rerun the current-host boundary test, and complete the supervised rehearsal
before re-enabling it.

The scheduled declaration must also bind the complete repository, checkout,
target, timing, timeout, worker, grant, denial, GitHub operator, credential
source, and repository-lease contract from the runbook. Scheduled and manual
write runs use the same atomic operator-owned lease. Never take over an existing
or stale lease.

The scheduled invocation enables write mode and grants branch updates, one
broker-fixed Dependabot recreation under the full native-npm path or the
`manual-hygiene` lane under a policy-selected recreation profile, review
requests, digest-bound top-level feedback responses, and review replies. It does
not grant check reruns, status chatter, or review-thread resolution. Scheduled
and supervised target invocations receive this same fixed, reviewed grant set;
the supervised caller selects only the admitted runtime and target, never a
per-invocation grant set. The scheduled path uses a sanitized standalone clone
and must not execute candidate code.
The exact scheduled argv is
`["sudo", "/opt/dependabot-prep/authorized-run"]`; a supervised target uses
`["sudo", "/opt/dependabot-prep/authorized-run", "--runtime", "{codex|claude}", "--target", "{positive-pull-request-number}"]`
with concrete admitted values. That executable wrapper runs
the separately pinned implementation at
`/opt/dependabot-prep/authorized-run.mjs`. The root orchestrator issues a
short-lived, non-model-writable nonce whose `mode` is `write`, bound to exact
runtime, nullable scheduled or exact supervised target, grants, run ID, the
canonical sorted launch inventory and its SHA-256, and its live root PID,
kernel boot ID, process start time, and exact transient systemd unit. Root
publishes it only after a stable inventory read; target `null` never expands
writes beyond that bound set, and a supervised target requires an exact
singleton. The mutation broker requires it. Direct
launcher write mode must refuse. Direct `run --read-only` and `status` remain
permitted. The activation test runs only as
`sudo /opt/dependabot-prep/selftest-run`; that root orchestrator clears all
supplementary groups and capabilities, runs the pinned no-credential probe, and
publishes `/etc/dependabot-prep/selftest-attestation.json` under root ownership.
`pin` and `selftest-run` are root-only maintenance; `lease-clear` is explicit
`dependabot` maintenance.
The model UID must keep `/var/lib/dependabot/gh` empty, so direct `/usr/bin/gh`
has no credential. Only the separate `dependabot-mutator` nologin UID may read
the repository PAT at `/var/lib/dependabot-mutator/gh`. Model GitHub access goes
through the pinned broker clients: fixed-repository REST `GET` and sealed
one-page `pull-request-force-push-history` and `pull-request-review-threads`
GraphQL templates only;
root-owned `manual-research` and `verify-assisted` evidence; capability-bound
CodeRabbit review request, bounded comment, and bounded reply operations; and
exact-CAS `push` or exact-head-and-base `sync-base` for branch writes.
`sync-base` constructs and verifies a clean exact-base merge in root
quarantine, then uses exact-CAS push; no pull-request branch-update API is used.
The exact client allowlists are read
`gh-read`/`lineage`/`verify-assisted`/`selftest` and write
`push`/`sync-base`/`recreate`/`request-review`/`comment`/`reply`/`manual-research`;
the result verifier may call only `verify-prepared` and `run-manifest` directly.
Invoke each write client, including `manual-research`, as the sole foreground
command and preserve its direct exit status and complete output.
Never expose the PAT or bypass the broker.
Exact-head secretless CI provides validation. Local candidate execution requires
a separate `execute` grant and a tested isolation adapter. It must not submit an
approval, dismiss a review, enable auto-merge, merge, or use a merge queue. A
maintainer provides the current human approval and performs the final squash
merge.

For each pull request:

1. Query the live pull request. Record `generationBaseSha` as the authenticated
   native-generation ancestry anchor, `currentTargetBaseSha` as the live `main`
   OID used for preparation, and `policySha` as the Git blob OID of the exact
   policy file read from that target base. Verify the exact Dependabot bot
   identity, native generation, `dependabot/**` head ref, live head SHA, and
   `autoMergeRequest: null`. Admit a pre-existing non-native head only through
   the pinned root-owned broker's complete `dependabot-lineage` receipt-chain
   proof.
   An in-process or same-UID log is not authority.
2. Paginate every issue comment, review comment, review, thread, label, and
   timeline page before mutation. Collect force-push events through GraphQL
   `HeadRefForcePushedEvent` nodes and require every page plus exact
   `beforeCommit.oid` and `afterCommit.oid` values. Read applicable branch rules
   from `/repos/{owner}/{repo}/rules/branches/{branch}`, paginate the
   repository ruleset list, and read each full ruleset. Legacy branch protection
   is not the authority surface. Apply the exact maintainer, veto-label,
   close/reopen, branch-command, review-request, and force-push rules in
   `.github/dependabot-prep-policy.json`. Inspect the complete manifest,
   lockfile, workflow, and transitive dependency diff.
   Require the sealed normalizer's identity, status, and note. Only a
   non-prepared row may report rejected/incomplete evidence or literal `unknown`
   `generationBaseSha`/`policySha`; `currentTargetBaseSha` remains required. That
   is a valid blocked policy result, never prepared evidence.
3. For an ordinary npm update, an initially stale base, merge conflict, or red
   required check is work to attempt, not a terminal classification. Select one
   processing mode: `full`, `sync-only`, `review-only`, or `manual`. `full`
   permits base synchronization and bounded data-only repairs; `sync-only`
   permits only base synchronization; `review-only` never mutates the ref; and
   `manual` reserves the change for a maintainer or another controller. Final
   exact-head checks, CodeRabbit review, feedback, mergeability, current base,
   and absent auto-merge remain mandatory.
   `manual-hygiene` is the only exception to research-only `manual` mode. It
   keeps the final verdict `manual`, `blocked`, or `read-only` and permits only
   a broker-fixed Dependabot recreation, exact-head CodeRabbit request, and
   bounded comment or reply after a current root-owned research-gate receipt.
   It never permits `push`, `sync-base`, candidate execution, check reruns,
   approval, dismissal, merge, close, auto-merge, or thread resolution. An
   assisted handoff may report a current-base, conflict-free, review-clean head
   even when exact-head CI is red; it must never call that head `prepared`.
   A complete handoff requires a root-verified authorizing research receipt and
   a root-verified complete assisted-handoff receipt. Before and immediately
   after recreation, require the current base's exact pinned Dependabot-config
   blob, old-present/new-absent tuples, an open PR, unchanged base and head, and
   null auto-merge. Those checks reduce but cannot eliminate the residual that
   GitHub may later close or retarget the PR or that the base may race.
   After any research receipt is issued, movement of the target base or policy
   blob ends the whole run's mutation path; start a fresh root-authorized
   targeted run instead of replacing the receipt in-process.
   Copy only `status`, `lane`, `category`, `recreateProfile`,
   `autoMergeRequestNull`, `containsCurrentTargetBase`, `conflictFree`,
   `exactHeadCiComplete`, `exactHeadCiPassed`, `currentHeadReviewTerminal`,
   `unansweredActionableCount`, `answeredButUnresolvedCount`,
   `verificationSha256`, and `note` from `verify-assisted` into
   `assistedHandoff`; `receiptFile`, `receiptSha256`, and `verifiedAt` remain
   root verification metadata outside that projection.
4. Never mutate a ref for a direct pull-request change below
   `.github/workflows/**` or `.github/actions/**`. Only an authenticated minor
   or patch version update from the `github-actions-routine` group may use
   `review-only`, and only when every old and new `uses:` ref is a full lowercase
   40-character SHA and the unchanged native exact head is green. Major,
   security, sensitive, self-reviewing, ambiguous, or local-Action updates are
   `manual`.
   For an admitted npm PR, require the protected subtrees at the exact old head
   to match `currentTargetBaseSha` byte-for-byte and mode-for-mode before any
   ref mutation. GitHub requires workflow-write authority even when a push only
   carries workflow bytes from the base; this controller deliberately has no
   such authority. The `full`-mode automated recovery is the broker's fixed
   `recreate` operation, once per exact authenticated native npm generation; it
   posts `@dependabot recreate`, waits for a new head, and requires complete
   re-authentication as a new native generation. If that does not produce an
   admissible head, the result is `manual`. Neither the agent nor conflict
   resolution may carry or repair the mismatch. Verify equality before commit, in
   an independent quarantine, and immediately before mutation. Merge the
   current base with no-commit and no-fast-forward behavior. Create one
   two-parent merge commit, one one-parent repair commit on an already-current
   base, or no commit. Never rebase, force-push, or create an empty second commit.
   A clean `sync-only` branch may use only the root broker's exact-head-and-base
   bound `sync-base` operation and its post-mutation receipt. The broker builds
   and verifies the two-parent merge in root quarantine, then exact-CAS pushes
   it. Do not grant `Workflows: write`; a protected-tree mismatch or conflict
   may use the fixed `recreate` operation, but direct ref mutation fails closed.
5. Apply only changes needed for the dependency update or valid review
   findings. A semver-patch-only `next` update may use `full` only when its
   authenticated original delta is limited to the exact coupled Next
   declaration, override, lockfile-closure, and derived runtime-contract digest
   tuple. All other bytes and modes—including Vercel identity/configuration,
   `packageManager` and pnpm/runtime pins, workflows, Actions, and security
   policy—must remain byte-and-mode identical to `currentTargetBaseSha`, subject
   to the protected-tree precondition above. The agent may make a bounded
   data-only repair inside that tuple only when it is deterministically
   derivable without candidate or package-manager execution. Any ambiguity,
   extra agent-authored change, missing generatable state, or Next minor/major
   update is `manual`. Classify every Vercel CLI, protected Playwright runtime,
   protected pnpm runtime or bootstrap rotation, and packages matching the
   policy's exact wallet, signing, transaction, or bridge risk patterns as
   `manual`.
   Ordinary npm admission requires a strict forward stable-semver transition
   with the same range prefix; a downgrade, prerelease, source/protocol change,
   or ambiguous version is `manual`. An ordinary compatibility repair is
   permitted only after a separate clean base sync, in one child commit of the
   exact old head, and may modify only existing non-protected files below
   `apps/` or `packages/`. It may not modify a dependency manifest or lockfile,
   and the final manifest tuples must
   exactly equal the authenticated native tuples. Follow
   [`docs/dependency-overrides.md`](docs/dependency-overrides.md)
   only during the maintainer takeover. Keep GitHub Actions on full lowercase
   40-character SHA pins. Classify sensitive or self-reviewing
   Actions as `manual`. This includes OSV scanner/reporter updates. Move the OSV
   scanner action and the OSV reporter action together, to the same pinned
   revision, in one update. This is a version-pin rule about those two actions.
   It places no limit on how many times a workflow may invoke either one.
   Every `manual` verdict must still research each involved package from
   authoritative upstream changelogs, release notes, migration guides, and
   security advisories. At least one authoritative upstream HTTPS URL per exact
   name/from/to tuple must be fetched and live-verified. Only when none of those
   four desired source classes exists may an authoritative upstream project or
   package page be used as the explicit fallback. Record the exact missing
   desired source classes and lower confidence. Report the linked changelog or
   release-note sources, the relevant changes and repository impact, a
   recommendation, a `low`/`medium`/`high`/`critical`/`unknown` risk estimate,
   a `low`/`medium`/`high` confidence level with rationale, and every source
   failure or uncertainty. If no authoritative link can be live-verified, mark
   the research operationally incomplete; the sweep must exit `1`, not report a
   successful complete run. Never execute candidate code for this research.
   Require each exact name/from/to tuple both in the result's complete
   `dependencies` inventory and in `manualResearch.packages`; the sets must match.
6. Do not run repository commands in the scheduled no-exec clone. After each
   push, require exact-head CI to run `pnpm dependency:policy:test` plus every
   affected repository gate. Require the override validators from
   `docs/dependency-overrides.md` when a root override changes. If a required
   repair or generated file cannot be produced without candidate execution,
   classify the pull request as `manual`.
7. Push only to the verified pull-request head with an explicit refspec and an
   exact expected-old-head lease after an independent fast-forward proof. Push
   only through the root broker's exact-CAS `push` or `sync-base` operation.
   The broker's one-shot worker activates the reviewed HTTPS credential adapter
   under `dependabot-mutator` and removes it after the attempt; the model never
   holds, generates, or interpolates that credential.
   Do not push when the native head is already current and needs no repair.
   Post the exact `@coderabbitai review` issue comment once per eligible exact
   head, including an unchanged `review-only` or no-op head, and again after
   every push. Request the review from the existing CodeRabbit GitHub App. Bind the
   request to the current invocation, stable comment ID, operator tuple, and
   exact head. Accept only numeric ID `136622811`, login
   `coderabbitai[bot]`, type `Bot`, and a review whose immutable `commit_id`
   equals the pushed head. Reply to every review comment. Never resolve or
   unresolve a review thread. Record each answered thread for the maintainer to
   resolve at the final gate.
8. Re-read the live head and base. Repeat the loop if either differs from the
   prepared state. Handoff requires passing required checks from their expected
   check-run Apps or commit-status creators and workflows, answers for every
   actionable item, a current-head CodeRabbit review, and `MERGEABLE` state on
   the exact final head and base. List every answered but unresolved thread.
   Thread resolution and human approval remain separate final gates.

Report one verdict: `prepared for maintainer decision`, `blocked`, `manual`, or
`read-only`. Include the processing mode, pull request, all three bound SHA
roles, normalized force-push/rules/mutation-lineage evidence, exact final head
and base SHAs, dependency risk, validation, feedback state, and any blocker.
Include the mandatory research packet for every `manual` verdict. State that
human approval and the squash merge remain. During an active preparation run,
monitor checks and reviews at intervals shorter than ten minutes. Do not claim
preparation is complete when the head, base, checks, feedback, review, or
mergeability changed after validation.

A complete, schema-valid sweep that covers the exact inventory exits `0` even
when individual pull requests are `manual` or `blocked`, unless any manual
research result is `unavailable`. Unavailable research remains reportable but
makes the sweep operationally incomplete and exits `1`; other operational or
invalid/incomplete-result failures also exit `1`, pin or self-test drift exits
`2`, and active lease contention exits `3`. Report per-verdict
and per-processing-mode counts separately from operational status.

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
