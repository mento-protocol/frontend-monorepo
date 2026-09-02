---
title: GitHub Actions owns Vercel build and deployment orchestration; Vercel remains hosting and runtime
status: active
owner: eng
canonical: true
last_verified: 2026-09-02
scope: ci/deployment
date: 2026-07
---

# ADR 0001 — GitHub Actions owns Vercel build and deployment orchestration; Vercel remains hosting and runtime

**Status:** Accepted (Jul 2026); preview and active-main cutovers are complete.
Amended 2026-09-01 to retire the legacy App v2 path per MGP-18. Amended
2026-09-02 to retire the App custom `v3` environment and its transitional
bridge, completing MGP-18's normalization.
**Scope:** ci/deployment

## Context

The monorepo's CI already compiles application code on GitHub Actions while
Vercel's Git integration compiles the same commits again for four frontend
projects. That duplicate work increased Vercel build-machine usage and made
build cost depend on every native preview and `main` deployment. The hosting
features that follow compilation—immutable deployments, CDN delivery,
Functions, custom environments, domains, preview URLs, and runtime services—are
still valuable and are not the source of the duplication.

The decision therefore separates **who builds and orchestrates** from **who
hosts and serves**:

```text
trusted pull request or main commit
  -> GitHub Actions on a standard hosted runner
     -> fail-closed affected-target plan
     -> vercel pull
     -> vercel build
     -> verify the exact prebuilt output
     -> vercel deploy --prebuilt
     -> smoke, status, and controlled activation
  -> Vercel deployment, CDN, domains, Functions, and runtime
```

This is not simply a runner substitution. At decision time, native Vercel Git
provided branch metadata, environment selection, preview discovery, domain
movement, and deployment statuses. A custom controller had to replace those
semantics explicitly without weakening the preview experience or exposing
deployment credentials to untrusted code.

The live target topology also prevents a blanket production design:

| Source            | Vercel target                                         | Public surface         | Required ownership after rollout                                  |
| ----------------- | ----------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| app `main`        | custom environment `v3` with preview system semantics | `app.mento.org`        | GitHub builds/deploys `--target=v3` and controls reviewed aliases |
| app `v2`          | Vercel production                                     | `v2-app.mento.org`     | Vercel Git remains owner                                          |
| governance `main` | Vercel production                                     | `governance.mento.org` | GitHub stages, verifies, and promotes exact deployments           |
| reserve `main`    | Vercel production                                     | `reserve.mento.org`    | GitHub stages, verifies, and promotes exact deployments           |
| UI `main`         | Vercel production                                     | `ui.mento.org`         | GitHub stages, verifies, and promotes exact deployments           |

The app's custom `v3` environment must retain `VERCEL_ENV=preview`,
`VERCEL_TARGET_ENV=v3`, and `NEXT_PUBLIC_VERCEL_ENV=preview`. It must never be
implemented by promoting the app project's legacy production target, because
that target belongs to `v2`. The removed Governance QA environment is not part
of the target topology.

The forces behind the choice are:

- materially reduce Vercel build-minute spend while retaining Vercel hosting;
- keep the first eligible preview automatic for every trusted human pull
  request—previews must not become opt-in;
- avoid waste from intermediate pushes without making correct scheduling depend
  on local developer behavior or GitHub concurrency ordering;
- skip proven non-runtime changes, but deploy all affected targets on ambiguous
  history, paths, or planner failures;
- preserve exact source SHA, branch, environment, and deployment identity from
  build through smoke and activation;
- keep fork and Dependabot code outside every Vercel credential boundary;
- preserve app `v2` and make a partially activated multi-project `main` release
  recoverable.

## Decision

### Ownership boundary

GitHub Actions owns compilation and deployment orchestration for ordinary
trusted pull-request previews and `main` releases. Vercel remains the deployment
store, hosting platform, CDN, domain/alias provider, Functions runtime, and
runtime-service provider. The Vercel GitHub integration is retained for source
metadata and the legacy app `v2` path; only automatic Git builds replaced by a
proven Actions path are disabled.

All builds use standard GitHub-hosted runners. Build and
`vercel deploy --prebuilt` run in the same job; `.vercel/output` is not uploaded
as a GitHub artifact or passed across a trust boundary. The Vercel CLI is pinned
to an exact version. Each attempt receives a deterministic Next.js deployment
ID derived from target, exact SHA, Actions run ID, and run attempt, and the
verified output carrying that ID is the output uploaded.

This decision relies on the current GitHub billing treatment for standard
hosted runners in public repositories. Larger runners are excluded because
they remain charged, and artifact/cache storage is measured separately rather
than described as free. A future repository visibility or billing-policy change
requires re-evaluation.

ADR 0005 amends the active-main rerun contract: stable release identity and
target-specific candidate identity are distinct from the attempt-derived
mutation and journal identity described here. This historical ADR remains
accepted; the newer ADR defines
provider-side manifest reconciliation, current-attempt recovery, and terminal
receipt handoff without changing the original per-attempt statement.

### Preview controller

A same-repository, non-Dependabot pull request that changes a runtime target
receives a preview automatically on its first eligible push. Later eligible
pushes remain automatic. Documentation-, test-, or other proven non-runtime
changes report an explained skip. Forks and Dependabot receive neither Vercel
credentials nor a deployment.

Dependabot status handling uses a two-workflow trust split. The
`pull_request_target` intake has read-only repository permission and executes no
checkout, artifact, secret, or pull-request code. Its completed
`workflow_run` invokes trusted default-branch controller code, which validates
the intake identity and re-queries the exact current PR head before publishing
the preview-disabled success status. This preserves an explicit terminal status
without assuming Dependabot-triggered write permissions or moving credentials
into the untrusted trigger.

Bursty pushes use a deterministic **first-plus-latest** controller rather than
asking developers to batch correctly:

1. A trusted metadata-only controller records immutable PR event receipts and
   per-target state outside lossy workflow concurrency.
2. The first eligible exact SHA is dispatched exactly once, even if a later
   event's Actions run starts first.
3. While that worker runs, later pushes replace only `latest_desired_sha`.
4. When the active worker is terminal, the controller dispatches the latest
   desired SHA exactly once if it differs from the completed SHA.
5. Duplicate delivery, reconciliation, worker retries, and callbacks are
   idempotent no-ops for an already recorded target/SHA key.

This preserves the initial visual/functional review guarantee, converges to the
current PR head, and deterministically drops only superseded intermediate
builds. GitHub `concurrency` may serialize reconciliation, but it is not the
selection algorithm because pending-run replacement and start ordering cannot
guarantee which event runs first.

Each worker creates or reuses one GitHub Deployment whose `ref` is the selected
40-character SHA, then reports queued, in-progress, and a truthful terminal
status. Every selected target runs direct smoke against its immutable URL before
success. App and governance retain a rollback-only native `deployment_status`
adapter for bounded target-local recovery; it is not an ordinary native preview
path. It exists only because these documented rollback paths require native
deployment proof. A status created with the repository
`GITHUB_TOKEN` is evidence, not a trigger contract.

The direct smoke is one credential-free reusable workflow shared by all four
targets and the bounded native adapter. Its input is an already verified,
mode-discriminated metadata tuple; it never looks up deployment metadata with a
token. Native App/Governance events are accepted only for the exact Vercel bot,
exact preview environment, empty native payload, successful status, and exact
project-slug team host. They always run the full smoke: historical status reuse
was rejected because deployment-status writers could forge description-only
dedupe and the extra reconstruction complexity would save public Actions
minutes rather than Vercel build minutes. The adapter also has no shared
concurrency group: GitHub may replace an older pending member of a concurrency
group even with `cancel-in-progress: false`, so grouping would violate the
one-full-smoke-per-qualifying-event invariant.

### Path-aware planning

Deployment planning is repository-owned, deterministic, and offline-testable.
It uses the real Turborepo package graph and a small reviewed list of proven
non-runtime paths. The list names each current documentation or dependency
policy file. It does not match a workflow or script prefix. New, renamed, or
near-match files remain unknown. Unknown paths, empty or unresolved diffs,
shallow history, non-ancestral ranges, malformed planner output, or graph
errors select all four targets rather than silently skipping a required
deployment.

For previews, planning compares the immutable base and snapshotted PR head. For
`main`, planning compares the SHA currently served by each logical target with
the exact new `main` SHA; it does not rely on `github.event.before`, because
coalesced or superseded runs can skip intervening commits.

The main handoff uses strict schema `vercel-main-plan:v2`. Its canonical
four-target `mainOwnershipMode` map partitions the ordered `stagedTargets` into
disjoint `activeTargets` and `shadowTargets`. Every selected target still
stages or builds; only GitHub-owned active targets enter the forward mutation
list. Global active mode permits a mixed map for target-local rollback. Global
shadow mode requires all four targets to be shadow-owned. Missing, extra,
malformed, or contradictory ownership state fails closed.

### Main release transaction

The main controller runs only from the trusted default-branch workflow
definition after the exact `CI/CD` run and exact `Build and Test` job succeed
for the deployment SHA. It rechecks that the candidate is still current `main`
before the transaction and immediately before and after every public mutation.

Governance, reserve, and UI are built as staged production deployments without
custom production domains, inspected, and runtime/browser verified before any
protected or custom production domain moves. In the reviewed CI topology, each
staged deployment exposes its immutable hostname through the deployment
URL/state identity. Vercel's provider alias list always contains the pinned
target-bound base project/team alias and can contain one author-scoped alias.
The controller accepts the author alias only when it is derived exactly from
the canonical deployment `creator.username` plus the target's pinned project
and scope slugs. It rejects protected, branch, global, wrong-target, second
author, or other extra aliases and fails safely if Vercel changes that
topology. A `git-*` creator can use the base-only form, but cannot authorize the
ambiguous author/branch hostname; the same rule reserves `env-*` against
custom-environment aliases. The ordinary upload implicitly moves those generated
system aliases, so the controller treats staging as a limited public-routing
mutation: it rechecks current `main`, journals the intended upload, verifies the
resulting immutable deployment and generated-alias topology, and retains the
transaction evidence before continuing. The deployments are then promoted
sequentially by exact immutable deployment ID. The app `v3` prebuilt candidate
is built and verified under custom-environment semantics before its app-v3
activation mutation, but `vercel deploy --prebuilt --target=v3` runs last
because that upload is itself the activation mutation when attached `v3`
domains move. The controller then verifies every reviewed alias and assigns only
those that do not already point to the exact deployment as intended. The three
ordinary public custom domains are the only protected runtime and rollback
aliases; generated project/team and creator-scoped aliases are
candidate-verification evidence only. `--prod` and `vercel promote` are
forbidden for the app `main -> v3` path.

Before mutation, the controller records the exact prior deployment and every
protected public alias for every selected target. It journals intent before
each command and verifies the observed mapping afterward. Each transition is
persisted as an immutable, sequence-derived artifact before the next mutation;
recovery validates the complete gap-free history and selects the highest valid
snapshot. Stale-main detection, failure, cancellation, timeout, or unknown
command outcome initiates reverse-order compensation to that captured set.
Unexpected operator-owned mappings stop for manual review rather than being
overwritten. The design does not claim cross-project atomicity; it provides a
bounded, auditable transaction with explicit compensation.

After activation, a fail-closed duplicate census proves that no unexpected
serving or pending deployment exists for a replaced `main` path at the exact
target/SHA release. For a project without an expected candidate, an
exact-project, exact-SHA deployment in terminal `CANCELED` state remains
visible as inert evidence and cannot satisfy the candidate or mapping proof.
Legacy App `v2 -> production` activity is classified and verified separately
instead of being mislabeled as a duplicate `main -> v3` deployment.

If recovery has already restored and verified every protected prior mapping and
credential-free runtime smoke, but the final duplicate census cannot be proven,
the terminal evidence retains those verified facts with a bounded non-secret
census-failure category. The release still fails as
`recovered-census-unproven`; this outcome is not evidence that the duplicate
census passed and never authorizes forward progress.

### Trust and credential boundary

- Pull-request code is never executed by a credentialed
  `pull_request_target` controller. If that event is used, it handles metadata
  only; trusted default-branch workflow code dispatches and revalidates the
  separately scoped worker.
- A worker snapshots and checks out one exact SHA and revalidates that it
  belongs to an open eligible same-repository PR before exposing preview
  credentials. It may still deploy the selected first SHA after the PR advances.
- Production credentials are scoped to a dedicated main-restricted GitHub
  environment. Preview and production capabilities are separate where the
  provider permits it.
- Tokens, pulled environment files, output directories, cookies, bypass values,
  and raw provider responses never enter artifacts, issue comments, summaries,
  or logs. System variables absent from prebuilt builds are supplied from an
  audited allowlist rather than assumed.
- GitHub Deployment creation is explicit and idempotent. Actions environments
  used only for credentials suppress implicit event-SHA deployments, and
  Vercel is not asked to create a duplicate GitHub Deployment.

### Phased cutover and rollback

The rollout kept Vercel Git authoritative until each Actions path had shadow or
pilot evidence. Preview paths cut over before `main`; the three ordinary
production targets proved staging without protected/custom-domain promotion,
and App `v3` proved its activation semantics before the final reviewed
ownership change.

The current version-controlled preview map assigns App, Governance, Reserve,
and UI to GitHub Actions. App's configuration change was accepted after its
exact-head PR #609 and fresh post-merge PR #610 canaries passed, following the
earlier Governance post-merge canary. Ordinary native branch previews are now
disabled for every target.

Historical PR A of #522 added a separate automatic `Vercel Main Deployment`
workflow in literal `shadow` mode. It authenticated the exact successful
upstream CI attempt, planned from each target's actual served SHA, staged and
browser-smoked selected ordinary production candidates, built selected App
custom-`v3` output without uploading it, and verified the durable
transaction/recovery handoff. Shadow mode structurally could not promote,
deploy App `v3`, assign an alias, roll back, run a recovery mutation, or change
Vercel Git ownership. Vercel Git remained the only public `main` activation
owner during this proof. The coordinator reported exactly `no-target`,
`superseded-before-journal`, `superseded-after-journal`, or `shadow-prepared`.
A durable journal existed only for the latter two outcomes, which required
`verified-no-mutation`; the other two required `not-required`. The final job
validated that matrix without ending the job, wrote either the full success
evidence or a minimal redacted failure graph, uploaded
`vercel-main-evidence-${run_id}-${run_attempt}` for seven days, and only then
returned the terminal result.

A later amendment widened that admission without weakening it. The workflow now
subscribes to both the `requested` and `completed` `workflow_run` activity
types, so read-only planning overlaps CI, and exact-attempt success authority
moved from admission into a dedicated credential-free gate job that every
public-mutation job requires. That job's name binds the exact upstream run and
attempt, which is the only durable proof a later run can query. A `completed`
delivery for a successful CI attempt still performs the full terminal
verification and deploys unless a deployment run for that exact upstream
attempt both passed the gate and concluded `success`; a failed attempt's
`completed` delivery is never admitted.

That success authority is one credential-free check with two placement forms.
Every candidate-upload, activation, and recovery job takes a `needs` edge on the
gate job. `restore-inherited-release` instead runs the same check as its own
first executable step, because its skip on the fast path would otherwise hold
the whole graph behind the gate job; implicit needs-success binds its
one-checkout prefix and the in-job check binds the verdict before any
credentialed or mutating step. `prepare-release` left the gate `needs` edge
entirely: it is read-only end to end, and now derives the sentinel from its own
bounded `require-success` call immediately before the single step that consumes
it. The structural workflow test asserts the ordering by step index, not by
convention, and pins which jobs may use the in-job form. See the
runbook sections "Exact upstream attempt
admission", "Exact-attempt CI success gate", "Read-only pre-gate window", "Gate
placement", and "Duplicate completed-event runs" in
[docs/vercel-deployments.md](../vercel-deployments.md).

The same amendment moved the app `v3` build out of the activation job into a
parallel `stage-app` job, so all four targets build concurrently. `stage-app`
still creates no provider deployment. It hands the verified output to
activation within the same run attempt as one uncompressed archive whose
SHA-256 digest, byte count, artifact name, run attempt, and candidate ID travel
as job outputs through the `needs` graph. That payload is transport, never
authority: activation re-establishes every property of the tree in its own
attempt before the transaction, so GitHub artifacts remain no alternate
cross-attempt authority. See "Same-run App custom-`v3` payload handoff" in
[docs/vercel-deployments.md](../vercel-deployments.md).

The active topology from the separately reviewed PR-B cutover enables
active mutation and disables the replaced native `main` paths in the same
commit. The checked-in global mode is `active`, and all four per-target main
ownership entries are `github`. App always retains `v2: true`; legacy
`v2 -> production` remains Vercel-Git-owned and is verified independently
before and after activation or recovery. The live #522 cutover evidence is
accepted.

`git.deploymentEnabled` branch rules disable only replaced native paths. The app
configuration always retains `v2: true`. Outside a bounded shadow canary or
rollback proving period, native Vercel Git and GitHub Actions do not both
automatically activate the same target/SHA. A target-local recovery atomically
restores that target's prior Vercel Git branch rules and changes only its
ownership mode from `github` to `shadow`; the controller stays `active` so
already-proven GitHub-owned targets remain available. The recovered target then
proves both its native path and GitHub shadow canary before another cutover.
Preview ownership remains GitHub-owned throughout this main-only rollback.

Preview ownership is an independent axis. The executable model has four exact
states per target: GitHub preview/GitHub main, GitHub preview/native main,
native preview/GitHub main, and fully native. Because Vercel enables unspecified
branches by default, the native-preview/GitHub-main state explicitly sets
`main: false` and `dependabot/**: false` while leaving ordinary preview branches
unspecified; App also explicitly retains `v2: true`. A target-local preview
rollback therefore cannot re-enable native main or create duplicate main
ownership.

That two-axis boundary is executable per target:
`scripts/vercel-git-ownership.test.mjs` accepts only each target's exact
canonical configuration paired with both reviewed ownership modes. A
full-native main rollback is separate: one reviewed change restores all four
native `main` branch rules and sets all four main ownership entries to
`shadow`; only that all-shadow map may use global `shadow` mode. Main-owner
rollback does not change the GitHub-owned preview map, and preview-owner
rollback does not change the GitHub-owned main map. The preview controller's
`observe-only` mode is a separate coordinated preview shutdown and is not a
main target-local rollback.

Ordinary targets recover with exact captured deployment IDs and verify every
domain after rollback. App `v3` recovers each reviewed alias independently to
its captured immutable URL, then verifies `v2-app.mento.org` is unchanged.
Commands such as `latest` are never rollback evidence.

### Accepted cost outcome

The fixed measurement interval recorded 16 Build CPU minutes. Its
target-mix-normalized counterfactual was 100.23649463908816 Build CPU minutes.
The reduction was 84.03774986584511%, reported as 84.04%.

The original acceptance gate required a reduction of at least 90%, so that
gate returned false. On 2026-08-26, the maintainer accepted the measured 84.04%
reduction as a successful product outcome. This decision preserves the original
gate result and closes the cost-success decision.

Account-specific prices, allocations, invoices, and absolute cost values remain
private. This ADR records only the accepted Build CPU aggregate and formula
inputs.

## Alternatives considered

### Keep native Vercel Git and add path-aware protection

Vercel supports `ignoreCommand`, and a shared fail-open-on-ambiguity diff script
could skip demonstrably irrelevant changes without much repository complexity.
`git.deploymentEnabled` can also disable selected branches entirely. These are
useful interim controls and are part of the reversible cutover.

Rejected as the final architecture: an ignored build is still represented as a
canceled deployment and can occupy a concurrent-build slot; the command also
must reconstruct a trustworthy diff in Vercel's sometimes shallow or Gitless
builder context. More importantly, it leaves compilation and orchestration on
Vercel and cannot provide one exact-SHA, multi-project main transaction. It
reduces waste but does not remove the duplicated build owner.

### Optimize only the native Vercel builds

Dependabot skipping, production-only source-map work, tighter Turbo inputs, and
better cache behavior are worthwhile and remain in place. Rejected as the sole
solution because cache hits and faster builds lower duration but retain a
second compilation for every eligible commit and leave cost coupled to Vercel
build billing.

### Make previews opt-in

Rejected. A preview on the first eligible push is part of feature verification,
not optional convenience. Labels, comments, or manual dispatch before the first
preview would trade a deterministic product-quality guarantee for cost. The
chosen first-plus-latest controller removes only superseded intermediate work.

### Permanent dual ownership

Rejected. Allowing Vercel Git and Actions to deploy the same target would create
duplicate cost, competing GitHub Deployments, and races over aliases/domains.
Dual execution is allowed only during a bounded non-authoritative pilot or
shadow proof where exactly one path owns protected and custom production
traffic.

### GitHub-hosted prebuilt uploads

Chosen. Standard GitHub-hosted runners provide clean managed execution for this
public repository, while Vercel's Build Output API and
`vercel deploy --prebuilt` preserve the platform's deployment/runtime layer.
The approach meets the cost boundary without adding runner fleet operations.

### Self-hosted Actions runners

Rejected for this migration. Actions does not charge self-hosted runner minutes,
but maintainers would own machines, patching, isolation, scaling, queueing, and
cleanup. Jobs are not guaranteed a clean instance. That operational and trust
surface is unjustified while standard public-repository runners meet the need.

### Leave Vercel entirely

Rejected. Replacing Vercel hosting, domains, CDN, Functions, preview URLs,
custom environments, and runtime integrations would greatly expand scope and
operational risk. The cost problem is duplicated compilation, not demonstrated
failure of the hosting/runtime platform.

## Consequences

- Vercel remote build minutes for migrated paths should fall substantially,
  while GitHub Actions runner time and queue latency increase and must be
  observed.
- Deployment workflows become production controllers, so exact-SHA provenance,
  current-main checks, journaling, idempotency, timeout handling, browser smoke,
  and rollback tests are correctness requirements rather than optional polish.
- Preview behavior stays automatic for trusted human PRs, Dependabot stays
  preview-disabled, and bursty work converges through durable first-plus-latest
  state instead of developer convention.
- The affected-target planner centralizes path-aware protection and must fail
  closed to all targets when it cannot prove a narrower result.
- Vercel remains an operational dependency. This decision does not reduce CDN,
  Functions, bandwidth, image optimization, or other runtime costs.
- The legacy app `v2` path intentionally remains exceptional and must be tested
  independently during every ownership change and rollback exercise.
- The ADR should be reconsidered if repository visibility changes, standard
  runner billing or limits materially change, Actions reliability or latency
  becomes unacceptable, or Vercel introduces a simpler build-offload mechanism
  with equivalent security and transaction semantics.

## Amendment — 2026-09-01 to 2026-09-02: App normalized under MGP-18

Governance proposal MGP-18 passed. The legacy App v2 path is removed from the
pipeline: Vercel-native Git production from branch `v2` serving
`v2-app.mento.org` no longer exists. The `app v2` row of the target table
above (lines 49–55) no longer exists. The design goal to preserve app `v2`
(lines 75–76) and the Git-integration retention rationale for `v2` (lines
85–87) no longer apply. Every "App always retains `v2: true`" statement above
(lines 241, 343–349, 363, 380, 473, 495) is historical: `apps/app.mento.org/vercel.json`
is now `{"git":{"deploymentEnabled":false}}`, like the other three apps.
Recovery now has five static turns (three ordinary plus two App-alias
transitions) instead of nine. The custom-v3 App path is unchanged by this
amendment. A follow-up change (planned) will also normalize the App target
to the ordinary production target described elsewhere in this ADR.

That follow-up shipped, in three steps: normalizing App onto the same
staged-production model as every other target; a manual dashboard move of the
`app.mento.org` domain into the Production environment; and a final tighten
step that removed every transitional mechanism the move needed. All three are
complete. App now stages and promotes through the native Production
environment exactly like Governance, Reserve, and UI: `stage-app` builds and
uploads a real candidate with production semantics, and activation promotes
it with the same `vercel promote` command every other target uses, verified
at `candidate`. There is no bridge alias operation; `promote` and
`ordinary_rollback` are the only operation types, and recovery is back down to
four static turns — one per promotable target (Governance, Reserve, UI, App) —
instead of the five the bridge slot required. The custom `v3` environment
is retired: `ENVIRONMENT_SEMANTICS.v3` is deleted from
`scripts/vercel-build-environment.mjs`, `TARGET_ENVIRONMENTS.app` is
`["preview", "production"]`, and the retired generated alias
`appmentoorg-env-v3-mentolabs.vercel.app` is rejected everywhere. Every
`TRANSITION-V3-PRIOR` tolerance — the App-only prior shape and the
bridge-specific `verified_noop` recovery rule — is deleted; App's prior is
now held to the same production contract as its candidate, exactly like
every other target. One narrow admission remains permanently: an immutable
bridge-era sealed manifest on a mapped production deployment — valid under
the current contract except for the exact bridge-era App prior shape — is
admitted as an unmarked rollback-only prior, because seals are immutable and
operator rollbacks can re-map one at any time. The
v3-specific deploy command (`vercel deploy --prebuilt --target=v3`), the
same-run App payload handoff between `stage-app` and activation, and the
post-hoc App candidate-discovery machinery remain removed; App carries a
known staged `deploymentId` before activation, exactly like every other
target. Provider-side, `app.mento.org` is a Production-environment domain and
`v2-app.mento.org` is a 308 redirect to it; the `v3` custom environment is
empty and is deleted from the Vercel project after this PR merges.

## Evidence

### Tracked rollout

Rollout status reverified on 2026-08-26:

| Issue                                                                  | Responsibility                                                 | Adoption status                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| [#515](https://github.com/mento-protocol/frontend-monorepo/issues/515) | Epic and non-negotiable behavior                               | Open; rollout owner                          |
| [#516](https://github.com/mento-protocol/frontend-monorepo/issues/516) | Planner, deployment ID, environment primitives                 | Complete                                     |
| [#517](https://github.com/mento-protocol/frontend-monorepo/issues/517) | Maintainer-provisioned credentials and mapping                 | Complete                                     |
| [#518](https://github.com/mento-protocol/frontend-monorepo/issues/518) | Manual no-cutover UI pilot and cost go/no-go                   | Complete                                     |
| [#519](https://github.com/mento-protocol/frontend-monorepo/issues/519) | Automatic UI previews and durable batching                     | Complete                                     |
| [#520](https://github.com/mento-protocol/frontend-monorepo/issues/520) | App, governance, and reserve preview cutover                   | Complete                                     |
| [#521](https://github.com/mento-protocol/frontend-monorepo/issues/521) | Main shadow proof and app `v3` semantics                       | Complete                                     |
| [#522](https://github.com/mento-protocol/frontend-monorepo/issues/522) | Main transaction, cutover, rollback, and app `v2` preservation | Complete                                     |
| [#523](https://github.com/mento-protocol/frontend-monorepo/issues/523) | Observation, savings proof, and migration cleanup              | 84.04% accepted; cleanup complete in PR #853 |

Merged implementation evidence:

- [PR #513](https://github.com/mento-protocol/frontend-monorepo/pull/513) —
  Dependabot preview suppression and smaller native build work.
- [PR #524](https://github.com/mento-protocol/frontend-monorepo/pull/524) —
  fail-closed planning, deployment IDs, build-environment contract, and pinned
  prebuilt prerequisites; closes #516.
- [PR #525](https://github.com/mento-protocol/frontend-monorepo/pull/525) —
  historical exact-SHA UI prebuilt pilot implementation; #518 is complete.
- [PR #604](https://github.com/mento-protocol/frontend-monorepo/pull/604) and
  [PR #609](https://github.com/mento-protocol/frontend-monorepo/pull/609) —
  final Governance and App preview-ownership cutovers; all four ordinary
  previews are now GitHub-owned.
- [PR #616](https://github.com/mento-protocol/frontend-monorepo/pull/616) and
  [PR #620](https://github.com/mento-protocol/frontend-monorepo/pull/620) —
  repo-linked Vercel settings validation and isolated production-shadow
  runtime, completing #521's protected main prerequisites.

Canonical repository evidence:

- [`docs/vercel-deployments.md`](../vercel-deployments.md) — current target,
  environment, build, rollback, and security runbook.
- `scripts/plan-vercel-deployments.mjs` and its offline fixtures — fail-closed
  affected-target planning.
- `scripts/vercel-prebuilt.mjs` and `scripts/vercel-build-environment.mjs` —
  pinned-version, deployment-ID, output, and environment contracts.
- `.github/workflows/vercel-preview-worker.yml` and
  `.github/workflows/_vercel-prebuilt.yml` — active automatic preview worker and
  reusable prebuilt pipeline.
- `.github/workflows/vercel-main-deployment.yml`,
  `scripts/vercel-main-deployment.mjs`, and the exact-attempt, served-SHA,
  transaction, ownership-partition, active mutation, recovery, duplicate-census,
  and runtime helpers — historical PR-A shadow proof and the active-main
  contract.
  Primary platform references, verified at adoption:

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
  and [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
  — standard hosted runners for public repositories and the larger-runner
  exception.
- [GitHub self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)
  — operator ownership and persistence trade-offs.
- [Vercel CLI deploy](https://vercel.com/docs/cli/deploy) — prebuilt upload
  behavior and the build-time system-variable caveat.
- [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
  — branch-selective `git.deploymentEnabled` behavior.
- [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json)
  — `ignoreCommand` exit semantics.
- [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings)
  — ignored-build deployment and concurrent-slot behavior.
