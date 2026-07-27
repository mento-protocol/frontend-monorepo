---
title: Stable active-main release identity and provider-side rerun reconciliation
status: active
owner: eng
canonical: true
last_verified: 2026-07-27
scope: ci/deployment/main-reruns
date: 2026-07
---

# ADR 0005 — Stable active-main release identity and provider-side rerun reconciliation

**Status:** Accepted (Jul 2026)
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
manifest. It binds the release and candidate identities, exact source and
upstream provenance, selected and active targets, ownership mode, and the
captured protected rollback priors. The provider stores that manifest with its
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
- If no mapped release explains the protected state, it captures a new baseline.
  Ambiguous, non-prefix, conflicting, incomplete, or unverified provider state
  fails closed.

No prior journal is resumed. Each workflow attempt creates and owns only its
current-attempt journal; its transaction IDs, artifacts, snapshots, and
recovery are attempt-scoped. A stable release identity is evidence lookup, not
mutation authorization.

Candidate reuse still requires one exact provider candidate and fresh
inspection and immutable smoke. App `v3` remains restrictive because its upload
can move protected generated aliases: its current-attempt journal records the
discovered candidate and current mappings before aliases may proceed. Legacy App
`v2 -> production` remains native and independently verified.

When App belongs to `shadowTargets`, its protected custom-`v3` preparation is
build-only terminal evidence. It never creates a provider deployment or gains
public-mutation authority.

### Final verdict handoff

The terminal receipt and terminal evidence are the only compact final-verdict
handoff between producer and final result evaluation. They bind the release
manifest, execution, final mapping, duplicate census, smoke, and terminal
journal status while remaining redacted and size-bounded. A final-only rerun
restores that terminal handoff; it does not download artifacts to reconstruct a
verdict or infer a release from a prior journal.

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

## Consequences

- The provider-side release manifest, not GitHub artifact history, is the
  durable cross-attempt source of truth.
- Every attempt has an independently auditable journal and recovery boundary.
- An inherited partial release is restored before a new baseline can be planned.
- A completed release is reused after fresh reconciliation rather than rebuilt
  or mutated again.
- Final-only reruns use the terminal receipt/evidence handoff only.
- Missing, conflicting, or ambiguous provider evidence stops the release rather
  than selecting a guess. Operators use the documented recovery and rollback
  procedures; they do not create a legacy alternate path.

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
  provider census, reconciliation, and inherited-prefix decisions;
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
