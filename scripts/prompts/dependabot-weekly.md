# Weekly Dependabot preparation

Use the installed dependabot-prep skill, portable revision trusted-agent-v1,
to prepare all open Dependabot PRs in mento-protocol/frontend-monorepo.
This is an explicit write task within the repository's trusted-agent policy.
Only non-draft authenticated same-repository Dependabot PRs are writable;
respect holds and require null auto-merge before every preparation write.

Before writes, read live main's AGENTS.md, CLAUDE.md,
docs/dependabot-automation.md and .github/dependabot-prep-policy.json.
Require schema dependabot-prep-policy:v3, executionModel trusted-openclaw-agent,
operatingRevision autonomous-decisions-v1 and workflow binding to
dependabot-prep / trusted-agent-v1. If the skill or binding is absent, stop and
report incomplete rollout. Never fall back to the legacy sealed entry/launcher.

Follow the skill with those repository overrides. Use giskard's existing shared
batch lock and mandatory capped single-heavy-tree profile; preserve hooks.
Budget six hours including waits, 45 active repair minutes and three attempts
per PR, cumulative across resume. Use the current coding runtime; no nested CLI
or provider/configuration changes.

Deliver start, actionable exceptions and the full readable final report to the
configured Slack destination U06S6HCHV9C. No periodic status chatter. Verify final
delivery and retain its receipt; return useful fallback report text without
duplicating confirmed delivery. No local-path-only handoff.

Do not start another active batch, alter the scheduler or enable the cron.
No approval, merge, close, auto-merge, or thread-state action is permitted.
