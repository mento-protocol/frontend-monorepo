---
title: A trusted default-branch controller processes Dependabot pull requests through exact-head evidence
status: active
owner: eng
canonical: true
last_verified: 2026-08-10
scope: ci/dependabot-processing
date: 2026-08-10
---

# ADR 0006 — A trusted default-branch controller processes Dependabot pull requests through exact-head evidence

**Status:** Accepted (Aug 2026)
**Scope:** ci/dependabot-processing

## Context

Dependabot pull requests do not all need the same response. Some low-risk
updates are safe once the repository's complete evidence contract passes. Some
need a small compatibility repair. Others expose a failure already present on
the default branch, require a security or architectural decision, or touch a
surface that automation must not change.

The former `dependabot-auto-merge.yml` workflow covered only patch and minor
GitHub Actions updates. It could approve and enable native auto-merge, but it
did not own npm updates, diagnose failures, distinguish branch failures from a
broken base, prepare bounded repairs, or follow the merged commit through the
main release. Its decision also depended on the repository's required checks,
which are a branch-protection minimum rather than this repository's full
dependency-update gate.

Dependabot-authored events run with a read-only `GITHUB_TOKEN` and only
Dependabot-scoped secrets. Pull-request source, package installation, build
steps, and generated repair instructions are untrusted. A workflow that mixes
those inputs with write credentials could let a dependency update choose what
trusted code runs or what repository state changes. Conversely, a controller
that repairs every red pull request will duplicate work when the same failure
exists on `main` and can hide a repository-wide incident behind branch-local
commits.

The repository already has separate exact-SHA contracts for CI, supply-chain
checks, preview evidence, active-main deployment, public smoke, recovery, and
managed operational-failure issues. Dependency processing should compose those
contracts rather than create weaker parallel gates.

## Decision

### Read-only intake and trusted processing remain separate

A credentialless intake handles Dependabot pull-request events. It validates
the event class and exposes only bounded identity data in its workflow-run
identity. It neither installs nor runs pull-request dependencies and it holds no
repository write, approval, merge, deployment, repair, or dispatch credential.
Dependabot's forced read-only `GITHUB_TOKEN` cannot and must not dispatch the
trusted workflow.

The trusted processor starts from the completed `Dependabot Intake`
`workflow_run`. GitHub creates that event across the privilege boundary. The
processor runs only version-controlled code from the default branch, re-queries
GitHub, and treats the upstream run name and event data as untrusted hints. It
requires the successful `pull_request_target` intake's repository, workflow
path, live `dependabot/*` head branch, and 40-character head SHA to agree with
the exact receipt title. It must then prove that the pull request is still open,
still Dependabot-authored and Dependabot-owned, still targets the expected base,
and still has the encoded head before making a decision. It never downloads or
executes an upstream artifact or candidate code.

The repository-dispatch event `dependabot-process` is a separate operator/sweep
entry. It accepts one bounded scope field and performs the same current-state
re-query; it does not accept a caller-selected mode, command, path, or token.
There is no `workflow_dispatch` entry point. Operators use this sweep contract
or the local planner documented in
[`docs/dependabot-automation.md`](../dependabot-automation.md), so a manual path
cannot acquire different trust or policy semantics.

A separate trusted-base AI reviewer supplies Dependabot's hosted review gate.
`.github/workflows/dependabot-claude-review.yml` is a privileged `workflow_run`
follow-up to the credentialless intake, so the Dependabot-triggered workflow
never receives the Claude secret. Before any token, secret, or Action is used,
the reviewer authenticates the same upstream run and receipt fields as the
processor, including the Dependabot actor and live upstream branch/SHA. A
linked PR record, when GitHub supplies one, must match the receipt. Live API
reads then prove an open, same-repository Dependabot PR targeting `main` at the
exact receipt head and a verified Dependabot-authored commit.

The secret-bearing job revalidates that identity, checks out the exact
`github.workflow_sha`, and pins the checkout and Claude Actions to immutable
commits. It passes the job's explicit read-only `GITHUB_TOKEN` instead of
minting a broader Claude GitHub App token through OIDC. It reads the candidate
diff only through GitHub APIs, makes no repository or review mutation, and
returns a bounded strict-schema result. It never checks out a candidate ref,
downloads its artifacts, restores its caches, installs its dependencies, or
executes its code.

A separate publisher job holds `checks: write`; it has no checkout, Claude
Action, OAuth secret, or candidate input. It queries the PR identity again and
publishes an explicit `claude-review` check on the exact PR head. The check
succeeds only when the review job succeeded, the structured result binds the
exact repository/PR/head and reports a completed clean review with zero
findings, and the pre/post identity remained stable. A failed findings verdict
includes the validated bounded findings as indented JSON in the check output.
Its details URL points to the trusted reviewer run, its versioned external ID
binds the PR, head SHA, run ID, and attempt, and the reviewer run title preserves
the exact intake receipt behind an anchored schema prefix. This lets the processor verify the
`workflow_run` event and workflow path even though the follow-up run itself is
recorded on the default-branch head. The human `pull_request` workflow remains
separate and reports `claude-review-human`, which cannot satisfy the processor
gate.

This reviewer contract covers the authenticated Dependabot head. The live
repair/re-review/push path remains disabled until a dedicated, allowlisted,
repository-scoped repair App is provisioned and its actor and repaired-head
lineage are integrated with both intake and this reviewer.

Malformed operator dispatch envelopes fail explicitly. A purported
`receipt=true` workflow-run target also fails unless every receipt and upstream
workflow field matches the exact contract, including equality between the live
upstream head SHA and the receipt SHA. A valid `receipt=false` intake is
deliberately non-targeted and skipped; it is not silently reinterpreted as a
trusted processing request.

### Modes are versioned policy, and unknown means observe

The controller has three rollout modes:

- `observe` classifies and records evidence but does not approve, repair, push,
  or merge;
- `assist` may produce a bounded repair packet for an eligible pull request but
  does not autonomously merge it; and
- `merge` may approve and serialize a policy-eligible pull request only after
  the exact-head full gate succeeds.

Mode is configuration, not input supplied by pull-request or dispatch data.
Missing, malformed, or unknown modes resolve to `observe`. An operator sweep
cannot raise the configured authority. This fail-closed default lets the same
workflow support observation, assisted rollout, and eventual low-risk merging
without replacing the controller.

Mode does not override native GitHub auto-merge state. `observe` and `assist`
suppress processor-check publication while any `AutoMergeRequest` is active,
because publishing a successful check could unblock a request the controller
did not create or bind to an exact head.

`merge` also requires a distinct repository-scoped merge GitHub App. Its client
ID is the Actions variable `DEPENDABOT_PROCESSOR_MERGE_APP_CLIENT_ID`; its
private key is the Actions secret
`DEPENDABOT_PROCESSOR_MERGE_APP_PRIVATE_KEY`. Missing either setting fails
`merge` closed without preventing `observe` or `assist` operation.

### Policy assigns automatic, manual, or veto handling

Every pull request receives one handling tier before check results can grant
authority:

- **automatic** updates may progress through the configured rollout mode when
  every other condition passes;
- **manual** updates may be classified and may receive a repair packet, but a
  human must approve the final dependency decision and merge; and
- **veto** updates receive evidence only. The controller must not approve,
  repair, or merge them.

Major and otherwise high-blast-radius runtime updates, security changes that
need a product or compensating-control decision, workflow permission or trust
changes, deployment/authentication changes, migrations, unrecognized update
shapes, and explicit operator vetoes fail into manual or veto handling. A
human-authored commit, a closed or draft pull request, unexpected ownership,
or a changed base/head invalidates earlier eligibility. Human closure and veto
always take precedence over automation.

Policy eligibility is distinct from check success: a green vetoed update is
still vetoed, and a red automatic update has no mutation authority.

The accepted initial automatic tier is only a recognized, non-sensitive GitHub
Action patch or minor update backed by one exact verified Dependabot commit on
the routine Actions group branch. Every changed file must be a non-removed,
non-renamed workflow or local Action YAML, and the dependency names and update
type must come from that immutable commit message. npm updates, Action majors
or unknown updates, sensitive reviewer/security/processor Actions, unverified
Action metadata, and unknown ecosystems remain manual. Labels and human
feedback may remove authority; no label or dispatch input may grant it.

### The full gate is bound to the current head

The processor evaluates the repository's dependency-update evidence contract,
not only the minimum checks required by branch protection. Every accepted check
must name the current pull-request head SHA and come from its expected workflow
or GitHub App. Missing, pending, stale-head, cancelled, timed-out, skipped
without an explicit repository planner success, or untrusted-source evidence
blocks progress.

After any rebase or repair push, all prior branch evidence is stale. The
processor starts again from current-head classification and waits for the full
gate. Immediately before approval or merge admission it re-reads the pull
request, head SHA, base, authorship, changed files, review state, unresolved
feedback, and check set. It never bypasses the branch ruleset or treats a
previous head's success as current authority.

The live snapshot brackets file, commit, head-check, and base-check collection
with two PR reads. Both reads must match on `updated_at`, state, head
SHA/ref/repository, and base SHA/ref/repository. Automatic Actions metadata is
valid only when its sole immutable commit SHA equals that head SHA. The
feedback snapshot is also collected twice; head SHA, update token, and a
canonical digest of threads, replies, reviews, issue comments, and auto-merge
state must remain identical. Head, base, or feedback movement aborts the run
instead of producing mutation authority.

### Feedback and timeline state may only remove authority

The controller walks bounded pages for review threads and replies, top-level
reviews, issue comments, and issue timeline events. Every actionable unresolved
thread blocks, even when it belongs to an older head. A resolved current-head
thread also requires a later direct trusted-maintainer reply in the
repository's exact `Fixed in <current-head prefix> — <change>` or `Won't fix:
<reason>` form. A resolved thread bound to a well-formed older head does not
need another current-head reply. This gate exemption does not change the
repository rule that agents reply to every PR review comment. Trusted human
top-level feedback or issue comments, requested changes, veto labels, and any
human close or reopen timeline event remove automatic authority. Close and
reopen events remain durable vetoes after later state changes.

Any observed `head_ref_force_pushed` issue event is also a durable veto,
regardless of actor. It permanently removes automatic-merge and repair-packet
authority for that PR generation. A later linear-looking head or green gate
cannot restore either authority. Operators must continue manually or recreate
the Dependabot PR to establish a new generation; rewritten lineage never resets
the two-attempt budget.

A processor-authored review is informational only when its strict body and
commit binding validate. A matching `APPROVED` review is controller state, not
human feedback or independent authority. The same valid envelope in `DISMISSED`
state is informational evidence of compensating cleanup and is not unknown-bot
feedback. Malformed or mismatched processor reviews still fail closed.

Malformed actors, thread commit SHAs or envelopes, or other thread data,
unknown bots, and exceeded collection caps fail closed. Canonical feedback and
blocker records hash bodies with SHA-256 and do not expose raw review or comment
text in processor output. The double
collection detects changes before its final read, but GitHub provides no atomic
comment-and-mutation transaction. A new issue comment can land immediately
after the final read and before the protected exact-head merge; this residual
last-millisecond race remains an explicit limitation.

### Attribution is base-aware and retry-first

Before asking for a branch repair, the controller attributes each blocking
failure. It compares the pull-request result with current default-branch
evidence for the same gate and considers superseding base changes. A failure
also present on the base is `base-failure`: the dependency pull request remains
blocked and the repository-wide failure is handled once through the existing
operational issue or a dedicated base-remediation pull request.

Only a failure proved specific to the dependency head may become a repair
candidate. Missing or conflicting baseline evidence is `unknown`, which has
the same authority as `observe`: it cannot cause a repair, approval, or merge.
After the base recovers, the pull request must be updated or reprocessed and
must earn fresh exact-head evidence.

Some gates depend on mutable providers, remote data, networked forks, hosted
reviewers, or deployment state. When current baseline evidence passes but one
of these gates fails on the pull request, the processor attributes the failure
as `non-deterministic` instead of proving it branch-caused. This applies to
dependency review, all four OSV scans, the three connected E2E checks, the two
visual-regression children, Claude review, and Vercel Preview. A failure on any
of those gates remains `base-failure` when the same baseline gate fails;
missing or pending baseline evidence remains `unknown`.

For an otherwise automatic PR, either `non-deterministic` or `unknown`
attribution produces `waiting-retry`. Manual risk and feedback/veto precedence
remain unchanged, so those PRs can still report `manual-review` or
`manual-veto-or-feedback`. In every tier, either attribution suppresses the
entire repair packet, including when a separate deterministic branch failure is
present. The controller does not rerun failed workflows. An operator waits for
or reruns the trusted exact-head and baseline check evidence, then processes the
PR again.

### Repair work is bounded by a canonical packet

A versioned repair packet exists only when structural PR and commit identity is
valid, the complete bounded feedback snapshot is clear with no reply required
by policy still missing, the PR is based on current `main`, and the complete
current-head gate has reported with no missing or pending evidence. It also
requires at least one deterministic branch-attributed failure, no
`non-deterministic` or `unknown` attribution, and a valid prior packet-receipt
lineage. The packet binds at least:

- repository, pull request, base branch and SHA, and exact head SHA;
- ecosystem, dependency group, update type, handling tier, and rollout mode;
- changed manifests, lockfiles, and permitted repair paths;
- failing checks, evidence links, and
  branch/base/non-deterministic/unknown attribution;
- the allowed validation commands and the complete post-push gate;
- forbidden trust, workflow, deployment, authentication, and unrelated
  dependency surfaces; and
- the current attempt number, maximum attempts, and terminal escalation rule.

A packet is emitted only after every failure has enough evidence for a
deterministic branch/base decision. One `non-deterministic` or `unknown`
failure, or any missing or pending gate evidence, suppresses the whole packet;
the worker must not apply a partial repair for the other deterministic failures
while provider or baseline evidence is unsettled.

The current policy permits at most two repair attempts. A packet receipt is
bound to its exact head, and reprocessing that same head is idempotent: it
reuses the attempt number. Only a new head whose commit history is a strict
append-only extension of the receipted head consumes that prior attempt. The
old receipt remains attempt-count evidence, but all old gate evidence is stale.
An observed `head_ref_force_pushed` event permanently ends packet and automatic
authority for that PR generation, so rewritten history cannot reset the
counter. A rebase, dropped or reordered commit, missing receipt, or ambiguous
lineage also fails closed instead of resetting the counter. The first packet is
attempt one; one valid strict successor may receive attempt two; no third packet
is allowed.

Each applied attempt must produce a small, relevant diff and a new head SHA;
then the complete gate reruns. A human-applied repair may remain structurally
eligible for the second proposal, but human mutation permanently removes its
automatic merge authority. A later green gate or packet never restores that
authority. A stale packet, expanded scope, unsuccessful validation, new
unrelated dependency, repeated failure, or exhausted attempt budget returns
the pull request to manual handling. The worker does not weaken tests, security
policy, or required evidence to make an update green.

The live repair/re-review/push path remains disabled until this repository has
a dedicated, allowlisted, repository-scoped repair GitHub App for that single
purpose and integrates its actor and repaired-head lineage with intake and the
trusted Dependabot reviewer. The repair worker must never use `GITHUB_TOKEN`,
the Vercel preview worker-dispatch credential from ADR 0003, or another
deployment/provider token. The dedicated App must use short-lived installation
tokens, the minimum contents and pull-request permissions, a restricted branch
target, and an auditable actor. Until that full integration exists, `assist`
can prepare a packet for human execution but cannot run an unattended repair,
trigger its re-review, push it, or make attempt two automatically mergeable.

### Merges and release proof are serialized

Only one Dependabot pull request may occupy the merge-and-release lane for the
default branch at a time. A merge-mode candidate must be based on current
`main`, pass the exact-head full gate, satisfy its handling tier, and pass a
final freshness check. The processor binds its approval to that commit and
invokes the normal squash merge with `--match-head-commit`; it never bypasses
the repository rules. Once GitHub accepts the merge, the changed current-main
SHA blocks later candidates until that SHA receives the release receipt.

The processor uses its normal `GITHUB_TOKEN` for reads, check publication,
native auto-merge cleanup, and exact-head approval. That token cannot perform
the merge because its resulting events do not start the default-branch push
workflow. The processor mints a short-lived installation token from the merge
App credentials only for the squash merge. The repository-scoped App and token
have exactly `contents: write` and `pull-requests: write` and no Actions,
workflow, or deployment permission. The App-authored merge is required so the
resulting `main` push starts default-branch `CI/CD`, which in turn admits the
Vercel controller and post-merge proof.

The merge App is distinct from the future repair App. It cannot push a repair
or enable the live repair/re-review/push path, which remains disabled pending
its separately reviewed App and lineage integration.

An existing GitHub `AutoMergeRequest` exposes no commit or head binding. It
blocks when it belongs to another Dependabot PR, when more than one request is
active, or when its PR/request identity is malformed. In `observe` and
`assist`, any active request suppresses processor-check publication. In
`merge`, the sole recoverable case is one request on the candidate whose
freshly queried PR number and `headRefOid` match the candidate. The controller
disables that request before any potentially merge-unblocking processor check
or approval. It then collects a new full identity, feedback, files, commits,
current-base, current-head check, and global auto-merge snapshot and proves the
lane empty. Only that fresh complete gate can authorize approval and the
protected exact-head merge; the native request itself never supplies
exact-head authority.

Immediately before approval, the controller binds the review to the full PR
identity and exact `updated_at`, including number, open/draft state, author,
head SHA/ref/repository, and base SHA/ref/repository. After approval it collects
a new complete snapshot, binds admission to that full post-approval identity
and its observed `updated_at`, and repeats feedback, full-gate, freshness, and global
lane checks. If any post-approval, pre-merge collection or gate fails while the
PR remains open, the normal workflow token dismisses the processor-created
approval. The merge App has no review-dismissal role.

Approval, post-approval reads, dismissal, and merge are separate GitHub API
operations. The dismissal is compensating cleanup, not an atomic rollback. A
mutation may still land after the last successful read and before the exact-head
merge, or while cleanup is running; these residual races remain explicit.

A hard runner cancellation, process kill, or machine death can strand an
approval between its creation and cleanup. Before check publication or a new
approval, every later live run that could add authority performs a bounded scan
of every open Dependabot PR. This repository-wide scan detects current-head
`APPROVED` `github-actions` reviews on selected and unselected PRs before any
processor-check publication or new approval.

Every independently exact, schema-valid processor approval is recoverable.
Dismiss all of them with the normal workflow token, including multiple valid
approvals on one PR. This cleanup only removes authority, so it applies in
`observe`, `assist`, and `merge`. A bounded global rescan must then prove that no
current-head processor approval remains.

After cleanup, the controller discards all earlier evidence, fully recollects
the originally selected PRs against their prior expected heads, recollects
repository-wide auto-merge state, and only then evaluates the run. Schema-valid
old-head processor reviews and schema-valid `DISMISSED` processor reviews remain
informational controller state and do not enter current-head reconciliation.

Any current-head `APPROVED` `github-actions` review that does not match the
exact processor envelope requires operator action. Malformed, incomplete, or
capped scan evidence, malformed or mismatched processor reviews, failed
dismissal, failed zero-approval rescan, or incomplete selected-PR or auto-merge
recollection fails closed before evaluation, publication, or mutation.

The controller does not declare that pull request complete at merge time. It
holds the serial lane until the exact merge SHA passes the full default-branch
`CI/CD` run and the existing active-main deployment controller produces its
terminal release proof, including public runtime smoke or a verified
no-deployment result when no runtime target changed. A main or release failure
keeps subsequent automated dependency merges blocked and routes through the
existing recovery and managed-failure process. It is never repaired by pushing
more commits to the already-merged Dependabot branch.

The Vercel result publisher binds the proof to its Actions run URL and strict
`dependabot-post-merge:<run-id>:<run-attempt>` external ID. GitHub's Checks API
can return the check's generated `/runs/<check-id>` self URL even though the
publisher submitted the Actions URL. That self URL identifies only the exact
check; it does not identify a trusted workflow run. The controller may resolve
this exact post-merge check only through the external-ID run and attempt, then
must re-query and validate the exact `Vercel Main Deployment` `workflow_run`:
source repository, `.github/workflows/vercel-main-deployment.yml` path,
`workflow_run` event, `main` head branch, exact current-main head SHA, run ID,
run attempt, completed status, and successful conclusion. The independently
queried workflow `head_sha` must be present and exact; the check head is never a
fallback. Every malformed or mismatched URL, envelope, or workflow-run field,
including a pending or failed run, fails closed.

For duplicate raw exact-name, exact-head receipts, the controller chooses the
newest immutable GitHub check-run publication ID before workflow provenance
resolution and enriches only that check. An unavailable obsolete run reference
therefore cannot block a newer receipt, while failure to resolve the selected
newest receipt remains fail closed. A newer malformed or unsuccessful receipt
blocks an older success. Each authority-bearing check collection or
recollection re-fetches the mutable workflow-run attempt, status, and
conclusion. Workflow-run caching and deduplication are scoped to one collection,
and distinct run resolutions use bounded concurrency to prevent GitHub
secondary-rate-limit bursts. The cache never crosses a recollection boundary.

## Alternatives considered

### Extend the former auto-merge workflow in place

Rejected. Adding more package types and checks would still leave failure
attribution, bounded repairs, serial release ownership, and the untrusted/trusted
split implicit. A long-lived controller makes those constraints one policy.

### Let a repair agent review and merge independently

Rejected. Model output and candidate code are untrusted inputs. They may propose
a bounded patch, but deterministic default-branch code retains classification,
mutation, merge, and release authority.

### Move dependency generation and orchestration to Renovate

Deferred. Renovate offers useful grouping, release-age, and dashboard controls,
but replacing Dependabot does not solve semantic repair or post-merge release
proof. The controller can be reconsidered for another update generator later if
its identity and trust inputs remain equally strict.

### Reuse an existing token for repair pushes

Rejected. `GITHUB_TOKEN` pushes do not provide the intended independent actor
and workflow-trigger contract. The preview worker credential has a different
reviewed scope and trust purpose. Reuse would collapse security boundaries and
make credential rotation or incident response ambiguous.

### Use the normal workflow token for the merge

Rejected. A merge performed with `GITHUB_TOKEN` would not create the
default-branch push workflow run that supplies CI and Vercel post-merge proof.
The narrowly scoped merge App provides an independent event actor without
granting Actions, workflow, deployment, or repair authority.

### Process several green updates concurrently

Rejected. Concurrent dependency merges can invalidate each other's lockfile and
base evidence and obscure which merged update caused a main or runtime failure.
Parallel read-only classification is allowed; merge and release proof remain
serial.

## Consequences

- Low-risk updates can progress automatically only after complete current-head
  evidence and current-base freshness.
- Branch-specific compatibility failures can receive a reproducible, bounded
  repair packet without giving an AI worker merge or production authority.
- Repository-wide failures are remediated once instead of copied into every
  open dependency branch.
- Provider-backed and baseline-unknown failures wait for fresh trusted evidence
  before any repair packet exists; the controller does not trigger that retry.
- Observation, assisted repair, and automatic merge use one workflow and can be
  rolled out independently through fail-closed configuration.
- Automatic merge additionally requires the repository-scoped merge App's
  client-ID variable and private-key secret. Missing configuration blocks only
  `merge`; `observe` and `assist` remain usable.
- A force-push event permanently removes automatic and repair-packet authority
  for that PR generation; operators must use the manual path or recreate it.
- A failed post-approval gate dismisses the processor approval while the PR is
  open, but the multi-call approval and merge sequence retains explicit API
  races.
- Hard runner termination can strand an approval. In any mode, every later run
  that could add authority scans all open Dependabot PRs, dismisses every exact
  current-head processor approval, proves zero globally, then fully recollects
  the selected PRs and global auto-merge state. Unrecognized or malformed
  approval evidence fails closed; valid old-head and `DISMISSED` reviews remain
  informational.
- The serial lane lowers throughput when main CI or deployment is slow, but it
  preserves attribution, rollback clarity, and a clean base for the next
  lockfile update.
- The controller cannot perform the live repair/re-review/push path until a
  dedicated, allowlisted, repository-scoped repair GitHub App is provisioned,
  its credential boundary is reviewed, and its actor and repaired-head lineage
  are integrated with intake and the Dependabot reviewer.
- Intake-driven processor failures are partitioned by PR in the managed failure
  notifier. A success for another PR cannot close that incident, while valid
  `receipt=false` skipped runs are ignored.
- A successful processor run means each selected pull request reached a
  documented terminal state. It does not mean every update was merged: manual,
  vetoed, base-failed, and attempt-exhausted outcomes are valid fail-closed
  results only when reported explicitly.

## Trust, evidence, and failure handling

Intake run identity and operator sweep payloads contain bounded selectors only.
Repair packets, processor receipts, and summaries must not contain tokens,
environment values, cookies, raw provider responses, or arbitrary pull-request
text promoted into trusted commands. Logs and summaries escape untrusted names
before rendering.

The processor never evaluates shell, workflow, or validation commands supplied
by the pull request or dispatch payload. Commands and expected check sources
come from trusted default-branch configuration. A processor crash, API
ambiguity, rate limit, missing evidence, head movement, or unrecognized state
stops mutation and reports a retryable or manual outcome.

Operators follow [`docs/dependabot-automation.md`](../dependabot-automation.md)
for observation, batch processing, repair handoff, token restrictions, serial
merge/release proof, and recovery. Existing deployment rollback authority stays
with the active-main controller and its runbook.

## Evidence

The implementation and tests are the current repository evidence:

- `.github/workflows/dependabot-intake.yml` — credentialless metadata receipt;
- `.github/workflows/dependabot-process.yml` — trusted `workflow_run`, scheduled
  and operator-sweep processing, permissions, and a non-collapsing serial
  concurrency queue;
- `.github/workflows/dependabot-claude-review.yml` — trusted-base, exact-source
  Dependabot AI review without candidate checkout or execution;
- `scripts/dependabot-processor.mjs` — policy, exact-head evidence,
  base-failure attribution, repair-packet limits, and terminal receipts;
- `pnpm dependabot:process:test` — network-free policy, parser, and workflow
  contract tests;
- `docs/dependabot-automation.md` — operator commands, rollout, output, and
  recovery; and
- `.github/workflows/vercel-main-deployment.yml` and
  `docs/vercel-deployments.md` — exact merged-SHA release proof and recovery.

These references specify expected behavior. They do not claim that a pull
request was repaired, merged, or deployed; the current run and its exact-SHA
evidence make that claim.

## References

Primary platform references verified for this decision:

- [GitHub Dependabot automation](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions)
  — Dependabot metadata can drive narrow approval and native auto-merge policy;
- [GitHub Dependabot on Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
  — Dependabot events have read-only tokens and Dependabot-scoped secrets;
- [GitHub `workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
  — a downstream workflow may cross into greater privilege, so it must not
  execute untrusted upstream code or artifacts;
- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
  — privileged workflows must not execute untrusted pull-request code and
  third-party actions should be immutably pinned;
- [Claude Code Action security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
  — Anthropic's threat model and security guidance for secret-bearing review;
- [GitHub `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token)
  — token-authored events normally do not start another workflow; use a
  narrowly scoped GitHub App when a new run must be triggered;
- [GitHub auto-merge](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
  — native auto-merge waits for branch protections and required checks;
- [`gh pr merge`](https://cli.github.com/manual/gh_pr_merge) —
  `--match-head-commit` supplies an additional expected-head guard; and
- [GitHub secrets](https://docs.github.com/en/actions/concepts/security/secrets)
  — grant minimum permissions and prefer a scoped GitHub App installation token
  to a broad personal credential.

## Reconsideration

Reconsider this decision if the repository adopts another dependency-update
generator, GitHub supplies a first-party exact-head repair-and-release
transaction with equivalent trust separation, or serial release proof cannot
meet the update service objective. Any replacement must preserve read-only
intake, trusted default-branch policy, fail-closed mode handling, base-failure
attribution, bounded repair scope, independent repair credentials, current-head
full gates, and exact-merge-SHA release proof.
