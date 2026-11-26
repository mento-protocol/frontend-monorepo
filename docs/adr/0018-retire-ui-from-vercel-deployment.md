---
title: UI is retired from GitHub-owned Vercel deployment
status: active
owner: eng
canonical: true
last_verified: 2026-11-26
scope: ci/deployment
date: 2026-11-26
supersedes_in_part:
  - "0001"
  - "0002"
  - "0003"
  - "0004"
  - "0005"
  - "0017"
---

# ADR 0018 — UI is retired from GitHub-owned Vercel deployment

**Status:** Accepted (Nov 2026). Supersedes in part ADRs
[0001](0001-github-actions-vercel-deployment-orchestration.md),
[0002](0002-single-comment-preview-controller-journal.md),
[0003](0003-preview-worker-dispatch-authentication.md),
[0004](0004-one-way-vercel-build-environment-materialization.md), and
[0005](0005-stable-main-release-identity-and-rerun-admission.md) wherever they
enumerate UI as a deployment target, and
[0017](0017-retire-governance-from-vercel-deployment.md) where it names its
governance-only read rules. Their decisions otherwise stand.
**Scope:** ci/deployment

## Context

The `ui.mento.org` component showcase no longer needs a hosted deployment, and
its Vercel project is being paused. The GitHub-owned pipeline still treats UI
as one of three targets, so every pull request that touches shared inputs
builds and smoke-tests a UI preview, and every main release stages, promotes,
and verifies UI. Once the project is paused, those previews would hang the
required "Vercel Preview" check exactly as the paused Governance project did
before [ADR 0017](0017-retire-governance-from-vercel-deployment.md).

The pixel visual-regression suite for the showcase does not use Vercel: the
required "Visual Regression (ui.mento.org)" check builds the app inside CI and
uploads screenshots to Argos.

As with Governance, durable state written while UI was a target outlives the
change. Every App and Reserve production deployment served today carries a
candidate seal whose release manifest names three targets, and open pull
requests carry preview journals keyed by three targets.

## Decision

UI is removed from the GitHub-owned preview targets and from the main release
pipeline. The pipeline has two targets, App and Reserve, with activation order
`reserve`, `app`. The deployment planner treats every path under
`apps/ui.mento.org/` as non-runtime, so a UI-only diff plans no deployment.

These stay as they are:

- the `apps/ui.mento.org` code, its `ci.yml` build, the "Visual Regression
  (ui.mento.org)" Argos suite, and its bundle-size budget;
- `apps/ui.mento.org/e2e/vercel-preview-browser-smoke.mjs`, which the Reserve
  preview smoke still imports for deployment-identity checks, and the
  showcase's Playwright dependency, which the trusted browser smokes resolve;
- `apps/ui.mento.org/vercel.json`, whose `git.deploymentEnabled: false` keeps
  native Vercel Git deployments off; and
- the GitHub repository variables, secrets, and environments that served UI.
  Workflows stop referencing them; nothing deletes them.

Order matters for this change: it merges first, and the Vercel project is
paused after its first main release. Pausing first would hang every preview, as
it did for Governance.

Instead of adding a second pair of one-off rules beside ADR 0017's, both read
rules are generalized to a list of retired eras, newest first.

**Retired-era candidate seals.**
`scripts/vercel-main-release-reconciliation.mjs` keeps one frozen universe per
retired era: the ui era (`reserve`, `ui`, `app`) and the governance era
(`governance`, `reserve`, `ui`, `app`). Retired target contracts, including
`ui.mento.org`'s production contract, are frozen there.
`assertRetiredEraReleaseManifest` admits a manifest that is valid against any
retired universe; `assertBridgeEraReleaseManifest` stays bound to the
governance era. `isRetiredEraCandidateMetadata` in
`scripts/vercel-main-candidate.mjs` applies the full seal validation, and the
sealed target must still be a current target, so a UI deployment's own seal is
never admitted. `inspectMappedCandidate` classifies a matching mapping as an
unmarked rollback-only prior. The first release after this change therefore
decides `capture-new-baseline` with reason `no-mapped-release-metadata` and
force-selects App and Reserve. A corrupt seal still fails closed.

**Retired-era preview journals.** `normalizeRetiredEraPreviewJournal` in
`scripts/vercel-preview-controller.mjs` normalizes a journal on read only when
its target-keyed maps are exactly one retired era's targets, after verifying
that era's canonical body and the journal digest. It drops every retired
target's entries and receipts. A persisted plan may still name `ui` or
`governance`, and those entries select nothing.

## Consequences

- Pull requests no longer build or smoke a UI preview, and main releases no
  longer stage UI. The ui.mento.org domain stops receiving releases.
- The showcase keeps its CI build and its required visual regression check.
- A future retirement adds one universe and one journal era to the two lists
  instead of new functions.
- Restoring UI needs a revert plus the inverse rule for two-target state, as
  ADR 0017 describes for Governance.

## Alternatives considered

- **Keep UI as a target.** Every affected pull request and release would keep
  building and verifying a showcase nobody needs hosted, and pausing its project
  would block the required preview check.
- **Add ui-specific copies of ADR 0017's functions.** That works, but it doubles
  the bespoke compatibility code for each retirement.
- **Rewrite the three-target manifests or reset open journals.** Seal digests
  bind the full manifest JSON, and the controller has no supported journal
  reset path.
