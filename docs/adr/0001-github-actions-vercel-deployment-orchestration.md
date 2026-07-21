---
title: GitHub Actions owns Vercel build and deployment orchestration; Vercel remains hosting and runtime
status: active
owner: eng
canonical: true
last_verified: 2026-07-21
scope: ci/deployment
date: 2026-07
---

# ADR 0001 — GitHub Actions owns Vercel build and deployment orchestration; Vercel remains hosting and runtime

**Status:** Accepted (Jul 2026); phased rollout in progress.
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

This is not simply a runner substitution. Native Vercel Git currently provides
branch metadata, environment selection, preview discovery, domain movement,
and deployment statuses. A custom controller must replace those semantics
explicitly without weakening the preview experience or exposing deployment
credentials to untrusted code.

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
that target belongs to `v2`.

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

GitHub Actions will own compilation and deployment orchestration for ordinary
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
success. App and governance additionally retain the temporary native
`deployment_status` adapter only while Vercel Git still produces those events;
a status created with the repository `GITHUB_TOKEN` is evidence, not a trigger
contract.

The direct smoke is one credential-free reusable workflow shared by all four
targets and the temporary native adapter. Its input is an already verified,
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
non-runtime paths. Unknown paths, empty or unresolved diffs, shallow history,
non-ancestral ranges, malformed planner output, or graph errors select all four
targets rather than silently skipping a required deployment.

For previews, planning compares the immutable base and snapshotted PR head. For
`main`, planning compares the SHA currently served by each logical target with
the exact new `main` SHA; it does not rely on `github.event.before`, because
coalesced or superseded runs can skip intervening commits.

### Main release transaction

The main controller runs only from the trusted default-branch workflow
definition after the exact `CI/CD` run and exact `Build and Test` job succeed
for the deployment SHA. It rechecks that the candidate is still current `main`
before the transaction and immediately before and after every public mutation.

Governance, reserve, and UI are built as unaliased staged production
deployments, inspected, and runtime/browser verified before any domain moves.
They are then promoted sequentially by exact immutable deployment ID. The app
`v3` prebuilt candidate is built and verified under custom-environment semantics
before mutation, but `vercel deploy --prebuilt --target=v3` runs last because
that upload is itself the activation mutation when attached `v3` domains move.
The controller then verifies every reviewed alias and assigns only those that do
not already point to the exact deployment as intended. `--prod` and
`vercel promote` are forbidden for the app `main -> v3` path.

Before mutation, the controller records the exact prior deployment and every
protected alias for every selected target. It journals intent before each
command and verifies the observed mapping afterward. Stale-main detection,
failure, cancellation, timeout, or unknown command outcome initiates
reverse-order compensation to that captured set. Unexpected operator-owned
mappings stop for manual review rather than being overwritten. The design does
not claim cross-project atomicity; it provides a bounded, auditable transaction
with explicit compensation.

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

Vercel Git remains authoritative until each Actions path has shadow or pilot
evidence. Preview paths cut over before `main`; the three ordinary production
targets prove no-domain staging, and app `v3` proves its activation semantics,
before the final reviewed ownership change.

`git.deploymentEnabled` branch rules disable only replaced native paths. The app
configuration always retains `v2: true`. There is no permanent state in which
native Vercel Git and GitHub Actions both automatically activate the same
target/SHA. Recovery sets GitHub's controller to `observe-only` mode and restores
the prior Vercel Git branch rules in the same reviewed change, then proves the
native canary path before treating Vercel Git as owner again.

For UI branch previews, that boundary is executable:
`.github/workflows/vercel-preview-controller.yml` carries a
version-controlled `active` or `observe-only` mode, and
`scripts/vercel-git-ownership.test.mjs` accepts only `active` paired with native
branch previews disabled or `observe-only` paired with native ownership
restored. `observe-only` retains receipts, terminal recovery, and status
evidence but cannot dispatch a new worker.

Ordinary targets recover with exact captured deployment IDs and verify every
domain after rollback. App `v3` recovers each reviewed alias independently to
its captured immutable URL, then verifies `v2-app.mento.org` is unchanged.
Commands such as `latest` are never rollback evidence.

### Cost and success gate

The migration succeeds only after at least seven complete post-cutover days and
ten eligible trusted PR pushes show at least a 90% target-by-path-normalized
reduction in raw Vercel Build CPU minutes for the migrated paths. Evidence also
tracks standard/larger runner usage, storage added by the migration, queue and
build durations, duplicate attempts, first-preview delivery, path-planning
correctness, smoke results, and preserved app `v2` activity.

Account-specific prices, allocations, invoices, and absolute cost values remain
private. Public evidence contains redacted aggregates and reproducible formulas
only. If the threshold, correctness, security, or service-quality gates fail,
the epic remains open and the unexplained build source gets a focused follow-up
instead of being normalized away.

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
shadow proof where exactly one path can serve public traffic.

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
  runner billing or limits materially change, Actions reliability/latency is
  worse than the acceptance bounds, normalized savings miss the threshold, or
  Vercel introduces a simpler build-offload mechanism with equivalent security
  and transaction semantics.

## Evidence

### Tracked rollout

Status at decision adoption on 2026-07-15:

| Issue                                                                  | Responsibility                                                 | Adoption status                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| [#515](https://github.com/mento-protocol/frontend-monorepo/issues/515) | Epic and non-negotiable behavior                               | Open; rollout owner                                        |
| [#516](https://github.com/mento-protocol/frontend-monorepo/issues/516) | Planner, deployment ID, environment primitives                 | Complete                                                   |
| [#517](https://github.com/mento-protocol/frontend-monorepo/issues/517) | Maintainer-provisioned credentials and mapping                 | Open                                                       |
| [#518](https://github.com/mento-protocol/frontend-monorepo/issues/518) | Manual no-cutover UI pilot and cost go/no-go                   | Open; pilot implementation merged, live acceptance pending |
| [#519](https://github.com/mento-protocol/frontend-monorepo/issues/519) | Automatic UI previews and durable batching                     | Open                                                       |
| [#520](https://github.com/mento-protocol/frontend-monorepo/issues/520) | App, governance, and reserve preview cutover                   | Open                                                       |
| [#521](https://github.com/mento-protocol/frontend-monorepo/issues/521) | Main shadow proof and app `v3` semantics                       | Open                                                       |
| [#522](https://github.com/mento-protocol/frontend-monorepo/issues/522) | Main transaction, cutover, rollback, and app `v2` preservation | Open                                                       |
| [#523](https://github.com/mento-protocol/frontend-monorepo/issues/523) | Observation, savings proof, and migration cleanup              | Open; analyzer preparation merged, observation not started |

Merged implementation evidence:

- [PR #513](https://github.com/mento-protocol/frontend-monorepo/pull/513) —
  Dependabot preview suppression and smaller native build work.
- [PR #524](https://github.com/mento-protocol/frontend-monorepo/pull/524) —
  fail-closed planning, deployment IDs, build-environment contract, and pinned
  prebuilt prerequisites; closes #516.
- [PR #525](https://github.com/mento-protocol/frontend-monorepo/pull/525) —
  manual exact-SHA UI prebuilt pilot implementation; #518 remains open pending
  its privileged run and evidence.
- [PR #528](https://github.com/mento-protocol/frontend-monorepo/pull/528) —
  public-safe cost-analysis tooling in preparation for #523; it does not start
  the observation window.

Canonical repository evidence:

- [`docs/vercel-deployments.md`](../vercel-deployments.md) — current target,
  environment, build, pilot, and security runbook.
- `scripts/plan-vercel-deployments.mjs` and its offline fixtures — fail-closed
  affected-target planning.
- `scripts/vercel-prebuilt.mjs` and `scripts/vercel-build-environment.mjs` —
  pinned-version, deployment-ID, output, and environment contracts.
- `.github/workflows/vercel-prebuilt-pilot.yml` and
  `.github/workflows/_vercel-prebuilt.yml` — merged manual pilot path, not an
  automatic cutover.
- [`docs/vercel-cost-validation.md`](../vercel-cost-validation.md) — private
  evidence boundary and public aggregate acceptance calculations.

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
