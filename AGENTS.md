# Mento Frontend Monorepo Instructions

Read `CLAUDE.md` for repo-local frontend conventions and commands.

## Pull request state

Always create pull requests as normal, ready-for-review PRs directly. Never
create a draft PR, never pass `--draft`, and never use a draft as a temporary
staging state. Draft PRs suppress automated AI reviews.

After creating or locating a PR, verify `isDraft: false`. If a pre-existing PR
is unexpectedly draft, run `gh pr ready <number>` immediately before requesting
reviews or starting the babysit loop.

For any protocol-level question that crosses beyond this frontend repo, first
read the private `mento-master-context` router when the checkout is available:

```text
../mento-master-context/.agents/mento-context/README.md
```

This applies before broad repo searches or drafting copy about contracts,
deployments, addresses, ABIs, live on-chain state, stable supply, reserve data,
monitoring/data semantics, docs, the whitepaper, business model, or legal/risk
framing. Load only the relevant master-context card(s), then return to this repo
for frontend implementation details. It is a router, not live truth; verify
current values through the source-specific repo, API, RPC, or frontend path it
points to. When answering, mention which master-context card you used or state
that the checkout was unavailable.

## Quality budgets and CI failure issues

Run `pnpm quality:budgets:test` for the zero-network structural/unit checks and
`pnpm quality:coverage` for the four tested workspace coverage floors. After a
production `pnpm build`, run `pnpm quality:bundle:check`; the canonical full
gate is `pnpm quality:budgets`. Exact baselines, thresholds, bundle limits, and
the update procedure live in `docs/quality-budgets.md`.

`.github/workflows/ci-failure-notifier.yml` owns one managed issue per monitored
workflow, operational trigger, and target ref for default-branch, scheduled, and
release-tag failures, then closes it only after recovery in that same partition.
`Visual Regression` filters default-branch pushes to visual-impact paths and
runs both surfaces whenever it starts, making workflow success valid recovery
evidence; pull requests remain path-gated per surface.
When adding or renaming an operational workflow, update its static allowlist and
the structural test in the same PR. Never execute a triggering head SHA from
this privileged `workflow_run` workflow.

## Pull request descriptions

Every non-draft, non-Dependabot pull request body must start with the exact
top-level headings `## The Problem` then `## The Solution` as its first two H2
sections. Only HTML comments may appear before `## The Problem`. Validate the
current PR with
`gh pr view --json body --jq .body | pnpm pr:description:check`; run the
validator tests with `pnpm pr:description:test`. The `PR description format`
job is designed to be a required status and therefore must keep running without
path filters.
