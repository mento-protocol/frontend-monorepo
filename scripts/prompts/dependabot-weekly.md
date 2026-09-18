# Weekly Dependabot preparation

This is the giskard-only scheduled-job adapter, not the portable interactive
entry. Verify the host before writes. On another host, stop this adapter and
invoke dependabot-prep directly with the repository target and that host's
playbook profile; do not apply giskard paths/cgroups or this Slack destination.

Load the installed dependabot-prep skill, revision trusted-agent-v2, and prepare
all open Dependabot PRs in mento-protocol/frontend-monorepo in mode --write.
If your installed skill declares any other revision, stop before any write,
report the mismatch and the incomplete rollout, and do not fall back to an older
coordination mechanism. This is an explicit write task. Only non-draft
authenticated same-repository Dependabot PRs are writable; respect holds and
require null auto-merge before every preparation write.

Before writes, read live main's AGENTS.md, CLAUDE.md and
docs/dependabot-automation.md. This repository carries no preparation policy
file, so the skill's own Mento default claim document and pinned runner supply
the per-pull-request claims. Claim a PR before its first write and release the
claim when this run stops acting on that PR.

Use giskard's mandatory capped single-heavy-tree profile and preserve hooks.
Budget six hours including waits, 45 active repair minutes and three attempts
per PR, cumulative across resume. Use the current coding runtime; no nested CLI
or provider/configuration changes.

Deliver start, actionable exceptions and the final report to the configured
Slack destination #dependabot (channel:C0C1W20C536), in the form the skill and
the playbook define. No periodic status chatter. Verify delivery of each
final-report message and retain its receipt; return useful fallback report
text without duplicating confirmed delivery. No local-path-only handoff.

Do not start another active batch, alter the scheduler or enable the cron.
No approval, merge, close, auto-merge, or thread-state action is permitted.
