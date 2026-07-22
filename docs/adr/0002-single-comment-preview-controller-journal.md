---
title: One canonical pull-request comment stores the preview controller journal
status: active
owner: eng
canonical: true
last_verified: 2026-07-22
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
<!-- vercel-preview-journal:v2 -->
vercel-preview-journal:v2
```

The comment keeps the reviewer explanation and a compact, stable-order
`app`/`governance`/`reserve`/`ui` outcome table outside one collapsed
`<details>` block. Each row links the useful immutable deployment or worker run
when one exists. The table is derived from the journal and is part of the exact
canonical body; it is not a second state surface. One canonical JSON document
inside the collapsed block contains the repository and pull-request identity,
a monotonic revision, an optional deterministic checkpoint, a top-level
numeric controller-workflow admission cursor, logically
immutable live event/selection/worker-evidence/result entries, and the bounded
mutable four-target controller state. The top-level `journal_digest` covers the
admission cursor, checkpoint, canonical live receipt set, and mutable state;
`state.receipts_digest` separately binds reconciliation to the checkpoint plus
live receipt set. The canonical Markdown envelope includes an explicit closing
`</details>` tag and permits no extra presentation text. The comment ID is
stable for the life of the journal. Updates edit that comment; they never
create another journal or a receipt-specific comment.

Receipt immutability is enforced by the journal protocol. A deterministic
receipt identity may be inserted once. Replaying an identical receipt is a
no-op; presenting different canonical JSON for an existing identity fails
closed. A mutation may append a receipt or replace the explicitly mutable
state, then must increment the revision and recompute `journal_digest`. Receipt
reconciliation also validates `state.receipts_digest` against the canonical
receipt set.

Before appending a later event, a terminal journal with no active or retired
worker and no unfinished evidence deterministically checkpoints its completed
prefix in place. The admission cursor remains top-level and independent from
receipt compaction. The checkpoint retains the cumulative receipt digest and
counts, the verified lifecycle tail event, and independent status, runtime, and
pending-owner evidence for every target. Open state uses the reconciled
lineage tail; closed state uses the matching closure. The mutable state is
rebased onto that verified tail and the completed live receipts are cleared.
Semantic replays of the checkpoint tail are idempotent, while a conflicting
receipt under the same run identity fails closed. Retrying a semantic alias
already covered by the top-level cursor is an exact no-op and cannot advance checkpoint
sequence, counts, or digest twice. A docs-only checkpoint tail
carries each target's inherited runtime success URL or terminal failure/error
meaning for subsequent docs-only pushes. This is one atomic revision of the
same comment and schema, not rollover, archival, or a second persistence path.
A four-target 50-preview sequential-cycle fixture remains below a strict
16,000-byte rendered UTF-8 bound.

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
3. updates the existing comment, or creates it for an explicit bootstrap or a
   strict numbered first-attempt `opened`/`reopened` event only after proving
   that its head commit carries no matching
   `Vercel Preview Journal v2 / PR #<number>` initialization status;
4. rereads the comment and proves its exact revision, canonical JSON, and
   journal digest before publishing statuses or dispatching work.

Duplicate journals, an unexpected author, malformed or oversized JSON, a
conflicting receipt, a lost reread, or a writer outside the common queue is an
ambiguous state and fails closed. The queue is not the first-plus-latest
selection algorithm; it only prevents concurrent journal replacement. Receipt
contents and current pull-request state continue to determine selection.

Before completed-worker recovery, journal mutation, status publication, or
dispatch, reconciliation compares the live pull request with the journal's
latest uniquely represented operational snapshot: PR number, lifecycle state,
trusted base ref, head SHA/ref/repository, author/trust classification, and
closed timestamp. The base ref is the PR target identity: ordinary base-tip SHA
advancement on that same ref does not imply a missing receipt or deferral,
while an actual base-ref retarget does. The trusted base SHA remains immutable
planning evidence on each receipt. GitHub's `updated_at` is deliberately
excluded because title- or body-only edits advance it without creating a
preview event receipt.
Each `pull_request_target` run has a strict machine name that binds its workflow
run ID and workflow-monotonic run number to the PR, action, head SHA,
synchronize `before` SHA, and receipt requirement. Dependabot author/ref events
and edited events without a base change are strict non-receipt admissions;
every other eligible event requires a receipt.

The journal's top-level `admission` cursor stores the active controller's
numeric workflow ID and the exact run ID/run number proven through. One
job-scoped scanner resolves the workflow file to that numeric identity and
lists the workflow's runs newest-first without branch, event, SHA, or time
filters. It must account for every run number above the cursor exactly once,
including inert `repository_dispatch` and `workflow_run` runs, and validate
each run's workflow, repository, trigger, immutable envelope, state, and strict
title. The first page is reread to reject a moving view. Five 100-run pages,
128 total admission requests, 500 processed raw runs, and 96 title hydration
requests are hard job-wide bounds shared by every proof boundary. A complete
proof advances the in-memory cursor; only a complete monotonic cursor is
persisted.

For this PR, every receipt-required admission above the cursor needs its exact
live receipt, and every numbered receipt above the cursor must map to one strict
admission. A missing queued or in-progress receipt defers without state, status,
dispatch, or ownership mutation; a completed run with no receipt fails closed.
Foreign strict runs are classified inside the same interval without opening a
foreign journal. Dynamic placeholder titles hydrate under one shared 30-second
budget. A still-pending placeholder defers, while a completed placeholder or
malformed strict run fails closed. Closed PR runs may have empty PR linkage;
present linkage is validated, while the strict title and top-level envelope
authenticate an empty-link run. Reruns reuse the same run ID and number, so
attempts do not create sequence entries.

A stable run-number gap, numeric workflow-ID mismatch, unavailable floor,
traversal overflow, or budget exhaustion fails closed and requires drain plus
explicit bootstrap. This global interval proof catches consecutive pushes and
same-head close/reopen cycles without relying on mutable `updated_at`, branch
names, or fork-controlled refs. Live reconciliation, dispatch, and final
publication boundaries reuse the same scanner, cache, cursor, and budget. The
event-receipt and bootstrap-receipt jobs receive least-privilege
`actions: read`; reconciliation already has Actions access for worker
recovery.

A first-attempt strict `opened`/`reopened` event may create the journal only
when no durable controller status for the same PR exists on its head commit.
Synchronize, edited, and closed events never infer a missing floor. Every
durably recorded event ensures a
separate `Vercel Preview Journal v2 / PR #<number>` success-status witness on
its head before normal reconciliation. This advances deletion evidence across
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
operator-authorized clean restart. The controller validates its numbered
receipt against the exact strict `repository_dispatch` run under the current
numeric workflow ID, then stores that run as the new floor. Earlier controller
runs are excluded and every later run is globally accounted. A brand-new strict
`opened` or `reopened` journal may use the immediately preceding run number as
a temporary floor. A legacy/unnumbered journal or first strict `synchronize`,
`edited`, or `closed` receipt must be bootstrapped. There is no branch-scoped or
legacy admission fallback.

One explicit closed-bootstrap path exists for recovery of a legacy cursorless
closed journal during the admission-cursor cutover. It can update only an
existing canonical v2 journal whose live PR is closed and whose durable state
proves that no worker, selection, result, or dispatch ownership remains
unfinished. The journal is cursorless unless this is an exact rerun of its
already-recorded bootstrap. It authenticates the exact repository,
numeric workflow ID/path, `repository_dispatch` run ID and run number, strict
title, and receipt before mutation. It records a terminal closed anchor/state
and admission floor without planning, worker dispatch, Deployment mutation, or
a pending preview status. A rerun of that same Actions run is idempotent and can
repair a post-commit witness or reconciliation failure; a second distinct
closed-bootstrap run cannot replace the cursor. A missing journal fails rather
than being created. Delayed events at or below that floor are exact-run-
authenticated write-free no-ops, while every later run remains part of the
global admission interval. A subsequent valid `reopened` event starts a new
epoch from the terminal anchor.

GitHub currently bounds `queue: max` at 100 pending jobs. The controller must
keep journal mutations short and expose queue pressure during canaries. When
only the live pull request's current operational snapshot is awaiting its
serialized receipt, and epoch selection has at most one candidate, the
controller may return the bounded, zero-write deferred result described above.
A missing historical admitted-event receipt, or more than one epoch candidate,
remains ambiguous and fails closed. The controller may recover current intent
only by re-querying the live pull request and performing the existing
conservative, fail-closed plan; it must not invent a missing historical receipt.

### Trust and public evidence

Only trusted default-branch controller or worker-controller code may reach a
journal write token. No write-token job checks out or executes pull-request
code. Existing exact-SHA, author/repository/ref, workflow-SHA, epoch, key,
Deployment, and worker-attempt validations remain required before a journal
transition can authorize work.

Tokens, environment files, cookies, output directories, bypass values, raw
provider responses, and credential values never enter the journal. The
journal's compact target table, aggregate `Vercel Preview` commit status, and
canonical GitHub Deployments are the reviewer and operator surfaces. The
collapsed JSON remains internal coordination evidence, not a new required
check or deployment.

### Clean cutover, cleanup, and rollback

Admission-cursor rollout is also intentionally single-path. First merge a
precursor that emits strict numbered event/inert titles and numbered bootstrap
receipts without enforcing the cursor. Verify one live canary. Then update
enforcement PR #586 exactly once, wait for its strict `synchronize` receipt,
freeze it, and drain controller, worker, intake, and callback activity plus all
unfinished durable ownership before merging it. Its close may fail admission
because the new implementation was not yet live on the default branch; that
one rollout edge is repaired only after merge. From the new default branch,
drain again and dispatch one closed bootstrap for #586. The exact
`repository_dispatch` run ID/number/title, numeric workflow ID/path,
repository, receipt, cursor, and terminal closed state must agree, with no
planner, worker, Deployment, or pending-status side effect. Finish or rerun the
same run's reconciliation (or dispatch an explicit reconcile after a committed
receipt) and recheck the terminal state. A second distinct closed bootstrap is
forbidden. Every other open pre-cursor v2 journal, including the explicit #535
inventory item, must be drained and bootstrapped immediately before another
lifecycle event. Delayed pre-floor runs authenticate exactly and perform no
writes; missing receipts above the floor defer while running and fail closed
when completed. A corrective push before a planned open bootstrap invalidates
that floor and therefore requires another drain/bootstrap cycle. No old branch
proof, inferred synchronize floor, or dual admission reader remains.

There is no dual-read period and no compatibility path for v1 journals or
already-running v1 workers. Before merging v2, operators establish a no-push
window; drain or cancel every preview controller, worker, and intake run; and
inventory the exact comment ID of every open participating PR's trusted
`<!-- vercel-preview-journal:v1 -->` comment. The cutover must not proceed while
a v1 run can still write a journal, dispatch work, or publish preview state.
The v2 implementation contains no v1 reader, writer, presentation upgrader,
payload importer, deleter, rematerializer, or compatibility worker.

After the merge, every open participating pull request is bootstrapped from its
current live PR metadata and a fresh fail-closed four-target plan. Bootstrap
creates an independent v2 journal epoch; it does not import, translate, trust,
or reconcile the v1 payload. Operators must prove exactly one trusted
`<!-- vercel-preview-journal:v2 -->` comment with a stable ID, all four target
states/checkpoints, and an exact-head aggregate status consistent with worker,
Deployment, native-owner, or no-runtime evidence.

Only after every open PR's v2 journal is proven may an operator manually delete
the inventoried v1 comment IDs. Each deletion rereads and requires the exact
recorded ID, exact `github-actions[bot]` author, and complete v1 journal marker.
Unknown, malformed, human, review, and third-party-bot comments are never
deleted. Cleanup is an operator step; it is deliberately absent from v2 runtime
code.

Rollback is a v2 roll-forward restart, not a data migration. Operators first
drain or cancel v2 controller and worker runs, merge the reviewed corrective
change, and bootstrap v2 afresh from live pull-request state. Never restore the
v1 controller, import a v1 payload, rematerialize a deleted v1 journal, or claim
continuity with the discarded epoch.

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

- Reviewers see at most one explanatory preview-controller journal with four
  visible target outcomes and collapsed machine state, rather than one card per
  procedural receipt.
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
