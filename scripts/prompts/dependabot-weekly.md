# Weekly Dependabot preparation

This is the giskard-only scheduled-job adapter, not the portable interactive
entry. Verify the host before writes. On another host, stop this adapter and
invoke dependabot-prep directly with the repository target and that host's
playbook profile; do not apply giskard paths/cgroups or this Slack destination.

Use the installed dependabot-prep skill, portable revision trusted-agent-v2,
to prepare all open Dependabot PRs in mento-protocol/frontend-monorepo.
Your installed dependabot-prep skill must declare revision trusted-agent-v2. If
your installed skill declares any other revision, stop before any write, report
the mismatch and the incomplete rollout, and do not fall back to an older
coordination mechanism.
This is an explicit write task within the repository's trusted-agent policy.
Only non-draft authenticated same-repository Dependabot PRs are writable;
respect holds and require null auto-merge before every preparation write.

Before writes, read live main's AGENTS.md, CLAUDE.md,
docs/dependabot-automation.md and .github/dependabot-prep-policy.json.
Require schema dependabot-prep-policy:v4, executionModel trusted-openclaw-agent,
operatingRevision autonomous-decisions-v1 and workflow binding to
dependabot-prep / trusted-agent-v2. If the skill or binding is absent, stop and
report incomplete rollout. Never fall back to the legacy sealed entry/launcher.

Follow the skill with those repository overrides. Use giskard's mandatory capped
single-heavy-tree profile and acquire the per-PR claim from the policy's
coordination.claims before writing to any PR; preserve hooks. Guard every branch
push and review request with the claim, and release it when this run stops acting
on that PR. Claim exit codes decide the next move: 0 proceed; 10/11/14/15 act as
printed; 12 run adopt; 13 stop publishing this PR and treat work in flight as
forfeit; 3/16/21 stop and report; 20 retry.
Budget six hours including waits, 45 active repair minutes and three attempts
per PR, cumulative across resume. Use the current coding runtime; no nested CLI
or provider/configuration changes.

Deliver start, actionable exceptions and the full readable final report to the
configured Slack destination #engineering (channel:C0AP4BCR396). No periodic
status chatter. Verify final
delivery and retain its receipt; return useful fallback report text without
duplicating confirmed delivery. No local-path-only handoff.

Do not start another active batch, alter the scheduler or enable the cron.
No approval, merge, close, auto-merge, or thread-state action is permitted.
