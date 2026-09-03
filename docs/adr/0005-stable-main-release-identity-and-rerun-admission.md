---
title: Stable active-main release identity and provider-side rerun reconciliation
status: active
owner: eng
canonical: true
last_verified: 2026-09-02
scope: ci/deployment/main-reruns
date: 2026-07
---

# ADR 0005 — Stable active-main release identity and provider-side rerun reconciliation

**Status:** Accepted (Jul 2026). Amended 2026-09-01 to retire the legacy App
v2 continuity proof per MGP-18. Amended 2026-09-02 to stage App through the
Production environment.
**Scope:** ci/deployment/main-reruns

## Context

An active-main release is the product of one repository, exact commit SHA,
validated upstream `CI/CD` run, and logical targets. A public mutation belongs
to one downstream workflow attempt. Treating both as an attempt-derived key
causes safe reruns to repeat verified work and obscures the rollback authority
for an interrupted release.

The former design used GitHub artifacts and a prior-attempt admission gate to
infer cross-attempt state. That made artifact retention, download, pagination,
and job history part of release authority. A journal artifact is useful only to
the attempt that created it: it cannot prove provider mappings still match, and
resuming it would give a later attempt ambiguous ownership and compensation
authority.

ADR 0001 historically described an attempt-derived deployment ID. That remains
correct for per-attempt builds and mutation journals. This ADR defines the
active-main rerun contract without rewriting that historical statement.

## Decision

### Stable provider release manifest

The active-main release ID is deterministic from:

```text
repository + DEPLOY_SHA + validated upstream CI/CD run ID
```

The target-specific candidate ID is `releaseId + target`. Before a release can
mutate a protected mapping, the planner creates the canonical stable release
manifest. It binds the release and candidate identities, exact source SHA and
upstream provenance, selected and active targets, ownership mode, and the
captured protected rollback priors. It also binds `rollbackOnlyTargets`: every
protected mapping that lacked complete canonical Mento candidate metadata when
the baseline was captured. The provider stores that manifest with its
candidates. It is the sole durable cross-attempt authority.

The release and candidate IDs survive both a rerun of the downstream controller
and a new downstream controller run for the same validated upstream CI run.
Provider metadata that does not carry one exact canonical manifest is not
authority. GitHub artifacts, job history, a prior journal, and an empty artifact
directory are never alternate cross-attempt authority.

### Reconcile provider state before planning

A later attempt first reads the protected provider mappings and discovers
candidates carrying stable release manifests. It reconciles the live mappings,
candidate census, manifest, and captured rollback priors before ordinary
planning.

- If the matching release is complete, the controller fully re-verifies and
  reuses it through the journal-free `current-release-verified` terminal route.
  It captures fresh mapping, census/state, raw public smoke, legacy `v2`, and
  freshness evidence without replaying public mutations.
- If the matching release is an uninterrupted canonical prefix, the controller
  continues that release only through a new current-attempt journal and a fresh
  protected-state snapshot.
- If an older release is an interrupted canonical prefix, the controller first
  restores the inherited partial release into a fresh current-attempt journal.
  Only after that recovery reaches its terminal state may new-release planning
  capture a baseline.
- If either an older or matching release explains the exact terminal App
  recovery residual, the controller restores only App through a fresh
  current-attempt journal before new planning. This residual requires at least
  one active non-App target, every active non-App target at its original prior,
  and every reviewed App alias at either its captured prior or one
  manifest-bound candidate, with at least one alias at the candidate. It can
  occur when the App command moves aliases before the controller checkpoints
  its return while recovery has already restored the ordinary targets. It
  never authorizes forward resumption.
- If no mapped release explains the protected state, it captures a new baseline.
  Every other non-prefix, ambiguous, conflicting, incomplete, or unverified
  provider state fails closed.

Every unmarked protected mapping in a new baseline is rollback-only regardless
of its optional Vercel `source`, Git metadata, or served SHA. The planner forces
each rollback-only target into the staged set before served-SHA and path-aware
planning. Its exact deployment ID, URL, project, environment, and served SHA
remain compensation authority only. Complete canonical Mento metadata and the
exact stable release manifest are the only evidence that can authorize an
already-current GitHub candidate. Fresh discovery binds the rollback-only set
into both preplan reconciliation and release execution. Same-release verify or
resume may proceed only when the manifest already stages every freshly
rollback-only target; a new baseline must persist exactly the discovered set.
The legacy planning command has no candidate census, so it conservatively
selects every target.

No prior journal is resumed. Each workflow attempt creates and owns only its
current-attempt journal; its transaction IDs, artifacts, snapshots, and
recovery are attempt-scoped. A stable release identity is evidence lookup, not
mutation authorization.

Candidate reuse still requires one exact provider candidate and fresh
inspection and immutable smoke. App `v3` remains restrictive because its upload
can move protected generated aliases: its current-attempt journal records the
discovered candidate and current mappings before aliases may proceed. Legacy App
`v2 -> production` remains independently verified through exact deployment,
project, environment, ref, SHA, and alias-topology identity. Vercel's optional
`source` value is telemetry only for both current and legacy deployments.
Likewise, optional Git organization, repository, and ref fields cannot reject
the exact manifest-bound rollback prior in the final census: its inspected
response SHA remains mandatory and must equal the manifest-bound served SHA.
Candidate admission still requires canonical
`mento-protocol/frontend-monorepo@main` Git identity.

An ordinary candidate already present at the trusted preflight may have
lost its generated project and creator aliases when recovery promoted the exact
prior deployment. That detached state is admissible only after the same exact
manifest-bound candidate census, inspection, and immutable smoke. The
preflight is captured before the job can build a candidate, and a
`create-if-zero` result does not authorize the relaxed topology. Any aliases
that remain must be a canonical subset of the candidate's reviewed
project/scope and creator aliases; protected/custom domains, Git/default
aliases, wrong-target aliases, and unknown aliases remain blockers. A candidate
absent from the trusted preflight still requires its reviewed generated project
alias, and any candidate change after that preflight fails closed.

When App belongs to `shadowTargets`, it stages and verifies a real Production
candidate. It stops without promotion or protected-domain/public mapping
mutation. Its receipt is terminal non-authorizing evidence and grants no
public-mutation authority.

### Final verdict handoff

The terminal receipt and terminal evidence are the only compact final-verdict
handoff between producer and final result evaluation. They bind the release
manifest, execution, final mapping, duplicate census, smoke, and terminal
journal status while remaining redacted and size-bounded. A final-only rerun
restores that terminal handoff; it does not download artifacts to reconstruct a
verdict or infer a release from a prior journal.

Generic JSON bridge documents retain a 256 KiB ceiling. Only complete active
journal history and terminal proofs use dedicated 1 MiB ceilings, sized for the
bounded maximum of six forward and nine recovery operations. The compact
terminal receipt and evidence retain their separate smaller bounds.

## Alternatives considered

### Keep GitHub artifacts and a prior-attempt gate as cross-attempt authority

Rejected. Artifact availability and listing behavior do not prove current
provider state, and they turn retention into release authority.

### Resume a prior attempt's journal directly

Rejected. A transaction journal is deliberately attempt-scoped. Cross-attempt
resume makes ownership and compensation ambiguous.

### Reuse candidates from Vercel metadata alone

Rejected. A candidate must carry the canonical release manifest, be unique in
a fresh provider census, and pass fresh inspection and smoke. Raw metadata or a
matching URL alone cannot prove a safe release state.

### Treat a completed release as permission to replay mutations

Rejected. The provider reconciliation already establishes the completed
release. Replaying mutations adds risk without changing the public result.

### Require manual recovery for every non-prefix provider state

Rejected. The terminal App recovery residual is fully explained by one
canonical manifest, exact captured priors, and complete reviewed App aliases.
Restricting automation to reverse-only App restoration preserves the same
compensation authority while avoiding a manual alias rollback after a
checkpoint failure. Unexplained App mappings, ordinary candidate suffixes, and
every other non-prefix state still require manual intervention.

## Consequences

- The provider-side release manifest, not GitHub artifact history, is the
  durable cross-attempt source of truth.
- Every attempt has an independently auditable journal and recovery boundary.
- A recovered ordinary candidate remains reusable across attempts even when
  recovery moved its reviewed generated aliases back to the prior deployment.
- An inherited partial release is restored before a new baseline can be planned.
- The exact terminal App recovery residual may restore only App before a new
  baseline; it never authorizes forward resumption.
- An unmarked protected mapping always forces reviewed GitHub preparation before
  it can become eligible for an already-current no-op. Only active-owned targets
  replace the public mapping.
- A completed release is reused after fresh reconciliation rather than rebuilt
  or mutated again.
- The final duplicate census may observe at most the exact manifest-bound
  same-SHA original prior alongside the canonical candidate. Separate mapping
  proof must show the candidate owns every protected alias. For a project
  without an expected candidate, an exact-project, exact-SHA deployment in
  terminal `CANCELED` state remains visible as `inertCanceled` evidence and
  cannot satisfy either proof. Any other serving, pending, malformed, or
  ambiguous same-SHA deployment fails closed.
- Final-only reruns use the terminal receipt/evidence handoff only.
- Missing, conflicting, or ambiguous provider evidence stops the release rather
  than selecting a guess. Operators use the documented recovery and rollback
  procedures; they do not create a legacy alternate path.

## Amendment — 2026-09-01: legacy App v2 retired (MGP-18)

Governance proposal MGP-18 passed. The legacy App v2 continuity proof — the
independently verified `v2 -> production` deployment, project, environment,
ref, SHA, and alias-topology identity described above (the "legacy v2"
reference at line 69, the App v3 restriction rationale at lines 112-115, and
the "legacy-v2" evidence bullet at line 243) — is no longer part of the
terminal evidence set. The bounded recovery-operation envelope at line 149
also drops from six forward plus nine recovery operations to six forward plus
five recovery operations (three ordinary and two App-alias transitions). The
custom-v3 App path was unchanged by this amendment and was later retired by the
2026-09-02 amendment below.

## Amendment — 2026-09-02: App stages through Production

App now stages an immutable Production candidate through the same provider
deployment model as the other targets. Active mode promotes that exact
candidate and uses one transitional alias-set operation while
`app.mento.org` remains attached to the retiring custom `v3` environment.
Shadow mode retains the staged provider deployment as terminal,
non-authorizing evidence and performs no promotion, protected-domain mutation,
or other public mapping change.

## Amendment — 2026-09-02: transition complete

The tighten step removed two things: the bridge alias-set operation and the
App-only prior-shape tolerance. App is now an ordinary production target. It
matches Governance, Reserve, and UI exactly. The only operation types are
`promote` and `ordinary_rollback`.

The custom `v3` environment is gone. The legacy `v2` branch and domain are
also gone. `v2-app.mento.org` now returns a 308 redirect to `app.mento.org`.

This amendment does not change release identity or rerun admission. One
exception remains: a bridge-era release seal, valid under the current
contract except for its bridge-era App prior shape, is still admitted as an
unmarked rollback-only prior. Seals are immutable, and operator rollbacks can
re-map one at any time. See ADR 0001's 2026-09-02 amendment for the
mechanism.

## Trust, evidence, and failure handling

Provider reconciliation and every mutation run in the protected
`vercel-cli-production` environment with `deployment: false`; each job exposes
the production token only as step-scoped `VERCEL_TOKEN`. The initial exact-CI
source gate remains token-free with respect to Vercel. Automation must never
inspect 1Password or another credential store.

Manifests, journals, terminal receipts, and terminal evidence contain canonical
identifiers and redacted state only. They never contain tokens, raw provider
responses, pulled environment files, cookies, or build output. On reconciliation
or recovery failure, do not edit a journal, reconstruct authority from logs, or
invent a prior mapping. Follow the target-local or full-native rollback
procedure as applicable, verify the protected mappings, and begin a new release
only from a validated upstream CI run.

## Evidence

The implementation and tests are the current repository evidence:

- `scripts/vercel-main-release-planner.mjs` and
  `scripts/vercel-main-release-reconciliation.mjs` — canonical manifest,
  provider census, reconciliation, inherited-prefix decisions, and terminal App
  residual restoration;
- `scripts/vercel-main-release-journal.mjs` and
  `scripts/vercel-main-release-execution.mjs` — fresh current-attempt journals
  and bounded execution handoffs;
- `scripts/vercel-main-terminal-receipt.mjs` — redacted compact terminal
  receipt/evidence contract;
- `.github/workflows/vercel-main-deployment.yml` — reconciliation before
  planning, current-attempt recovery, and final-only receipt restoration;
- `docs/vercel-deployments.md` — operator-facing release, recovery, credential,
  legacy-v2, and rollback contract.

These references specify expected behavior. They do not claim a live production
rerun, candidate reuse, or cost result.

Primary platform references, verified for this decision:

- [GitHub re-running workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
  — workflow reruns retain their triggering SHA/ref;
- [Vercel CLI deploy metadata](https://vercel.com/docs/cli/deploy) — deployments
  can be given metadata and `vercel list --meta` can filter by it.

## Reconsideration

Reconsider this decision if Vercel can no longer retain and query the canonical
manifest metadata, its metadata model gains a stronger immutable release
receipt, or fresh provider reconciliation cannot meet the deployment service
objective. Any replacement must preserve stable candidate identity,
attempt-scoped journals, fresh protected-state reconciliation, the compact
terminal handoff, and fail-closed treatment of ambiguous state.
