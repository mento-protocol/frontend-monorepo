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
UTC. An external-agent sweep starts each Monday at 10:15 UTC. The current
scheduler launches the sweep through OpenClaw. This is deployment configuration,
not part of the repository contract.

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

The generic skill owns the reusable sequence:

1. discover live Dependabot pull requests;
2. authenticate exact bot, repository, head ref, head SHA, base, and absence of
   auto-merge;
3. use one isolated worktree per pull request;
4. classify under repository policy;
5. merge the current base without rebase or force-push;
6. inspect, repair, and validate the dependency update;
7. push only to the existing verified ref with an explicit refspec;
8. request and complete current-head review and feedback; and
9. hand off exact head, base, checks, review, feedback, risk, and blockers.

Repository rules take precedence. `AGENTS.md` and
[`docs/dependabot-automation.md`](../dependabot-automation.md) define the Mento
classification, protected-runtime procedure, commands, secret boundaries, and
human handoff.

### Keep preparation separate from merge authority

The external agent may update and push a Dependabot branch. It may request
review, reply to review comments, and resolve eligible answered threads. It
must not approve, dismiss a review, change auto-merge, merge, close, or enqueue
the pull request.

The agent requires live `autoMergeRequest: null` before any branch mutation,
immediately before each push, and at handoff. It merges the current base into
the branch. It never rebases or force-pushes. Any push invalidates prior
current-head check and review evidence.

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

Non-sensitive npm and Actions updates can be prepared when the agent completes
the repository checks and exact-head review. Grouped updates and major updates
receive full diff and release review; grouping never reduces scope.

### Rotate protected runtime dependencies through repository procedures

Next.js and Vercel CLI updates can change both the ordinary workspace and the
standalone Vercel deployment runtime. The external agent or a maintainer must
rotate all coupled manifests, overrides, lockfiles, and contract digests in one
pull request. It must use the existing independent validators documented in
[`docs/dependency-overrides.md`](../dependency-overrides.md).

If the complete rotation cannot be reproduced and validated, the result is
`manual`. The agent must not restore the old workspace version only to satisfy
a skew check.

### Preserve secretless pull-request boundaries

Native Dependabot pull requests remain outside every same-repository `User`
credential grant. Candidate jobs receive no repository or provider secret and
do not persist checkout credentials. The read-only Vercel preview intake still
authenticates the exact Dependabot event before trusted default-branch code
publishes a preview-disabled status. The external-agent design does not widen
preview, deployment, cache, package, environment, or workflow authority.

### Remove repository-hosted preparation machinery

Retire the repository workflows, scripts, tests, commands, evidence artifacts,
dedicated GitHub App configuration, and model credentials that existed only for
repository-hosted Dependabot preparation. Keep native Dependabot configuration,
normal pull-request CI and review, the secretless Vercel preview intake, and the
repository validators used by external or manual preparation.

This decision supersedes ADRs 0006, 0007, and 0008. Those ADRs remain archived
as historical records.

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
  Dependabot refs, reply to comments, and resolve threads. It receives no
  approval or merge authority.
- The preparation logic becomes reusable from Codex, Claude Code, OpenClaw,
  and other compatible runtimes and across JavaScript repositories.
- Repository policy becomes smaller and easier to audit. Mento-specific risk,
  validation, protected-runtime, and secretless-preview rules remain explicit.
- Exact-head checks and review remain necessary. Agent evidence is a current
  snapshot and does not replace the maintainer's final GitHub revalidation.

## Failure handling

The agent fails closed on identity drift, base or head drift, auto-merge state,
unknown dependency input, unrelated lockfile changes, validation failure,
missing current-head review, unresolved feedback, or mergeability failure. It
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
