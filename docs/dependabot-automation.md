---
title: Dependabot preparation with external agents
status: active
owner: eng
canonical: true
last_verified: 2026-09-01
scope: dependency-maintenance
---

# Dependabot preparation

An external agent prepares native Dependabot pull requests for a maintainer
decision. It reviews the update, synchronizes the branch with `main`, fixes
update-specific defects, runs the repository gates, completes current-head
review, and reports exact evidence. A maintainer gives the final approval and
performs the squash merge.

## Schedule and invocation

Dependabot checks both npm and GitHub Actions each Monday at 06:00 UTC. The
external-agent sweep starts each Monday at 10:15 UTC. This delay lets Dependabot
create and update the native pull requests before preparation starts.

The current scheduler uses OpenClaw. That is an operator choice, not a
repository contract. A manual run may use Codex, Claude Code, OpenClaw, or any
compatible agent runtime. Ask the runtime to use the installed generic
`dependabot-prep` skill for one pull request or all open Dependabot pull
requests. Use its read-only or dry-run mode when branch mutation is not
authorized.

Version 1 has no event webhook and no standing polling loop. A missed scheduled
run waits for a manual invocation or the next weekly sweep. During one active
preparation run, the agent may monitor checks and review at intervals shorter
than ten minutes.

The generic skill owns only the runtime-neutral preparation sequence. This
runbook owns repository-specific classification, security boundaries, commands,
and handoff requirements. Do not copy Mento-specific policy into the generic
skill. Do not add runtime-specific prompts, credentials, or state to this
repository contract.

## Authority boundary

The agent may:

- discover and inspect open Dependabot pull requests;
- create one isolated worktree per pull request;
- merge the current `main` commit into the existing Dependabot branch;
- resolve conflicts and fix defects caused by the dependency update;
- update coupled manifests, lockfiles, policy data, tests, and documentation;
- run local validation;
- push to the verified existing Dependabot ref with an explicit refspec;
- request the configured review bot for the exact pushed head;
- reply to every review comment and resolve eligible answered threads; and
- monitor checks and report exact-head readiness evidence.

The agent must not:

- approve the pull request or submit any review as an approver;
- dismiss a review;
- enable, disable, or otherwise change auto-merge;
- merge, close, or enqueue the pull request;
- rebase or force-push;
- combine update branches or move one pull request to another ref;
- broaden workflow permissions, secret access, cache access, or preview trust;
  or
- claim authority beyond the current head and base evidence.

Preparation does not require human approval. Human approval is the final
boundary after preparation. It must apply to the latest pushed head.

## Candidate identity

Do not trust a label, branch name, or pull-request title by itself. Before any
local mutation, verify all of these live values:

- repository `mento-protocol/frontend-monorepo`;
- open pull request with base ref `main`;
- author login `dependabot[bot]`, numeric ID `49699333`, and type `Bot`;
- head ref below `dependabot/` in this repository;
- exact live head and base SHAs; and
- `autoMergeRequest: null`.

Repeat the `autoMergeRequest` check immediately before each push, at final
handoff, and before the human merge. Stop if it is not `null`. Do not change it.

Use one isolated worktree per pull request. Family or ecosystem grouping is for
schedule and reporting only. It never authorizes one branch to contain another
pull request's update.

## Repository classification

Classify the complete live diff before mutation. Use one of these outcomes:

- `prepare`: the update can follow this runbook;
- `manual`: a maintainer must review or direct the change before branch
  mutation;
- `blocked`: identity, source, branch, policy, validation, review, or GitHub
  state prevents safe progress; or
- `read-only`: the invocation did not authorize writes.

### npm updates

Review every direct and transitive change. Grouped updates and major updates do
not reduce the review scope. Check release notes, migration guidance, package
source, install or lifecycle scripts, engines, peer dependencies, new registry
packages, removals, and lockfile integrity.

Treat an unknown package, unknown registry source, downgrade, prerelease,
unexpected changed path, unexplained lockfile rewrite, or unrelated dependency
movement as `manual` or `blocked`. Treat wallet, signing, transaction, bridge,
authentication, deployment, credential, and security-policy changes as
`manual` unless a maintainer explicitly directs preparation.

Next.js and Vercel updates may use the coupled protected-runtime procedures in
[`dependency-overrides.md`](dependency-overrides.md). If the agent cannot
complete every coupled edit and validator, classify the pull request as
`manual`. Do not restore the old version only to make a skew check pass.

### GitHub Actions updates

Every third-party Action reference must remain a full lowercase 40-character
commit SHA with its reviewed version comment. Review the upstream comparison,
action metadata, entrypoint, permissions, inputs, outputs, network behavior,
and release provenance.

Classify sensitive or self-reviewing Actions as `manual`. This includes the OSV
scanner and reporter. Their workflow must keep exactly one scanner step and one
reporter step. Both steps must use the same full SHA revision. A non-sensitive
Action update may be prepared only when the live diff contains the expected pin
and fixture changes and the Actions policy tests pass.

### Secretless pull-request boundary

Dependabot pull requests do not receive repository or provider credentials.
Do not broaden this rule during preparation.

`.github/workflows/vercel-preview-intake.yml` is the read-only boundary for
Dependabot preview events. It validates metadata without candidate checkout,
artifact, secret, or write token. Trusted default-branch code revalidates the
exact pull request and publishes the preview-disabled status. Do not route a
Dependabot ref through a credentialed Vercel Preview worker.

Direct pull-request workflows grant repository credentials only when the live
author and sender are same-repository `User` identities. Dependabot remains
outside that grant. Candidate jobs must not persist checkout credentials or use
repository-credential-dependent dependency, Foundry, or Trunk caches.
Pull-request supply-chain scans remain read-only.

## Preparation loop

Run this loop independently for each pull request.

1. **Discover.** Query the live pull request and verify the candidate identity.
   Record the pull-request number, head ref, head SHA, base ref, base SHA,
   author tuple, and `autoMergeRequest` state.
2. **Isolate.** Create a clean worktree for that pull request. Require local
   `HEAD` to equal the recorded live head. Preserve unrelated worktrees,
   branches, stashes, and changes.
3. **Inspect.** Review the full manifest, lockfile, source, workflow, and
   transitive diff. Review upstream release and security information. Select
   `prepare`, `manual`, `blocked`, or `read-only` under the repository policy.
4. **Synchronize.** Fetch the current base SHA and merge it into the pull-request
   branch. Do not rebase. Do not force-push. Resolve conflicts without dropping
   the requested dependency update.
5. **Repair.** Make only update-specific compatibility changes and valid review
   fixes. Update coupled policy fixtures and documentation in the same branch.
   Follow the protected-runtime procedure when its files are in scope.
6. **Validate.** Run `pnpm dependency:policy:test` and every gate selected by
   the changed paths. Use the additional commands below. Inspect the final diff
   and require every changed path to be explained by the update.
7. **Revalidate before push.** Re-read the live pull request. Require the same
   head ref, `autoMergeRequest: null`, and a base SHA equal to the base merged
   locally. If the base moved, return to step 4. Push local `HEAD` only to the
   explicit verified Dependabot ref.
8. **Review.** Re-read the pushed head SHA and require it to equal local `HEAD`.
   Request one new review from the configured CodeRabbit App for that exact
   head. Require the exact `coderabbitai[bot]` login, type `Bot`, and a review
   record whose immutable `commit_id` equals the current head.
9. **Resolve feedback.** Reinspect the full diff. Reply to every review comment.
   Use `Fixed in <commit> — <change>` for a fix. Use
   `Won't fix: <technical reason>` when no change is correct. Resolve a thread
   only after the fix or technical reply. A push restarts current-head
   validation and review.
10. **Handoff.** Re-read the live head, base, `autoMergeRequest`, required
    checks, review decision, all feedback surfaces, thread state, and
    mergeability. Repeat the loop on drift. Stop before approval or merge.

## Validation matrix

Run the narrow commands first. Run every additional gate selected by changed
paths or repository CI.

| Change                                        | Required local validation                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Any Dependabot policy or update               | `pnpm dependency:policy:test`                                                                       |
| GitHub Action pin                             | `pnpm ci:action-pins:test`                                                                          |
| Root catalog or override                      | `pnpm supply-chain:version-skew` and `pnpm supply-chain:lockfile-lint`                              |
| Next.js or Vercel protected runtime           | `pnpm vercel:versions:check`, `pnpm vercel:production-shadow:test`, and `pnpm vercel:workflow:test` |
| Application or shared-package behavior        | Affected type, lint, unit, build, and browser gates from `CLAUDE.md`                                |
| Architecture-significant workflow or boundary | `pnpm adr:check` plus a new ADR when required                                                       |

Use a frozen install to prove the final checked-in lockfiles. Do not normalize
or regenerate unrelated lockfile regions. Do not waive a failing required gate
without explicit maintainer direction for the exact head.

## Handoff record

Report one verdict exactly:

- `prepared for maintainer decision`;
- `manual`;
- `blocked`; or
- `read-only`.

The report must include:

- pull-request number and dependency or Action update;
- risk classification and reason;
- exact final head and base SHAs;
- final `autoMergeRequest` state;
- explained changed-path inventory;
- local validation commands and results;
- required-check results on the exact head;
- exact-head CodeRabbit review identity and commit;
- unresolved comments or threads, if any;
- GitHub review decision and mergeability;
- remaining blocker or risk; and
- the required next human action.

Use `prepared for maintainer decision` only when the exact final head and base
are stable, required checks pass, current-head review is complete, all feedback
is answered and resolved, GitHub reports `MERGEABLE`, and auto-merge is absent.
Human approval may still be absent. Report that as the expected final boundary.

## Human approval and squash merge

Immediately before merge, the maintainer must re-read the live pull request and
verify:

1. the head and base match the preparation handoff;
2. `autoMergeRequest` is still `null`;
3. every required check passes on the exact head;
4. every review comment is answered and every eligible thread is resolved;
5. the current-head CodeRabbit review is present;
6. the required human approval applies after the latest push;
7. ruleset and review state are satisfied; and
8. GitHub still reports the pull request as mergeable.

The maintainer then performs a squash merge. The external agent never performs
this action. After merge, verify the exact merge SHA's default-branch CI and
deployment result under the normal repository release runbook.

## Failure handling

| Condition                                           | Result                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| Identity, ref, base, or author mismatch             | `blocked`; do not mutate                                  |
| `autoMergeRequest` is not `null`                    | `blocked`; do not change it                               |
| Sensitive or self-reviewing Action                  | `manual`; report the review needed                        |
| Unknown package, source, ecosystem, or changed path | `manual` or `blocked`                                     |
| Protected-runtime coupling cannot be completed      | `manual`; do not revert only part of the update           |
| Base moves before push or handoff                   | merge the new base and repeat validation                  |
| Head moves outside the local push                   | discard stale evidence and restart from the live head     |
| Required validation fails                           | fix the update-specific defect or report `blocked`        |
| Current-head review does not complete               | `blocked`; do not substitute an older review              |
| Feedback remains unresolved                         | `blocked`; identify each remaining item                   |
| Scheduled job does not run                          | use a manual invocation or wait for the next Monday sweep |

## References

- [ADR 0009](adr/0009-external-agent-dependabot-preparation.md)
- [Dependency overrides](dependency-overrides.md)
- [Vercel deployments](vercel-deployments.md)
- [Architecture decision checklist](pr-checklists/architecture-decisions.md)
