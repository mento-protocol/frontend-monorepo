---
title: Dependabot preparation policy moves into the shared skill
status: active
owner: eng
canonical: true
last_verified: 2026-09-18
scope: dependency-maintenance
date: 2026-09-18
supersedes_in_part:
  - "0010"
---

# ADR 0012 — Dependabot preparation policy moves into the shared skill

## Status

Accepted. This supersedes the policy-file and claim-wrapper parts of
[ADR 0010](0010-trusted-agent-dependabot-preparation.md). The rest of ADR 0010,
the ordinary trusted-agent preparation workflow itself, stays in force.

## Context

`.github/dependabot-prep-policy.json` carried the admission rules, the allowed
and forbidden action lists, the research and handoff contract, the reporting
shape, the host caps and the `coordination.claims` block.
`scripts/dependabot-claim.mjs` read that file out of the default branch's
revision and injected it as `--config` to the pinned claims runner, so a
candidate branch could not choose its own namespace, lease or package pin.

The shared `dependabot-prep` skill now supplies claims for every
`mento-protocol/` repository whose base carries no policy file. It copies its
own default claim document outside every checkout, sets `repository` to the
resolved target, and runs the pinned `@mento-protocol/issues@0.2.0` runner with
`pnpm --dir` from a directory outside every clone. That copy comes from the
installed skill, which is the same trust class as a policy read from the live
base. The skill's own text carries the rules the policy duplicated.

Keeping both meant one contract in two places, drifting on every skill revision,
plus a repository wrapper and its test surface to maintain.

## Decision

Delete `.github/dependabot-prep-policy.json` and `scripts/dependabot-claim.mjs`,
with the `dependabot:claim` script and the tests that asserted their contents.
Let the skill's Mento defaults supply the claim document and the runner.
`docs/dependabot-automation.md` keeps only the repository facts the skill cannot
know: claim continuity, host caps, schedule and rollback.

The claim namespace is unchanged, `refs/mento-claims/v1/pr/<number>`, with the
same 30/10/10/360 lease. Claim refs taken under the policy stay valid, and a
later takeover finds them.

The `dependabot-prep:claimed` label projection is retired. The default document
sets `label: null`, because the ref is the claim and a label is a repository
write outside the preparation grant. A release under `label: null` removes no
label, so labelled pull requests do not drain on their own. None carry the label
today, and an org-wide search returns none, so an operator can delete the label
definition now.

Order matters: this lands after the skill's Mento defaults merge in
mento-protocol/agents and the scheduled host has pulled that skill. A host still
carrying the older skill treats a missing policy file as "no claims", so it
would prepare pull requests with no per-PR mutex at all, and its stored prompt
still names the policy file it can no longer read. Refresh the job's prompt
from `scripts/prompts/dependabot-weekly.md` in the same window.

## Alternatives considered

- Keep the policy file as a thin override. It would still duplicate the schema
  and the pin, and every skill revision would need a matching repository edit.
- Keep the wrapper alone, reading the skill's document. The wrapper's value was
  reading the policy out of the default branch; with no repository policy there
  is nothing left for it to read.
- Retain the label projection. It is a repository write a preparation run should
  not make, and the ref already carries the state the label mirrored.

## Consequences

One contract, in the skill. A skill revision changes the workflow without a
repository pull request. The repository loses its own schema check, and the
skill's revision stop no longer applies either: that stop fires on a policy
naming a `workflow.revision`, and there is no policy. The only check left is the
cron prompt's revision sentence, which catches a skill that declares a different
revision string and nothing else. Rollback is a revert of the pull request that
made this change, which restores both files and every reference that pinned them
from git history.
