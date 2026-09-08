---
title: Use the ordinary trusted coding agent for Dependabot preparation
status: active
owner: eng
canonical: true
last_verified: 2026-09-08
scope: dependency-maintenance
date: 2026-09-07
supersedes:
  - "0009"
---

# ADR 0010 — Ordinary trusted-agent Dependabot preparation

## Status

Accepted for implementation; scheduled activation still requires a successful
supervised run and separate operator confirmation.

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
canonical playbook and v3 policy. Permit normal coding and local validation for
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
