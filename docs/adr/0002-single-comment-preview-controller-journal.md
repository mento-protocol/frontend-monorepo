---
title: One canonical pull-request comment stores the preview controller journal
status: active
owner: eng
canonical: true
last_verified: 2026-07-17
scope: ci/deployment/preview-controller-state
date: 2026-07
---

# ADR 0002 — One canonical pull-request comment stores the preview controller journal

**Status:** Accepted (Jul 2026)
**Scope:** ci/deployment/preview-controller-state

## Context

ADR 0001 selected GitHub Actions as the owner of Vercel build and deployment
orchestration while retaining Vercel as the hosting and runtime platform. Its
automatic preview controller persists enough GitHub-owned evidence to survive
overlapping pull-request events, worker retries, callback loss, cancellation,
controller upgrades, and out-of-order completion.

The first implementation represented that evidence as one mutable controller
state comment plus separate immutable comments for event, selection,
pre-completion worker evidence, and terminal result receipts. Treating each
receipt comment as an append-only row avoided concurrent read-modify-write
loss, but one ordinary preview produced several procedural, machine-only cards
in the pull-request timeline. Collapsing each JSON block made each card easier
to ignore without making the review surface coherent.

The pull-request timeline is primarily for reviewers. Preview status and the
canonical GitHub Deployment already provide the useful human-facing outcome;
the controller's internal record granularity should not leak into that surface.
At the same time, combining records into one mutable object is safe only when
every writer shares the same serialization boundary. GitHub issue-comment
updates do not provide a documented conditional compare-and-swap operation.

This ADR refines ADR 0001's preview-controller persistence mechanism. It does
not supersede ADR 0001's ownership, trust-boundary, automatic-preview,
first-plus-latest, or deployment-orchestration decisions.

## Decision

### One journal per participating pull request

Every participating non-Dependabot pull request has exactly one canonical
`github-actions[bot]` journal comment shared by all present and future preview
targets. The hidden marker and payload schema are:

```text
<!-- vercel-preview-journal:v1 -->
vercel-preview-journal:v1
```

The comment keeps the reviewer explanation outside one collapsed `<details>`
block and stores one canonical JSON document inside it. That document contains
the repository and pull-request identity, a monotonic revision, an optional
deterministic checkpoint, logically immutable live
event/selection/worker-evidence/result entries, and the bounded mutable
controller state. The top-level `journal_digest` covers the checkpoint,
canonical live receipt set, and mutable state; `state.receipts_digest`
separately binds reconciliation to the checkpoint plus live receipt set. The
canonical Markdown envelope includes an
explicit closing `</details>` tag and permits no extra presentation text. The
comment ID is stable for the life of the journal. Updates edit that comment;
they never create another journal or a receipt-specific comment.

Receipt immutability is enforced by the journal protocol. A deterministic
receipt identity may be inserted once. Replaying an identical receipt is a
no-op; presenting different canonical JSON for an existing identity fails
closed. A mutation may append a receipt or replace the explicitly mutable
state, then must increment the revision and recompute `journal_digest`. Receipt
reconciliation also validates `state.receipts_digest` against the canonical
receipt set.

Before appending a later event, a terminal journal with no active or retired
worker and no unfinished evidence deterministically checkpoints its completed
prefix in place. The checkpoint retains the cumulative receipt digest and
counts, the verified lifecycle tail event, and its terminal status. Open state
uses the reconciled lineage tail; closed state uses the matching closure. The
mutable state is rebased onto that verified tail and the completed live
receipts are cleared. Semantic replays of the checkpoint tail are idempotent,
while a conflicting receipt under the same run identity fails closed. A
docs-only checkpoint tail carries forward the inherited runtime success URL or
terminal failure/error meaning for subsequent docs-only pushes. This is one
atomic revision of the same comment and schema, not rollover, archival, or a
second persistence path. A 50-preview sequential-cycle fixture peaks at 7,772
rendered UTF-8 bytes.

The same checkpoint field protects an overlapping push burst before the hard
body limit is reached. At a 40,000-byte soft threshold, the controller proves a
unique path to the latest pull-request tail represented by the complete receipt
graph, then folds that graph and terminal receipts not needed for recovery into
the cumulative digest. A pending checkpoint records the exact unfinished owner,
its consumed attempt count, and the latest runtime event still owed, while
retaining that owner's selection, worker evidence, and result. Reconciliation
waits for that owner;
its terminal result either satisfies a runtime-equivalent tail or releases the
latest runtime event for dispatch. Thus queued receipt jobs cannot disappear,
and a docs-only tail cannot remain pending after its runtime dependency ends.

The complete rendered comment body remains subject to the controller's
60,000-byte UTF-8 hard limit. A mutation that cannot use either terminal or
capacity checkpointing safely and would exceed that bound fails closed before
it changes the journal, publishes a success status, or dispatches a worker.
Unfinished evidence and active or retired ownership are never truncated to
recover capacity.

### The shared queue is a correctness boundary

Every job that can create or update the journal uses the same repository-wide,
per-PR concurrency group with `queue: max` and `cancel-in-progress: false`.
This includes event persistence, bootstrap, reconciliation, selection,
pre-completion worker evidence, terminal recovery, close/reopen handling, and
any controller-error result. No other job may mutate the journal.

After acquiring that queue, a writer:

1. lists and validates the exact bot-owned journal count, marker, repository,
   pull request, revision, journal digest, receipts, state, and, when state
   exists, `state.receipts_digest`;
2. applies one idempotent transition in memory;
3. updates the existing comment, or creates it for an explicit bootstrap, a
   first-attempt `opened`, or another first-attempt non-closed PR event only
   after proving that its `before` and head commits carry no matching
   `Vercel Preview Journal / PR #<number>` initialization status;
4. rereads the comment and proves its exact revision, canonical JSON, and
   journal digest before publishing statuses or dispatching work.

Duplicate journals, an unexpected author, malformed or oversized JSON, a
conflicting receipt, a lost reread, or a writer outside the common queue is an
ambiguous state and fails closed. The queue is not the first-plus-latest
selection algorithm; it only prevents concurrent journal replacement. Receipt
contents and current pull-request state continue to determine selection.

A first-attempt non-closed event may win the queue before `opened`; it may
create the journal only when no durable controller status for the same PR
exists on its `before` or head commit. Every durably recorded event ensures a
separate `Vercel Preview Journal / PR #<number>` success-status witness on its
head before normal reconciliation. This advances deletion evidence across
pushes and lets a retry repair a status write that failed after the journal
mutation committed. A witness from another PR on a reused or stacked commit is
not initialization evidence for this PR. The witness never reuses the
reserved `Vercel Preview` context, so a delayed old same-SHA event cannot
overwrite a newer epoch's preview result. Consequently a later missing journal
with matching PR-scoped evidence is ambiguous and fails closed, as do event
reruns. A close for a PR with neither a journal nor matching evidence is
intentionally inert: the receipt job emits `reconcile_required=false`, so the
workflow creates neither an anchorless closure-only journal nor a reconciliation
run. A delayed non-closed event also remains inert when the live PR is already
closed and no journal or witness exists. Explicit bootstrap remains the only
operator-authorized clean restart.

GitHub currently bounds `queue: max` at 100 pending jobs. The controller must
keep journal mutations short, expose queue pressure during canaries, and treat
an admitted-event gap as ambiguous. It may recover current intent only by
re-querying the live pull request and performing the existing conservative,
fail-closed plan; it must not invent a missing historical receipt.

### Trust and public evidence

Only trusted default-branch controller or worker-controller code may reach a
journal write token. No write-token job checks out or executes pull-request
code. Existing exact-SHA, author/repository/ref, workflow-SHA, epoch, key,
Deployment, and worker-attempt validations remain required before a journal
transition can authorize work.

Tokens, environment files, cookies, output directories, bypass values, raw
provider responses, and credential values never enter the journal. The
`Vercel Preview` commit status and canonical GitHub Deployment remain the
reviewer and operator surfaces; the journal is internal coordination evidence,
not a new required check or deployment.

### Clean cutover, cleanup, and rollback

There is no dual-read period and no compatibility path for already-running
legacy workers. Before merging the journal implementation, operators inventory
all preview controller, worker, and intake runs and let them terminate or cancel
them. The cutover must not proceed while a legacy run can still write a receipt
comment, dispatch work, or act on legacy controller state. The implementation
contains no legacy-comment reader, presentation upgrader, payload importer, or
rematerialization path.

After the merge, every open participating pull request is bootstrapped from its
current live PR metadata and a fresh fail-closed plan. The bootstrap creates a
new journal epoch; it does not import, translate, trust, or reconcile legacy
comment payloads. Previously created preview evidence is outside the new
journal's ownership unless the fresh controller independently proves it through
the normal GitHub Deployment and provider APIs.

Only after each fresh journal is reread and its status/dispatch decision is
valid may an operator delete legacy machine comments. Deletion is restricted
to comments authored by `github-actions[bot]` whose complete body validates
under one of the exact retired `vercel-preview-event-receipt:v1`,
`vercel-preview-selection:v1`, `vercel-preview-worker-evidence:v1`,
`vercel-preview-worker-result:v1`, or `vercel-preview-controller:v1`
marker/schema pairs and one of the retired canonical Markdown envelopes.
Unknown, malformed, human, review, third-party-bot, and journal comments are
never deleted. Closed historical pull requests need no new journal; after the
run inventory proves quiescence, their exact validated legacy machine comments
may be removed as historical cleanup.

Cleanup failure is cosmetic and retryable because the new journal is the only
authoritative source after cutover. Legacy comments that remain temporarily are
ignored by the new controller. A journal write or verification failure is not
cosmetic and blocks status progression and dispatch.

Rollback is also a clean restart, not a data migration. Operators first drain
or cancel journal-era controller and worker runs, merge the reviewed rollback,
and bootstrap the restored controller afresh from live pull-request state. The
rollback does not rematerialize legacy receipts from the journal and must not
claim continuity with journal-owned epochs. Journal comments may be retained
as inert audit evidence until the restored controller is proven; deletion, if
desired, requires exact `github-actions[bot]` authorship and full validation of
the journal marker, schema, and canonical body.

## Alternatives considered

### Keep separate comments with collapsed JSON

Rejected. It preserves the independent append-only storage model but continues
to litter the reviewer timeline with records that require no reviewer action.

### Hide or minimize the receipt comments

Rejected. GitHub has no appropriate hidden issue-comment storage surface, and
classifying valid controller evidence as spam, abuse, off-topic, or outdated
would misuse comment minimization while retaining multiple timeline entries.

### Store the journal in a dedicated Git ref

Rejected for this iteration. Fast-forward-only ref updates provide a strong
GitHub-native optimistic-concurrency primitive and no pull-request timeline
noise, but require `contents: write`, Git object/ref lifecycle management, and
a materially larger implementation and operator surface.

### Store receipts in check runs

Rejected. Check runs move procedural records into the merge and Checks surface,
are associated with commit rather than pull-request lifecycle identity, and are
subject to platform history limits. `Vercel Preview` remains one truthful
Statuses API context instead.

### Store receipts in GitHub Actions artifacts

Rejected. Public-repository artifacts expire after at most 90 days and require
archive listing and download during recovery. They are useful debugging output,
not durable controller state.

### Store receipts in GitHub Deployment payloads or statuses

Rejected as the complete store. A Deployment does not exist for every event or
non-runtime decision, its creation payload cannot be extended with later upload
evidence, and status descriptions cannot hold the journal. The canonical
Deployment remains complementary lifecycle evidence.

### Store receipts in repository variables

Rejected. Variables are mutable configuration, have repository count and size
limits, lack an append-only audit or compare-and-swap model, and require a token
permission outside the normal configurable `GITHUB_TOKEN` permission set.

### Add an external transactional store

Rejected. Conditional writes would solve concurrency without a visible comment,
but introduce another availability boundary, credential or OIDC configuration,
cost, retention policy, and operator dependency for preview deployment.

## Consequences

- Reviewers see at most one explanatory, collapsed preview-controller journal
  rather than one card per procedural receipt.
- The journal comment is a single persistence object. Deletion, corruption,
  duplicate creation, or ambiguous ownership fails closed.
- Receipt immutability becomes protocol-enforced inside a mutable envelope
  instead of being represented by immutable comment IDs.
- Correctness depends on every mutation path sharing one queue and completing
  its reread verification. Structural tests for that wiring are mandatory.
- Journal writers may wait longer during a burst, and queue depth becomes an
  operational signal alongside preview latency.
- Deterministic terminal and capacity checkpoints keep sequential previews and
  overlapping bursts bounded without adding an archive, rollover comment, or
  compatibility path. The 60,000-byte UTF-8 bound remains a fail-closed
  constraint when unfinished ownership cannot be summarized safely.
- Terminal results remove their retired owners once the result is durable.
  More than 40 genuinely unfinished retired owners fails closed; ownership is
  never silently sliced to fit history bounds.
- Cutover and rollback require explicit run draining and fresh bootstrap. They
  intentionally abandon persistence continuity across journal versions rather
  than carrying compatibility code indefinitely.
- The decision should be reconsidered after any lost journal entry, duplicate
  worker or Deployment caused by journal state, repeated approach to the body
  limit, queue pressure near the 100-pending platform bound, material preview
  delay caused by comment API availability, or renewed reviewer demand for no
  machine comment at all.

## Evidence

Repository decision and implementation surfaces:

- [ADR 0001](0001-github-actions-vercel-deployment-orchestration.md) — retained
  build/deployment ownership, trust, and first-plus-latest decisions.
- [`docs/vercel-deployments.md`](../vercel-deployments.md) — current controller,
  clean-cutover, bootstrap, recovery, and verification contract.
- `scripts/vercel-preview-controller.mjs` and
  `scripts/vercel-preview-controller.test.mjs` — journal validation,
  idempotency, size, failure, and state-machine evidence.
- `.github/workflows/vercel-preview-controller.yml` and
  `.github/workflows/vercel-preview-worker.yml` — shared queue and write-token
  ownership.
- [PR #548](https://github.com/mento-protocol/frontend-monorepo/pull/548) and
  [PR #549](https://github.com/mento-protocol/frontend-monorepo/pull/549) — live
  reviewer evidence that per-receipt comments remained noisy after their JSON
  presentation was collapsed.

Primary platform constraints verified at adoption:

- [GitHub Actions concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)
  — shared groups, `queue: max`, pending bound, and ordering behavior.
- [GitHub REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate)
  — conditional requests are not generally supported for unsafe methods such
  as comment `PATCH`.
- [GitHub Actions artifact retention](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-repository)
  — public-repository artifact retention is limited to 90 days.
- [GitHub Deployment statuses](https://docs.github.com/en/rest/deployments/statuses#create-a-deployment-status)
  — status fields and the 140-character description limit.
