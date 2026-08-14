---
title: Dependabot Processing
status: active
owner: eng
canonical: true
last_verified: 2026-08-14
scope: ci/dependabot-processing
---

# Dependabot Processing

The Dependabot controller prepares eligible pull requests for one human action:
clicking Merge. It can classify, refresh, repair, re-review, satisfy
receipt-bound feedback, approve through the normal processor identity, and
publish exact-head ALL CLEAR evidence. It never merges and never enables native
auto-merge.

[ADR 0006](adr/0006-dependabot-processing-controller.md) records this decision.
This runbook defines the live trust boundaries, receipts, operating sequence,
and failure handling.

## Invariants

Keep these properties true in code, workflows, rulesets, and operation:

- Modes are exactly `observe`, `assist`, and `prepare`. Missing, empty,
  legacy `merge`, unknown, case, or whitespace variants become `observe`.
- No workflow or controller code calls a merge endpoint, runs `gh pr merge`,
  enables auto-merge, or holds a merge queue entry. A maintainer performs the
  final squash merge.
- Every decision, packet, mutation, review, reply, approval, and readiness
  receipt binds the exact repository, PR, branch, current base, and head.
- Any push invalidates all earlier current-head gates and review evidence.
- Refresh and repair are strict append-only operations. A force-push event
  permanently removes preparation authority for that PR generation.
- Refreshes have a separate receipt lineage and do not spend the two-repair
  budget. At most two repair commits are allowed.
- Branch-write authority and approval/ALL CLEAR authority never coexist in one
  job or process.
- Candidate input is never executed. The read-only materializer may hold a
  step-scoped token while sealing exact inert Git blobs; candidate artifacts,
  dependencies, caches, and commands never enter a write- or secret-bearing
  job.
- Only one ALL CLEAR candidate occupies the lane. Keep it occupied through the
  human merge and the exact merge SHA's default-branch CI and release proof.
- Keep the npm open-pull-request limit at six or higher. Five npm PRs were
  already open when the isolated Vercel lane launched, so the former limit
  prevented that rotation from reaching the processor.
- ALL CLEAR is current evidence, not a timeless authorization. GitHub must still
  enforce current-base and ruleset state when the maintainer clicks Merge.

## Trust topology

### Native Dependabot intake

`.github/workflows/dependabot-intake.yml` is the credentialless
`pull_request_target` boundary for `opened`, `synchronize`, and
`reopened`. Its existing `dependabot-intake:v1` title stays strict. The
workflow has `permissions: {}`, one local shell step, no API call, no secret,
no checkout, and no artifact. It binds repository, PR, Dependabot-owned
`dependabot/*` ref, exact head, base `main`, action, and the exact Dependabot
bot event sender login, user ID, and type.

Do not relax this receipt to admit an App-authored head. The strict native
receipt is useful because a normal Dependabot synchronize and a prepared
successor have different actors and lineage requirements. App-authored
synchronize events are inert here and enter only through prepared-head intake.

### Prepared-head intake

`.github/workflows/dependabot-prepared-head-intake.yml` is a distinct
credentialless `repository_dispatch` boundary with event type
`dependabot-prepared-head`. The dispatch must be authored by the exact
configured Prepare App bot ID/login. Its payload has nine top-level keys, below
GitHub's ten-key limit:

```json
{
  "schema": "dependabot-prepared-head-intake:v1",
  "repository": "mento-protocol/frontend-monorepo",
  "prNumber": 731,
  "headRef": "dependabot/...",
  "parentHeadSha": "<40 hex>",
  "headSha": "<40 hex>",
  "operation": "refresh",
  "operationReceipt": {
    "checkId": 123,
    "digest": "<64 hex>",
    "externalId": "<typed external ID>",
    "workflowRunId": 456,
    "workflowRunAttempt": 1,
    "workflowSha": "<40 hex>"
  },
  "prepareApp": {
    "slug": "<exact App slug>",
    "botId": 123456,
    "botLogin": "<exact App bot login>"
  }
}
```

The compact display title carries only PR, new head, operation kind, check ID,
digest, and receipt result. It stays at or below 220 characters at maximum
bounded field lengths. The trusted downstream workflow re-fetches the check and
full canonical receipt; the title is not authority by itself.

A malformed payload, actor mismatch, false receipt, wrong check type, extra key,
or oversized/unbound value never enters the prepared reviewer or processor.

### Trusted processor

`.github/workflows/dependabot-process.yml` consumes authenticated native
intake, prepared-head intake, and Dependabot Claude Review completions. The
bounded `dependabot-process` repository dispatch remains an operator sweep
whose payload is exactly `{"scope":"open"}`. There is no
`workflow_dispatch`.

The schedule runs at minutes `3,13,23,33,43,53` to reconcile missed events.
Immediate intake and review completions provide the normal low-latency path.
Every downstream `workflow_run` gate identifies its source by the exact
allowlisted workflow path. A custom `run-name` becomes the live run's `name`
and `display_title`, so those dynamic fields authenticate only the typed receipt
grammar and never select the source workflow.
Every entry point materializes `scripts/dependabot-processor.mjs` and its
`scripts/dependabot-preparation-receipts.mjs` validator dependency through the
GitHub Contents API at the same exact `github.workflow_sha`; it never checks out
a candidate ref.

Prepare execution has explicit phases:

- `request` may publish only a typed old-head Refresh request. It has no App
  credential or branch-write authority.
- `mutate` may consume only a terminal trusted request from an earlier
  Processor run. Before dispatch, the old PR base must still match the
  receipt's `previousBaseSha`, while an independent live default-branch lookup
  must match the receipt's `baseSha`. A short-lived Prepare App token then
  performs the bounded branch refresh. It cannot publish checks, approve,
  reply, resolve threads, or publish ALL CLEAR.
- `finalize` rejects `DEPENDABOT_PROCESSOR_REPAIR_TOKEN`, cannot update a
  branch, recollects the exact head, and alone may clean stale processor
  approvals, post packet-bound replies, approve, and publish ALL CLEAR.
- A phase-less invocation defaults to `finalize` for compatibility; every
  trusted workflow passes its phase explicitly. An unknown or incompatible
  phase fails closed.

### Trusted Dependabot review

`.github/workflows/dependabot-claude-review.yml` follows either credentialless
intake through `workflow_run`. Before any token, secret, or Action:

1. the first shell step authenticates upstream conclusion, event, actor ID,
   actor login/type, exact workflow path, repository, compact receipt, run ID,
   attempt, and workflow SHA;
2. it re-queries the live open non-draft Dependabot PR and exact head; and
3. for prepared heads it materializes
   `scripts/dependabot-prepared-review.mjs` at exact
   `github.workflow_sha`.

The prepared validator accepts only:

- a completed successful `Dependabot Refresh` or `Dependabot Repair` check
  published by github-actions App ID 15368;
- canonical raw JSON whose digest, external ID, run ID/attempt, and workflow SHA
  agree;
- a terminal successful trusted Actions run with the exact workflow path,
  event, repository, `main` source, and SHA;
- an exact two-parent refresh whose first parent is the prior PR head and second
  parent is the completed receipt's verified applied base, plus its successful
  old-head request;
- an exact one-parent, verified-valid Repair App bot commit, its durable staged
  intent, completed receipt, and v2 Processor packet; and
- a complete first-parent operation chain ending at a verified Dependabot seed.

The validator accepts the submitted Actions URL or GitHub's exact
`/runs/<check-id>` self URL representation, then resolves the run only from
the canonical receipt. A generic github-actions check, external ID alone,
candidate comment, or configured actor assertion cannot establish lineage.

The Claude job has only read permissions and checks out only the trusted
workflow SHA. It restricts built-in tools to Bash, denies every MCP tool, and
runs in `dontAsk` mode. A trusted `PreToolUse` guard authorizes one exact bound
repository-scoped `gh pr diff` command per workflow run attempt and exits with a
blocking result for every other Bash input, including suffixes, compound shell
syntax, background execution, and malformed calls. The job therefore grants no
generic Bash, `gh api`, Git, curl, web, or GitHub MCP access. It never downloads
a candidate artifact, restores a candidate cache, installs candidate
dependencies, or executes candidate code. A paired trusted `PostToolUse` guard
binds the same command and tool-use ID, rejects interrupted, background,
timed-out, empty, or persisted/truncated output, and seals a digest-bound
`dependabot-claude-review-tool-completed:v2` receipt over the original diff.
After sealing, the hook replaces the model-visible Bash result with one
`text/plain` document whose data is the exact validated stdout. This document
path bypasses Claude Code 2.1.220's 30,000-character text-result persistence,
which would otherwise replace a large successful result with a short persisted
preview that the restricted reviewer cannot reopen. A later no-token step
requires the v2 receipt, so a missing or failed diff cannot be upgraded by
schema-valid model output. Its exact bot allowlist contains only
`dependabot[bot]` and the configured Prepare App bot login.

The isolated publisher has no Claude secret or checkout. For both clean and
findings outcomes, `claude-review` check `output.text` is the exact canonical
`dependabot-claude-review-result:v1` JSON. A provenance-valid
`verdict="findings"` is deterministic repair input. A missing, malformed,
incomplete, or infrastructure-failed result is retry-first and cannot become a
repair packet.

## Prepare App configuration and residual capability

Configure:

| Type     | Name                                           |
| -------- | ---------------------------------------------- |
| Variable | `DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID`   |
| Variable | `DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG`        |
| Variable | `DEPENDABOT_PROCESSOR_PREPARE_BOT_ID`          |
| Variable | `DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN`       |
| Secret   | `DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY` |

The client ID mints a short-lived installation token. The returned App slug is
verified against configuration, and the live bot account ID/login/type is
queried before mutation. Receipt authority records the verified slug and bot
identity; it does not pretend that a bot user ID is the numeric GitHub App ID.

Install the repository-scoped App with only `contents: write` and
`pull-requests: write`; GitHub's update-branch endpoint requires both. The
processor's refresh token requests both permissions. Git Data repair and
authenticated-dispatch tokens are explicitly downscoped to Contents write.
Grant no bypass, Actions, workflow, deployment, package, environment, or
provider permission.

GitHub does not offer an endpoint-level permission that permits Git writes but
denies the merge endpoint. Contents write therefore leaves a residual technical
merge capability. The control is architectural and auditable:

- no reviewed workflow or helper contains a merge call;
- the token exists only inside a repair-staging, ref-mutation/refresh, or
  authenticated-dispatch job;
- no such job has approval or ALL CLEAR authority;
- the token is revoked/invalidated at job completion; and
- finalize runs later without the App credential.

Never substitute the normal `GITHUB_TOKEN`, preview worker credential, Vercel
or package credential, deployment token, or a PAT.

## Modes and handling tiers

| Mode      | Classification | Packet                        | Refresh/repair/re-review | Approval/ALL CLEAR  | Merge |
| --------- | -------------- | ----------------------------- | ------------------------ | ------------------- | ----- |
| `observe` | Yes            | No                            | No                       | No                  | Never |
| `assist`  | Yes            | No; non-authorizing evidence  | No                       | No                  | Never |
| `prepare` | Yes            | v2 generic or v3 typed packet | Eligible bounded path    | Exact finalize only | Never |

Unknown values normalize to `observe` before any credential is exposed.

Handling tier and preparation eligibility are separate:

- **preparable**: verified npm updates, including grouped and major updates, and
  verified non-sensitive GitHub Actions updates may be refreshed and, when
  already green, fully prepared. Autonomous repair never writes `.github/**`;
  an Actions failure that would require such a change becomes
  `manual-repair-required`. The dependency names, update type, ecosystem, and
  risk tier remain visible to the maintainer.
- **manual**: sensitive/self-reviewing Actions; workflow-policy, deployment,
  authentication, credential, or security Actions; unknown ecosystem or
  metadata; and any policy shape not explicitly admitted.
- **vetoed**: human veto/close/reopen, force-push history, unresolved or
  malformed feedback, untrusted actor, or ambiguous/capped evidence.

The preparable tier is broader than the former automatic tier. It does not grant
automatic merge authority. It authorizes only bounded preparation for a human
decision.

Two preparation dispositions are intentionally terminal for the current sweep:

- `repair-pending` means the exact head already has its trusted attempt packet.
  The PR keeps the serialized lane, the processor preserves that original
  packet/run for retry, and later sweeps publish neither a second packet nor an
  identical Processor check.
- `manual-repair-required` means deterministic evidence needs a change outside
  the valid bounded packet surface. The PR leaves the automatic lane for human
  repair and receives no packet.

## Exact preparation sequence

### 1. Collect and classify

The collector brackets each PR, files, commits, checks, immutable commit
metadata, feedback, and base-ancestry read with stable identity reads. It
collects every bounded thread/reply, review, issue comment, close/reopen event,
force-push event, and native `AutoMergeRequest`. Any collection cap,
pagination ambiguity, malformed SHA/envelope, unknown authority-bearing bot, or
identity drift fails closed.

Only exact configured gate and receipt names trigger an Actions workflow-run
provenance lookup. Unrelated checks and statuses remain raw non-authorizing
evidence and consume no run lookup. One processor job caches each exact
repository/run/attempt provenance read across its collections; the selected
post-merge gate is always re-fetched for its current snapshot.

Every required gate must report for the exact head. Attribute each failure
against the corresponding current-`main` baseline:

- `branch`: deterministic exact-head failure with a passing baseline;
- `base`: the corresponding current-main baseline also fails;
- `non-deterministic`: provider-backed head failure with a passing baseline;
- `unknown`: baseline missing or pending.

Only deterministic branch failures or provenance-valid Claude findings can
enter a repair packet. Any non-deterministic or unknown failure suppresses the
whole packet, including mixed failures. The current controller does not patch
around or infer success from provider failures; wait for or authorize a trusted
retry, then recollect.

### 2. Refresh stale current-base ancestry

Prepare mode can request a refresh only after stable structural identity and
policy eligibility. It first publishes a successful `Dependabot Refresh`
request receipt on the old head. The short-lived Prepare App requests an
append-only update to the exact current base.

The completed head is accepted only when:

- it is still the same repository-owned `dependabot/*` ref and PR;
- the old head is its first parent, and its second parent is either the
  still-current requested base or the verified live-current successor admitted
  by the bounded request-to-update race reconciliation;
- the completed receipt points to the exact old-head request check and digest;
- the App bot dispatch and terminal trusted run are exact; and
- the full native/prepared chain remains rooted in the verified Dependabot seed.

A refresh never increments the repair count. Do not use Dependabot rebase,
force-push, or a history rewrite.

GitHub may retarget existing review-comment commit metadata while update-branch
creates the append-only successor. The bounded old-head wait and typed
snapshot-race retry use separate counters so a late successor still gets a
stable read. The accepted read still requires a fully stable snapshot plus the
exact parent, base, App identity, and signature evidence above. Persistent drift
or any other collection error fails closed.

### 3. Produce and publish one bounded repair

A generic v2 repair packet exists only when identity/lineage, current base,
complete gate, clear feedback, deterministic attribution, preparable policy,
and repair attempt lineage all pass. A typed v3 packet may instead represent
one admitted deterministic protected-runtime synchronization. Its operation is
actionable even with no failed check: ALL CLEAR would otherwise leave the
immutable Dependabot target unrealized across the protected runtime. Same-head
processing is idempotent. The first append-only Repair commit consumes attempt
one; a second consumes attempt two. There is no third attempt.

Processor check publication is also transition-idempotent. The newest trusted
exact-head receipt must match mode, disposition/output summary, attempt, packet
flag, and packet digest before publication is skipped. Newer malformed or
untrusted evidence never suppresses a replacement. `repair-pending` retains the
original packet source rather than creating another repair run.

`.github/workflows/dependabot-prepare-repair.yml` separates planning, durable
intent, branch mutation, and recovery:

1. **preflight** authenticates the exact Processor v2 or v3 packet and terminal
   processor run, then selects its exact plan kind;
2. **plan** first runs the trusted `materialize-repair-evidence` command with a
   step-scoped read token. The command authenticates the packet and live PR,
   binds the exact base-to-head compare, re-fetches every expected file through
   the Git blob API, collects only packet-bound failed-job logs and findings,
   and seals a canonical manifest plus synthetic evidence files under
   `RUNNER_TEMP`. Claude then runs through the pinned token-free base action
   with only guarded `Read` and `Grep` access to those files and a strict JSON
   schema. Its model-visible tool surface has no Bash/Edit/Write, general
   network, MCP, candidate checkout, or mutation capability. The workflow-only
   `DEPENDABOT_REPAIR_EVIDENCE_ROOT`,
   `DEPENDABOT_REPAIR_EVIDENCE_MANIFEST`, and
   `DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST` values bind the hook to that
   sealed directory and manifest. Paired pre/post hooks seal successful exact
   accesses; large files require explicit one-based bounded Read pages, and Grep
   may locate the relevant ranges. A no-token postflight assertion requires at
   least one successful exact access before the generic plan job succeeds.
   A `vercel-cli-runtime-sync` v3 packet takes the mutually exclusive
   model-free path instead: trusted code reads the same exact blob evidence,
   fetches the exact current and target public npm records, changes only the
   Vercel regions of the root lock, runs pinned pnpm with scripts, workspace
   links, and pnpmfile loading disabled to regenerate the standalone lock twice,
   and emits only the packet's fixed five-path patch set;
3. **validate** has no secret or write token. It re-fetches exact inputs by Git
   object SHA, including files larger than the Contents API limit, applies
   patches in a disposable credential-free temporary Git tree, enforces
   permitted/forbidden paths, file/edit/byte caps, exact
   packet/head/base/check IDs, and emits a digest-bound plan. For the typed v3
   path it also regenerates independently and requires exact plan equality;
4. **candidate CLI smoke** runs only for typed v3 after trusted validation on a
   fresh no-output runner. It binds the canonical validated plan, performs a
   secretless frozen standalone install with candidate scripts and workspace
   links disabled, and requires `node <cli> --version` to equal the packet
   target. Candidate execution is the terminal step: it can veto staging but
   cannot change the validated plan or produce downstream authority;
5. **stage** alone receives a short-lived Prepare App token and writes exact
   unreachable blobs, tree, and one commit without moving the branch;
6. **intent** has no App token. It publishes `Dependabot Repair Intent`
   (`dependabot-repair-intent:v1`) on the staged successor, binding the packet,
   plan, old head, tree, result blobs, exact workflow run, and expected new head;
7. **mutate** receives a fresh Prepare App token, revalidates the intent and
   exact current ref, then moves only that `dependabot/*` ref with
   `force=false`; and
8. **receipt/recovery** has no App token. It publishes the completed
   `Dependabot Repair` check, or recovers that check idempotently after a failed,
   cancelled, timed-out, action-required, or startup-failed source run only when
   the exact intent-bound commit is already the current PR head.

The staged tree is never executed. The Repair commit must have the configured
Prepare App bot as its exact author and either that bot or GitHub's exact
`web-flow` system user as its committer, with GitHub verification
`verified=true` and reason `valid`. GitHub uses `web-flow` when it server-signs
a Git Data commit created by an App without custom author, committer, or
signature fields. A staged intent is inert if its commit did not become the PR
head. `Dependabot Prepared Head Dispatch` sends prepared-head intake only from
a successful completed Repair receipt. Only the exact retryable non-success
conclusions above may trigger bounded retry or the checks-only recovery path;
they never establish completion authority by themselves.

Infrastructure retry count is separate from the two-commit repair attempt. A
normal failure before the ref move re-authenticates and redispatches the exact
Processor packet at counts one and two. Any normal failure after the exact ref
move enters recovery at count zero, including when the normal run was already
retry two. Failed checks-only recovery may retry at counts one and two. Count
two is terminal; retry never changes the packet, plan, intent, head, or repair
attempt.

### 4. Re-review and recollect

The prepared-head intake starts a new exact-head Claude review and processor
cycle. Discard every old check, review, base, and feedback conclusion.

A generic v2 packet may bind a validated Claude finding or review thread only by exact
identifier, commit/head, and body digest. After the repaired head has a clean
re-review and complete green gate, finalize may post only:

`Fixed in <current-head prefix> — <concrete change>`

and resolve only those packet-bound threads. It must then collect feedback
again. Generic github-actions comments/replies, unbound bot output, or a model
claim never satisfy feedback. Automated `Won't fix` is not permitted; that
decision remains human.

A v3 Vercel runtime sync may bind an exact Cursor thread only when its
structured `Incomplete Vercel CLI runtime sync` finding names the operation's
source and target versions, root `package.json` path, and trusted seed or
current review commit. All actionable threads must match that contract. Any
other unresolved feedback makes the typed operation manual. The completed typed
Repair then uses the same digest-bound reply and resolution flow above.

For historical Codex feedback, `Reviewed commit` binds the parent review's own
`reviewCommitSha`, not the repaired current head. Its unresolved historical
thread still blocks; a resolved historical thread clears. If an exact
packet/PR/head/thread-bound remediation reply already exists, a retry does not
post it again and retries only thread resolution.

### 5. Finalize one ALL CLEAR candidate

Before readiness publication, finalize:

1. proves there is no native `AutoMergeRequest` on any Dependabot PR;
2. discovers the repository-wide approval/ALL CLEAR inventory, preserves and
   prioritizes one still-valid active candidate even when it is outside a
   targeted run, and dismisses only stale or invalid authority;
3. recollects the selected PR and global lane from scratch;
4. proves exact native or prepared lineage, current `main` ancestry, stable
   `updated_at`, complete green gates, clean exact-head Claude review, and
   clear feedback;
5. requires GitHub `mergeable`, `mergeStateStatus`, review decision, branch
   protection/ruleset, and required-check state to be satisfied;
6. creates one exact-head processor approval with the normal workflow token;
7. recollects the selected PR, then immediately re-reads the repository-wide
   approval inventory and proves it contains exactly that new approval ID, PR,
   and head with no other evidence change; and
8. publishes a successful `Dependabot ALL CLEAR` receipt.

The Prepare App token is absent throughout finalize. The processor approval
satisfies the repository's review rule; it does not authorize code to merge.
If any post-approval gate fails while the PR remains open, dismiss the approval
and do not publish success.

## Typed receipt contracts

All authority-bearing check output is exact recursively key-sorted compact JSON.
SHA-256 is computed over those exact bytes. The publisher is github-actions App
ID 15368, but that shared identity alone grants no authority. Every receipt also
binds its exact terminal trusted workflow run ID, attempt, workflow SHA, path,
event, repository, `main` source, status, and conclusion. GitHub's self check
URL is accepted only for the same check ID and resolved canonical run.

### Processor v2 and repair packets v2/v3

A packet-issued Processor check uses:

`dependabot-processor:v2:pr=<n>:head=<sha>:mode=prepare:repair=<1|2>:packet=true:digest=<digest>:run=<run-id>:attempt=<run-attempt>`

Its `output.text` is the exact canonical
`dependabot-repair-packet:v2` or `dependabot-repair-packet:v3` JSON. It is
deliberately a completed **failure** check while repair is required, so it
cannot unblock merge. Both schemas bind the exact workflow run/SHA,
PR/head/base, attempt, policy/risk, permitted/forbidden paths, caps, validation,
and escalation. V2 additionally requires deterministic failure, finding, or
feedback evidence.

V3 is reserved for the exact
`dependabot-protected-runtime-sync:v1` operation. Its current
`vercel-cli-runtime-sync` kind binds the immutable seed Vercel row, stable
same-major patch/minor target, exact pnpm 10.34.4, exact current-head input
blobs, and the fixed root/runtime manifest, lockfile, and contract output paths.
It may carry empty failure/finding/feedback arrays because the missing typed
runtime synchronization is the actionable invariant. It may instead carry only
the exact matching Cursor runtime-mismatch threads described above. Mixed v2
attempt-one and v3 attempt-two lineage remains valid only when every packet,
Intent, commit, receipt, operation digest, target version, and current-tree
contract matches.

### Refresh v1

Requested receipt exact keys:

`baseSha, headRef, headSha=null, parentHeadSha, prepareAppSlug, prepareBotId, prepareBotLogin, previousBaseSha, pullRequestNumber, repository, schema, state, workflowRunAttempt, workflowRunId, workflowSha`

Completed adds `requestCheckId` and `requestDigest`, sets
`headSha=<new head>`, and records the actual second parent in `baseSha`. That
parent can differ from the requested base only through the bounded verified
request-to-update race reconciliation. An older applied base can remain valid
lineage, but current-base readiness still requires another refresh.

External ID:

`dependabot-refresh:v1:pr=<n>:head=<bound head>:state=<requested|completed>:digest=<digest>:run=<run-id>:attempt=<run-attempt>`

Both checks are completed success.

### Repair intent v1

Intent exact keys:

`attempt, baseSha, edits, editsDigest, headRef, headSha, packetDigest, parentHeadSha, parentTreeSha, prepareAppSlug, prepareBotId, prepareBotLogin, processorCheckId, pullRequestNumber, repository, retryCount, schema, state, treeDigest, treeSha, validatedPlanDigest, workflowRunAttempt, workflowRunId, workflowSha`

External ID:

`dependabot-repair-intent:v1:pr=<n>:head=<staged head>:attempt=<repair attempt>:digest=<digest>:run=<run-id>:run_attempt=<run-attempt>`

The completed-success intent is non-readiness evidence. `retryCount` records
the bounded normal infrastructure retry that produced it. `edits` contains one
to six objects with exactly
`contentDigest, expectedBlobSha, mode, path, resultBlobSha, type`. Paths are
unique, each result blob differs from its expected blob, `type` is `blob`, and
`mode` is `100644` or `100755`. The intent binds one exact validated staged
successor before the branch moves. Mutation or recovery must
re-fetch and match its source run, Processor packet, exact tree/blobs, App
identity, verified-valid commit, and current PR ref.

### Repair v1

Completed receipt exact keys:

`attempt, baseSha, headRef, headSha, packetDigest, parentHeadSha, prepareAppSlug, prepareBotId, prepareBotLogin, processorCheckId, pullRequestNumber, repository, schema, state, workflowRunAttempt, workflowRunId, workflowSha`

External ID:

`dependabot-repair:v1:pr=<n>:head=<new head>:attempt=<repair attempt>:digest=<digest>:run=<run-id>:run_attempt=<run-attempt>`

The check is completed success. `processorCheckId` and `packetDigest` bind the
exact parent-head Processor failure check and canonical v2 or v3 packet.

### ALL CLEAR v1

ALL CLEAR top-level keys are exactly:

`autoMergeEnabled, baseSha, checksDigest, feedbackDigest, headRef, headSha, humanAction, mergeAuthorizedByAutomation, mergeStateStatus, mergeable, preparation, processorApprovalId, pullRequestNumber, repository, reviewDecision, riskTier, schema, updateType, workflowRunAttempt, workflowRunId, workflowSha`.

Fixed values are `humanAction="merge"`,
`mergeAuthorizedByAutomation=false`, `autoMergeEnabled=false`,
`mergeable=true`, `mergeStateStatus="CLEAN"`, and
`reviewDecision="APPROVED"`.

Its `preparation` object is either:

- native: `{kind:"native",seedHeadSha,refreshCount:0,repairCount:0,operationDigests:[]}`; or
- prepared:
  `{kind:"prepared",seedHeadSha,refreshCount,repairCount,operationDigests,prepareAppSlug,prepareBotId,prepareBotLogin}`.

For a prepared lineage, `operationDigests.length` equals
`refreshCount + repairCount`, and every operation digest is unique.

External ID:

`dependabot-all-clear:v1:pr=<n>:head=<sha>:base=<sha>:digest=<digest>:run=<run-id>:attempt=<run-attempt>`

A native verified Dependabot seed can finalize without minting the Prepare App
token.

## Native auto-merge and approval cleanup

Treat every GitHub `AutoMergeRequest` as mutation risk. Prepare mode removes a
sole exact candidate request only as an authority-reducing cleanup and then
recollects; another, multiple, malformed, or newly appearing request blocks.
Observe and assist never publish a readiness check while a request exists.
The controller never creates a native request.

A crash can strand a processor approval. Before any approval or readiness
publication, scan every open Dependabot PR. If the sole current approval has an
exact matching, current-base ALL CLEAR receipt, collect and revalidate that PR
even when the run targeted another PR, then keep it pinned. Otherwise dismiss
every independently schema-valid stale current-head processor approval with the
normal token, including multiple approvals or approvals outside the selected
PR, and prove the bounded global rescan is empty. An unknown or malformed
current-head github-actions approval requires operator resolution. Recollect
selected PRs and auto-merge state after cleanup; pre-cleanup evidence is stale.

## Serial human merge and post-merge proof

There is at most one successful ALL CLEAR candidate. A valid active receipt and
its sole exact approval outrank numeric candidate selection; targeted and global
runs both collect and preserve that incumbent until it merges or becomes
invalid. The maintainer checks that the receipt still targets the visible head
and clicks the normal squash Merge button. The repository ruleset must reject
stale base, changed head, failed check, missing approval, or lost review state
at click time.

In prepare mode, a targeted event expands collection to the bounded set of all
open Dependabot PRs while its expected-head assertion remains bound only to the
triggering PR. One durable preparation incumbent also outranks numeric
selection: a pending Refresh request or completion, a trusted same-head repair
packet, or a valid prepared lineage keeps the lane while it waits for checks,
retry, or re-review. Multiple incumbents without one valid active ALL CLEAR
authority fail closed. Terminal manual, vetoed, or rejected identities leave
the automatic lane, and every other preparable PR waits for serialization.

The controller does not claim to eliminate the final-read race. A comment,
review, ruleset change, native auto-merge request, or `main` push can land
after final recollection. If GitHub does not block the click, the maintainer must
stop and rerun preparation.

After merge, keep the lane occupied until the exact merge SHA has:

1. successful full default-branch `CI/CD`;
2. the applicable `Vercel Main Deployment`; and
3. successful exact-main `Dependabot Post-Merge Verification` with terminal
   release, smoke, and recovery evidence, or a verified no-target outcome.

Do not admit another ALL CLEAR candidate while main CI/release proof is missing
or failed. Follow the managed failure issue and deployment recovery runbook.

## Failure handling

| Evidence/outcome                                     | Action                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| Malformed/false intake or dispatch                   | Fail; inspect actor and exact envelope.                           |
| Head/base/feedback changed before mutation           | Make no mutation; start a fresh exact-head cycle.                 |
| Snapshot race after one authorized refresh request   | Retry read-only collection within the bounded successor poll.     |
| Missing/pending gate                                 | Wait for trusted evidence; recollect.                             |
| Base failure                                         | Repair `main`, prove recovery, then refresh affected PRs.         |
| Provider/Claude infrastructure failure               | Retry through the trusted provider path; never patch around it.   |
| Repair/recovery infrastructure failure               | Retry exact evidence twice per phase; then require investigation. |
| Valid Claude findings                                | Treat as deterministic packet input, not infrastructure failure.  |
| Eligible deterministic branch failure                | Publish v2 packet only when the bounded repair surface is valid.  |
| Admitted Vercel protected-runtime target missing     | Publish exact v3 model-free sync packet; require typed proof.     |
| Existing exact-head packet (`repair-pending`)        | Preserve its run; publish no duplicate packet/check.              |
| No valid automatic packet (`manual-repair-required`) | Leave the lane and require human repair.                          |
| Refresh needed                                       | Use request/completed v1 lineage; do not spend repair budget.     |
| Repair plan malformed/out of scope                   | Fail before App token mutation; escalate manual.                  |
| Repair attempts exhausted                            | Manual handling; do not reset with rebase/force-push.             |
| Sensitive/unknown/manual tier                        | Record evidence and require human dependency handling.            |
| Human veto/close/reopen or force-push                | Stop preparation for this PR generation.                          |
| Unresolved/unbound feedback                          | Block; never infer a reply or resolution.                         |
| Auto-merge request or competing candidate            | Remove only exact safe stale authority, recollect, or block.      |
| Mergeability/ruleset/review unsatisfied              | Do not approve or publish ALL CLEAR.                              |
| Finalize drift after approval                        | Dismiss processor approval and reprocess.                         |
| ALL CLEAR published                                  | Human verifies current head and clicks Merge.                     |
| Main CI/release proof failed                         | Keep lane occupied and follow recovery.                           |
| Ambiguous/capped evidence                            | Fail closed and require operator investigation.                   |

## Commands and reporting

Evaluate a saved snapshot without network or mutation:

```bash
pnpm dependabot:process -- evaluate --input path/to/snapshot.json --mode observe
```

Run the complete processor, workflow, receipt, repair, and reviewer contract
suite after any related code, workflow, configuration, or documentation change:

```bash
pnpm dependabot:process:test
```

When reporting, distinguish:

- classified vs packet-issued;
- refresh requested vs completed;
- repair planned vs validated vs pushed;
- review findings vs clean re-review;
- processor approved vs ALL CLEAR;
- ALL CLEAR vs human merged; and
- merged vs exact-main CI/release proven.

Include mode, workflow/run/attempt/SHA, PR/head/base, risk/preparable tier,
attribution, refresh/repair counts, operation digests, review verdict, feedback
state, approval ID, ALL CLEAR check ID, human merge SHA if it exists, and
post-merge proof.

## References

- [Dependabot on GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
- [GitHub `workflow_run` security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Claude Code Action security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
- [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub signature verification for bots](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#signature-verification-for-bots)
- [Repository dispatch](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
- [GitHub Checks API](https://docs.github.com/en/rest/checks/runs)
- [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
