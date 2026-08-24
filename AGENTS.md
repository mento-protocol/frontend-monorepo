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

## Connected fork clock

Both connected-swap seed scripts use `scripts/fork-test-clock.mjs`. The helper
models the deployed `MarketHoursBreaker` UTC calendar. It selects wall time only
when the FX market stays open for two more hours. Otherwise, it advances the
fork to the next safe opening. It never rewinds, and the second seed preserves
an already-safe future timestamp. Keep Celo and Monad on this shared helper.
Derive raw fork transaction deadlines from the latest block timestamp. Changes
to the helper must select the Celo app, Celo governance, and Monad E2E lanes.

## Dependabot processing

Use `.github/workflows/dependabot-process.yml` for every Dependabot decision.
Its exact modes are `observe`, `assist`, and `prepare`; missing, legacy `merge`,
unknown, whitespace, and case variants become `observe`. The processor never
merges or enables native auto-merge. A maintainer performs the final squash
merge through one of two explicit paths. A prepared change requires a
successful exact-head `Dependabot ALL CLEAR` check and its exact processor
approval. A `manual-review` change requires an explicit maintainer takeover.
Before merging it, verify the exact current head and base, all
repository-required checks, resolved feedback, a current human approval, and
mergeability. The packetless failed `Dependabot Processor` check is
non-required and intentionally waived for this manual path.

`.github/workflows/dependabot-intake.yml` remains the credentialless v1 boundary
for exact Dependabot-bot-sent native events. Prepared heads use the distinct credentialless
`.github/workflows/dependabot-prepared-head-intake.yml` repository-dispatch
boundary. That intake accepts only the exact Prepare App bot ID/login, exact App
slug, nine-key bounded payload, and a digest-bound completed Refresh or Repair
check. Never broaden either intake or add `workflow_dispatch`. Completed native
intake, prepared-head intake, and Dependabot Claude review runs resume the
processor immediately; a staggered ten-minute schedule reconciles missed
events.

Dependabot AI review runs through
`.github/workflows/dependabot-claude-review.yml`. Its first credentialless step
authenticates either intake. For a prepared head, it also proves the exact
append-only Refresh/Repair chain back to a verified Dependabot seed. The
read-only Claude job checks out only `github.workflow_sha`. It restricts
built-in tools to Bash, denies every MCP tool, and runs in `dontAsk` mode. The
workflow pins `claude-sonnet-4-6`. This prevents provider-default
drift. A
trusted `PreToolUse` guard authorizes one exact bound repository-scoped
`gh pr diff` command per workflow run attempt and blocks every other Bash call.
A paired `PostToolUse` guard validates the same successful, complete foreground
diff result, seals its original bytes in a
`dependabot-claude-review-tool-completed:v2` receipt, and delivers those exact
bytes as one `text/plain` document tool result. The document bypasses Claude
Code 2.1.234's 30,000-character Bash text-result persistence. A later no-token
step requires the receipt before the review job can succeed. Missing, failed,
interrupted, empty, or persisted/truncated diff output is retry-first. The job
emits bounded canonical JSON and never checks out, caches, downloads, installs,
or executes candidate-controlled input. The reviewer reports transitive
dependency changes only when the diff shows a concrete incompatible constraint
or repository defect. Added registry metadata for an unchanged package
resolution is not a finding unless the updated dependency makes that package
newly reachable or creates a concrete incompatibility. A valid `findings` result is
deterministic repair input; an infrastructure or malformed result is
retry-first. The isolated publisher owns the exact-head `claude-review` check.
Human PRs keep the separate `claude-review-human` check.

Dependabot review and Claude repair prefer the `ANTHROPIC_API_KEY` secret. They
use `CLAUDE_CODE_OAUTH_TOKEN` only when the API-key secret is absent. A bounded
post-action diagnostic reports only the CLI subtype, error flag, terminal
reason, and numeric API status. It never logs the model result, prompt, tool
output, or diff. The publisher records canonical non-authorizing failure
metadata. The processor may rerun the exact trusted review twice for HTTP 429,
500, 502, 503, 504, or 529. It reruns only when that failure remains the newest
trusted exact-head Claude result. Attempt three is terminal. The isolated retry
job has Actions write and read-only PR/check access. It has no repository-write,
check-write, App, or Claude credential.

`observe` classifies only. `assist` publishes non-authorizing evidence for
human handling but cannot issue an automatic repair packet. `prepare` may
refresh a stale branch, apply at most two bounded
repairs, trigger exact-head re-review, reply to and resolve only receipt-bound
findings after validation, create the processor approval required by the
ruleset, and publish ALL CLEAR. Refreshes do not consume the two-repair budget.
Every mutation invalidates prior gate and review evidence.

The preparable tier is broader than the former automatic tier: verified npm
updates, including grouped and major updates, may be repaired and prepared;
verified non-sensitive GitHub Actions updates may be prepared only while their
native Dependabot head is current and green. The Prepare App never refreshes or
repairs a PR generation whose live diff contains `.github/workflows/**` or
`.github/actions/**`. Each ref mutator re-fetches that exact file inventory
immediately before its write. A stale or failing Actions update stays manual.
The receipt retains risk and update metadata for the human merge decision.
Sensitive or self-reviewing Actions, workflow
policy, deployment, authentication, credential, or security changes; unknown
metadata/ecosystems; untrusted force-push histories; manual vetoes; unresolved
feedback; and exhausted repair attempts remain blocked. A complete
native-to-native Dependabot rewrite chain starts a new generation. Every event,
commit, actor, ref, and SHA in that chain must pass the exact controller policy.
An exact `@dependabot rebase` or `@dependabot recreate` issue comment from a
trusted maintainer is a branch-maintenance command, not a veto. Every other
trusted-maintainer issue comment remains a veto. Only an exact, unchanged
`@dependabot recreate` comment can start a new native generation after poisoned
branch history. Its creation and update timestamps must match. The next and all
later force-push events must have later timestamps. Their destinations must
remain an exact signed Dependabot chain. `@dependabot rebase` cannot reset that
history. For these two exact commands only, the collector also trusts a `User`
whose live repository permission is `admin` or `write`. It binds the permission
response to the comment author's numeric ID, login, and type. A missing, `read`,
or malformed permission response remains untrusted. All other issue-comment
feedback continues to use the author-association policy.

Sensitive and self-reviewing Actions remain manual. This includes OSV
scanner/reporter updates. The workflow contract requires exactly one scanner
step and one reporter step. Both actions must use full lowercase 40-character
SHA pins at the same revision. The test does not copy a specific revision into
another source file. Use the explicit `manual-review` maintainer takeover path
for these updates. Never report this path as Dependabot ALL CLEAR.

Configure the repository-scoped Prepare App with variables
`DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID`,
`DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG`,
`DEPENDABOT_PROCESSOR_PREPARE_BOT_ID`, and
`DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN`, plus secret
`DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY`. Install the App with
`contents: write` and `pull-requests: write`. Update-branch and Refresh need
both permissions. Repair and authenticated dispatch request only Contents.
Grant the App no bypass, Actions, workflow, deployment, package, environment,
or provider permission. Contents write also
makes GitHub's merge endpoint technically reachable, so the reviewed workflow
contains no merge call or merge code and isolates and revokes the token before
approval. The mutation token is passed to the core only as
`DEPENDABOT_PROCESSOR_REPAIR_TOKEN`; the trusted App slug and bot identity bind
every receipt. Never reuse `GITHUB_TOKEN`, a preview credential, deployment
token, package credential, or PAT.

Keep branch mutation and readiness authority in separate jobs. The request
phase may publish only a typed Refresh request and has no App credential. The
mutation phase may hold the short-lived Prepare App token but cannot publish a
check, approve, or publish ALL CLEAR. It revokes the token at job end. A later
finalize phase rejects the repair token, recollects the exact head with the
normal workflow token, and alone may clean stale processor approvals, approve,
reply to receipt-bound threads, and publish ALL CLEAR. The repair planner is
token-free and may only use guarded Read/Grep over a trusted, sealed evidence
directory. A preceding read-only materializer binds the exact packet, compare,
Git blobs, and failed-job logs; paired pre/post hooks and a later assertion
require at least one successful exact evidence read, and large files require
explicit one-based bounded Read pages. Grep may locate the relevant ranges. The
boundary never executes candidate input. The
validator has no secret or write token and re-fetches blobs by exact Git object
SHA, including files larger than the Contents API limit. The publisher uses Git
Data APIs for one exact-parent non-force commit and never executes candidate
input.

Stable same-major patch/minor updates to the unscoped `vercel` package use the
typed `dependabot-repair-packet:v3` protected-runtime operation instead of the
model planner. The same packet admits the exact `frontend-core` Next update
when the root override and workspace catalog must move together. Trusted
workflow-SHA code binds the exact refreshed-head workspace/runtime inputs. The
Vercel kind also binds both public npm release records and changes only the
exact Vercel regions of the root lock. The Next kind accepts only caret source
or target specs, moves every Next declaration forward to the immutable target,
and starts from the sealed source root lock. It runs one isolated exact-pnpm
10.34.4 target solve as an oracle, imports only the exact Next runtime closure
records and integrity values, and preserves every unrelated source resolution.
Exact registry metadata also binds the Next peer maps, optional-peer metadata,
Node engine, bin shape, and retained snapshot peer context.
The bound `resolutionMode: lowest-direct` constrains only that oracle. It does
not define the output lock. The generator rotates the exact Next override in
the sealed standalone lock, requires frozen-lock consistency, and reseals the
runtime contract because it binds the full root override map.
Both kinds disable scripts and pnpmfile loading. Standalone checks also disable
workspace linking. The Next kind permits only the root
package/workspace/lock plus
`scripts/vercel-cli-runtime/{contract.json,package.json,pnpm-lock.yaml}`. An
independent no-secret job reproduces the exact plan before the unchanged staged
commit, Intent, non-force move, receipt, and recovery path. Major, prerelease,
downgrade, overshoot, builder-key-set, override, registry, generation, or byte
drift fails closed. Generic repairs remain exact v2 and retain every
runtime/deployment deny. ALL CLEAR requires the requested target plus its
reachable typed operation; human squash merge remains mandatory.
After a reachable Vercel v3 sync, one later v2 repair may carry the
already-bound runtime paths in its authenticated PR inventory only when each
new finding or feedback path names an exact generic-safe changed file. That v2
packet exposes only those evidence files as expected and permitted blobs.
`scripts/vercel-cli-runtime/**` remains forbidden and unavailable for edits.
Missing v3 proof, an extra protected path, an unsafe evidence path, or a mixed
non-review failure remains `manual-repair-required`.
The typed Vercel or Next operation may carry exact Cursor feedback only when
each structured finding matches the operation kind, source and target versions,
and a review commit from the authenticated prepare lineage. The Vercel finding must name root
`package.json`; the Next finding must name root `pnpm-lock.yaml`. Every other
unresolved finding stays manual. The packet binds each accepted comment and
body digest. Evidence binds the packet commit to the immutable review-comment
`original_commit_id`. GitHub may retarget the mutable `commit_id` to the
refreshed packet head. Finalize replies and resolves the comment only after the
typed Repair receipt, complete green gates, and clean exact-head re-review.
PR preview workers validate the candidate runtime tuple only as data; every
credentialed preview build still stages its CLI from the trusted default-branch
controller. After trusted plan validation, a fresh terminal no-output job uses
API and shell steps to materialize the exact trusted scripts, a byte-identical
sealed Node executable, and the hash-verified pnpm bootstrap. It registers no
runner action or post action before candidate code. A separate non-sudo account
runs candidate code and cannot write the trusted source, evidence, Node or pnpm
executable, candidate `PATH` directories, workspace, Actions directory, or
runner command files. The checked `PATH` excludes the runner-owned
`/usr/local/bin` directory. The job reapplies the digest-bound validated patches to
fresh exact evidence, performs the secretless frozen checks, and emits no plan
or mutation authority. For Next, the final step performs a cacheless frozen
install of only the selected app's production dependencies. Lifecycle scripts
run in a sanitized environment. It executes the exact target CLI and builds a
minimal App Router project. It can veto staging.

The Prepare App becomes the sender after a repair ref move. Direct PR
workflows grant repository credentials only when
`ALLOW_REPOSITORY_CREDENTIALS` proves a same-repository `User` author and
`User` sender. Dependabot, the Prepare App bot, and reserved Dependabot refs
remain secretless. Their candidate jobs do not persist checkout credentials or
use dependency, Foundry, or Trunk caches. This applies to CI, E2E, visual, and Quality
Budgets. Pull-request supply-chain scanners have read-only tokens;
schedule/manual scanners own SARIF write authority.

Only an exact trusted pending Refresh may start the mutation/token job. A native
green Dependabot head skips that job and can finalize without Prepare App
configuration. `repair-pending` preserves the original exact-head packet/run
without publishing duplicates; `manual-repair-required` exits automatic
preparation for human work.

The authority checks are `Dependabot Refresh` (`dependabot-refresh:v1`),
`Dependabot Repair Intent` (`dependabot-repair-intent:v1`), `Dependabot Repair`
(`dependabot-repair:v1`), and `Dependabot ALL CLEAR`
(`dependabot-all-clear:v1`). Their canonical JSON binds repository, PR, ref,
parent/head/base, trusted workflow SHA/run/attempt, actor identity when a
Prepare App mutation occurred, and operation-specific digests. Check publisher
identity remains github-actions App ID 15368. A refresh requires a successful
request receipt on the old head and a successful completed receipt on the new
two-parent head. A repair stages an unreachable exact-parent commit, publishes a
packet/plan/tree-bound intent without the App token, moves the exact ref with a
fresh token, and publishes the completed receipt without it. The commit must
have the exact App bot author, either the exact App bot or GitHub's exact
`web-flow` system signer as committer, and GitHub verification `verified=true`
with reason `valid`. A failed, cancelled, timed-out, action-required, or
startup-failed post-move run may only enter the bounded exact-intent recovery
path. Normal pre-move work and checks-only recovery each get at most two
exact-evidence infrastructure retries, independent of the two-commit repair
budget. External IDs are digest indexes, never authority alone. Packetless
`Dependabot Processor` checks are non-authorizing status records. They never
enter repair-receipt or attempt accounting. Only `packet=true` checks can bind
a repair packet, and those checks retain strict terminal-success workflow
provenance. Packetless manual checks include one deterministic reason and next
action in their bounded summary.

ALL CLEAR requires stable exact identity, current-base ancestry, complete green
exact-head gates, a clean re-review, clear feedback, satisfied mergeability,
ruleset, and review state, one exact processor approval, no native
`AutoMergeRequest`, and no competing candidate. It records
`humanAction="merge"`, `mergeAuthorizedByAutomation=false`, and the complete
native or prepared lineage. Keep one candidate serialized until the human merge
SHA has default-branch CI and post-merge release proof. A new comment or main
push can still land after final recollection and before the click, so ALL CLEAR
is a current-head snapshot and strict current-base/ruleset enforcement at merge
time remains mandatory.

If final validation fails after approval, publish an automation-invalidating
exact-head ALL CLEAR failure before dismissal. The optional failed check does
not replace dismissal as the GitHub merge-authority control. A later finalize
run may replace that failure with a neutral tombstone only after a fresh global
scan finds no processor approval and exact-head evidence reports
`REVIEW_REQUIRED`, `BLOCKED`, and no auto-merge. Recollect and prove the same
non-authorizing state before a new approval. A tombstone is never an ALL CLEAR
receipt. A later run first changes a persisted tombstone back to failure. A
failed recovery restores every attempted target, removes a sole exact late
auto-merge request, and dismisses every observed processor approval. Two
consecutive bounded paired global scans must prove both authority inventories
empty. Post-approval failure uses the same rollback, including after an
ambiguous approval response.

A valid active ALL CLEAR receipt plus its sole exact approval outranks ordinary
numeric candidate selection, including during a run triggered for another PR.
Finalize recollects that incumbent and preserves it until merge/post-merge proof
or until current evidence invalidates it.

Prepare-mode targeted runs collect every bounded open Dependabot PR while
binding the triggering expected head only to its original PR. A pending Refresh
request/completion, trusted same-head repair packet, or valid prepared lineage
also keeps the serialized lane through check, retry, and re-review waits.
Multiple such incumbents without one valid active ALL CLEAR fail closed.

Run
`pnpm dependabot:process -- evaluate --input path/to/snapshot.json --mode observe`
for a network-free plan and `pnpm dependabot:process:test` after processor,
workflow, receipt, reviewer, policy, or runbook changes. Run
`pnpm dependabot:soak` to render and validate the offline observational
production evidence report. Before changing a pending row to passed, revalidate
its exact PR, check, workflow-run, and authority evidence against live GitHub.
The offline command does not certify GitHub provenance.
When a Dependabot job-level callback guard duplicates a downstream validator,
keep their accepted receipt forms identical. Test the complete grouped guard and
explicitly reject each paired false or non-target form. Positive fragment checks
alone do not prove the boundary.
Follow `docs/dependabot-automation.md` and
ADRs 0006 and 0008 for the complete contract.

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
original prior, and every reviewed App alias at either its captured prior or one
manifest-bound candidate, with at least one alias at the candidate; it grants
App restoration authority only and never forward resumption. It never
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
and fails if Vercel produced an unexpected serving or pending deployment for a
replaced `main` path. If the release plan has no expected candidate for a
project, an exact-project, exact-SHA deployment in terminal `CANCELED` state
remains visible as `inertCanceled` evidence. It cannot satisfy the required
candidate or protected-mapping proof.

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
