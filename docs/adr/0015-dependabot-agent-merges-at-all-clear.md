---
title: The Dependabot preparation agent merges at ALL CLEAR
status: active
owner: eng
canonical: true
last_verified: 2026-10-29
scope: dependency-maintenance
date: 2026-10-29
supersedes_in_part:
  - "0012"
---

# ADR 0015: The Dependabot preparation agent merges at ALL CLEAR

## Status

Accepted on 2026-10-29. This supersedes the "never merge, never resolve threads" sentence of the [ADR 0012](0012-dependabot-prep-policy-moves-to-shared-skill.md) agent guidance. The rest of ADR 0012 stays in force.

## Context

The shared `dependabot-prep` skill (`trusted-agent-v2`) drives a Dependabot PR through ALL CLEAR, an exact-head merge and a verified rollout. This repository's agent guides forbade merging and thread resolution. Prepared PRs therefore waited on a human merge even when every check, review and approval had passed. Frontend #1060, a critical Sentry advisory fix, waited this way. The ruleset requires review-thread resolution, so a PR whose findings were fixed still stayed blocked until a human clicked resolve.

CodeRabbit was already advisory for Dependabot PRs. It skips them for lack of a bot seat, and it can be rate-limited.

## Decision

- The agent merges at ALL CLEAR. ALL CLEAR means, on the exact head:
  - current `main` is merged in;
  - every required check passes;
  - the human approval that the ruleset requires is present;
  - every finding is addressed;
  - there is no hold and no draft state;
  - auto-merge is disabled.
- The merge is an exact-head squash, run under the claim's `merge` gate. It never uses `--admin` or auto-merge.
- After a merge, the agent verifies the affected production Vercel deployments.
- The agent may resolve a review thread only when that thread's findings are proven fixed at the current head. It does so under the claim's `thread-resolve` gate.
- Approval stays human. The agent never approves, dismisses reviews or closes PRs.
- An unavailable CodeRabbit review does not block a PR. Unavailable covers a missing review, a skipped review, a missing bot seat, a stale review, a licensing refusal and a rate limit. Findings that CodeRabbit does post are mandatory, like those from any other reviewer.

## Consequences

- A human approval is now the last step before a merge. The human no longer has to do the merge by hand.
- Repository workflow code still cannot merge Dependabot PRs; `scripts/dependency-policy.test.mjs` enforces this. Only the claim-fenced agent, acting outside the repository, can merge.
- To revert, restore the previous wording in `AGENTS.md` and `CLAUDE.md`.
