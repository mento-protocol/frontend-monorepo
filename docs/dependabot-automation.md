---
title: Dependabot preparation operations
status: active
owner: eng
canonical: true
last_verified: 2026-09-18
---

# Dependabot preparation

## Who owns the workflow

The shared `dependabot-prep` skill, revision `trusted-agent-v2`, owns the
preparation workflow. It is published in
[mento-protocol/agents](https://github.com/mento-protocol/agents) and supplies
the admission rules, agent decisions, bounded loop, publication fences, research
requirements and handoff verdicts. This repository carries no preparation policy
file, so the skill's Mento defaults apply unchanged. This note records the
repository facts the skill cannot know: the claim continuity, the host caps, the
schedule and the rollback.

Preparation runs in an ordinary trusted OpenClaw, Codex or Claude coding
session, with the same host, model, package execution and GitHub credential
exposure as interactive coding. Scope and forbidden actions are instructions,
not an enforced credential sandbox, and a separate worktree is not isolation.
Use existing GitHub authentication; never copy production secrets into a
checkout.

Read AGENTS.md, CLAUDE.md and this note from the live `main` branch before
writes. [ADR 0012](adr/0012-dependabot-prep-policy-moves-to-shared-skill.md)
records why the repository policy file and its claim wrapper were retired;
[ADR 0010](adr/0010-trusted-agent-dependabot-preparation.md) records the
trusted-agent decision they came from.

## Claims

Writers coordinate per pull request. The mutex is one Git ref,
`refs/mento-claims/v1/pr/<number>`, moved by compare-and-swap, so different
hosts prepare different PRs at the same time. The namespace is unchanged from
the retired policy, so claim refs taken under it stay valid and a later takeover
finds them. The lease runs 30 minutes, renews after 10 and keeps 10 minutes of
grace.

`skills/dependabot-prep/references/mento-defaults.md` in
[mento-protocol/agents](https://github.com/mento-protocol/agents) defines that
claim document, its pinned runner, and the placement that keeps both outside
every checkout.

The `dependabot-prep:claimed` label projection is retired: the default document
sets `label: null`, so a run applies no label and a release removes none.
Labelled pull requests therefore do not drain on their own. None carry the label
today, and an org-wide search returns none, so an operator can delete the label
definition now.

## Host memory safety

On giskard, allow one heavy process tree at a time, including installs, hooks,
tests, builds and browsers. Run it in a separate systemd user scope outside the
gateway with `MemoryHigh=2G`, `MemoryMax=3G`, `MemorySwapMax=0` and
`CPUQuota=100%`, and verify the live properties first. Use explicit
Turbo `--concurrency=1` and Vitest min/max workers 1; Trunk strips
`TURBO_CONCURRENCY`, so an environment assignment is not proof. Other hosts
keep one heavy tree and explicit worker limits, with memory monitoring rather
than cgroup enforcement. Never raise caps or bypass hooks to finish a run.

## Budget and review

This repository's batch budget is six hours including waits, 45 active repair
minutes per pull request and three attempts, cumulative across resume. The
skill's default is one hour and 30 active repair minutes, so an interactive run
has to be given these numbers; nothing in a checkout supplies them.

The technical reviewer is `coderabbitai[bot]`, GitHub user id `136622811`.
Request it with the exact `@coderabbitai review` comment, at most once per exact
head, and only when no qualifying review or pending request already exists.
Acknowledgements are not reviews, and readiness binds the review to the final
head.

## Schedule and activation

Existing job `1b1cad5e-fa4e-48b3-a1f0-10bca3628175`, agent `coding`, Monday
`15 10 * * 1` UTC, stagger zero. The job's `delivery.to` and `failureAlert.to`
are the `#dependabot` channel (`C0C1W20C536`), the destination the prompt names;
when the prompt's destination changes, change the job's delivery setting in the
same edit. The job's stored prompt must match
[`scripts/prompts/dependabot-weekly.md`](../scripts/prompts/dependabot-weekly.md)
on `main` byte for byte, with one exception: OpenClaw stores `payload.message`
without the file's final newline. Treat any other difference as a stale copy,
and verify after every refresh and before enabling. Use an ordinary `agentTurn`
with an isolated session and a seven-hour timeout, the six-hour budget plus
reporting margin. Enabling or disabling the job is an operator decision.

For interactive preparation on a Mac or another approved host, invoke
`dependabot-prep mento-protocol/frontend-monorepo all --write` directly rather
than copying the scheduled prompt; its report goes to the invoking session.

To run the job once outside its schedule, for example as a manual pilot:

```sh
openclaw cron run 1b1cad5e-fa4e-48b3-a1f0-10bca3628175
```

It returns before the batch completes, so check the existing session and the
live per-PR claims before running it again.

## Rollback and claim-ref retention

Rolling the policy back is a reviewed pull request that restores
`.github/dependabot-prep-policy.json`, `scripts/dependabot-claim.mjs` and the
references that pinned them from git history, as one revert. See ADR 0012.

Claim refs accumulate one per prepared pull request, and an operator prunes them
quarterly outside the tool. `delete-claim-refs` is a forbidden action, so a
preparation run never issues the mutation below. List the claims with the pinned
runner, from a directory outside every checkout, against the copied document:

```sh
claims_cwd="<an absolute directory outside every clone>"
doc="<the copied default claim document>"
mento_issues=(pnpm --dir "$claims_cwd" --config.ignore-scripts=true \
  --package=@mento-protocol/issues@0.2.0 dlx mento-issues)
"${mento_issues[@]}" claims list --json --config "$doc"
```

Delete only refs at UNLOCK whose PR is closed and whose `completedAt` is older
than 90 days. Substituting a LOCK object id for `<currentUnlockOid>` destroys
the mutex of a pull request another host is preparing, because the
compare-and-swap then succeeds. This repository's `<repositoryId>` is
`R_kgDOObNo8w`. Only an eligible UNLOCK ref for a closed pull request is an
inert audit artifact an operator can prune; a LOCK ref is live coordination
state.

```sh
gh api graphql -f query='mutation($r:ID!,$n:GitRefname!,$b:GitObjectID!){updateRefs(input:{repositoryId:$r,refUpdates:[{name:$n,beforeOid:$b,afterOid:"0000000000000000000000000000000000000000",force:false}]}){clientMutationId}}' -f r=<repositoryId> -f n=<ref> -f b=<currentUnlockOid>
```

The tool itself deletes nothing.
