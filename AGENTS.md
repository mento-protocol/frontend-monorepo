# Mento Frontend Monorepo Instructions

Read `CLAUDE.md` for repo-local frontend conventions and commands.

## Architecture decisions

Architectural decisions live under `docs/adr/`. Use
`docs/pr-checklists/architecture-decisions.md` to decide whether a change needs
one, and run the advisory `pnpm adr:check` reminder before publishing.

## Pull request state

Always create pull requests as normal, ready-for-review PRs directly. Never
create a draft PR, never pass `--draft`, and never use a draft as a temporary
staging state. Draft PRs suppress automated AI reviews.

After creating or locating a PR, verify `isDraft: false`. If a pre-existing PR
is unexpectedly draft, run `gh pr ready <number>` immediately before requesting
reviews or starting the babysit loop.

## Dependabot processing

Use the long-lived processor in `.github/workflows/dependabot-process.yml` for
Dependabot PR decisions. `.github/workflows/dependabot-intake.yml` is a
credentialless event intake; it may expose only bounded PR identity to the
trusted processor through a completed `Dependabot Intake` `workflow_run`. Its
read-only token must not dispatch a privileged workflow. The separate
`dependabot-process` repository-dispatch event is an operator sweep with one
bounded scope field. Do not add a `workflow_dispatch` alternative or execute
candidate code/artifacts in the trusted processor.

Dependabot AI review runs separately in
`.github/workflows/dependabot-claude-review.yml` from the authenticated
`Dependabot Intake` `workflow_run`. A preflight binds the intake receipt to the
live PR and verified Dependabot commit. The read-only Claude job checks out only
the exact `github.workflow_sha`, reads the diff through APIs, and returns bounded
structured findings. A separate no-secret publisher rechecks the PR identity
and owns the exact-head `claude-review` check. No job may check out, cache,
download, install, or execute candidate-controlled input. The human
`pull_request` workflow reports `claude-review-human`.

A malformed dispatch or purported `receipt=true` intake must fail explicitly.
A valid `receipt=false` intake is deliberately skipped; the failure notifier
ignores it and partitions targeted intake failures by PR.

Use
`pnpm dependabot:process -- evaluate --input path/to/snapshot.json --mode observe`
for a network-free plan and run `pnpm dependabot:process:test` after policy,
parser, workflow, or runbook changes.
Modes are `observe`, `assist`, and `merge`; missing or unknown mode is always
`observe`. Bind every result, repair packet, approval, and merge decision to the
current PR head and re-run the complete gate after any push. Attribute failures
to current `main` before proposing a branch repair. Process merges one at a time
and keep the lane occupied until the exact merge SHA has default-branch CI and
release proof.

Automatic merge has a separate credential boundary. Configure the repository-
scoped merge GitHub App through the Actions variable
`DEPENDABOT_PROCESSOR_MERGE_APP_CLIENT_ID` and Actions secret
`DEPENDABOT_PROCESSOR_MERGE_APP_PRIVATE_KEY`. Its short-lived installation token
may have only `contents: write` and `pull-requests: write`; grant it no Actions,
workflow, or deployment permission. The normal workflow `GITHUB_TOKEN` remains
responsible for reads, check publication, and exact-head approval and must not
perform the merge. The App must author the merge so the resulting `main` push
starts default-branch `CI/CD` and Vercel post-merge proof. Missing App
configuration fails `merge` mode closed while `observe` and `assist` remain
usable. Keep this merge App separate from the future repair App; the live repair
path remains disabled.

A provider-backed failure with a passing baseline is `non-deterministic`; a
missing or pending baseline is `unknown`. Either suppresses the entire repair
packet, including mixed deterministic failures. The processor does not rerun
checks: wait for or rerun trusted exact-head/baseline evidence, then process the
PR again. `waiting-retry` applies only after identity, feedback/veto, and risk
tier precedence.

Live processing brackets files, commits, checks, and immutable commit metadata
with stable PR and feedback reads. The feedback gate collects all bounded
thread/reply, review, issue-comment, and timeline pages; hashes bodies in output;
and fails closed on unknown bots, malformed data, malformed thread commit SHAs
or envelopes, or collection caps. An unresolved actionable thread blocks even
when it belongs to an older head. A resolved current-head thread requires the
exact `Fixed in <current-head prefix> — <change>` or `Won't fix: <reason>`
reply; a resolved older-head thread does not need another current-head reply.
Agents must still reply to every PR review comment, including comments they do
not fix. Human close or reopen events remain durable vetoes. Any observed
`head_ref_force_pushed` issue event permanently removes automatic merge and
repair-packet authority for that PR generation. Continue manually or recreate
the PR; never let rewritten lineage reset the two-attempt budget. A comment can
still land after the final read and immediately before mutation; never claim
that the gate eliminates this residual race.

Manual/veto policy and human actions may only remove authority. Repair packets
require valid structural identity, complete clear feedback, a current base, a
complete current-head gate with no missing or pending evidence, a deterministic
branch-attributed failure, and valid attempt lineage. Reprocessing the same
head reuses its packet receipt; only a strict append-only successor consumes
the prior attempt, and the limit is two. A human-applied repair may remain
eligible for a second proposal but never regains automatic merge authority.
The live repair/re-review/push path remains disabled until a dedicated,
allowlisted, repository-scoped repair GitHub App is provisioned and integrated
with intake and the Dependabot reviewer. Never reuse `GITHUB_TOKEN`, the
preview worker-dispatch credential, or a deployment token.

Treat every native GitHub `AutoMergeRequest` as mutation risk. In `observe` and
`assist`, publish no processor check while any request is active. In `merge`,
another, multiple, or malformed request blocks. If the sole request matches the
candidate, disable it before publishing any potentially merge-unblocking check
or approval, collect a fresh full snapshot, prove the global lane is empty,
then approve and invoke the protected exact-head merge. Bind approval to the
full PR identity and its `updated_at` before approval and again after approval.
If any post-approval, pre-merge gate fails while the PR remains open, dismiss
the processor's approval with the normal workflow token. This compensation is
not atomic. A hard runner cancellation or death can strand an approval before
cleanup runs. Before any live run can publish a processor check or create an
approval, scan every open Dependabot PR for current-head `APPROVED`
`github-actions` reviews. Dismiss every independently exact, schema-valid
processor approval with the normal workflow token, including multiple approvals
on one PR and approvals on PRs outside the selected intake. This cleanup only
removes authority and applies in every mode. A bounded global rescan must prove
that no current-head processor approval remains. Then fully recollect the
originally selected PRs against their prior expected heads and recollect
repository-wide auto-merge state before evaluation. Any current-head
`APPROVED` `github-actions` review that is not the exact processor envelope
requires operator action. Malformed, incomplete, or capped evidence, dismissal
failure, or rescan failure also fails closed before publication or mutation.
Schema-valid old-head processor reviews and schema-valid `DISMISSED` reviews
are informational controller state, not unknown-bot feedback. Keep residual
API races between the final read and merge explicit.
Follow `docs/dependabot-automation.md` and
`docs/adr/0006-dependabot-processing-controller.md` for the complete contract.

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
`CI/CD` forces the full build, unit-test, type-check, Knip, and Trunk suite on
every default-branch push so a workflow success is valid recovery evidence;
documentation-only scoping applies only to pull requests.
`Visual Regression` filters default-branch pushes to visual-impact paths and
runs both surfaces whenever it starts, making workflow success valid recovery
evidence; pull requests remain path-gated per surface.
When adding or renaming an operational workflow, update its static allowlist and
the structural test in the same PR. Never execute a triggering head SHA from
this privileged `workflow_run` workflow.

`.github/workflows/vercel-main-deployment.yml` automatically consumes only the
exact successful `CI/CD` `main` attempt and runs with the global controller in
`active` mode. Its token-free gate must bind the event run/attempt, literal
`Build and Test` job, workflow definition, checked-out source, and `DEPLOY_SHA`
before any job can use `vercel-cli-production`. Planning starts from each
target's actual served SHA. The strict `vercel-main-plan:v2` handoff contains
the canonical four-target `mainOwnershipMode` map and deterministic
`stagedTargets`, `activeTargets`, and `shadowTargets` partitions. The current
map assigns all four targets to `github`; global `shadow` is valid only when all
four targets are `shadow`. Ambiguous path planning selects a target; ambiguous
ownership or protected state aborts the whole run.

Release identity is stable across reruns—repository, exact SHA, and validated
upstream CI run ID—and the target-specific candidate identity adds the target.
The provider-side stable release manifest is the sole durable cross-attempt
authority. Mutation transaction IDs and journals remain downstream
run-and-attempt scoped. Before planning, a later attempt reconciles the
provider's protected mappings and candidates against that manifest. It reuses
a complete release, resumes or restores an interrupted forward prefix as
appropriate, or restores the exact terminal App recovery residual through a
fresh current-attempt journal before new planning can proceed. That residual
requires at least one active non-App target, every active non-App target at its
original prior, and every reviewed App alias at one manifest-bound candidate;
it grants App restoration authority only and never forward resumption. It never
resumes or treats a prior attempt's journal artifact as cross-attempt authority.
Every other non-prefix, ambiguous, conflicting, or incomplete provider state
fails closed before the release continues.

Every selected Governance, Reserve, and UI target stages and verifies an
immutable candidate with `--prod --skip-domain`. Only an `activeTargets` member
may mutate its public mapping: ordinary targets promote the exact staged
deployment, while App deploys the verified custom-`v3` output and verifies or
assigns only its reviewed aliases. App's legacy `v2 -> production` path remains
native and is verified independently. Before and after each public mutation,
the controller rechecks freshness and protected state and persists the next
durable journal transition. Recovery restores exact captured mappings in
reverse mutation order and treats unknown operator-owned state as manual
intervention. The final evidence includes an active duplicate-deployment census
and fails if native Vercel also attempted a replaced `main` path.

Ordinary reruns reuse only the exact stable candidate identified by the release
manifest, one provider candidate, and fresh deployment inspection/smoke. A
complete release takes the journal-free `current-release-verified` route: it
rechecks current mappings, deployment census/state, raw public runtime smokes,
fresh legacy App `v2`, and freshness without replaying a mutation. An
interrupted release uses a new current-attempt journal and current
protected-state snapshot. App shadow preparation is build-only terminal
evidence, never a provider deployment. The terminal receipt and evidence are
the only compact final-verdict handoff and support final-only reruns. A release
identity is evidence lookup only; it never authorizes a prior attempt's
mutation sequence.

Target-local main rollback restores only that target's reviewed native `main`
configuration and changes only its `mainOwnershipMode` to `shadow`; ordinary
previews remain GitHub-owned. Target-local preview rollback uses the exact
native-preview/GitHub-main branch rules and does not restore native `main`. A
full-native rollback is a separate coordinated procedure. For ordinary
targets, the public custom domain is the only protected
runtime and rollback alias; generated project/team and creator-scoped aliases
are candidate evidence only. Keep App `v2` native and never recreate the removed
Governance QA environment. The historical PR-A canary, active transaction,
public runtime proof, journal, recovery, target-local rollback, and full-native
restoration contracts live in `docs/vercel-deployments.md`.

`.github/workflows/vercel-production-shadow.yml` is manual-only and
non-promoting. Ordinary uploads implicitly move the target's reviewed generated
base project/team alias and may also move Vercel's exact creator-scoped alias,
but the workflow issues no explicit alias assignment, promotion,
environment-configuration, ownership, or protected-domain mutation. Candidate
dependency installation and builds must run under its dedicated UID boundary
with exact protected tools, private-umask runner-owned pull staging, raw
Git-object materialization of the exact commit (never archive/checkout filters),
and a runner-owned verified output handoff. Browser smoke must use a fresh
trusted checkout and dependencies, never candidate `node_modules`; tear down
every candidate boundary before upload or later production-token checks. Keep
all build-boundary state below the target-scoped, authenticated
`/var/lib/mento-vercel-runtime-<run>-<attempt>-<target>/work` root, seal
`RUNNER_TEMP` to runner-owned mode `0700` before candidate execution, and
reauthenticate and remove the exact runtime in a final `if: always()` step.
Preserve App custom `v3` as build-only and preserve the App `v2` alias.
Governance, Reserve, and UI uploads must avoid custom production domains and
must expose the immutable deployment hostname through the deployment URL/state
identity. The provider alias list must contain the target's reviewed literal
base project/team alias and may contain at most one author alias derived exactly
from the canonical Vercel deployment `creator.username`; reject every other
alias.
Every candidate Vercel build must use `--standalone`; reject invalid, oversized,
or non-empty-`filePathMap` `.vc-config.json` files before handoff and again on
the runner-owned upload tree.
The protected Vercel CLI must come only from the exact standalone manifest and
lockfile under `scripts/vercel-cli-runtime`; never install it through the root
workspace, admit workspace links, or weaken recursive symlink containment.
Never copy a raw Vercel-pulled `.env.*.local` into candidate storage. One-way
materialize only the exact `vercel-pull` allowlist, prove the raw source is
unchanged, reassert candidate canonical bytes, and remove raw pull and derived
environment state during candidate teardown.
Preflight must bind workflow, requested, fetched-main, and source SHAs before
downstream jobs consume its single SHA output. Reachable browser smokes must
verify both the custom build ID and exact deployed-SHA response header. Candidate
builds must emit one canonical Turbo cache summary for per-target evidence.
The full contract and commands live in `docs/vercel-deployments.md`.

## Pull request descriptions

Every non-draft, non-Dependabot pull request body must start with the exact
top-level headings `## The Problem` then `## The Solution` as its first two H2
sections. Only HTML comments may appear before `## The Problem`. Validate the
current PR with
`gh pr view --json body --jq .body | pnpm pr:description:check`; run the
validator tests with `pnpm pr:description:test`. The `PR description format`
job is designed to be a required status and therefore must keep running without
path filters.
