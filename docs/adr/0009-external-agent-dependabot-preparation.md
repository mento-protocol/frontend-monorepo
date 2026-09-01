---
title: External agents prepare weekly Dependabot pull requests for human merge
status: active
owner: eng
canonical: true
last_verified: 2026-09-01
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

## Decision

### Use a weekly external-agent sweep

Dependabot checks the npm and GitHub Actions ecosystems each Monday at 06:00
UTC. An OpenClaw job is installed for Monday at 10:15 UTC. It stays disabled
until the one-time cutover passes. After activation, OpenClaw launches the
sweep. This is deployment configuration, not part of the repository contract.

The four-hour and fifteen-minute delay lets Dependabot create or refresh its
native pull requests before the sweep. Version 1 does not add an event webhook
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
the trusted pre-model launcher and any runtime-specific instruction-isolation
adapter. The launcher verifies those pins, the skill pin, and the exact runtime
binary, version, and instruction-discovery configuration before it starts the
model.

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
the result to the host, runtime, configuration, launcher, adapter, and exact
access operations. A runtime that cannot prove these properties remains
read-only. A manual session that did not start through this boundary also
remains read-only until it is stopped and relaunched.

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
   timeline surface before mutation;
2. bind repository policy to the exact trusted base SHA;
3. authenticate exact bot, repository, native head lineage, head ref, head SHA,
   base, and absence of auto-merge;
4. use a sanitized standalone clone and sealed bundle without candidate
   execution;
5. classify under repository policy;
6. merge the current base with one inspected no-commit/no-fast-forward merge,
   without rebase or force-push;
7. inspect and repair the dependency update as data, then validate it through
   exact-head secretless CI;
8. push only to the existing verified ref with an explicit refspec, exact
   expected-old-head lease, explicit branch grant, and the generic skill's
   reviewed one-shot exact-CAS push adapter;
9. request and complete current-head review and feedback under separate grants;
   and
10. hand off exact head, base, type-specific check-run or commit-status
    provenance, review, feedback, risk, and blockers.

Repository rules take precedence. `AGENTS.md` and
[`docs/dependabot-automation.md`](../dependabot-automation.md) define the Mento
classification, protected-runtime procedure, commands, secret boundaries, and
human handoff. `.github/dependabot-prep-policy.json` defines the exact Mento
identity, veto, intervention, force-push, and Actions-ref rules.

### Keep preparation separate from merge authority

Read-only is the default. The scheduled operator grants branch updates, review
requests, comments, replies, and one proven infrastructure rerun. It does not
grant review-thread resolution. Manual operators grant each permitted mutation
class explicitly.
The scheduled operator does not grant local candidate execution. The external
agent must not approve, dismiss a review, change auto-merge, merge, close, or
enqueue the pull request.

The agent requires live `autoMergeRequest: null` before any branch mutation,
immediately before each push, and at handoff. It merges the current base into
the branch. It never rebases or force-pushes. Any push invalidates prior
current-head check and review evidence.

Each invocation starts from an authenticated native Dependabot head. A
pre-existing non-native head is manual because this design has no durable,
independently verified cross-runtime preparation ledger. During one
uninterrupted invocation, the agent admits only its exact non-force transitions.
It creates one two-parent merge commit, one one-parent repair commit on an
already-current base, or no commit. It never creates an empty second commit.

Preparation ends with one of four reports: `prepared for maintainer decision`,
`manual`, `blocked`, or `read-only`. A maintainer then revalidates the exact
head and base, gives the current human approval, and performs the final squash
merge.

### Keep sensitive updates manual

Unknown packages, sources, ecosystems, or paths remain manual or blocked.
Wallet, signing, transaction, bridge, authentication, deployment, credential,
and security-policy changes require an explicit maintainer decision. Sensitive
or self-reviewing GitHub Actions remain manual. This includes the paired OSV
scanner and reporter.

Non-sensitive npm updates can be prepared when the agent completes the
repository checks and exact-head review. The agent never mutates an Actions
ref. A non-sensitive Actions update can pass only on its current, unchanged,
native green head. Grouped updates and major updates receive full diff and
release review; grouping never reduces scope.

### Rotate protected runtime dependencies through repository procedures

Next.js and Vercel CLI updates can change both the ordinary workspace and the
standalone Vercel deployment runtime. Protected pnpm updates also span the root
package-manager declaration, workflow setup pins, controller checks, Linux
bootstrap, and standalone pnpm runtime. The pull request must rotate all
coupled manifests, overrides, lockfiles, pins, and contract digests together.
Exact-head CI must run the independent validators documented in
[`docs/dependency-overrides.md`](../dependency-overrides.md).

The generic agent always reports these rotations as `manual`. It does not
prepare or push them, even with an `execute` grant. An authenticated maintainer
performs the documented provenance review and source-bound lockfile generation.
The agent must not restore the old workspace version only to satisfy a skew
check.

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
authority, verifies every live ruleset and branch-protection rule, closes only
the enumerated obsolete bot-managed notifier issues, and completes a final
authority readback. The operator then verifies the shared skill and pre-model
launcher boundary in Codex, Claude Code, and OpenClaw, completes one read-only
inventory and one supervised no-exec preparation, and only then enables the
weekly schedule. The merge freeze remains until the final readback proves that
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
- The scheduled operator needs bounded GitHub authority to push existing
  Dependabot refs and reply to comments. It receives no thread-resolution,
  approval, or merge authority.
- The current OpenClaw credential has broader technical repository authority.
  The skill provides a procedural boundary, not token-level least privilege.
  This residual replaces the dedicated Prepare App and controller.
- The scheduled path cannot produce a repair that requires local candidate
  execution. It reports that pull request as manual instead of rebuilding a
  second CI system outside GitHub.
- A later invocation cannot resume a head changed by a prior agent. It reports
  that pre-existing non-native head as manual. This is the cost of removing the
  durable processor lineage authority.
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

The agent fails closed on identity drift, base or head drift, auto-merge state,
unknown dependency input, unrelated lockfile changes, validation failure,
missing current-head review, unanswered feedback, or mergeability failure. It
reports `manual` or `blocked` with the exact reason and does not merge.

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
