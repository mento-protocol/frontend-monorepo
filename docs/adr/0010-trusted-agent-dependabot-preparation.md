---
title: Use the ordinary trusted coding agent for Dependabot preparation
status: active
owner: eng
canonical: true
last_verified: 2026-09-09
scope: dependency-maintenance
date: 2026-09-07
supersedes:
  - "0009"
---

# ADR 0010 — Ordinary trusted-agent Dependabot preparation

## Status

Accepted and rolled out. The package, policy and skill merged on 2026-09-10;
the operator enabled the scheduled job on 2026-09-11, so its first live run is
the supervised acceptance run. Reports go to `#engineering`.

## Context

The operator already delegates ordinary issue and PR repair to OpenClaw with
repository command execution and GitHub access. The sealed no-exec Dependabot
launcher introduced a stricter trust model than that accepted baseline. Repeated
launcher and policy repairs did not deliver a prepared PR. Manual-hygiene lanes
could research and respond but could not fix the code needed for readiness.

The incremental risks of scheduling are unattended execution and repetition.
They justify explicit scope, bounded work, a single active batch, recovery from
live state and visible progress, not another bespoke execution platform.

## Decision

Use one ordinary OpenClaw agent job and the checked-in preparation prompt,
canonical playbook and v3 policy. That v3 binding is superseded, not deleted:
the claim-based refinement below makes `dependabot-prep-policy:v4` the active
policy, and `trusted-agent-v2` refuses v3. Permit normal coding and local validation for
dependency-related repairs. Keep credentials in their existing provider/config
paths; never print or copy them into artifacts. The worker may technically access
more than its task permits: forbidden actions are procedural instructions, not
enforced least privilege. Candidate execution on the host has the same exposure
as interactive coding; a separate worktree is not a sandbox.

Keep merge, approval, closing, auto-merge, thread-state, and security/validation
weakening prohibited. Sensitive automation changes require a decision. Preserve
secretless Dependabot CI and existing production credential boundaries.
Readiness binds final head/base, required CI, CodeRabbit findings and researched
risks. Human approval, answered-thread resolution and merge remain explicit.

Do not use or expand the legacy launcher, receipt schema, runtime adapters or
manual-hygiene lanes. Preserve installed tooling for diagnosis. Ship the policy
through normal review; do not let an agent adopt unmerged candidate instructions
as its standing preparation authority.

### Operational refinement — 2026-09-08

The first completed batch prepared three of twelve PRs, but mixed genuine
permission boundaries with unfinished migration work under "needs decision".
Frequent Slack process updates obscured the outcome, and a local report path
did not deliver the report. Default to agent-owned reversible decisions with
consequential choices, evidence, alternatives and confidence visible in a
maintained PR comment. Invite input without pausing safe work. Explicit holds,
forbidden actions and unproven readiness gates still apply. Deliver a readable
final report; send only start and actionable exceptions beforehand.

Host OOM and stripped concurrency environment variables demonstrated that
procedural limits need runtime verification: serialize heavy tasks and hook
children inside capped sibling systemd scopes. This is resource containment,
not a revival of the retired credential/isolation platform. Preserve normal
checks and hooks. Keep the repository playbook authoritative rather than loading
the conflicting generic sealed skill as a second execution procedure.

### Portable skill refinement — 2026-09-08

Share the trusted-agent preparation procedure through `dependabot-prep` revision
`trusted-agent-v1` across OpenClaw, Codex and Claude. This playbook remains the
repository-specific policy override, not a competing sealed procedure. Preserve
the v3 execution-model identifier for compatibility and add an explicit workflow
binding. Keep the cron prompt thin: skill, repository, policy guard, host profile,
budget and delivery. Giskard retains enforced resource caps; Mac sessions serialize
work and report their unenforced memory-containment residual. No new credential
isolation is claimed. Roll out the skill first, then merged repository policy,
then refresh the job's stored prompt from `scripts/prompts/dependabot-weekly.md`
before enabling it; never fall back to the old skill or start a batch as part of
rollout. The first scheduled run is the acceptance evidence.

The earlier generic-skill exclusion above describes the former sealed entry;
it does not exclude this portable successor. No legacy pins are rotated.

All frontend preparation writers acquire the existing giskard batch directory,
including interactive hosts through an operator-configured authenticated, encrypted connection.
Local locks and Git leases alone cannot serialize comments or distinct PRs. Reuse
the existing coordinator rather than add a lock service; if it is unreachable,
other hosts stay read-only. This trades offline preparation availability for the
existing one-batch invariant. The scheduled entry is giskard-only; interactive
hosts invoke the portable skill directly with this repository override.

### Claim-based coordination refinement — 2026-09-09

The giskard batch directory above serialized every frontend preparation writer
through one host. A writer without an authenticated connection to that host could
prepare nothing, the mechanism is unverified for cloud coding sessions, and it
also serialized unrelated pull requests against each other.

Replace the repository-wide batch lock with a per-pull-request lease held in a
custom Git ref, `refs/mento-claims/v1/pr/<number>`, moved by GraphQL `updateRefs`
compare-and-swap. The state machine and payload format are unchanged from
monitoring-monorepo ADR 0082. The lease fields — `expiresAt`, `ownerRunId`,
`ownerHost`, `ownerRuntime`, `ownerLogin` — are opt-in LOCK payload fields, and
the current LOCK object id is the fencing token. A `guard` subcommand proves that
token immediately before a branch push or a review request, renews the lease for
the guarded child's lifetime, and stops the child when the claim is lost. The
claim CLI ships as `@mento-protocol/issues`, pinned by exact version in the
policy and run through `pnpm dlx`, so this repository adds no dependency.

The one-batch invariant recorded above is superseded, not deleted. Different
hosts now prepare different pull requests concurrently, while one pull request
stays exclusive through the ref compare-and-swap. Claim refs accumulate one per
prepared pull request and an operator prunes them; the tool deletes nothing.
Cloud coding sessions stay refused through `allowCloudWriters: false` until a
live probe settles whether their GitHub proxy injects an identity.

Comment serialization is now advisory, which the superseded rationale above
treated as a reason for the batch lock. `requiredBefore` covers branch pushes and
review requests only. Summary comments and inline replies check the claim without
blocking on it, and one summary comment per author login per PR prevents
duplicates.

The shared skill revision moves to `trusted-agent-v2` and the policy schema to
`dependabot-prep-policy:v4`. The `trusted-agent-v1` binding recorded above is
superseded, not deleted: a v1 skill refuses a v4 policy and a v2 skill refuses a
v3 policy, so hosts and policy move in opposite orders on rollout and rollback.

Evidence, verified: the capability probe ref `refs/mento-claims/v1/probe` at
commit `99291e8cb6b4f50ba8910ad40c9a904db56f224f` in repository `R_kgDOObNo8w`,
created by `updateRefs` from the zero object id with `force:false` on
2026-09-09, and confirmed there to refuse a second identical compare-and-swap.
The ref stays in place as the first audit artifact.

Evidence, verified: the live rehearsal on the closed PR #872 on 2026-09-09,
run with the package checkout's binary against this policy and a two-minute
rehearsal lease. The chain on `refs/mento-claims/v1/pr/872` records bootstrap
UNLOCK `5315e664`, acquire `ec905e78`, renew `81f41e3b`, release `87fbe0d7`,
acquire `a163e0ba`, takeover `7b526031` after expiry plus grace, renew
`164628bf` from a fresh process, and release `ff5d88d3`. A second run was
refused while the lease was live, a supplied run id was rejected, the
superseded token failed verify, guard and release with exit 13, and the label
followed the ref in both directions. No comment, commit, review request or
workflow run was created on the PR.

Pending review, and not yet merged: the claims package
([mento-protocol/agents#1](https://github.com/mento-protocol/agents/pull/1)),
the portable skill at revision `trusted-agent-v2` (chapati23/agent-skills#19,
a private repository),
and this repository's `dependabot-prep-policy:v4`
([#948](https://github.com/mento-protocol/frontend-monorepo/pull/948)). The
drop-in adoption in monitoring-monorepo is tracked in
[mento-protocol/monitoring-monorepo#2343](https://github.com/mento-protocol/monitoring-monorepo/issues/2343).

## Alternatives considered

- Continue the sealed launcher: stronger credential separation, but substantial
  operational complexity and restrictions on ordinary repair work.
- Build a new disposable executor and narrow controller: potentially useful for
  all coding agents, but not a prerequisite uniquely imposed on this workflow.
- Keep purely manual initiation: useful for rehearsal, but misses the requested
  weekly maintenance cadence.

## Consequences

Scope and safety depend on agent compliance like existing interactive work.
Prompt injection and malicious dependency execution remain accepted exposure,
not risks eliminated by this change. Stop and reconsider after any forbidden
action, credential exposure, repeated duplicate mutation, or persistent failure
to produce genuinely prepared PRs. The operator owns that decision.

Measure actual prepared PRs, remaining blockers and time spent, not launcher
exit codes. Rollback disables the job and preserves evidence; it does not
automatically re-enable the retired system. Box-wide isolation can be proposed
separately when its benefit justifies maintenance cost.

## Evidence

- [Preparation playbook](../dependabot-automation.md)
- [Previous design](0009-external-agent-dependabot-preparation.md)
- [Cutover tracking](https://github.com/mento-protocol/frontend-monorepo/issues/893)
- [Manual-hygiene implementation](https://github.com/mento-protocol/frontend-monorepo/pull/920)
