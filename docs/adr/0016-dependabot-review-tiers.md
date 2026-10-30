---
title: Only human-tier Dependabot PRs need a maintainer approval
status: active
owner: eng
canonical: true
last_verified: 2026-10-30
scope: dependency-maintenance
date: 2026-10-30
supersedes_in_part:
  - "0015"
---

# ADR 0016: Only human-tier Dependabot PRs need a maintainer approval

## Status

Accepted on 2026-10-30. This supersedes the rules in [ADR 0015](0015-dependabot-agent-merges-at-all-clear.md) that every Dependabot merge needs a human approval and never uses `--admin`. The rest of ADR 0015 stands.

## Context

Every Dependabot PR needs one approval, last-push approval is on and required checks are strict. Each merge puts the other PRs behind `main`, and updating them cancels their approval, so a batch of routine updates takes a maintainer one approval per PR, one at a time. Most of those PRs are development tooling or patch and minor upgrades that a maintainer does not need to read.

## Decision

- The shared `dependabot-prep` skill classifies every Dependabot PR in `references/review-tiers.md`.
- A human-tier PR still needs a maintainer approval: a major upgrade of a production dependency, a research red flag, or a hold.
- An automatic-tier PR is everything else. The agent merges it without a human approval, through the `h4rdn` review bypass on the `main` ruleset.
- The bypass waives only the human approval. Every other ALL CLEAR gate stays. The agent never uses it for a direct push, force push or deletion.
- While the bypass also covers required checks, GitHub does not enforce them on an `--admin` merge. The agent proves from fresh reads that each required check succeeded on the exact head from the expected producer and that the head contains current `main`, and it stops otherwise.

## Consequences

- A maintainer only sees Dependabot PRs that need a decision.
- A bypass applies to any PR, not only to Dependabot's. Only the agent's own rules limit it to automatic-tier Dependabot PRs.
- To revert, remove the bypass from the ruleset and restore the previous wording in `AGENTS.md` and `CLAUDE.md`.
