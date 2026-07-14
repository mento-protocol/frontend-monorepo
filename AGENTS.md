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

## Pull request descriptions

Every non-draft, non-Dependabot pull request body must start with the exact
top-level headings `## The Problem` then `## The Solution` as its first two H2
sections. Only HTML comments may appear before `## The Problem`. Validate the
current PR with
`gh pr view --json body --jq .body | pnpm pr:description:check`; run the
validator tests with `pnpm pr:description:test`. The `PR description format`
job is designed to be a required status and therefore must keep running without
path filters.
