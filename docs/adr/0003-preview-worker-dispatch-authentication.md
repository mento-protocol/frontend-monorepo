---
title: A dedicated repository-scoped credential dispatches preview workers
status: active
owner: eng
canonical: true
last_verified: 2026-07-21
scope: ci/deployment/preview-worker-dispatch-authentication
date: 2026-07
---

# ADR 0003 — A dedicated repository-scoped credential dispatches preview workers

**Status:** Accepted (Jul 2026)
**Scope:** ci/deployment/preview-worker-dispatch-authentication

## Context

ADR 0001 made trusted default-branch GitHub Actions code the owner of Vercel
preview orchestration, and ADR 0002 consolidated its durable coordination state
into one pull-request journal. The controller dispatches a separate
`Vercel Preview Worker` and relies on the worker's terminal `workflow_run`
event to recover its result, advance first-plus-latest scheduling, and publish
the final status.

The initial controller dispatched that worker with the job's repository
`GITHUB_TOKEN`. GitHub permits a `GITHUB_TOKEN`-authenticated
`workflow_dispatch` to create the worker, but suppresses most events caused by
that token from creating further workflow runs. Consequently the worker ran,
yet its terminal `workflow_run` callback was not created. A later pull-request
event or manual repository reconciliation could recover the completed worker,
but automatic terminalization, cancellation recovery, and latest-push
advancement were not dependable.

GitHub recommends using a GitHub App installation token or personal access
token when one workflow must trigger another workflow. This is a credential
boundary, not a reason to move the controller's journal, status, Deployment,
run-listing, validation, or recovery authority away from `GITHUB_TOKEN`.

This ADR refines ADR 0001's preview-controller trust boundary. It does not
supersede ADR 0001 or ADR 0002.

## Decision

### One narrowly used dispatch credential

The repository has one Actions secret named
`GH_PREVIEW_WORKFLOW_DISPATCH_TOKEN`. Its value is a fine-grained personal
access token whose resource owner is `mento-protocol`, repository access is
limited to `frontend-monorepo`, and repository permission is limited to
`Actions: read and write` plus implicit metadata read.

Only the four trusted reconciliation steps in
`.github/workflows/vercel-preview-controller.yml` receive that secret. Each
constructs a secondary Octokit client with the `actions/github-script`
`getOctokit(token)` helper and passes the client to `reconcilePreview`. The
secondary client is used for exactly one operation:

```text
POST /repos/mento-protocol/frontend-monorepo/actions/workflows/
  vercel-preview-worker.yml/dispatches
```

There is no `GITHUB_TOKEN` fallback for that POST. The primary Octokit client,
authenticated by the job's repository `GITHUB_TOKEN`, continues to own every
pull-request journal mutation, commit status, Deployment and Deployment status,
pull-request lookup, workflow-run listing and validation, recovery operation,
and controller-error publication. The workflow does not replace
`actions/github-script`'s `github-token` input with the personal access token.

The dispatch credential is never sent to the worker, reusable Vercel workflow,
candidate checkout, Vercel command, artifact, journal, log, output, or summary.
It is not a Vercel credential and does not replace `VERCEL_TOKEN_PREVIEW`.

### Fail-closed behavior and recovery

Reconciliation first writes and rereads the durable `intended` selection and
uses the primary client to search for a matching worker. If a valid existing
worker is found, reconciliation attaches or recovers it without requiring the
dispatch credential. Only when no existing worker can own the intent does the
controller require the secondary client. A missing secret then fails closed
immediately before the new dispatch, leaves the durable intent recoverable,
and publishes an error status through the primary client.

A worker dispatched with the dedicated credential is expected to produce its
terminal `workflow_run` callback automatically. The callback still runs only
trusted default-branch controller code, validates the exact worker identity,
and uses `GITHUB_TOKEN` for terminal evidence and subsequent reconciliation.
The dispatch credential grants no authority to the worker itself.

### Provisioning, rotation, and rollback

A maintainer creates the fine-grained token interactively, gives it an explicit
owner and expiration/rotation date, and stores it only as the repository Actions
secret. Automation may verify that the secret is configured by observing
workflow behavior but must never retrieve, print, reconstruct, or export its
value.

Rotation replaces the repository secret with an equivalently scoped token and
then proves one automatic worker callback. Revocation is fail-closed for new
dispatches; already-created workers and their recovery remain operable through
the primary client.

Rollback sets the version-controlled controller mode to `observe-only` in the
same reviewed change that restores native Vercel Git ownership. That mode does
not expose the secondary credential to reconciliation and the dispatch
implementation rejects a new worker POST. Reintroducing `GITHUB_TOKEN` dispatch
is not a valid rollback because it recreates the known event-suppression
failure.

## Alternatives considered

### GitHub App installation token

Operationally preferable for long-lived organization automation because the
identity is bot-owned, installation-scoped, and short-lived. Rejected for the
immediate repair because registering and installing an App and minting its
token adds operational setup beyond this single repository. Reconsider the App
when a second repository needs this automation, a personal-token rotation
causes an incident, or the organization standardizes an Actions-dispatch App.

### Continue dispatching with `GITHUB_TOKEN`

Rejected. The worker starts, but GitHub suppresses the terminal callback on
which automatic recovery and first-plus-latest advancement depend.

### Have the worker send `repository_dispatch`

Rejected. A final job can emit before the workflow is technically terminal,
creating a recovery race, and cannot report cancellation, startup failure, or
termination before the notifier runs. Adding polling or a watchdog would create
another recovery protocol.

### Poll or schedule reconciliation

Rejected as the primary mechanism. It adds delay, spend, and another state
machine while remaining weaker than GitHub's terminal event. Manual
`vercel-preview-reconcile` remains an operator recovery tool, not normal
completion delivery.

### Let the worker write its terminal result

Rejected. A running workflow cannot reliably observe its own final platform
conclusion, especially cancellation and startup failure, and this would move
controller write authority into the credential-bearing worker.

## Consequences

- Successful, failed, cancelled, timed-out, and startup-failed workers can
  produce the existing automatic terminal callback without manual reconcile.
- One fine-grained credential becomes an operational prerequisite for new
  preview work. Its absence is explicit and fail-closed.
- The personal token remains able to perform other Actions-write operations in
  the selected repository, so repository-only access, minimal permissions,
  expiration, rotation ownership, and exact call-site tests are required.
- Existing-worker recovery remains available during token expiry or rotation.
- Structural tests must fail if the secret reaches another workflow/job, if a
  reconciliation step overrides the primary `github-token`, or if the worker
  receives the secret.
- Unit tests must prove that the secondary client performs only dispatch while
  primary-client run validation and missing-secret recovery remain intact.

## Evidence

Repository surfaces:

- [Preview controller workflow](../../.github/workflows/vercel-preview-controller.yml)
- [Preview controller implementation](../../scripts/vercel-preview-controller.mjs)
- [Preview controller tests](../../scripts/vercel-preview-controller.test.mjs)
- [Preview workflow structural tests](../../scripts/vercel-preview-workflows.test.mjs)
- [Vercel deployment runbook](../vercel-deployments.md)

Primary platform documentation:

- [Events triggered by `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs)
- [Triggering a workflow from a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
- [Fine-grained personal access token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- [Keeping API credentials secure](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure)
