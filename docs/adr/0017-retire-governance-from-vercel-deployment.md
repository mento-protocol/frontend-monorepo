---
title: Governance is retired from GitHub-owned Vercel deployment
status: active
owner: eng
canonical: true
last_verified: 2026-11-24
scope: ci/deployment
date: 2026-11-24
supersedes_in_part:
  - "0001"
  - "0002"
  - "0003"
  - "0004"
  - "0005"
superseded_in_part_by:
  - "0018"
---

# ADR 0017 — Governance is retired from GitHub-owned Vercel deployment

**Status:** Accepted (Nov 2026). Supersedes in part ADRs
[0001](0001-github-actions-vercel-deployment-orchestration.md),
[0002](0002-single-comment-preview-controller-journal.md),
[0003](0003-preview-worker-dispatch-authentication.md),
[0004](0004-one-way-vercel-build-environment-materialization.md), and
[0005](0005-stable-main-release-identity-and-rerun-admission.md) wherever they
enumerate Governance as a deployment target. Their decisions otherwise stand.
Amended 2026-11-26 by
[ADR 0018](0018-retire-ui-from-vercel-deployment.md), which retires UI and
generalizes both read rules below to a list of retired eras: the function
names below are now `assertRetiredEraReleaseManifest`,
`isRetiredEraCandidateMetadata`, and `normalizeRetiredEraPreviewJournal`.
**Scope:** ci/deployment

## Context

The `governance.mento.org` Vercel project is permanently paused, and its
production domain answers `503 DEPLOYMENT_PAUSED`. The GitHub-owned pipeline
still treated Governance as one of four targets, so GitHub-built Governance
previews got stuck or failed on every pull request that touched it, and every
main release staged and verified a target that cannot serve. The chance that
Governance returns to Vercel is small, about 1 percent, so the pipeline is not
built to add it back.

Durable state written while Governance was a target outlives the change. Every
App, Reserve, and UI production deployment served today carries an immutable
candidate seal whose release manifest names four targets, and open pull
requests carry preview journals keyed by four targets. Both are validated
strictly, so dropping Governance from the target lists alone would make
pre-planning reject every served mapping and the preview controller reject
every open journal.

## Decision

Governance is removed from the GitHub-owned preview targets and from the main
release pipeline. The pipeline has three targets, App, Reserve, and UI, with
activation order `reserve`, `ui`, `app`. The deployment planner treats every
path under `apps/governance.mento.org/` as non-runtime, so a Governance-only
diff plans no deployment.

These stay as they are:

- the `apps/governance.mento.org` code, its unit tests, its `ci.yml` build,
  and the `e2e.yml` "Connected governance (anvil fork)" job;
- its bundle-size budget, `scripts/setup-worktree.sh`, and
  `docs/wallet-testing.md`;
- `apps/governance.mento.org/vercel.json`, whose
  `git.deploymentEnabled: false` keeps native Vercel Git deployments off; and
- the GitHub repository variables, secrets, and environments that served
  Governance. Workflows stop referencing them; nothing deletes them.

Two bounded, permanent read rules keep the four-target history readable.

**Four-target candidate seals.**
`scripts/vercel-main-release-reconciliation.mjs` validates a release manifest
against a target universe. The current universe has the three targets. A frozen
governance-era universe reproduces the retired contract: activation order
`governance`, `reserve`, `ui`, `app`; ownership keys `app`, `governance`,
`reserve`, `ui`; and the retained `governance.mento.org` production contract.
`assertGovernanceEraReleaseManifest` validates against it, and so does
`assertBridgeEraReleaseManifest`, because the bridge era ended before this
retirement. `isGovernanceEraCandidateMetadata` in
`scripts/vercel-main-candidate.mjs` applies exactly the full seal validation of
the bridge-era classifier, and the sealed target must still be a current
target. `inspectMappedCandidate` in `scripts/vercel-main-candidate-provider.mjs`
classifies a matching mapping as an unmarked rollback-only prior with
`metadata: null`. The first release after this change therefore decides
`capture-new-baseline` with reason `no-mapped-release-metadata` and
force-selects App, Reserve, and UI through `served-mapping-rollback-only`. A
corrupt seal still fails closed. Old manifests are never rewritten, because
their digests bind the full JSON.

**Four-target preview journals.** `scripts/vercel-preview-controller.mjs`
normalizes a journal on read only when its target-keyed maps, which are the
controller state targets, the status decisions, and the checkpoint targets,
are exactly the current preview targets plus `governance`. It first verifies
the raw journal's digest and canonical body. It then drops the Governance
entries, including any in-flight ownership, and every Governance-target
receipt. A persisted event plan may still name `governance`, and that entry
selects nothing. Any other key mismatch still fails closed, and the next
journal write persists three keys. A late Governance worker run no longer
matches the worker run title pattern, so it is ignored or rejected.

## Consequences

- Pull requests no longer wait on or fail through Governance previews, and main
  releases no longer stage a project that cannot serve.
- Governance still gets CI build, unit-test, and connected E2E coverage, but no
  repository workflow deploys it anywhere.
- The two read rules are permanent. Seals are immutable, and an operator
  rollback can re-map a four-target deployment at any time.
- Restoring Governance needs more than a revert. A plain revert would make the
  pipeline reject every seal and journal written with three targets, so it
  would also need the inverse compatibility rule for that state.

## Alternatives considered

- **Keep Governance as a target and let it fail.** Every affected pull request
  and every main release would keep paying for a project that cannot serve, and
  required checks would stay red for reasons nobody can fix.
- **Rewrite the four-target manifests.** The seal digests bind the full
  manifest JSON, so a rewritten manifest no longer matches its own seal.
- **Reset open preview journals by hand.** This needs operator work on every
  open pull request, and the controller has no supported reset path. The
  bounded read rule needs none.
