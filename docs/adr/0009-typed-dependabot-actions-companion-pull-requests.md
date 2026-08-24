---
title: Typed companion pull requests carry supported sensitive Dependabot Actions updates
status: active
owner: eng
canonical: true
last_verified: 2026-08-24
scope: ci/dependabot-actions-companion
date: 2026-08-24
---

# ADR 0009 — Typed companion pull requests carry supported sensitive Dependabot Actions updates

**Status:** Accepted
**Scope:** ci/dependabot-actions-companion

## Context

ADR 0006 keeps sensitive GitHub Actions updates in manual review. It also
forbids automatic repair of `.github/workflows/**`. These controls are correct,
but they leave a deterministic gap. A native Dependabot pull request can update
an action SHA while a trusted repository test mirrors the old SHA. Dependabot
cannot edit that test in the same generated update.

PR #840 exposed this gap for the internal OSV scanner and reporter actions. Its
workflow edit contained only two full-SHA replacements. The required companion
change was two matching replacements in
`scripts/dependabot-workflows.test.mjs`. The processor correctly classified the
source PR as `manual-review`, but it could not prepare a reviewable combined
change.

The normal `GITHUB_TOKEN` cannot create or update a branch that changes a file
in `.github/workflows`. A GitHub App needs both Contents and Workflows write
permissions for that operation. Giving one job branch-write, PR-write,
approval, and readiness authority would cross the capability boundaries in ADR 0006.

## Decision

The processor can create a separate, ready-for-review companion pull request
for one typed adapter: the internal OSV scanner and reporter pair. This path
does not change the source Dependabot branch or its authority state.

The typed planner accepts a source only when all of these conditions hold:

1. The source is one open, non-draft, same-repository native Dependabot PR.
2. The exact verified Dependabot commit has current `main` as its only parent.
3. The dependency group is `github-actions-manual`.
4. The dependencies are exactly the internal OSV scanner and reporter actions.
5. The PR modifies only `.github/workflows/_osv-scanner-readonly.yml`.
6. The semantic change contains only two full 40-character SHA replacements.
7. Both actions move from the same old SHA to the same new SHA.
8. The source has no veto label, processor approval, or native auto-merge.
9. A complete exact-base census finds the old SHA only in the source workflow
   and the test mirror, with two occurrences in each file.
10. The test mirror accepts exactly one replacement for each action.

The planner emits a canonical plan. It binds the source PR, source head, current
base commit and tree, old and new action SHAs, two result blobs, deterministic
branch, commit message, PR title/body, tree digest, reference-audit digest, and
plan digest.

The live receipts bind two run identities. They bind the current Processor
orchestration run and the authenticated Processor check run that supplied the
actionable manual result. A reused check must come from a completed run at the
same trusted workflow SHA. The workflow materializes the companion helper,
live adapter, Processor, and Processor receipt dependency from that exact SHA.
The live adapter reuses the Processor's complete feedback collector and gate.
It binds the stable feedback, pull-request update token, labels, and human event
evidence into the census and stage receipts.

The workflow separates branch staging from PR creation:

- The staging job receives a short-lived Prepare App token downscoped to
  `contents: write` and `workflows: write`. It has no PR-write, check-write,
  approval, ALL CLEAR, or merge authority. It creates one new deterministic
  branch. Immediately before it creates the ref, it recollects all feedback and
  requires the bound feedback evidence to remain unchanged and clear. It never
  updates or force-pushes an existing ref.
- The opening job receives a separate short-lived Prepare App token downscoped
  to `pull-requests: write`. It has no Contents or Workflows write permission.
  It re-collects the live source and base, recomputes the plan, validates the
  staged commit, tree, and blobs, recollects the same complete feedback
  evidence immediately before the write, rejects mismatched or duplicate
  companions, and opens a non-draft PR. Any veto, unresolved thread, human
  event, label, or update-token drift fails before the write. An exact existing
  open PR converges without a duplicate write. An exact merged or
  closed-unmerged PR returns a bounded terminal result. Terminal convergence
  authenticates the exact Prepare App PR creator. It reconstructs the
  historical source/base plan from immutable commits and verifies the exact
  companion commit, parent, tree, and result blobs. It does not depend on a
  surviving companion branch ref or mutable current-base state.
- After exact PR confirmation, the opening job publishes one redacted
  observational artifact. It binds the source, companion, workflow, Processor,
  plan, and SHA-256 hashes of the exact canonical census, stage, and open
  receipt bytes. It does not publish the raw receipts or grant authority.

Install the Prepare App with Contents, Pull requests, and Workflows write
permissions. Each token request still receives only the permissions required
by its job. Existing Refresh and Repair jobs do not request Workflows write.

The companion PR enters the normal human PR path. This workflow never approves,
publishes ALL CLEAR for, enables auto-merge on, merges, or closes either PR.
Human review and human merge remain mandatory. Other sensitive Actions need a
separate typed adapter before they can use this path.

## Alternatives considered

### Let autonomous repair edit every workflow and fixture

Rejected. Candidate-controlled workflow edits can change the next trusted
execution boundary. A generic model or patch loop must not receive that
authority.

### Add the test change to the Dependabot source branch

Rejected. The source branch is protected provenance. Mutating it would replace
the native one-commit evidence and weaken the separation between Dependabot
generation and maintainer-authored compatibility work.

### Give one App token all required permissions

Rejected. A job that can write workflow files and open or approve a PR would
combine unrelated capabilities. Separate downscoped tokens keep staging and PR
authority distinct.

### Use the normal workflow token to create the branch

Rejected. GitHub does not grant `GITHUB_TOKEN` the Workflows permission needed
to create a ref whose tree changes `.github/workflows`.

## Consequences

- A future update with the exact PR #840 shape can produce one deterministic
  combined companion PR after the native source is current with `main`.
- The Prepare App installation gains Workflows write permission. Only the
  isolated typed staging job requests it.
- A source or base race, unsupported edit, incomplete census, mismatched
  branch or PR, or duplicate PR fails closed. Exact open, merged, and
  closed-unmerged companion states converge without a duplicate write. Moved
  base refs and deleted companion refs do not weaken historical verification.
- The source Dependabot PR remains open and manual. The companion PR identifies
  it and remains human-review and human-merge only.
- The first adapter does not cover Claude, CodeQL, or other sensitive Actions.

## Evidence

- `node --test scripts/dependabot-actions-companion.test.mjs`
- `node --test scripts/dependabot-actions-companion-live.test.mjs`
- `pnpm dependabot:process:test`
- Exact-source fixture from PR #840 head
  `c60c9d3c64cd42119e98051d7860d84a5cc0721d`
