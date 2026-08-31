---
title: A trusted controller prepares exact-head Dependabot pull requests for human merge
status: active
owner: eng
canonical: true
last_verified: 2026-08-31
scope: ci/dependabot-processing
date: 2026-08-10
---

# ADR 0006 — A trusted controller prepares exact-head Dependabot pull requests for human merge

**Status:** Accepted, amended Aug 14, Aug 22, Aug 24, and Aug 31 2026
**Scope:** ci/dependabot-processing

## Context

Dependency updates need more than a green required-check subset. Some expose an
existing default-branch failure, some need a compatibility repair, some contain
review findings, and some touch authentication, deployment, workflow policy, or
other surfaces that automation must not mutate. npm updates, grouped updates,
and majors still benefit from fully collected evidence even when a maintainer
owns the final risk decision.

Dependabot events run with a restricted token and Dependabot secrets.
Pull-request source, manifests, lockfiles, patches, model output, check logs, and
comments are untrusted. Combining them with a long-lived write credential or a
job that can both push and approve would let candidate-controlled input cross a
privilege boundary.

The previous design had `observe`, `assist`, and `merge` modes. Its merge
mode used a dedicated App to approve and merge one green candidate, then held
the lane through default-branch CI and release proof. The desired operating
model changed: automation should do the repetitive preparation, while a human
makes the final merge decision. Keeping dormant merge code or a repository
variable that re-enabled it would violate that requirement.

A repaired head also has a different actor from the original Dependabot commit.
Blindly accepting every bot synchronize would destroy the strict native intake
boundary. A trusted controller needs a separate, versioned way to prove an
append-only App mutation, its exact packet, and re-review without executing the
candidate.

## Decision

### The terminal automation state is ALL CLEAR, never merge

The processor's exact modes are `observe`, `assist`, and `prepare`.
Missing, empty, legacy `merge`, unknown, case, and whitespace variants
normalize to `observe` before any credential is available.

- `observe` classifies and records evidence.
- `assist` publishes non-authorizing classification evidence for human
  handling and cannot issue an automatic repair packet.
- `prepare` may refresh, repair, re-review, satisfy packet-bound feedback,
  create the processor approval required by the ruleset, and publish
  `Dependabot ALL CLEAR`.

No mode merges, calls a merge endpoint, invokes `gh pr merge`, enables native
auto-merge, or creates a merge-queue entry. Retire the merge mode, merge code,
merge-token minting, and merge App configuration.

A maintainer performs the final squash merge through one of two explicit
paths. A prepared change requires a successful exact-head `Dependabot ALL
CLEAR` check and its exact processor approval. A `manual-review` change
requires an explicit maintainer takeover. A maintainer agent may merge the
current base into the branch without rebasing or force-pushing, resolve
conflicts, fix valid findings, validate, push, reply to every review comment,
and resolve eligible threads. At handoff, the agent must report the exact final
head and stop. It must not dismiss a review, submit a review approval, create a
processor approval, publish or claim `Dependabot ALL CLEAR`, enable auto-merge,
or merge. Before merging the change,
verify the exact current head and base, all
repository-required checks, resolved feedback, a current human approval, the
ruleset-required approval after the latest push, mergeability, and absence of
auto-merge. The packetless failed `Dependabot Processor` check is non-required
and intentionally waived for this manual path.
The manual path does not produce or claim ALL CLEAR.

### Native and prepared intake remain distinct

`.github/workflows/dependabot-intake.yml` remains the credentialless
`dependabot-intake:v1` `pull_request_target` boundary. It accepts only the
strict repository-owned Dependabot branch/head/base event from the exact
Dependabot bot sender and gains no token, secret, checkout, API, artifact, or
dispatch capability.

`.github/workflows/dependabot-prepared-head-intake.yml` is a second
credentialless boundary. It accepts only a
`dependabot-prepared-head` repository dispatch from the configured Prepare App
bot ID/login and App slug. Its strict nine-key payload binds repository, PR,
head ref, old/new heads, operation, the exact completed operation check/run, and
verified App bot identity. Its compact receipt stays within GitHub's display
title limit. Full authority comes from downstream API revalidation of the typed
check, not the title or client payload alone.

We do not weaken v1 to accept arbitrary bots. A malformed/false receipt, extra
payload key, sender mismatch, generic bot synchronize, or candidate comment
fails closed.

### Trusted review accepts only proven append-only lineage

`.github/workflows/dependabot-claude-review.yml` follows either intake through
`workflow_run`. Its first step has no token or third-party Action and
authenticates the upstream conclusion, event, actor ID/login/type, workflow
name/path, source repository, run ID/attempt, and compact receipt.

For prepared heads, the workflow materializes
`scripts/dependabot-prepared-review.mjs` from exact
`github.workflow_sha`. That API-only helper requires:

- an exact completed successful Refresh or Repair check published by
  github-actions App ID 15368;
- exact canonical JSON, digest, external ID, workflow run/attempt/SHA, path,
  event, repository, main source, and terminal success;
- the submitted Actions URL or the exact check self URL, resolved through the
  canonical run ID rather than trusted as a URL;
- a Refresh commit whose first parent is the prior head and whose second parent
  is the receipt's actual applied base, plus its successful old-head request and
  verified bounded request-to-update base-race evidence;
- a Repair commit whose single parent is the packet head, whose author matches
  the live configured App bot ID/login, and whose committer is either that bot
  or GitHub's exact `web-flow` system signer; and
- a bounded operation chain rooted in a verified Dependabot seed.

The Claude job checks out only the trusted workflow source. It restricts
built-in tools to Bash, denies every MCP tool, and runs in `dontAsk` mode. The
workflow pins `claude-sonnet-4-6`. This prevents provider-default
drift. A
trusted `PreToolUse` guard authorizes one exact bound repository-scoped
`gh pr diff` command per workflow run attempt and blocks every other Bash call.
A paired `PostToolUse` guard validates the same successful, complete foreground
diff result, seals the original bytes in a
`dependabot-claude-review-tool-completed:v2` receipt, and replaces the
model-visible Bash result with one `text/plain` document containing those exact
bytes. This document path bypasses Claude Code 2.1.243's 30,000-character
text-result persistence, which would otherwise leave the restricted reviewer a
short persisted preview it cannot reopen. A later no-token step requires the v2
receipt. Missing, failed, interrupted, empty, or persisted/truncated output is
retry-first. The job never restores candidate artifacts/caches, installs
candidate dependencies, or executes candidate code. Its bot allowlist is the
exact Dependabot login plus exact Prepare App bot login. The no-secret publisher writes canonical
`dependabot-claude-review-result:v1` JSON for both clean and findings verdicts.
A valid findings result is deterministic repair input; an Action, provider,
schema, or infrastructure failure is retry-first.

Dependabot review and Claude repair prefer the `ANTHROPIC_API_KEY` secret. They
use `CLAUDE_CODE_OAUTH_TOKEN` only when the API-key secret is absent. A bounded
post-action diagnostic reports only the CLI subtype, error flag, terminal
reason, and numeric API status. It never logs the model result, prompt, tool
output, or diff. The publisher records a canonical non-authorizing failure
receipt. The processor can rerun the exact failed review workflow twice for an
authenticated transient provider status. It reruns only when that failure
remains the newest trusted exact-head Claude result and the failed review used
the current processor workflow SHA. The isolated retry job
receives only Actions write and read-only PR/check access. Attempt three is
terminal.

### Preparation eligibility is broader than automatic eligibility

The accepted **preparable** tier includes verified npm updates, including
grouped and major updates, and verified non-sensitive GitHub Actions updates.
Green or refreshed Actions updates can clear, but autonomous repair never writes
`.github/**`; an Actions failure requiring that surface becomes
`manual-repair-required`. This is not automatic merge policy. Risk tier,
ecosystem, dependency names, group, and update type remain in packet and ALL
CLEAR evidence for the maintainer.

The following do not receive preparation authority:

- sensitive or self-reviewing Actions;
- workflow-policy, authentication, authorization, credential, deployment,
  security, or similarly protected Action changes;
- unknown ecosystem, dependency metadata, update shape, actor, or provenance;
- human veto, close/reopen, or force-push history not admitted by ADR 0008;
- unresolved, unbound, malformed, or over-cap feedback/evidence; and
- invalid lineage or exhausted repair attempts.

Human actions may remove authority but never grant missing structural authority.

### Branch write and readiness authority are separate capabilities

The Prepare App is repository-scoped. Configure its client ID, exact App slug,
bot account ID/login, and private key. Mint only short-lived installation tokens
and verify the returned App slug plus live bot identity before use.

Install the App with `contents: write` and `pull-requests: write`. The
processor's Refresh token requests Contents and Pull requests write because
GitHub's update-branch endpoint requires both. Git Data Repair and
terminal-dispatch tokens request only Contents write. The App receives no
bypass, Actions, deployment, package, environment, or provider permission.
Never reuse the normal workflow token, preview App, deployment/provider token,
registry credential, or PAT.

Contents write also makes GitHub's merge endpoint technically available; GitHub
has no endpoint-specific deny for this combination. We therefore do not claim
that the credential itself cannot merge. The controls are:

- no reviewed workflow/helper contains a merge call;
- the App token is isolated to one repair-staging, ref-mutation/refresh, or
  terminal-dispatch job;
- those jobs cannot approve or publish ALL CLEAR;
- the token is revoked/invalidated before finalize; and
- finalize rejects the repair token and has no branch-write credential.

No job or process may hold branch-write and approval/ALL CLEAR authority
together.

### Repair planning and publication separate intent, mutation, and recovery

`.github/workflows/dependabot-prepare-repair.yml` starts only from an
authenticated, bounded Processor packet dispatch and uses trusted default-branch
code. Its repository-wide concurrency group uses `queue: max` and does not
cancel in-progress runs. GitHub can retain up to 100 pending repair or recovery
runs instead of replacing an older pending run. Ordering follows the time each
run starts waiting and can differ from dispatch order.

1. **preflight** re-fetches the exact completed Processor v2 or v3 check,
   canonical packet, run provenance, live PR/head/base, and attempt;
2. **plan** uses a trusted step-scoped read token to authenticate and seal the
   exact packet-bound compare, Git blobs, failed-job logs, and findings under
   `RUNNER_TEMP`. Generic v2 repairs use Claude token-free through the pinned
   base action. It may only use guarded Read/Grep calls on the canonical
   evidence manifest and accepts only a strict bounded patch schema. Typed v3
   protected-runtime repairs instead use the trusted model-free generator from
   the exact workflow SHA. Three workflow-only bindings—
   `DEPENDABOT_REPAIR_EVIDENCE_ROOT`,
   `DEPENDABOT_REPAIR_EVIDENCE_MANIFEST`, and
   `DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST`—tie the hook to the sealed
   evidence. Paired pre/post hooks seal successful exact accesses; large files
   require explicit one-based bounded Read pages, and Grep may locate the
   relevant ranges. A no-token postflight assertion requires at least one access
   before success;
3. **validate** has no secret or write token, re-fetches exact inputs by Git
   object SHA, including files larger than the Contents API limit, applies
   patches in a disposable credential-free temporary Git tree, and enforces
   path, file, edit, and byte caps. For v3, it independently reproduces the
   exact typed plan;
4. **candidate CLI smoke** runs only for v3 after validation. API and shell
   steps materialize exact trusted source, a byte-identical sealed Node
   executable, and a hash-verified pnpm bootstrap without registering a runner
   action or post action. A separate non-sudo account runs candidate code as the
   terminal step. Its checked non-writable `PATH` excludes the runner-owned
   `/usr/local/bin` directory. The account has read-only trusted inputs and no
   secret, cache, or write authority;
5. **stage** alone gets a short-lived App token and writes exact unreachable
   blobs, tree, and one commit without moving the branch;
6. **intent** has no App token and publishes `Dependabot Repair Intent`
   (`dependabot-repair-intent:v1`) on the staged successor. Its canonical
   receipt binds the packet, plan, parent, tree, result blobs, workflow, and
   expected successor before any ref mutation;
7. **mutate** gets a fresh App token, revalidates the intent and exact current
   ref, and moves only the exact `dependabot/*` ref with `force=false`; and
8. **receipt/recovery** has no App token and publishes the completed Repair
   receipt. If the enclosing run fails, is cancelled, times out, needs action,
   or has a startup failure after the exact ref move, a checks-only recovery run revalidates the intent, current
   head, commit, tree, and failed source before publishing the same typed
   completion idempotently. An intent whose staged commit never became the PR
   head is inert.

Repair commits must have the exact Prepare App bot author, either that bot or
GitHub's exact `web-flow` system signer as committer, and GitHub verification
`verified=true` with reason `valid`. This models GitHub's server-signed App
commit shape without accepting an arbitrary committer. Mutation and recovery
never install dependencies or execute the new tree. `Dependabot Prepared Head
Dispatch` accepts a successful completed receipt for prepared-head intake. It
accepts those exact retryable non-success Repair sources only to dispatch the
exact intent-bound recovery; a source never counts as completed Repair
authority.

Infrastructure retries are bounded independently of the two-commit repair
budget. A normal run that fails before moving the ref may re-authenticate and
redispatch the exact Processor packet at retry counts one and two. Any normal
run that moved the intent-bound ref enters a separate checks-only recovery at
count zero; failed recovery may retry at counts one and two. Count two is
terminal. Retry never changes the packet, plan, intent, expected head, or repair
attempt.

Refresh follows the same request/completed principle. A successful request
receipt exists on the old head before App mutation. Completed evidence records
the actual second parent and must show the exact old head plus either the
still-current requested base or the verified live-current base admitted by the
bounded request-to-update race reconciliation. Older applied-base lineage may
remain valid, but readiness still requires current-main ancestry. Refresh does
not consume repair attempts and may never use rebase or force-push.

### Repair attempts are typed and capped independently of refresh

The generic v2 Processor packet is created only after exact structural
identity, prepared lineage, current base, complete current-head gate,
preparable policy, valid attempt history, and at least one deterministic branch
attribution, validated finding, or exact repairable feedback thread. Feedback
must otherwise be clear. Unknown attribution blocks the packet. Prepare mode
may retain trusted provider failures outside a packet that contains separate
deterministic branch evidence. Provider evidence never enters the packet and
still blocks approval and readiness. ADR 0007 adds an exact v3 packet for a
model-free protected-runtime synchronization. It retains this lineage and
attempt budget but may be actionable without failed-check evidence when the
verified Dependabot target is not yet realized across the protected runtime.

Failure attribution distinguishes `non-deterministic` provider evidence with a
passing baseline, `provider-baseline` evidence whose trusted head and main
checks both report `error`, `failure`, `startup_failure`, or `timed_out`, and
`provider-unbaselined` evidence whose exact-main provider check is missing,
pending, or intentionally skipped. All three states remain failed and stay
outside repair packets. `unknown` covers untrusted evidence, a missing or
pending deterministic baseline, and a trusted current or baseline conclusion
outside the accepted proof set, such as `neutral` or `cancelled`. Baseline
evidence accepts only configured push, scheduled, or manual runs. The workflow
branch must be `main`, and the workflow head must equal the exact current-main
SHA. PR and PR-target runs cannot supply it. Every `main` push runs the
deterministic Supply Chain lockfile and catalog jobs. The provider-backed OSV
jobs skip that push and retain their PR, scheduled, and manual cadence.

Same-head packet and Processor check publication is idempotent. The newest
trusted exact-head receipt must match mode, disposition/output summary, attempt,
packet flag, and packet digest before publication is skipped; newer malformed or
untrusted evidence never suppresses publication. `repair-pending` preserves the
original packet and serialized lane without creating another repair run.
`manual-repair-required` is non-lane evidence that no valid bounded automatic
packet can represent the repair. An exact one-parent Repair successor consumes
its parent packet. The limit is two Repair commits. Refresh operation receipts
form the same append-only lineage but do not increment the repair counter. A
untrusted force-push, rebase, missing receipt, reordered history, ambiguous
receipt, or third repair fails closed rather than resetting the budget. ADR
0008 defines the complete native-to-native rewrite chain that starts a new
generation with a new reachable receipt budget.

### Receipts are canonical, typed, and run-bound

The collector resolves Actions workflow provenance only for exact configured
gate and receipt names. Unrelated checks and statuses remain non-authorizing raw
evidence. It caches each exact repository/run/attempt lookup within one
processor job to bound installation API use, while the selected post-merge gate
always gets a fresh run read.

Authority-bearing checks use exact recursively key-sorted compact JSON and
SHA-256 of those bytes. External IDs are indexes, not independent authority.
Each receipt binds an exact terminal successful trusted workflow run ID,
attempt, workflow SHA, path, event, repository, main source, and check publisher.
A github-actions App ID 15368 check without those bindings is insufficient.

The contracts are:

- `dependabot-processor:v2` and the exact generic
  `dependabot-repair-packet:v2` or typed `dependabot-repair-packet:v3`: exact
  head/base/policy/path scope, attempt, workflow source, and packet digest. V2
  binds failure, finding, or exact repairable feedback evidence. V3 is reserved
  for the deterministic
  protected-runtime operation in ADR 0007. A packet-issued Processor check is
  completed **failure**, so repair-needed state cannot unblock merge.
- `dependabot-refresh:v1`: successful requested receipt on the old head and
  successful completed receipt on the new two-parent head. Completed evidence
  binds the request check ID/digest.
- `dependabot-repair:v1`: successful completed receipt on the App commit,
  binding parent-head Processor check ID, packet digest, attempt, App slug/bot
  identity, and workflow provenance.
- `dependabot-all-clear:v1`: successful exact-head readiness receipt that says
  `humanAction="merge"`, `mergeAuthorizedByAutomation=false`, and
  `autoMergeEnabled=false`.

ALL CLEAR's `preparation` object distinguishes a native verified Dependabot
seed from a prepared lineage. Native evidence has zero refresh/repair counts and
no operation digests. Prepared evidence binds seed, counts, ordered operation
digests, and exact App slug/bot identity. Digest count must equal refresh plus
repair count.

### Feedback resolution is packet-bound

The collector reads every bounded review thread/reply, review, issue comment,
and close/reopen event. ADR 0008 requires a separate complete GraphQL timeline
and exact commit census for force-push evidence. Unresolved actionable feedback
blocks even when it targets an older head.

A generic v2 packet may bind a validated Claude finding or review thread only
by exact ID, head/commit, and body digest. After the repaired head passes its complete
gate and clean re-review, finalize may post the repository's exact
`Fixed in <sha> — <change>` reply and resolve only those bound threads. It
then recollects feedback. Generic bot/github-actions comments, candidate text,
and unbound replies cannot establish lineage or clear the gate. Automated
`Won't fix` is not authorized.

Historical Codex `Reviewed commit` text binds the parent review's own
`reviewCommitSha`, not the repaired current head. Unresolved historical threads
still block; resolved historical threads clear. An existing exact
packet/PR/head/thread-bound remediation reply suppresses a duplicate reply, so a
retry after reply success and resolution failure retries only resolution.

### ALL CLEAR requires the full exact-head gate and one processor approval

Finalize runs without the Prepare App token. Before successful ALL CLEAR it
must:

1. discover the repository-wide approval/ALL CLEAR inventory, collect and pin a
   sole still-valid active candidate even when a targeted run selected another
   PR, and remove only stale or invalid processor approvals;
2. prove no native `AutoMergeRequest` or competing candidate exists;
3. discard pre-cleanup evidence and recollect the selected PR/global state;
4. prove stable open/non-draft identity, exact native/prepared lineage, and
   strict current-main ancestry;
5. require complete passing exact-head checks, clean Claude re-review, clear
   feedback, and no missing/pending/retry-first evidence;
6. require GitHub `mergeable=true`, `mergeStateStatus="CLEAN"`,
   `reviewDecision="APPROVED"`, and satisfied ruleset/required-check state;
7. create one exact-head processor approval with the normal workflow token;
8. recollect the selected PR, then immediately re-read the repository-wide
   inventory and prove it contains exactly the new approval ID, PR, and head and
   nothing changed; and
9. publish canonical ALL CLEAR success.

If any post-approval pre-publication condition fails while the PR remains open,
publish an automation-invalidating exact-head ALL CLEAR failure and then dismiss
the approval. The optional failed check does not remove GitHub merge authority;
dismissal does. This is compensating, not atomic. A later finalize run may
replace that failure with a neutral non-authorizing tombstone only after fresh
evidence proves zero processor approvals, `REVIEW_REQUIRED`, `BLOCKED`, and no
auto-merge. It recollects and proves that state before it can approve again. A
later run changes a persisted tombstone back to failure before it trusts that
state. Failed recovery restores every attempted neutral target, disables a sole
exact late auto-merge request, and dismisses every observed processor approval.
Two consecutive global scans must prove both authority inventories empty within
five attempts. A processor approval or sole exact auto-merge request first
exposed by the final scan is removed. Multiple, malformed, or ambiguous
auto-merge evidence remains blocking. The run still fails because it cannot
prove the required empty sequence. Post-approval failure uses the same
paired-inventory rollback, including after an ambiguous approval response.

The packetless Processor classification check emitted before approval is a
non-authorizing status record. It is excluded from repair-receipt and attempt
accounting even while its source run is still active or if that run later
fails. Only a `packet=true` Processor check can bind repair authority, and that
check still requires terminal-success workflow provenance.

### The human lane stays serialized through release proof

One successful ALL CLEAR receipt occupies the lane and outranks ordinary numeric
candidate selection. Targeted and global runs both collect and revalidate that
incumbent. The maintainer verifies that GitHub still shows the same head and
performs the normal squash merge. The lane remains occupied until that exact
merge SHA has successful full
default-branch `CI/CD` and the terminal Vercel/no-target
`Dependabot Post-Merge Verification` receipt.

Every targeted prepare run expands collection to all open Dependabot PRs while
keeping the triggering expected-head assertion scoped to its original PR. A
pending Refresh request/completion, trusted same-head repair packet, or valid
prepared lineage is a durable incumbent and retains the lane through check,
retry, and re-review waits. Without a valid active ALL CLEAR authority, multiple
durable incumbents fail closed rather than rotate authority. Terminal manual,
vetoed, and rejected identities do not occupy the automatic lane.

A comment, review, auto-merge request, ruleset change, or new main commit can
land after final recollection and before the click. ALL CLEAR does not eliminate
that race. The ruleset must enforce the exact current base, required checks,
approval, and mergeability again at merge time. If visible state changed, the
maintainer does not click; the controller recollects.

The processor's ten-minute schedule at minutes
`3,13,23,33,43,53` reconciles missed events. Native intake, prepared intake,
and Claude review completions resume processing immediately.

## Alternatives considered

### Retain automatic merge as a configurable mode

Rejected. A dormant mode, merge helper, or repository variable still permits
automation to perform the terminal action. The amended requirement is human
merge only, so merge authority is removed rather than merely disabled by
configuration.

### Use native GitHub auto-merge and let required checks decide

Rejected. A native request lacks an exact immutable head binding in the
collected GraphQL state, can merge when a check publication changes protection,
and does not encode the repository's full feedback, baseline-attribution,
prepared-lineage, re-review, or release-lane contract.

### Let one job mutate, review, approve, and publish readiness

Rejected. Candidate/model/check input could influence a process holding both
branch-write and merge-unblocking authority. Separate planner, validator,
mutation, receipt, reviewer, and finalize jobs make each authority explicit and
revocable.

### Reuse the native Dependabot intake for App successors

Rejected. The original actor and verified Dependabot head checks would either
reject valid repaired heads or require broad bot trust. A versioned prepared
intake preserves native v1 and proves exact App lineage separately.

### Use comments or commit messages as operation receipts

Rejected. Candidate-controlled or broadly writable prose is not a trusted
lineage channel. Only canonical checks from the exact trusted workflow run,
verified App bot commit identity, and append-only parents establish authority.

### Ask Dependabot to rebase or force-push

Rejected. Rewrites destroy append-only attempt accounting and can make old
receipts ambiguous. The controller never requests such a rewrite. ADR 0008
admits only a complete native-to-native rewrite that Dependabot already made.
Every other force-push history permanently removes preparation authority for
the PR.

### Treat every check failure as repairable

Rejected. Provider and baseline ambiguity can cause automation to patch around
an outage or a failure already on main. Only deterministic branch evidence,
validated structured findings, or exact repairable feedback threads enter their
corresponding packet fields. Unknown and deterministic baseline failures block
mutation. Provider-only failures wait for a trusted retry. Prepare mode may
repair separate deterministic branch evidence while trusted provider failures
remain failed and outside the packet.

### Give the Prepare App broad permissions or reuse another App

Rejected. Cross-purpose credentials merge threat boundaries. The Prepare App is
repository-scoped, short-lived, audited, and isolated. Its unavoidable Contents
write merge-endpoint reachability is recorded as residual risk rather than
hidden.

## Consequences

### Positive

- Maintainers receive a fully refreshed, repaired, reviewed, and ruleset-ready
  PR with one explicit final action.
- npm/grouped/major updates and current green native non-sensitive Actions
  updates can be prepared without granting automatic merge policy. The Prepare
  App never refreshes or repairs `.github/workflows/**` or `.github/actions/**`;
  stale or failing Actions updates escalate to humans.
- Typed receipts distinguish refresh from repair and keep refresh outside the
  two-attempt budget.
- Exact App actor, parent chain, workflow run, packet, and review validation
  makes repaired heads first-class without broad bot trust.
- Candidate execution stays outside credential-bearing jobs.
- Default-branch CI and release proof continue to serialize production risk
  after the human merge.

### Costs and residual risks

- The workflow graph and receipt schemas are more complex and require structural
  and executable tests.
- Provider failures still need a trusted retry; they are not converted into
  speculative repairs.
- Contents write technically reaches the merge endpoint. Code review, token
  isolation, absence of merge code, and human-only merge are the mitigation.
- Approval cleanup and post-approval recollection are compensating API
  operations; hard cancellation can strand authority until reconciliation.
- GitHub state can change after the last read. Ruleset enforcement and human
  visible-head verification remain necessary.
- One serialized candidate trades throughput for bounded release attribution.

## Failure handling

Malformed, capped, stale, ambiguous, or untrusted evidence fails before
mutation or readiness publication. Missing or pending deterministic baseline
evidence also fails closed. A deterministic baseline failure is repaired on
main first. A provider-only failure waits for trusted evidence. A trusted
passing or retryably failing provider baseline may coexist with a deterministic
branch repair in prepare mode. An absent, trusted-pending, or intentionally
skipped provider baseline may also coexist with that repair. The provider
failure remains failed and never enters the packet. A malformed or out-of-scope
plan stops before App mutation. Exhausted repairs, sensitive policy, veto,
untrusted force-push history, or unresolved feedback move the PR to manual
handling.

If main CI or post-merge release proof fails after the human merge, keep the
lane occupied and use the managed failure issue and deployment recovery
runbook. Never merge another dependency update to test whether it masks the
failure.

## Evidence

The repository contract is implemented by:

- `.github/workflows/dependabot-intake.yml` — strict native credentialless
  intake;
- `.github/workflows/dependabot-prepared-head-intake.yml` — strict prepared
  credentialless intake;
- `.github/workflows/dependabot-process.yml` — trusted modes, phases,
  immediate/scheduled reconciliation, approval, and ALL CLEAR;
- `.github/workflows/dependabot-prepare-repair.yml` — sealed evidence
  materialization, token-free guarded planner, secretless validator, App-only
  staging/ref mutation, no-App durable intent, receipt publication, and
  checks-only recovery;
- `.github/workflows/dependabot-prepared-head-dispatch.yml` — terminal source
  revalidation and App-authenticated bounded dispatch;
- `.github/workflows/dependabot-claude-review.yml` — native/prepared
  exact-head API-only review;
- `scripts/dependabot-processor.mjs` — policy, evidence, typed receipts,
  attempt lineage, and serialization;
- `scripts/dependabot-preparation-receipts.mjs` — repair dispatch, plan,
  evidence materialization, blob/patch, commit, and receipt validation;
- `scripts/dependabot-repair-evidence-tool-guard.mjs` — exact-manifest Read/Grep
  authorization for the token-free planner;
- `scripts/dependabot-prepared-review.mjs` — prepared operation/run/commit
  lineage validation;
- `pnpm dependabot:process:test` — network-free policy, workflow, receipt,
  planner, publisher, and reviewer tests;
- `docs/dependabot-automation.md` — operating contract; and
- `.github/workflows/vercel-main-deployment.yml` plus
  `docs/vercel-deployments.md` — exact merged-SHA release proof.

These files define capability. Only current GitHub checks, approvals, commits,
merge state, CI, and release receipts prove a particular PR reached a stage.

## References

- [Dependabot on GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
- [GitHub `workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Claude Code Action security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
- [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub signature verification for bots](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#signature-verification-for-bots)
- [Repository dispatch](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
- [GitHub Checks API](https://docs.github.com/en/rest/checks/runs)
- [Protected branches and rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## Reconsideration

Reconsider this decision if GitHub supplies a first-party exact-head
refresh/repair/re-review transaction with equivalent actor, run, lineage,
credential, ruleset, and release-proof separation, or if the serialized lane
cannot meet the dependency-update service objective. Any replacement must keep
human-only merge, strict native/prepared intake, fail-closed mode normalization,
current-base attribution, bounded non-force repair, no candidate execution with
credentials, exact-head full gates, and exact merge-SHA release proof.
