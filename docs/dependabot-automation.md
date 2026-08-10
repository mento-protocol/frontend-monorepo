---
title: Dependabot Processing
status: active
owner: eng
canonical: true
last_verified: 2026-08-10
scope: ci/dependabot-processing
---

# Dependabot Processing

The Dependabot processor classifies every open Dependabot pull request, keeps
untrusted intake separate from trusted policy, and requires exact-head evidence
before it can assist or merge. It follows one merged update at a time through
default-branch CI and the existing release proof.

[ADR 0006](adr/0006-dependabot-processing-controller.md) records the
architectural decision. This runbook covers normal operation and failure
handling.

## Authority and trust boundaries

The workflow has two security domains:

1. **Read-only intake** handles Dependabot pull-request events. It exposes only
   bounded PR identity in the `Dependabot Intake` workflow-run identity. It does
   not check out candidate source, install dependencies, run candidate code, or
   hold write, provider, or dispatch credentials.
2. **Trusted processing** starts from the completed intake's `workflow_run` and
   runs processor code from the default branch. It treats the upstream run name
   and event data as untrusted hints, fetches current GitHub state itself, and
   requires the upstream `pull_request_target` run's `dependabot/*` head branch
   and 40-character head SHA to match the exact receipt title before it fetches
   the PR. It then proves the PR identity, authorship, ownership, base, and exact
   head before it interprets checks or changes state. It never downloads or
   executes candidate artifacts from the intake run.

The `dependabot-process` repository-dispatch event is a separate operator/sweep
entry with one bounded scope field. There is deliberately no `workflow_dispatch`
entry point. Do not add a manual workflow with different validation or
permissions.

The processor's normal `GITHUB_TOKEN` may perform only the versioned controller
reads, check publication, native auto-merge cleanup, and exact-head approval
explicitly granted by its workflow. It must not run PR-controlled commands with
that token, and it cannot perform the merge. It never receives Vercel,
package-registry, or application secrets.

Automatic merge uses a separate repository-scoped GitHub App. Store its client
ID in the Actions variable `DEPENDABOT_PROCESSOR_MERGE_APP_CLIENT_ID` and its
private key in the Actions secret `DEPENDABOT_PROCESSOR_MERGE_APP_PRIVATE_KEY`.
The workflow mints a short-lived installation token only for the protected
exact-head merge. The App and token may have exactly `contents: write` and
`pull-requests: write`; grant them no Actions, workflow, or deployment
permission. The App must author the merge because events created by the normal
`GITHUB_TOKEN` do not start the default-branch push workflow needed for `CI/CD`
and Vercel post-merge proof. Missing either setting fails `merge` mode closed.
It does not prevent `observe` or `assist` processing.

The merge App is not the future repair App. It has no authority to push repairs,
and provisioning it does not enable the live repair/re-review/push path.

### Trusted Dependabot AI review

Dependabot AI review has a separate trust boundary from review of human-authored
pull requests:

- `.github/workflows/dependabot-claude-review.yml` follows a completed
  `Dependabot Intake` through `workflow_run`, so Dependabot's restricted event
  never receives the Claude secret. Before any token, secret, or Action is
  used, the reviewer authenticates the successful intake event, workflow path,
  repository, Dependabot actor, live `dependabot/*` upstream branch, and exact
  upstream head SHA against the receipt title. When GitHub supplies a linked PR
  record, the reviewer cross-binds its number, head ref/SHA, and `main` base; an
  omitted linked-PR record does not replace the signed receipt plus live API
  checks. It then requires an open, same-repository Dependabot PR targeting
  `main` at that exact head and a verified Dependabot-authored head commit.
- The secret-bearing review job rechecks that PR identity, checks out only the
  exact trusted workflow commit from `github.workflow_sha`, with credentials
  disabled, and pins `actions/checkout` and
  `anthropics/claude-code-action` to immutable commits. It passes an explicit
  read-only `GITHUB_TOKEN`, so the Action cannot exchange OIDC for a broader
  Claude GitHub App token. It emits only a bounded, strict JSON result and has
  no issue, pull-request, contents, or checks write permission.
- The trusted reviewer reads the pull-request diff through GitHub APIs. It must
  never check out a candidate ref, download a candidate artifact, restore a
  candidate cache, install candidate dependencies, execute candidate code, or
  write review comments. The structured review result is the only handoff to
  the publisher.
- A separate publisher job owns `checks: write` and has no checkout, Claude
  Action, OAuth secret, or candidate surface. It queries the same PR identity
  after review and publishes `claude-review` directly on the receipt's exact PR
  head. The check links to the trusted reviewer run and carries a versioned
  external ID binding the PR, head SHA, reviewer run ID, and attempt. It
  succeeds only when the review job succeeded, the JSON schema and exact
  repository/PR/head bindings validate, `reviewCompleted` is true, the verdict
  is `clean` with zero findings, and the pre/post identity stayed stable. Any
  finding produces a failed check whose output includes the validated bounded
  findings as indented JSON, so operators do not need access to an implicit
  Action log or PR comment. The processor accepts the check only from a
  `workflow_run` of
  `.github/workflows/dependabot-claude-review.yml` with the anchored intake
  receipt in its run title. The human-only
  `.github/workflows/claude-code-review.yml` workflow reports
  `claude-review-human`; it is not Dependabot gate evidence.

Do not combine the two workflows or make the human check name satisfy the
Dependabot gate. The secret-bearing reviewer remains trusted-base code even
though the pull-request diff it inspects is untrusted data.

## Rollout modes

The repository Actions variable `DEPENDABOT_PROCESSOR_MODE` chooses one of
these modes. The trusted workflow forwards the value to default-branch policy;
pull-request, intake, schedule, and dispatch data cannot replace it.

| Mode      | Classification and evidence | Repair packet | Live repair/re-review/push path            | Automatic merge                            |
| --------- | --------------------------- | ------------- | ------------------------------------------ | ------------------------------------------ |
| `observe` | Yes                         | No            | No                                         | No                                         |
| `assist`  | Yes                         | Eligible PRs  | Disabled pending dedicated App integration | No                                         |
| `merge`   | Yes                         | Eligible PRs  | Disabled pending dedicated App integration | Policy-eligible, exact-head green PRs only |

Only the exact lowercase strings `observe`, `assist`, and `merge` select those
modes. Case variants, leading or trailing whitespace, non-string values, absent
values, misspellings, and otherwise malformed or unknown values always become
`observe`. Workflow-run and operator-sweep inputs cannot select a more powerful
mode. Selecting `merge` also requires both merge App settings described above;
missing configuration stops the trusted workflow before any merge mutation.
`observe` and `assist` do not require those credentials.

GitHub Actions expression string comparisons ignore case, so the workflow does
not use expression equality to decide whether merge credentials are available.
The first trusted process step compares the raw value with literal `merge`
using case-sensitive shell equality and emits only a literal JSON boolean. The
credential validation and token-minting steps consume that boolean through
`fromJSON`; case or whitespace variants therefore receive no merge App secret
or token and still reach the strict processor core as `observe`.

Packet eligibility and automatic merge authority are separate. A human may
apply a packet and the strict structural lineage may permit one more proposal,
but that human-applied head never regains automatic authority. The second
attempt is therefore not an operational automatic-merge path today.

Roll out changes in this order:

1. Run `observe` over at least one complete dependency-update cycle. Review
   classification, base-failure attribution, full-gate selection, and false
   manual/veto outcomes.
2. Enable `assist`. Review every repair packet and apply any repair manually.
   Measure whether two attempts are sufficient and whether path/command budgets
   are narrow enough.
3. Provision and install the dedicated merge App with only `contents: write` and
   `pull-requests: write`, add its client-ID variable and private-key secret, and
   enable `merge` only for the approved automatic tier. Keep manual and veto
   tiers unchanged. Confirm the App-authored merge starts default-branch `CI/CD`
   and Vercel post-merge proof. Do not enable the live repair/re-review/push path
   in this step.
4. Provision and review a dedicated, allowlisted, repository-scoped repair
   GitHub App, then integrate its actor and head lineage with intake and the
   Dependabot reviewer before separately enabling the live
   repair/re-review/push path. Re-run the trust and workflow-contract tests
   first.

## Handling tiers

Mode describes maximum controller authority. The handling tier narrows it for
one pull request:

- **automatic**: may merge in `merge` mode once every current-head gate passes;
- **manual**: may be classified and receive a repair packet in `assist` or
  `merge`, but needs a human dependency decision and merge approval; and
- **veto**: evidence only; no approval, repair, or merge.

Treat majors and high-blast-radius runtime changes, workflow permissions,
authentication and deployment changes, migrations, unclear security tradeoffs,
unrecognized update shapes, and explicit human vetoes as manual or veto. A
human close, reopen, or veto wins immediately. Green checks never override a
tier.

The current automatic tier is deliberately narrow: a recognized,
non-sensitive GitHub Action patch or minor update with one verified Dependabot
commit in the `dependabot/github_actions/github-actions-routine` branch family.
Its changed files must all be non-removed, non-renamed workflow or local Action
YAML, and its dependency metadata must parse from that immutable commit message.
All npm updates, GitHub Action majors or unknown updates, sensitive
review/security/processor Actions, `manual-unverified-action-metadata`, and
unknown ecosystems are manual. These labels remove automation authority when
present: `dependencies:manual`, `dependabot:manual`, `do-not-merge`,
`no-auto-merge`, and `processor:veto`. Labels never grant automatic handling.

## Commands

Run the network-free processor and workflow contract suite before changing the
policy, parser, workflow, or runbook:

```bash
pnpm dependabot:process:test
pnpm dependabot:process -- --help
```

Use the version-controlled CLI for network-free planning from a saved snapshot:

```bash
pnpm dependabot:process -- evaluate \
  --input path/to/snapshot.json \
  --mode observe
```

The argument separator is required. `evaluate` is read-only. Select saved PRs
with `--pr-numbers <number[,number...]>`; the default is `all`.

A live read-only evaluation fetches the current open set from GitHub:

```bash
pnpm dependabot:process -- evaluate \
  --live \
  --repo mento-protocol/frontend-monorepo \
  --pr-numbers all \
  --mode observe
```

Live commands require a GitHub token in the environment. Use a read-only token
for `evaluate`. Do not put the token on the command line or in a snapshot.

`process --live --publish-checks` can publish the processor check and, in
`merge` mode, approve and invoke the protected exact-head merge for the one
serialized eligible candidate. It supplies the expected head to GitHub and
never bypasses the ruleset. Run that mutation path only through the reviewed
trusted workflow; do not reproduce it from a developer shell with a broad
personal token. The normal workflow `GITHUB_TOKEN` performs the reads, check
publication, and exact-head approval. The dedicated merge App token performs
only the merge.

Native `AutoMergeRequest` state takes precedence over check publication. In
`observe` and `assist`, the processor suppresses its check while any native
request is active, because a successful check could unblock a request created
outside this controller. In `merge`, another, multiple, or malformed request
blocks. A sole request for the candidate must be disabled before any
potentially merge-unblocking check publication or approval; the processor then
collects a fresh full snapshot and proves the global lane empty before it can
approve and invoke the protected exact-head merge.

Every evaluation uses schema `dependabot-processor:v1` and returns
`repository`, normalized `mode`, `evaluations`, `mergeCandidate`,
`serialization`, and `summary`. Preserve that JSON when auditing a batch. The
CLI accepts `--expected-head-sha` only with one PR; intake uses it to reject a
head that moved after the credentialless receipt.

To request trusted GitHub processing outside an intake completion, send the
single supported `dependabot-process` repository-dispatch sweep:

```bash
gh api --method POST repos/mento-protocol/frontend-monorepo/dispatches \
  -f event_type=dependabot-process \
  -f 'client_payload[scope]=open'
```

The `client_payload` has exactly one field, `scope=open`. The event type and
workflow pin the repository and contract. The workflow rejects missing,
additional, or malformed fields. Never add caller-selected commands, paths,
modes, SHAs, or tokens to this payload. An hourly sweep at minute 43 invokes
the same all-open sweep without a dispatch payload. It revisits checks and the
separate Claude review that settle after the intake-triggered snapshot, bounds
the unattended reconciliation delay to roughly one hour, and avoids the
high-traffic start of the hour.

All intake, schedule, and operator runs share one global concurrency group with
`queue: max`, so a burst does not replace already-pending PR receipts. The hourly
all-open sweep remains the recovery path if the 100-run GitHub queue limit is
ever exceeded.

A malformed dispatch envelope fails the processor run explicitly. A purported
`receipt=true` intake also fails explicitly unless its conclusion, source
event, repository, default-branch workflow path, live upstream `dependabot/*`
branch and SHA, PR number, receipt SHA, and action match the exact receipt
contract. A valid intake with `receipt=false` is not a processor target: it
creates a visibly skipped `target=ignored` run rather than entering trusted
evaluation.

## Processing all open Dependabot pull requests

Use this sequence for an observation run or rollout verification:

1. Fetch the live open set. Do not reuse a saved PR list.

   ```bash
   gh pr list --repo mento-protocol/frontend-monorepo --state open \
     --author app/dependabot --limit 100 \
     --json number,baseRefName,headRefName,headRefOid,isDraft,url
   ```

2. Run the local planner in the configured mode and inspect its proposed tier,
   exact-head gate, base attribution, and terminal outcome for every returned
   PR.
3. Send one `dependabot-process` operator sweep for the live set. Read-only
   classification may run in parallel, but do not admit more than one PR to the
   merge-and-release lane.
4. For every run, confirm the processor re-read the same head. If Dependabot or
   a human moved the head, discard the result and wait for the new intake or
   send another all-open sweep. Never add the SHA to the dispatch payload.
5. Re-query the live open set after the batch. Account for every original PR as
   merged, manual, vetoed, base-failed, repair-packet-ready, retryable, or still
   pending exact-head evidence.

"Successfully processed" means every selected PR reached and reported one of
those valid terminal states. It does not mean the processor forced every update
to merge. A missing PR, unexplained workflow failure, stale-head receipt, or
unreported pending state fails the batch verification.

## Exact-head full gate

The processor uses the repository's full dependency gate rather than only the
branch ruleset minimum. Its current exact-name policy covers:

- `Build and Test`, `Action Pin Policy`, `Action Pin Policy Source`,
  `dependency-review`, and `claude-review`;
- root, trusted-pnpm-runtime, standalone-Vercel-runtime, and
  trusted-pnpm-bootstrap OSV scans;
- `lockfile integrity + registry`, `catalog version-skew`, and
  `coverage and production bundles`;
- the E2E plan, fork-seed self-test, and connected Celo, Governance, and Monad
  checks;
- the visual-regression plan plus UI and App visual checks; and
- `Vercel Preview`.

Trusted planner success may justify a skipped child E2E or visual check. No
other missing or skipped result passes.

For each required surface verify:

- the check belongs to the exact current head SHA;
- its workflow or GitHub App matches the expected source;
- it is complete and successful;
- an omitted or skipped job has an explicit, successful repository planner
  reason; and
- there is no cancelled replacement, pending newer run, untrusted source, or
  unresolved review feedback.

Any rebase or repair push invalidates the complete gate. Re-run processing only
after the new head has reported every applicable result.

### Snapshot stability

The live collector brackets the snapshot with two pull-request reads. The
reads must match on `updated_at`, state, head SHA/ref/repository, and base
SHA/ref/repository. Between them it collects the complete changed-file and
commit lists plus exact-head and exact-base checks. This binds those lists and
checks to one PR generation instead of combining evidence observed across a
head or base change. For the automatic Actions tier, the only immutable commit
must also have the exact head SHA and the required verified Dependabot
authorship and commit metadata.

Feedback is collected twice as a separate snapshot. Its first and final head
SHA, GitHub update token, and canonical digest must match. A change in either
snapshot aborts processing; it is not converted into a waiting or repair
outcome.

## Feedback and durable veto gate

The processor walks the bounded review-thread pages, thread roots and replies,
top-level reviews, issue comments, and close/reopen timeline events. It also
paginates REST review, issue-comment, and timeline responses. Exceeding the
thread or reply cap, malformed actor or thread data, a missing or malformed
thread commit SHA or envelope, or feedback from an unrecognized bot fails
closed instead of silently dropping data.

Every actionable unresolved thread blocks processing, including an outdated
thread. A resolved current-head thread also needs a later direct reply from a
trusted repository member in exactly one of these forms:

```text
Fixed in <7-40 character prefix of the current head SHA> — <what changed>
Won't fix: <technical reason>
```

A resolved thread bound to a well-formed older head does not need a new
current-head reply. This gate exemption does not change the repository rule
for agents: reply to every PR review comment, including comments that do not
produce a fix. A trusted human's non-empty top-level `COMMENTED` review on the
current head, trusted human issue comment, requested changes, veto label, or
explicit veto removes automatic authority. Any non-Dependabot human close or
reopen found in the paginated timeline remains a durable veto even if the PR is
open again.

Any observed `head_ref_force_pushed` issue event is a durable veto regardless of
actor. It permanently removes both automatic-merge and repair-packet authority
for that PR generation, even if a later head appears linear and every check is
green. Continue through the manual path or recreate the Dependabot PR to start a
new generation. Never interpret the rewritten lineage as a new attempt-zero
state or let it reset the two-attempt budget.

A processor-authored review is informational controller state only when its
strict body and commit binding validate. A matching `APPROVED` review never
counts as human feedback or independent merge authority. A matching review in
`DISMISSED` state is informational evidence that compensating cleanup ran; do
not classify it as unknown-bot feedback. Any malformed or mismatched processor
review still fails closed as unknown bot feedback.

The feedback digest includes actor and state metadata but replaces every body
with its SHA-256 digest. Processor output exposes only bounded identifiers,
reasons, counts, and body digests; it never emits raw review or comment bodies.
The processor collects and compares the complete digest twice. During
thread-page traversal it separately requires the same head SHA and update token
on every page.

GitHub does not provide an atomic transaction that locks issue comments during
final merge admission. A comment can still arrive after the final feedback read
and immediately before the mutation. This is a residual
last-millisecond race: reprocess after any newly observed feedback, and use a
close or veto label when a stop must be durable. Do not describe the feedback
gate as eliminating that race.

## Attribute failures before repairing

Classify every red or missing gate as one of:

- `branch-failure`: the dependency head caused the failure and current base
  evidence for the same gate is healthy;
- `base-failure`: the same failure exists on current `main` or a superseding
  base state explains it;
- `non-deterministic`: current baseline evidence passes, but a provider-backed
  gate failed and one observation cannot prove a branch defect;
- `unknown`: the available evidence cannot distinguish the cause.

Only `branch-failure` can create a repair packet. For `base-failure`, stop work
on the dependency branch and use the existing CI failure issue or one dedicated
base-remediation PR. Reprocess affected dependency PRs after `main` recovers.
Missing or pending baseline evidence is `unknown`.

The provider-backed set is exact: dependency review; the root, trusted pnpm
runtime, standalone Vercel CLI runtime, and trusted pnpm bootstrap OSV scans;
the connected Celo, Governance, and Monad E2E checks; the UI and App
visual-regression checks; Claude review; and Vercel Preview. If the
corresponding baseline check also fails, the attribution remains
`base-failure`. Planner and seed checks are not part of this provider-backed
set.

For an otherwise auto-approvable PR, `non-deterministic` or `unknown` yields
`waiting-retry`. Identity, feedback/veto, and manual-tier decisions have higher
precedence, so a manual or vetoed PR may still report `manual-review` or
`manual-veto-or-feedback`. Regardless of the displayed disposition, either
attribution suppresses the entire repair packet, even when another failure is a
deterministic `branch-failure`.

The processor does not rerun a failed workflow. Wait for a trusted provider
retry or, when authorized, rerun the failed trusted check. Confirm fresh
exact-head and baseline evidence, then send another processor sweep. Never
patch around the provider-backed failure or prepare a partial packet while the
retry evidence is unresolved.

## Repair packets

A repair packet is a proposal and reproducibility contract, not mutation
authority. It exists only when all of these prerequisites are true:

- structural PR, branch, commit, and Dependabot identity is valid;
- the complete bounded feedback snapshot is clear, including every thread that
  requires a reply under the current-head policy;
- the PR is based on current `main`;
- the complete current-head gate has reported with no missing or pending
  evidence;
- at least one failure is deterministically attributed to the branch and no
  `non-deterministic` or `unknown` attribution remains; and
- prior packet receipts form a valid attempt lineage.

Confirm the packet contains:

- exact repository, PR, base SHA, and head SHA;
- ecosystem, dependency group/update type, mode, and handling tier;
- the branch-specific failure and linked base comparison;
- permitted manifest, lockfile, source, fixture, and test paths;
- trusted validation commands and the post-push full gate;
- forbidden workflow permissions, trust boundaries, deployments,
  authentication, unrelated upgrades, and test/policy weakening;
- attempt number and a maximum of two attempts; and
- the manual terminal action when scope expands or both attempts fail.

The canonical schema is `dependabot-repair-packet:v1`. Its field names are
`schema`, `repository`, `pullRequestNumber`, `baseRef`, `baseSha`, `headSha`,
`mode`, `packageEcosystem`, `dependencyGroup`, `dependencyNames`, `updateType`,
`riskTier`, `automatic`, `requireHumanApproval`, `requireExactHead`,
`changedPaths`, `permittedPaths`, `forbiddenPaths`, `failures`,
`validationCommands`, `requiredGateIds`, `attemptNumber`, `attemptLimit`, and
`escalation`. Treat a missing, extra-authority, stale, or differently versioned
packet as invalid rather than filling gaps from model output.

The packet must be absent when any failure attribution is `non-deterministic`
or `unknown`. This suppression applies to mixed failures: a deterministic CI,
lockfile, version-skew, or other repairable failure does not authorize a partial
packet until the retry-first failure has fresh evidence. Missing or pending
gate evidence also suppresses the packet rather than becoming repair scope.

The processor records a packet receipt on its exact head. Processing that same
head again is idempotent: it reuses the attempt number and does not spend the
budget again. Only a new head whose commit history is a strict append-only
extension of the receipted head consumes the prior attempt. The earlier receipt
remains evidence for counting attempts, but none of that head's gate evidence
is valid for the successor. An observed `head_ref_force_pushed` event permanently
ends repair-packet and automatic authority for that PR generation; the rewritten
history cannot reset the counter. A rebase, dropped or reordered commit, missing
receipt, or ambiguous lineage also fails closed instead of resetting the
attempt counter. The first valid packet is attempt one, one strict successor may
receive attempt two, and no third packet is allowed.

Before applying a packet manually, prove its head is still current. Make the
smallest relevant change, run its named validation, push to the exact Dependabot
branch, and then discard all old check evidence. Reply to every PR review
comment, including comments that do not result in a fix, using the repository's
required reply format.

A human-applied repair can remain structurally eligible for the second packet
when that append-only lineage is valid. Human mutation permanently removes
automatic merge authority for that PR generation; a later green gate or second
packet does not restore it. Treat the repaired PR as manual through merge and
release reporting.

Never keep retrying after two attempts. Move the PR to manual handling with the
failure evidence and remaining decision.

### Repair credential limitation

The live repair/re-review/push path is currently disabled. It stays disabled
until a dedicated, allowlisted, repository-scoped GitHub App is provisioned for
Dependabot repair and its actor and repaired-head lineage are integrated with
the credentialless intake and trusted Dependabot reviewer. Its installation
token must be short-lived, limited to this repository and the minimum
contents/pull-request permissions, and usable only on a freshly revalidated
Dependabot head.

Never substitute:

- the normal workflow `GITHUB_TOKEN`;
- the preview worker-dispatch GitHub App/token from ADR 0003;
- a Vercel or package-registry credential; or
- a developer's broad personal access token.

The preview credential has a separate reviewed purpose. Reusing it would merge
the preview and dependency-repair trust boundaries. `GITHUB_TOKEN` also does not
provide the intended independent actor and downstream workflow-trigger
contract. Until the dedicated App, intake, and reviewer integration is complete,
the processor may prepare packets for human use but cannot run an unattended
repair, trigger its re-review, push it, or treat attempt two as automatically
mergeable.

## Merge and release proof

The merge lane is serial. Before merge admission, re-query and verify:

- the PR remains open, non-draft, Dependabot-authored/owned, and on its expected
  base;
- the current head matches the processor receipt and is based on current
  `main`;
- no human changed or vetoed the PR;
- its tier permits automatic merge in the configured mode;
- all full-gate evidence belongs to that exact head; and
- all required reviews and review threads are satisfied.

GitHub's `AutoMergeRequest` GraphQL object does not expose a commit or head SHA.
Treat any request on another Dependabot PR, multiple requests, or malformed
request/PR identity as blocking lane occupancy. In `observe` and `assist`, any
active request suppresses processor-check publication. In `merge`, the only
recoverable case is one request on the candidate whose freshly queried PR
number and `headRefOid` match the candidate. The processor must disable that
request before it publishes any potentially merge-unblocking processor check
or approval. It then collects a new complete identity, feedback, files,
commits, current-base, current-head checks, and global auto-merge snapshot and
proves the lane is empty. Only that fresh full gate may authorize approval and
the protected exact-head merge. Never infer a head binding from the native
request itself.

Use the normal branch ruleset and merge method. Do not bypass protections. Bind
the approval and merge request to the exact Dependabot head with `commit_id`
and `--match-head-commit`. After GitHub accepts the merge, later sweeps remain
blocked until current `main` receives its own exact-SHA release receipt.

The approval boundary includes the full PR identity: number, open/draft state,
author, head SHA/ref/repository, base SHA/ref/repository, and the exact
`updated_at` value. Revalidate that identity immediately before approval. After
GitHub records the approval, collect another complete snapshot and bind merge
admission to the full post-approval identity and its observed `updated_at` value,
then re-run the feedback, full-gate, freshness, and global-lane checks.

If any post-approval, pre-merge collection or gate fails while a fresh read says
the PR remains open, dismiss the processor-created approval with the normal
workflow `GITHUB_TOKEN`. This cleanup includes identity or `updated_at` drift,
new feedback, a failed or missing gate, changed auto-merge occupancy, and merge
admission errors. The merge App token does not dismiss reviews. Dismissal is a
compensating API call rather than an atomic transaction: a change can still land
after the final successful read and before the exact-head merge, and the PR can
change again while cleanup runs. Keep those residual races explicit.

A hard runner cancellation, process kill, or machine death can occur after
GitHub records approval and before the dismissal handler runs. This can strand
an active processor approval on an open PR. Before any live intake, operator,
or hourly reconciliation run can publish a processor check or create an
approval, it performs a bounded scan of every open Dependabot PR for
current-head `APPROVED` reviews by `github-actions`. This repository-wide scan
also covers PRs outside a targeted intake.

Each current-head review is independently recoverable only when its strict
processor body, commit binding, actor, state, and identifier are exact and
schema-valid. Dismiss every such approval with the normal workflow token,
including multiple valid approvals on one PR. This cleanup only removes
authority, so it applies in `observe`, `assist`, and `merge`. After dismissal, a
bounded global rescan must prove that no current-head processor approval remains.

Discard all evidence collected before cleanup. Fully recollect the originally
selected PRs, pin each one to its prior expected head, recollect repository-wide
auto-merge state, and only then evaluate the run. Schema-valid old-head
processor reviews and schema-valid `DISMISSED` processor reviews are
informational controller state and do not enter current-head reconciliation.

A current-head `APPROVED` `github-actions` review that does not match the exact
processor envelope requires operator action. Malformed, incomplete, or capped
scan evidence, malformed or mismatched processor reviews, failed dismissal,
failed zero-approval rescan, or incomplete selected-PR or auto-merge
recollection also fails closed before evaluation, publication, or mutation.

The approval uses the normal workflow `GITHUB_TOKEN`; the merge must use a
short-lived installation token minted from
`DEPENDABOT_PROCESSOR_MERGE_APP_CLIENT_ID` and
`DEPENDABOT_PROCESSOR_MERGE_APP_PRIVATE_KEY`. Limit that repository-scoped App
to `contents: write` and `pull-requests: write`, with no Actions, workflow, or
deployment permission. A missing client ID or private key blocks `merge` mode
before merge mutation. `observe` and `assist` remain available. The App-authored
merge is required so GitHub emits the `main` push that starts the default-branch
`CI/CD` run and, after it succeeds, Vercel post-merge verification.

Keep the serial lane until that exact merge SHA has:

1. completed the full default-branch `CI/CD` workflow;
2. reached the existing `Vercel Main Deployment` controller when a target is
   selected; and
3. produced the terminal release receipt, public runtime smoke, and recovery
   result described in [`docs/vercel-deployments.md`](vercel-deployments.md), or
   an explicit verified no-deployment result.

The existing Vercel result job publishes that result as the exact-main
`Dependabot Post-Merge Verification` check. It reports success only after the
terminal evidence is restored, the final active release succeeds, no deferred
failure remains, and the outcome is `active-committed`,
`current-release-verified`, or a verified `no-target`. A later sweep admits
another automatic candidate only when the current `main` SHA carries that
successful check and no open Dependabot PR still has an auto-merge request,
including one left by an earlier controller or operator.
Because the Vercel controller admits only an exact successful `CI/CD` main run,
missing or failed main CI cannot produce this receipt.

If main CI or release proof fails, stop the dependency queue. Use the managed
failure issue and deployment recovery runbook. Do not push to the merged
Dependabot branch or merge the next update to test whether it masks the issue.

## Trigger and processor failure incidents

The CI Failure Notifier tracks failures of the trusted processor. Intake-driven
processor runs with a valid `receipt=true` identity are partitioned by PR, so a
success for one Dependabot PR cannot close another PR's failure issue. Scheduled
and `dependabot-process` sweep failures remain in their default-branch trigger
partitions. A repository-dispatch callback is admitted only when its workflow
name, canonical open-sweep display title, default branch, and source repository
all match the processor contract; the trusted notifier script revalidates the
title with case-sensitive equality. Legitimate `receipt=false` intake
completions are deliberately
skipped and ignored by the notifier; they are not processor incidents.

Treat a malformed dispatch or purported receipt, controller exception, API
ambiguity, snapshot race, or unexplained workflow failure as an explicit run
failure. It is distinct from a successful fail-closed policy disposition such
as `manual-review`, `waiting-retry`, or `waiting-baseline`.

## Failure handling

| Outcome                                      | Operator action                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Malformed dispatch or purported true receipt | Inspect the envelope/receipt; correct the caller or intake contract.       |
| Snapshot or feedback changed                 | Make no mutation; collect a new exact-head snapshot and process again.     |
| Feedback malformed or over cap               | Inspect and reduce/repair the feedback state; do not infer a clear gate.   |
| `head_ref_force_pushed` observed             | Use manual handling or recreate the PR; no automatic or packet authority.  |
| Stale head or changed base                   | Fetch current identity and start a new processor run.                      |
| Base failure                                 | Repair `main` once, wait for recovery evidence, then refresh affected PRs. |
| Provider-backed failure, base passes         | Wait for or rerun the trusted check, then process again; do not repair.    |
| Baseline evidence missing or pending         | Wait for or rerun trusted baseline evidence, then process again.           |
| Branch failure, eligible                     | Review/apply the packet manually; cap proposals at two; keep manual merge. |
| Manual tier                                  | Record evidence and obtain the required human dependency decision.         |
| Veto tier or human veto                      | Stop; do not approve, repair, or merge.                                    |
| `merge` selected, merge App config missing   | Fail before mutation; restore the variable and secret or use a lower mode. |
| Post-approval, pre-merge gate failed         | Dismiss the processor approval when the PR is open, then reprocess.        |
| Exact current-head processor approvals       | Dismiss all in any mode; prove zero globally, then recollect and evaluate. |
| Unrecognized or malformed approval evidence  | Fail closed before publication or mutation; require operator resolution.   |
| Merge succeeded, main/release failed         | Keep the queue stopped and follow existing recovery/rollback.              |
| Other ambiguous controller evidence          | Observe and escalate; never infer mutation authority.                      |

When reporting a batch, state the configured mode, processor workflow/run,
source PR/head, tier, attribution, repair attempt count, gate result, merge SHA
if any, and exact main/release proof. Keep "prepared repair" separate from
"repair pushed", and "merge-ready" separate from "merged and release-proven".

The processor's disposition values are `rejected-identity`,
`manual-veto-or-feedback`, `manual-review`, `waiting-checks`,
`repair-required`, `waiting-baseline`, `waiting-retry`, `would-merge`,
`ready-for-approval`, `merge-candidate`,
`waiting-post-merge-verification`, and `waiting-merge-serialization`. Report the
exact value; do not rewrite a waiting or manual disposition as success.

## References

- [Dependabot on GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
  — forced token and Dependabot-secret restrictions;
- [`workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
  — privilege transition and untrusted-code warning;
- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
  — trusted-base workflow guidance and immutable third-party Action pins;
- [Claude Code Action security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
  — Anthropic's threat model and security guidance for secret-bearing review;
- [`GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token)
  — event recursion limits and the GitHub App alternative;
- [Automatically merging a pull request](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
  — native protection and check behavior;
- [`gh pr merge`](https://cli.github.com/manual/gh_pr_merge) — exact-head
  `--match-head-commit` support; and
- [GitHub Actions secrets](https://docs.github.com/en/actions/concepts/security/secrets)
  — least-privilege and scoped App guidance.
