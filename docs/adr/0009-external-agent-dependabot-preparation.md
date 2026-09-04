---
title: External agents prepare weekly Dependabot pull requests for human merge
status: active
owner: eng
canonical: true
last_verified: 2026-09-03
scope: dependency-maintenance
date: 2026-09-01
supersedes:
  - "0006"
  - "0007"
  - "0008"
---

# ADR 0009 — External agents prepare weekly Dependabot pull requests for human merge

**Status:** Accepted
**Scope:** dependency-maintenance

## Context

The repository previously ran dependency preparation through a large set of
trusted default-branch workflows, custom receipts, policy code, repair code,
model-review code, and production evidence tooling. The design kept final merge
authority with a human, but its repository-specific control plane was costly to
maintain. Routine dependency policy changes required updates across workflows,
scripts, tests, runbooks, credentials, and identity contracts.

The work before a human merge is a suitable external-agent task. An agent can
authenticate the live pull request, isolate the branch, synchronize `main`,
review the dependency and lockfile changes, make bounded compatibility fixes,
run repository validation, complete review feedback, and report exact-head
evidence. These steps do not require a repository-hosted preparation control
plane.

The preparation method must work from more than one agent runtime. The same
operator may use a scheduled OpenClaw session, an interactive Codex session, or
a Claude Code session. Generic JavaScript repositories can reuse the common
sequence, while this repository keeps its security and validation rules local.

The first supervised sweep also exposed two evidence-collection false negatives
and one policy deadlock. REST issue-timeline force-push fields did not provide
the commit OIDs that GraphQL exposes, legacy branch-protection reads required
unneeded administration permission even though repository rules were readable,
and stale npm pull requests could not inherit trusted workflow removals from
`main`. The original protected-runtime classification also made a patch-only
Next.js update manual even when its coupled data could be constrained and
verified without execution. A valid weekly sweep must distinguish individual
policy outcomes from an operational launcher failure, admit that narrow patch
case, and provide useful research whenever a pull request stays manual.

## Decision

### Use a weekly external-agent sweep

Dependabot checks the npm and GitHub Actions ecosystems each Monday at 06:00
UTC. An OpenClaw job is installed for Monday at 10:15 UTC. It stays disabled
until the one-time cutover passes. After activation, OpenClaw launches the
sweep. This is deployment configuration, not part of the repository contract.

The four-hour and fifteen-minute delay lets Dependabot create or refresh its
native pull requests before the sweep. Version 2 does not add an event webhook
or a standing polling process. A missed sweep waits for a manual invocation or
the next Monday run. An active agent session may monitor the checks and review
that it started.

### Use one runtime-neutral skill

Every scheduled or manual sweep invokes the installed generic
`dependabot-prep` skill. Manual runs may use Codex, Claude Code, OpenClaw, or
another compatible runtime. The repository does not depend on one runtime's
prompt format, command syntax, memory store, or model provider.

The operator-controlled scheduler records the canonical skill source path and
reviewed SHA-256 digest. Every write-capable run verifies both values before it
uses repository-write authority. A digest rotation requires a disabled
schedule, complete skill review, byte-identical installation, updated expected
digest, and a supervised rehearsal.

Write authority also requires an operator-owned boundary before the model
starts. The scheduler pins the canonical paths and reviewed SHA-256 digests of
the trusted pre-model launcher, root `authorized-run` orchestrator, and any
runtime-specific instruction-isolation adapter. The launcher verifies those
pins, the skill pin, and the exact runtime binary, version, and
instruction-discovery configuration before it starts the model.

The launcher uses one of two contexts. It can use an operator-owned,
repository-instruction-free directory outside every checkout. It can instead
use a trusted materialization that it proves is a clean, ordinary-file-only
checkout of the authenticated exact live base SHA before model launch. A
candidate clone, candidate branch, mutable controller checkout, or unverified
repository directory cannot be the runtime project root.

An instruction-free launch must discard stale policy, candidate state, and
evidence, then rebind policy and restart classification when a base moves. An
exact-base launch cannot unload instructions that entered the model context.
Any base movement in that mode ends write authority and requires a fresh
materialization and model relaunch. A multi-base invocation uses the
instruction-free context or one launcher process per distinct exact base OID.

Before a write-capable launch on a host, and after any bound input changes, the
launcher runs a no-credential test against the exact runtime and access path.
The test places unique sentinel instructions in every supported instruction
location in a disposable candidate clone. It proves with machine-verifiable
runtime evidence that reading, editing, or using a command working directory in
that clone cannot add candidate instructions to the active instruction set. A
model statement is not evidence. The same test uses hostile shell, autoenv, Git,
editor, formatter, language-server, watcher, and package-tool sentinels. It must
prove that the exact access operations start no candidate process, load no
candidate configuration, and make no candidate-triggered network request. Bind
the result to the host, runtime, configuration, authorizer, launcher, adapter,
and exact access operations. A runtime that cannot prove these properties
remains read-only. A manual session that did not start through this boundary
also remains read-only until it is stopped and relaunched.

The scheduler also binds the repository, controller checkout, target set,
schedule, timeout, worker limit, exact write grants, denied mutation classes,
GitHub operator identity and credential source, and one operator-owned
repository lease. Scheduled and manual write runs use the same atomic lease.
They do not remove or take over an existing or stale lease. This prevents two
sweeps from posting or mutating against the same live state. Cutover verifies
the complete disabled declaration, exercises a second-lease failure, and reads
the complete declaration again after enable.

The generic skill owns the reusable sequence:

1. discover live Dependabot pull requests and paginate every feedback and
   timeline surface before mutation, including GraphQL force-push events with
   exact before/after OIDs and the applicable repository rules and rulesets;
2. bind repository policy to separate `generationBaseSha`,
   `currentTargetBaseSha`, and policy-blob `policySha` roles;
3. authenticate exact bot, repository, native head lineage, head ref, head SHA,
   base, and absence of auto-merge;
4. use a sanitized standalone clone and sealed bundle without candidate
   execution;
5. classify under repository policy as `full`, `sync-only`, `review-only`, or
   `manual`; an initial conflict, stale base, or red CI result is admissible work
   for ordinary npm rather than a final verdict;
6. when the old-head protected tree already equals the current base, merge that
   base with one inspected no-commit/no-fast-forward merge, without rebase or
   force-push;
7. inspect and repair the dependency update as data, then validate it through
   exact-head secretless CI;
8. push only to the existing verified ref with an explicit refspec, exact
   expected-old-head lease, explicit branch grant, and the generic skill's
   reviewed one-shot exact-CAS push adapter;
9. request and complete current-head review and feedback under separate grants;
   and
10. hand off exact head, base, type-specific check-run or commit-status
    provenance, review, feedback, risk, and blockers, plus authoritative-source
    research and confidence for every manual outcome.

Repository rules take precedence. `AGENTS.md` and
[`docs/dependabot-automation.md`](../dependabot-automation.md) define the Mento
classification, protected-runtime procedure, commands, secret boundaries, and
human handoff. `.github/dependabot-prep-policy.json` defines the exact Mento
identity, veto, intervention, force-push, and Actions-ref rules.

### Keep preparation separate from merge authority

Read-only is the default. The scheduled operator grants branch updates, one
fixed-body Dependabot recreation under the full native-npm path or the
`manual-hygiene` lane under a policy-selected recreation profile, review
requests, comments, and replies. It grants neither check reruns nor
review-thread resolution. Scheduled and supervised target invocations receive
the same fixed, reviewed grant set. A supervised operator selects only the
admitted runtime and target, not a per-invocation grant set.
The scheduled operator does not grant local candidate execution. The external
agent must not approve, dismiss a review, change auto-merge, merge, close, or
enqueue the pull request.

The exact scheduled write argv is
`["sudo", "/opt/dependabot-prep/authorized-run"]`. A supervised target uses
`["sudo", "/opt/dependabot-prep/authorized-run", "--runtime", "{codex|claude}", "--target", "{positive-pull-request-number}"]`
with concrete admitted values. This executable wrapper runs
the separately pinned implementation at
`/opt/dependabot-prep/authorized-run.mjs`. The root orchestrator creates a
short-lived, root-owned nonce whose `mode` is `write`, bound to the resolved
runtime, nullable scheduled or exact supervised target, exact grants, run ID,
the canonical sorted launch inventory and its SHA-256, and its live authorizer
PID, kernel boot ID, process start time, and exact transient systemd unit. Root
publishes the nonce only after a stable read of the private `expected-prs`.
Scheduled target `null` still permits writes only to that bound inventory; a
supervised non-null target requires an exact singleton inventory. The nonce is
not model-writable, and the
mutation broker requires it. Direct launcher write mode refuses; direct
`run --read-only` and `status` remain available. The activation test runs only
through `sudo /opt/dependabot-prep/selftest-run`; it drops privileges with no
supplementary groups or capabilities, validates strict evidence independently,
and publishes a root-owned, pin-bound
`/etc/dependabot-prep/selftest-attestation.json`. `pin` and `selftest-run` are
root-only maintenance, and `lease-clear` remains explicit `dependabot` maintenance. This
separates model intent from mutation authority and deliberately changes the
scheduled command.

The model's `dependabot` UID has no GitHub credential and its
`/var/lib/dependabot/gh` directory remains empty. A separate
`dependabot-mutator` nologin UID owns the repository PAT under
`/var/lib/dependabot-mutator/gh`. Direct authenticated `gh` is forbidden. The
model uses only the pinned broker proxy: fixed-repository REST `GET` and sealed,
one-page `pull-request-force-push-history` and `pull-request-review-threads`
GraphQL templates with only PR number and cursor inputs; capability-bound
root-owned `manual-research` and `verify-assisted` evidence; CodeRabbit review request,
bounded top-level comment, and bounded review reply operations; and exact-CAS
push or broker-generated exact-CAS base synchronization for branch writes. This is a
technical credential boundary, although compromise of the privileged broker or
mutator credential remains a residual risk.
The exact client allowlists are read
`gh-read`/`lineage`/`verify-assisted`/`selftest` and write
`push`/`sync-base`/`recreate`/`request-review`/`comment`/`reply`/`manual-research`;
the result verifier may call only `verify-prepared` and `run-manifest` directly.
Invoke each write client, including `manual-research`, as the sole foreground
command and preserve its direct exit status and complete output.

The agent requires live `autoMergeRequest: null` before any branch mutation,
immediately before each push, and at handoff. It merges the current base into
the branch. It never rebases or force-pushes. Any push invalidates prior
current-head check and review evidence.

Each invocation starts from an authenticated native Dependabot head or a
complete, validated receipt chain returned by the pinned root broker. A
same-`dependabot`-UID receipt is forgeable and remains manual. During one
uninterrupted invocation, the agent admits only its exact non-force transitions.
It creates one two-parent merge commit, one one-parent repair commit on an
already-current base, or no commit. It never creates an empty second commit.

Cross-invocation continuation uses the pinned root-owned receipt and mutation
broker. After a successful exact-CAS push or exact-CAS base synchronization and
live readback, the broker atomically records a chained receipt containing `sequence`,
`previousReceiptSha256`, `repository`, `pullRequestNumber`, `headRefName`, exact
old and new heads, target base and policy identities, canonical recording time,
mutation kind, processing mode, the exact run-authorization digest, run and
operator identities, protected-tree evidence, `generationBaseSha`,
`nativeOriginHeadSha`, `nativeLineageSha256`, and pinned component digests
before control returns. The native-lineage digest canonically binds force-push
events, the generation base, ordered native commit SHAs and parents, and the
native origin head. A later invocation admits only the complete receipt chain
returned by the broker's exact PR/ref/head lineage query. Missing,
same-UID-writable, or unverifiable receipts remain manual.

Before a network mutation, the root broker takes the atomic
`/var/lib/dependabot/lineage/operation.lock` directory and durably writes a
`dependabot-prep-mutation-intent:v1` record under the root-owned `intents`
directory. After verified live readback, it durably appends and rereads the
receipt, moves the intent through the root-owned `pending` directory, fsyncs the
directories, and releases the lock. Any pre-existing intent, pending record, or
crash-surviving lock blocks all later ref mutations until explicit human
forensic recovery; the controller never auto-deletes or automatically retries
those artifacts.

Preparation ends with one of four reports: `prepared for maintainer decision`,
`manual`, `blocked`, or `read-only`. A maintainer then revalidates the exact
head and base, gives the current human approval, and performs the final squash
merge.

### Use the least-privilege evidence surfaces

Force-push lineage comes from completely paginated GraphQL
`HeadRefForcePushedEvent` items and their exact `beforeCommit.oid` and
`afterCommit.oid` values. Applicable protection comes from
`/repos/{owner}/{repo}/rules/branches/{branch}` plus the completely
enumerated and fully read repository rulesets. The legacy branch-protection
endpoint is not required, and its administration-only failure does not justify
a broader token. Missing pages, OIDs, applicable rules, or producer evidence
still fail closed.

Normalized result evidence exposes `forcePushHistory` with its complete OID
transitions, `repositoryRules` with source endpoints, pagination status, and a
bounded summary, and `mutationLineage` with its native-lineage digest, receipt
provenance, exact old/new-head transitions, and final-head binding. The
mutation-lineage source is always root-owned receipt evidence, never
model-writable and never itself mutation authority, even when a native-only
head has no receipt transition.

Every result keeps `generationBaseSha`, `currentTargetBaseSha`, and `policySha`
distinct. `policySha` is the Git blob OID of the exact policy read from the
target base, not a SHA-256 digest or either base SHA.
The sealed normalizer identifies itself and reports a verified or rejected
status with a note. Only a non-prepared row may carry rejected/incomplete
evidence or literal `unknown` `generationBaseSha`/`policySha`;
`currentTargetBaseSha` remains required. Such a row is honestly blocked rather
than an operational launcher failure; a prepared row still requires exact,
complete, verified evidence.

### Require protected-tree equality without workflow-write authority

A direct pull-request change below `.github/workflows/**` or
`.github/actions/**` permits no ref mutation. GitHub requires workflow-write
authority for a push that introduces workflow bytes from an upstream base, not
only for an agent-authored workflow edit. This controller deliberately receives
no such authority. Before any npm ref mutation, an independent verifier must
therefore prove that the protected subtrees at the exact old head already equal
`currentTargetBaseSha` byte-for-byte and mode-for-mode, then prove the same for
the quarantined candidate and immediately before mutation. A mismatch is
ineligible for direct ref mutation; neither the agent nor conflict resolution
may carry or repair it. The `full`-mode automated recovery is one broker-fixed
`@dependabot recreate` request for an authenticated native npm generation that
contains exactly one native Dependabot commit. Multi-commit ordinary native
generations fail closed to `manual`, so the v1 ordinary receipt can never omit
an interior OID that could later be replayed. The controller then waits for a
replacement head and restarts full
native-generation authentication. Failure to obtain an admissible new head is
`manual` or `blocked`.

Before requesting regeneration, the broker revalidates the exact live PR, ref,
head, target base, policy, dependency tuple, version transition, path class,
manual-risk exclusions, vetoes, and absence of human review intervention. It
records the fixed operator comment in a root-owned recreate ledger before
clearing the mutation intent. Subsequent normalization independently rereads
that ledger and the exact live comment, discards pre-boundary authority, rejects
SHA replay, and emits a `generationTransition` bound to the first later
Dependabot force-push event. The agent must recollect all evidence from scratch
after the replacement rather than slicing the old timeline.

For a clean `sync-only` branch, the broker independently fetches the exact old
head and target base into a root-owned quarantine, requires a clean merge tree,
creates and verifies an exact two-parent merge commit, then uses the same
exact-CAS push worker as an ordinary branch repair. It verifies the live state
and writes an `exact-cas-base-sync` receipt. This path is eligible only when the
old-head and target-base protected trees already match. No pull-request
branch-update API or `Workflows: write` grant is used. A protected-tree mismatch
or conflict may use the fixed recreation path, but direct mutation fails closed;
credential broadening is not a fallback.

### Keep sensitive updates manual

Unknown packages, sources, ecosystems, or paths remain manual or blocked.
Packages matching the exact wallet, signing, transaction, or bridge risk
patterns require an explicit maintainer decision. Sensitive
or self-reviewing GitHub Actions remain manual. This includes the paired OSV
scanner and reporter.

Non-sensitive npm updates can be prepared when the agent completes the
repository checks and exact-head review. The agent never mutates an Actions
ref. Only an authenticated minor or patch version update in the
`github-actions-routine` group can use `review-only`, and only when every old and
new ref is a full lowercase 40-character SHA on its current, unchanged, native
green head. Major, security, sensitive, self-reviewing, ambiguous, and
local-Action updates remain manual; grouping never reduces scope.

### Prepare manual pull requests mechanically without accepting their risk

The `manual-hygiene` lane is an exception to "research only" for a small set of
broker-authenticated mechanical operations while the processing mode and final
ownership remain `manual`. It may request one fixed Dependabot recreation when
needed and, on the exact unchanged current or replacement native head, request
CodeRabbit review and post bounded answers to actionable feedback. It never edits or pushes a branch,
executes candidate code, reruns checks, approves, dismisses, merges, closes,
changes auto-merge, or resolves a review thread. It can therefore make a manual
pull request conflict-free and review-clean without making the dependency
decision for the maintainer.

Before admitting the lane, the broker exact-validates the complete top-level
`manualResearch` and `manualHygiene` trusted-base policy contracts. Generic
research-only manual rows still pass through the pinned launcher and result
verifier but confer no mutation authority.

Every such operation requires a current-run root-owned
`dependabot-prep-manual-research-receipt:v1`. It binds the authorized target,
exact PR/ref/head and native lineage, live base and policy, manual category and
profile, dependency tuples, research projection, source evidence, and root run
authorization. The broker revalidates the live bindings and independently
verifies sources in the policy-mapped upstream repository. The generic
project/package fallback may support a manual report but cannot authorize an
operation. A partial packet is report-valid when it retains at least one
live-verified authoritative source per tuple and discloses every gap; it
authorizes hygiene only when every tuple also has at least one
operation-authorizing source. An unavailable packet has at least one tuple with
no verified source and authorizes no operation. Every gate-input source uses the tuple's exact
values rendered as `<fromVersion> -> <toVersion>` (for example,
`2.0.0 -> 3.0.0`); the angle-bracket names are placeholders and must not appear
in the packet. Serialize the packet as exactly one compact JSON line followed
by one newline, with no other insignificant whitespace; `jq -c` produces the
required form. When desired source kinds are known absent but the fallback
verifies, the research stays partial and retains the fallback while authorizing
no hygiene. A known source absence is recorded in overall `gaps`, package
`sourceNote`, and `missingSourceKinds`, with only unverified sources omitted and
no `sourceFailures` entry unless a fetch or validation actually failed. Overall
risk cannot be lower than the riskiest package and overall confidence cannot
exceed the least-confident package.
After any research receipt is issued, target-base or policy-blob movement ends
the entire run's mutation path and requires a fresh root-authorized targeted
run; the same run may not replace the receipt or attempt another mutation. The
broker anchors the first receipt's base and policy for the entire run; a new
receipt for a post-recreation head is allowed only while both remain unchanged.
The receipt binds every authenticated native-prefix commit OID, and the manual
recreate receipt copies that complete list into the replaced-history
quarantine. This prevents an intermediate commit from the old native prefix
from being replayed as part of a supposedly fresh generation.

Recreation uses separate native npm, native GitHub Actions, and legacy recovery
profiles. Legacy recovery admits only a continuous one-parent suffix by
`mento-dependabot-prepare[bot]` (ID `315967666`) over an authenticated native
prefix. That suffix is quarantined, never admitted as trusted lineage, and can
authorize only one fixed recreation followed by a wholly new native Dependabot
generation. Immediately before and after every recreation, the broker requires
the current base's `.github/dependabot.yml` blob to equal
`145af6e07c4ff728553a46cfda379cd76bb93227`, every old tuple to remain present,
every new tuple to remain absent, and the PR to remain open with unchanged base,
head, and null auto-merge. These checks guard the known obsolete-update path;
they do not eliminate the external-service residual that GitHub may later close
or retarget the PR, or the race in which the base moves after the final read.
An assisted-handoff verifier publishes a root-owned
`dependabot-prep-assisted-handoff-receipt:v1` and reports current-base
containment, conflict state, complete terminal exact-head CI, current-head
CodeRabbit state, unanswered findings, answered-but-unresolved threads, and
null auto-merge state. Red CI is reported, not disguised as a passed
preparation gate, and the verdict never becomes `prepared`.
Only the schema-listed `status`, `lane`, `category`, `recreateProfile`,
`autoMergeRequestNull`, `containsCurrentTargetBase`, `conflictFree`,
`exactHeadCiComplete`, `exactHeadCiPassed`, `currentHeadReviewTerminal`,
`unansweredActionableCount`, `answeredButUnresolvedCount`,
`verificationSha256`, and `note` are copied into `assistedHandoff`.
`receiptFile`, `receiptSha256`, and `verifiedAt` remain root verification
metadata outside the result projection.
Fallback-only partial and unavailable receipts preserve the research report but
authorize no hygiene. The agent skips `verify-assisted` and emits the
receipt-bound handoff as `not-attempted` with null observations; unavailable is
`blocked` in write mode or `read-only` in a dry run. On a replacement head, the
result retains the already-receipted recreation and generation transition as
its sole prior action; no later operation is permitted.

Supervised rollout is target-scoped and serial: `#917`, `#892`, `#871`, `#872`,
`#897`, then `#919`. The PR numbers are an activation plan, not durable policy.
Every target requires an operation-authorizing root research receipt, a
root-verified complete assisted-handoff receipt, zero prohibited mutations, and
released lease and capability; an exit `0` with a merely manual or blocked row
does not pass. All six must pass before a separate explicit operator
confirmation. Only after that confirmation may the untargeted scheduled sweep
use the full authenticated open-Dependabot inventory, category
priority, and coupled-family serialization. Any non-null root target remains an
exact one-PR authorization.

Dependabot configuration isolates Next.js, Vercel CLI, Playwright runtime, and
protected pnpm updates from ordinary libraries, and couples the Vitest family.
Catch-all groups explicitly exclude every protected class. The npm
open-pull-request cap is twelve so those focused lanes cannot consume every
slot needed by ordinary updates.

A semver-patch-only `next` update may nevertheless use `full` when the original
authenticated diff and any deterministic data-only repair are confined to the
exact coupled Next declaration, override, lockfile-closure, and derived
runtime-contract digest tuple. The Vercel identity and configuration,
package-manager and runtime pins, workflows, Actions, security policy, and all
unrelated bytes and modes must equal `currentTargetBaseSha`, subject to the
independently verified protected-tree precondition. The agent cannot execute candidate
code or a package manager to produce the tuple; ambiguity or missing generated
state makes the update `manual`. Next minor and major updates remain `manual`,
as do Vercel CLI, protected Playwright, protected pnpm rotations, and packages
matching the exact wallet, signing, transaction, or bridge risk patterns.

Ordinary npm admission accepts only strict forward stable-semver transitions
with an identical range prefix. Downgrades, prereleases, source or protocol
changes, and ambiguous versions are manual. A compatibility repair may occur
only after a separate clean base synchronization, as one child commit of the
exact old head. It may modify only existing non-protected files below `apps/` or
`packages/`, never a dependency manifest or lockfile, and its final dependency tuples must exactly
match the authenticated native tuples.

Manual classification does not end the agent's analysis: it must research the
exact upstream version range and live-verify at least one authoritative upstream
HTTPS URL for every exact package tuple. Changelogs, release notes, migration
guides, and advisories are the desired source classes. Only when none exists may
an authoritative upstream project or package page be used as the explicit
fallback; the exact missing desired classes are recorded and confidence is
lowered. The packet links its verified changelog or release-note sources,
explains breaking changes and repository impact, and reports recommendations
with per-package and overall risk (`low`/`medium`/`high`/`critical`/`unknown`)
and confidence. If no authoritative
link can be live-verified, research is operationally incomplete and the launcher
sweep fails. Candidate code is never executed for research.

### Separate per-pull-request outcomes from launcher health

A complete schema-valid result covering the exact initial inventory exits `0`
even when some pull requests are manual or blocked, unless any manual research
result is `unavailable`. Unavailable research remains in the validated report
but makes the sweep operationally incomplete and exits `1`. Other operational
or invalid/incomplete-result failures also exit `1`, pin or self-test drift
exits `2`, and active lease contention exits `3`. Machine-readable status and per-verdict
and per-processing-mode counts preserve both signals. OpenClaw alerts on
operational failure, not on an accurately reported policy outcome.

### Rotate protected runtime dependencies through repository procedures

Next.js and Vercel CLI updates can change both the ordinary workspace and the
standalone Vercel deployment runtime. Playwright updates can require a matching
workflow container pin. Protected pnpm updates also span the root
package-manager declaration, workflow setup pins, trusted protected-runtime
and action-policy checks, Linux bootstrap, and standalone pnpm runtime. A
checker-only first pull request must land the protected transition rule before
these states can move. The second pull request must rotate all coupled
manifests, overrides, lockfiles, pins, and contract digests together, then
remove the temporary old pnpm version from the checker. Exact-head CI must pass
both action-policy checks and the independent validators documented in
[`docs/dependency-overrides.md`](../dependency-overrides.md) on both stages.

The generic agent may prepare only the constrained semver-patch-only Next tuple
defined above, and only when it can verify or deterministically repair that data
without candidate or package-manager execution. It reports every Next minor or
major update, out-of-contract patch, Vercel CLI update, protected Playwright
update, and protected `pnpm` or `@pnpm/linux-x64` rotation as `manual`, even
with an `execute` grant.
An authenticated maintainer performs the documented provenance review and
source-bound lockfile generation. The agent must not restore the old workspace
version only to satisfy a skew check.

### Preserve secretless pull-request boundaries

Native Dependabot pull requests remain outside every same-repository `User`
credential grant. Candidate jobs receive no repository or provider secret and
do not persist checkout credentials. The read-only Vercel preview intake still
authenticates the exact Dependabot event before trusted default-branch code
publishes a preview-disabled status. The external-agent design does not widen
preview, deployment, cache, package, environment, or workflow authority.

External preparation uses a separate clone made from sealed exact-SHA bundles.
The scheduled path uses sanitized trusted Git and structured edits only. It does
not execute candidate hooks, package-manager commands, tests, builds,
generators, plugins, local binaries, or configuration. Existing secretless
pull-request CI is the candidate-execution and validation boundary. A required
repair that needs local execution remains manual unless a separate `execute`
grant and tested isolation adapter exist.

### Remove repository-hosted preparation machinery

Retire the repository workflows, scripts, tests, commands, evidence artifacts,
dedicated GitHub App configuration, and model credentials that existed only for
repository-hosted Dependabot preparation. Keep native Dependabot configuration,
normal pull-request CI and review, the secretless Vercel preview intake, and the
repository validators used by external or manual preparation.

This decision supersedes ADRs 0006, 0007, and 0008. Those ADRs remain archived
as historical records.

The cutover spans both sides of the file deletion. An explicitly authorized
human operator acts outside every `dependabot-prep` invocation. Before this
decision reaches `main`, the operator freezes all Dependabot merges, cancels and
reads back every native auto-merge request, disables the old workflows, revokes
the Prepare App and repository-specific model credential, removes the five
processor variables and Prepare App private-key secret, and deletes or expires
every rerunnable old workflow run. A blocked freeze, auto-merge cancellation,
shared-credential cleanup, or nonterminal old run blocks the retirement merge.
The zero-rerun proof prevents an old workflow from using the retained shared
Claude OAuth fallback.

The operator holds the shared repository write lease from before the first
cutover mutation through the final authority readback. This blocks a scheduled
or manual write-capable preparation run from changing the same pull requests
during cutover. An existing or stale lease blocks the cutover.

After the deletion reaches `main`, the operator removes stale processor
authority, verifies every live ruleset and applicable combined branch rule,
closes only the enumerated obsolete bot-managed notifier issues, and completes
a final authority readback. The operator then verifies the shared skill and pre-model
launcher boundary in Codex, Claude Code, and OpenClaw, completes one read-only
inventory, and runs the six separately targeted supervised invocations in order:
`#917`, `#892`, `#871`, `#872`, `#897`, and `#919`. Each must have a
root-verified complete assisted handoff, zero prohibited mutations, and released
authorization state. Only after all six pass and the operator separately
confirms enablement may the weekly schedule be enabled. The merge freeze remains until the final readback proves that
no old processor approval, `Dependabot ALL CLEAR`, native auto-merge request,
required old check, App actor, or App bypass remains on any open pull request.
The exact checklist is in the active runbook.

## Alternatives considered

### Keep the repository-hosted preparation architecture

This preserves immediate event processing and deterministic receipts. It also
preserves the largest maintenance and credential surface even though a human
still makes the final merge decision. We rejected it.

### Use GitHub native auto-merge

Native auto-merge reduces human work but gives the dependency update a merge
path that this repository does not want. It also does not perform the required
Mento-specific review, protected-runtime coupling, or feedback loop. We
rejected it.

### Use a runtime-specific repository command

One command tied to OpenClaw, Codex, or Claude Code would make the repository
depend on that runtime's configuration and would reduce reuse across other
JavaScript repositories. We rejected it in favor of the generic skill plus
repository-local policy.

### Keep all dependency preparation manual

This has the smallest automation surface but repeats the same discovery,
branch synchronization, review, validation, and feedback work. We rejected it
for routine updates. Sensitive updates still use the manual outcome.

## Consequences

- The repository loses immediate dependency-event processing. Weekly or manual
  invocation is the expected latency.
- A failed scheduled operator run does not receive an in-repository retry. A
  maintainer must invoke the skill manually or wait for the next sweep.
- The scheduled operator can request only the broker's bounded GitHub
  operations for existing Dependabot refs, reviews, and replies. The model has
  no credential and receives no thread-resolution, approval, or merge authority.
- The mutator PAT still has broader provider-level repository authority than
  the broker's allowlisted methods. The model has no direct credential, so the
  dedicated nologin UID and sealed broker create a technical boundary; their
  compromise remains the residual that replaces a dedicated Prepare App.
- The scheduled path cannot produce a repair that requires local candidate
  execution. It reports that pull request as manual instead of rebuilding a
  second CI system outside GitHub.
- A later invocation can resume only a head proved by the pinned root broker's
  complete receipt chain. Any prior agent head without that proof stays manual.
- A valid sweep with manual or blocked pull requests is operationally
  successful and exits `0` unless any manual research result is `unavailable`.
  Unavailable research remains reportable but makes the sweep operationally
  incomplete and exits `1`; machine-readable counts preserve those outcomes.
  Alerts cover unavailable research plus launcher, evidence, result, pin,
  self-test, or lease failures.
- The preparation logic becomes reusable from Codex, Claude Code, OpenClaw,
  and other compatible runtimes and across JavaScript repositories.
- A manual session cannot gain write authority after launch. The operator must
  relaunch it through the reviewed boundary and retain current-host instruction
  isolation evidence.
- Repository policy becomes smaller and easier to audit. Mento-specific risk,
  validation, protected-runtime, and secretless-preview rules remain explicit.
- Exact-head checks and review remain necessary. Agent evidence is a current
  snapshot and does not replace the maintainer's final GitHub revalidation.

## Failure handling

The agent fails closed on identity drift, unhandled base or head drift,
auto-merge state, unknown dependency input, unrelated lockfile changes, final
validation failure, missing current-head review, unanswered feedback, or final
mergeability failure. An initial conflict, behind state, or red CI result on an
ordinary npm pull request is work for `full` or `sync-only`, not itself a
failure. Every manual result includes the source-linked research packet. The
agent never merges.

If the scheduled run misses a week, use a manual `dependabot-prep` invocation.
Do not add a webhook, poller, runtime-specific repository workflow, or broader
credential as an incident workaround.

## Evidence

The repository validates the retained boundary with:

- `pnpm dependency:policy:test`;
- `pnpm ci:action-pins:test` for Actions pins;
- `pnpm supply-chain:version-skew` and
  `pnpm supply-chain:lockfile-lint` for catalog, override, and lockfile policy;
- `pnpm vercel:versions:check`, `pnpm vercel:production-shadow:test`, and
  `pnpm vercel:workflow:test` for protected-runtime coupling and deployment
  boundaries; and
- the normal exact-head required checks and review surfaces.

The operating procedure is
[`docs/dependabot-automation.md`](../dependabot-automation.md).

## Reconsideration

Reconsider this decision if weekly latency becomes operationally unacceptable,
the number of open updates exceeds one bounded sweep, or repeated scheduler
failures make manual recovery routine. Any event-triggered replacement needs a
new ADR with explicit identity, credential, candidate-execution, approval, and
merge boundaries.
