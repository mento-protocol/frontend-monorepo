# Vercel deployments from GitHub Actions

This runbook documents the repository-owned planning, build, and automatic
four-target preview controller used by the GitHub Actions deployment migration tracked in
[issue #515](https://github.com/mento-protocol/frontend-monorepo/issues/515).
The ownership boundary and its trade-offs are recorded in
[ADR 0001](adr/0001-github-actions-vercel-deployment-orchestration.md).
The preview v2 controller builds App, Governance, Reserve, and UI independently
from one target-ordered plan. All four ordinary branch-preview paths are
GitHub-only. App completed the last exact-head and fresh post-merge canary gates
in PRs
[#609](https://github.com/mento-protocol/frontend-monorepo/pull/609) and
[#610](https://github.com/mento-protocol/frontend-monorepo/pull/610).
The separate automatic `Vercel Main Deployment` workflow is configured as the
active `main` owner for App, Governance, Reserve, and UI. It runs after
successful `main` CI, plans from the SHA each public target actually serves,
stages and verifies all four selected targets, and activates only the plan's
GitHub-owned targets. App stages and promotes through the same production
model as every other target: one `vercel promote`, verified at candidate, with
no bridge alias and no custom environment (see "Transition complete
(2026-09-02)" below).
The repository configuration contains no Governance QA environment.

The automatic preview controller's version-controlled
`VERCEL_PREVIEW_CONTROLLER_MODE` is `active` in this ownership state. The only
other accepted value is `observe-only`, which records receipts, recovers or
retires already-persisted dispatch ownership, and publishes a truthful
no-dispatch status but cannot create a worker. The canonical target order,
workspace/root/project mapping, exact native/GitHub `vercel.json` shapes, and
per-target `shadow` or `github` mode live together in
`scripts/vercel-preview-targets.mjs`. The workflow topology, runtime ownership
guards, and ownership tests import or structurally verify that source; do not
copy a second ownership table into executable code.

The manual production-shadow pilot workflow is retired (2026-09-02); preview
deployments cover pre-merge verification. Staged main candidates keep its
non-promoting property: like the historical automatic PR-A shadow path, an
upload does not promote or mutate a protected/custom production domain or
deployment ownership. Each ordinary upload implicitly moves the target's
reviewed base generated project/team alias and may also move Vercel's exact
creator-scoped generated alias.

## Automatic active main deployment

`.github/workflows/vercel-main-deployment.yml`, named
`Vercel Main Deployment`, owns the automatic `main` path tracked in
[#522](https://github.com/mento-protocol/frontend-monorepo/issues/522). It
subscribes to both `workflow_run` activity types of the `CI/CD` push workflow
on `main`, `types: [requested, completed]`:

- the `requested` delivery starts the release run concurrently with CI. It
  admits the exact non-terminal attempt and runs only read-only planning until
  the separate success gate proves the CI verdict; and
- a `completed` delivery for a successful CI attempt is the takeover or no-op
  run. It performs today's full terminal verification and deploys unless a
  deployment run for that exact upstream attempt both passed the success gate
  and concluded `success`. A `completed` delivery whose CI attempt did not
  conclude `success` is never admitted, so it neither takes over nor
  deduplicates.

Whether GitHub redelivers `requested` for a re-run of a `main` CI attempt is not
verified here, and both outcomes are safe. If it does not fire, the re-run
produces exactly one deployment run with today's semantics. If it does,
`assertNonTerminal` accepts the re-queued attempt, the gate binds
`runId + run_attempt`, and the attempt-2 `completed` delivery deduplicates
against the attempt-2 marker, so the run count matches an ordinary push.

The exact upstream attempt is bound into the success gate job's name,
`Require the exact successful CI attempt for upstream <runId> attempt
<runAttempt>`. That name is the only durable, queryable proof that a given
deployment run already passed the CI verdict for that attempt: a
`workflow_run`-triggered run object names no triggering run.
`scripts/vercel-main-ci-attempt.mjs` owns its exact format, and
`pnpm vercel:workflow:test` pins the job's `name` against it.

The workflow deliberately sets no `run-name`. As the preview-recovery contract
below already records, GitHub's Actions REST API reports a configured dynamic
`run-name` in both `name` and `display_title`, and both
`.github/workflows/ci-failure-notifier.yml` and `scripts/ci-failure-issue.mjs`
identify this workflow by that `name` field. The gate job's name carries the
marker instead, which also makes the duplicate proof a single artifact.

The concurrency group is unchanged (`vercel-main-deployment`,
`cancel-in-progress: false`, `queue: single`). It now carries up to two runs per
commit: it keeps an in-progress run and at most one pending run, and a newer
arrival replaces an older pending one. Ordering is never trusted for
correctness.

The workflow keeps orchestration and pinned artifact transfers in YAML. Tested
Node modules own exact-attempt validation, served-SHA planning, canonical
state, active mutation descriptors, journal transitions, recovery decisions,
runtime smoke inputs, and evidence rendering. Each mutation phase is a bounded
invocation around an immutable journal snapshot; no process pretends that an
in-memory callback is durable. `pnpm vercel:workflow:test` is the executable
source of truth for the literal job graph and the exact command-to-artifact
handoffs.

### Exact upstream attempt admission

`wait-for-ci` is token-free with respect to Vercel. It sets `DEPLOY_SHA` only
from `github.event.workflow_run.head_sha` and validates the event plus GitHub
API record with `scripts/vercel-main-ci-attempt.mjs admit`. The accepted run
must:

- belong to `mento-protocol/frontend-monorepo`;
- be the `CI/CD` push workflow at `.github/workflows/ci.yml` on branch `main`;
- identify the exact event run ID, run attempt, and lowercase 40-character
  `DEPLOY_SHA`, with canonical API and web URLs.

The two deliveries differ only in their verdict assertions:

- on a `completed` payload the event and the API record must both be
  `status: completed` with `conclusion: success`, and the attempt-specific,
  fully paginated jobs endpoint must return exactly one literal
  `Build and Test` job that concluded `success` — the previous `verify`
  behaviour, byte for byte; and
- on a `requested` payload both the event and the API record must be
  non-terminal (`conclusion` is `null` and `status` is not `completed`). The
  attempt's jobs are deliberately not read at all. An attempt that has already
  concluded when the early run reads it is rejected; the `completed` delivery
  then takes over.

Admission cannot observe the `Build and Test` sentinel, and does not try.
GitHub creates a job record only once that job's `needs` resolve, and
`.github/workflows/ci.yml` gives the sentinel
`needs: [changes, build, test-workspaces, test-vercel, static]`. Measured on
real runs, the record's
`created_at` equals the completion of the last of those jobs, roughly 150–190
seconds after `run_started_at` and seconds before `CI/CD` itself concludes. On
CI run `33084029561` it was 187 seconds in, only 5 seconds before the run
concluded. A
`requested` delivery admits within about fifteen seconds of the run starting,
so waiting for that record would fail closed on every push and would erase the
overlap the early delivery exists for. `require-ci-success` is the earliest job
in which the record is guaranteed to exist, so it derives the sentinel and
publishes the exact `Build and Test` job URL as its own job output.
`pnpm vercel:workflow:test` pins that coupling against the real `ci.yml` job
graph. That 5-second margin is also why `prepare-release` waits for the full
`require-success` verdict rather than polling for the record's mere existence:
an existence-only poll would buy under five seconds and would cite a sentinel
whose conclusion nothing read.

The job then requires `github.workflow_ref` to identify
`.github/workflows/vercel-main-deployment.yml` on `refs/heads/main`,
`github.workflow_sha == DEPLOY_SHA`, checked-out `HEAD == DEPLOY_SHA`, and
`DEPLOY_SHA` to be the freshly fetched `origin/main` tip after first proving
ancestry. A mismatched workflow definition or superseded source exits before
any Vercel environment or credential is available. That proof now runs roughly
three minutes earlier, which shrinks the window in which a fast-follow push
supersedes it. Admission records only the attempt-qualified upstream run URL,
`DEPLOY_SHA`, the admission mode, and the deploy mode; release execution
validates the attempt suffix against the separately admitted run attempt.

### Exact-attempt CI success gate

`require-ci-success`, whose name is prefixed
`Require the exact successful CI attempt` and always carries the
`for upstream <runId> attempt <runAttempt>` suffix the duplicate probe matches,
owns the CI verdict. It is credential-free by construction: no `environment`, no
`secrets.` reference, no source checkout, no install, and only the workflow's
`contents: read` plus `actions: read` permissions. It runs
`scripts/vercel-main-ci-attempt.mjs require-success`, which:

- re-reads the event payload and requires `DEPLOY_SHA`, `UPSTREAM_RUN_ID`, and
  `UPSTREAM_RUN_ATTEMPT` from admission to equal the event's own head SHA, run
  ID, and run attempt;
- polls only that exact run every five seconds until `status` is `completed`,
  re-validating the full run identity on every response, bounded at 30 minutes
  of await inside a 35-minute job timeout;
- requires `conclusion: success`, with any other terminal conclusion throwing
  immediately and without further polling; and
- requires exactly one literal `Build and Test` job that is `completed` and
  `success` in the attempt-specific, fully paginated jobs endpoint, then
  publishes that exact job URL as the `build_and_test_job_url` job output.

`activate-and-verify` and `recover-main-deployment` read
`BUILD_AND_TEST_JOB_URL` from that gate job output. `prepare-release` runs the
same `require-success` CLI in-job and binds the sentinel from its own
`steps.gate` output onto the single step that consumes it, so the evidence in
the release plan still comes from a proven verdict.
`provider-preplan` and `restore-inherited-release` need no sentinel and carry
none.

A failed, timed-out, or cancelled gate skips every mutating job and fails the
`Vercel Main Deployment` check, exactly as a red CI does today.
`prepare-release` and a selected `restore-inherited-release` instead fail at
their own in-job gate step, so a red CI grows the failed-job list by one or two
jobs; the `result` verdict is unchanged.

### Read-only pre-gate window

Four jobs may start before the gate job concludes:

- `wait-for-ci`, which is token-free with respect to Vercel;
- `provider-preplan`, the first credential-bearing main-release job. It
  captures the reviewed protected mappings, then discovers provider candidates
  that carry canonical stable release manifests;
- `restore-inherited-release`, whose entire pre-gate surface is one immutable
  controller checkout before its in-job gate at step index 1; and
- `prepare-release`, which is read-only from its first step to its last and
  runs the same allowlisted census commands as `provider-preplan` before
  self-gating ahead of its one sentinel-consuming step.

There is still no GitHub artifact or prior-attempt gate between admission and
provider reconciliation. This is a deliberate amendment to the trust model:
credentialed but read-only jobs now observe provider state while CI is still
running, because CI (about three minutes) is only hideable behind the run-start
latency, admission, preplan, and release preparation. Every provider write
still waits for the gate.

A pre-gate job may run only these commands:
`vercel-main-deployment.mjs validate-source|create-spec`,
`vercel-deployment-state.mjs planning-snapshot|snapshot`, and
`vercel-main-provider-cli.mjs preplan-discover|preplan-decide`, plus
`vercel-main-ci-attempt.mjs admit` in admission. The allowlist did not widen
for this change. It may not use
`./.github/actions/vercel-main-active-transition`,
`./.github/actions/vercel-main-active-recovery-transition`,
`./.github/actions/vercel-candidate-build`,
`./.github/actions/vercel-protected-runtime`, or
`vercel-production-shadow.mjs pull|deploy`. Enforcement is index-aware:
`pnpm vercel:workflow:test` computes each job's pre-gate boundary — its in-job
gate index, or its whole step list when it has none — and requires every node
subcommand before that boundary to be on the allowlist, no mutation adapter to
appear before it, and no credentialed pre-gate step to be a composite action.
The same test pins the pre-gate set to exactly these four jobs and their
credentialed subset to the last three.

### Gate placement

The exact-attempt verdict has two placement forms.

`stage-app`, `stage-governance`, `stage-reserve`, `stage-ui`,
`activate-and-verify`, and `recover-main-deployment` take `require-ci-success`
as a direct `needs` edge. Every one of those conditions that uses `always()` —
which disables GitHub's implicit needs-success — additionally asserts
`needs.require-ci-success.result == 'success'` literally. A staged candidate
upload (`vercel deploy --prebuilt --prod --skip-domain`) moves the target's
reviewed generated Vercel system aliases, so staging counts as a provider write
and stays behind that edge.

`restore-inherited-release` runs the same credential-free
`scripts/vercel-main-ci-attempt.mjs require-success` as its own step at index 1,
directly after the immutable controller checkout and before every credentialed
or mutating step. It keeps no `always()`, so implicit needs-success binds that
one-checkout prefix while the in-job gate binds the verdict for the rest,
including its six bounded recovery invocations. It carries the edge form
nowhere, because its skip on the fast path would otherwise hold the whole graph
behind the gate job: on deployment run `33084034097` the skipped job resolved at
exactly the gate job's completion.

`prepare-release` is read-only end to end, so it takes neither form for write
safety. It self-gates only to derive the sentinel, immediately before its final
`Create and encode release execution` step. `pnpm vercel:workflow:test` pins
that the in-job form is used by exactly `restore-inherited-release` among the
mutation jobs, that its gate step index is strictly below every credentialed or
mutating step, and that `prepare-release`'s gate is the penultimate step.

Both in-job gates raise their job's timeout by the CLI's full 30-minute bounded
await on top of the job's own work budget, so a slow or queued CI attempt fails
closed on the CLI's explicit bounded-await error rather than on GitHub's generic
job timeout: `restore-inherited-release` 60 → 90 minutes and `prepare-release`
25 → 55 minutes. The two budgets compose the same way even though the gates sit
at opposite ends of their jobs. `restore-inherited-release` gates at step index
1, so the await runs first and its 60-minute recovery budget follows.
`prepare-release` gates penultimately, so its 25-minute census budget runs first
and the await follows. Either order costs the sum.

`prepare-release` also asserts `!cancelled()` literally. Leaving the gate
`needs` edge removed the guard that edge used to provide: on a cancelled run the
gate job resolved `cancelled` and the job skipped with it, whereas `always()`
alone would now start the credentialed census on the common fast path, where
`restore-inherited-release` resolves `skipped`.

### Duplicate completed-event runs

The `completed` delivery is a no-op only when exactly one strictly validated
sibling deployment run for this `DEPLOY_SHA` exists, that sibling run itself is
`status: completed` with `conclusion: success`, and its latest attempt contains
exactly one job named
`Require the exact successful CI attempt for upstream <runId> attempt
<runAttempt>` for this exact upstream attempt, concluded `success` and bound to
that sibling's run ID. The sibling must be a `workflow_run`-triggered run of
`.github/workflows/vercel-main-deployment.yml` on `main` with canonical API and
web URLs, and it must not be this run.

The probe matches a job **name**, so the in-job `require-success` steps in
`restore-inherited-release` and `prepare-release` create no second gate-name
artifact: a step never appears in the attempt's jobs listing, and the probe's
requirement of exactly one such job still holds.

Both conditions are load-bearing. The gate job proves the sibling reached the
same CI verdict for the same attempt; the sibling's own conclusion proves it
actually finished the release. A sibling that passed the gate and then failed in
`provider-preplan`, `prepare-release`, a stage, or `activate-and-verify` left
`main` undeployed, so it must not suppress this delivery. `queue: single` holds
this run until the sibling leaves the queue, so the sibling is already terminal
when the probe reads it.

Every other observation deploys: zero or multiple siblings, a sibling run that
is unfinished, failed, cancelled, or missing a conclusion, a gate job bound to
a different upstream run or attempt, a missing, duplicated, failed, or
still-running gate job, a listing above the 100-run bound, or any API or schema
error. Refusing to deploy on ambiguity can strand `main`,
while a redundant run is serialized by `queue: single` and routed by the stable
release manifest to `verify-existing-release` and its journal-free
`current-release-verified` route, which creates no journal and executes no
public mutation (see the reconciliation decisions above).

Operationally: an early-run failure at any point — before or after the gate —
is picked up automatically by the `completed` delivery, which then deploys with
the full terminal verification and reconciles against the stable release
manifest exactly as a `Re-run all jobs` would. A post-gate failure that left a
partial forward prefix is therefore resumed or restored by that takeover rather
than waiting for an operator. Only a failure of the `completed` delivery itself
is operator-owned. A failed early run leaves its own red check on the commit
that the later green takeover run does not replace, so a commit can legitimately
carry one red and one green `Vercel Main Deployment` run; read them together and
treat the newest run as the verdict. Because deduplication requires the sibling
run to have concluded `success`, a failed release always leaves the newest run
red, which keeps `.github/workflows/ci-failure-notifier.yml` reporting it.

A duplicate no-op run also skips `wait-for-ci`'s exact-source checkout and
proof. It deploys nothing, and because it starts only after the sibling run
leaves the single deployment queue, the `main` tip may legitimately have moved
by then. Every run that can still reach a provider write proves its source
exactly as before.

The duplicate no-op skips every release job, reports
`Report a deduplicated upstream-attempt no-op` in the run summary naming the
sibling run URL, and ends the `Vercel Main Deployment` check green. It creates
no release execution and performs no provider write.

One observation epoch captures the complete main snapshot, rediscovers
provider candidates, and decides from two fresh sequential main censuses. If
that decision reports typed planning state drift, the job discards the epoch
and repeats that whole sequence once. Every read, digest, and candidate check
therefore comes from the same epoch. A second drift, HTTP 429, malformed response,
transport failure, or any candidate/reconciliation ambiguity fails closed
without another epoch. A failed command prints only an allowlisted
classification such as `planning-census-read-timeout`,
`planning-census-unstable`, `planning-census-stale`,
`preplan-reconciliation-failed`, `preplan-private-output-write-failed`,
`preplan-handoff-encode-failed`, or `preplan-github-output-append-failed`; it
never prints a request path, provider response, project or deployment identity,
or credential. The failure classifications are value-free. Before the preplan
command appends its GitHub job outputs, it opens the existing command file
without following links, requires one regular single-link inode with mode
exactly `0600` or GitHub's `0644` default, seals the open descriptor to `0600`,
then rechecks the same inode, its single link, non-symlink path, exact mode, and
size both before and after the append. Group- or other-writable files, links,
identity changes observed during validation, and oversized command files fail
closed.

The provider-side stable release manifest is the sole durable cross-attempt
authority. It binds repository, release ID, `DEPLOY_SHA`, validated upstream
run, ownership mode, staged and active targets, release-plan digest, and every
captured protected rollback prior.

Its schema tag stays `vercel-main-release-manifest:v2`, and rider domains are
deliberately **not** in it. A candidate upload runs `--prod --skip-domain`,
which moves the project's generated aliases off the still-serving prior, so two
attempts of one release legitimately observe different rider sets. The manifest
is embedded in every candidate seal and compared byte-for-byte when a later
attempt discovers an existing candidate, so a sealed rider list would make an
interrupted release unresumable: the deterministic candidate would be found and
then rejected for a manifest difference that reflects nothing but provider
drift. Riders never enter the manifest, the candidate seal, the journal, the
release-plan digest, or any other identity- or digest-bound value.

A provider census must be complete and
stable, each candidate must carry one exact canonical manifest, and the current
protected mappings must form one canonical forward release prefix or the exact
terminal App recovery residual: at least one active non-App target with every
such target at its original prior, and every reviewed App alias at either its
captured prior or one canonical candidate, with at least one alias at the
candidate. That residual authorizes `restore-before-planning`, even for the
matching release; it never authorizes forward resumption. Missing, ambiguous,
conflicting, malformed, non-prefix, or incomplete provider state fails closed.
GitHub artifacts and prior job history are not alternate cross-attempt
authority.

Vercel's optional deployment `source` field is diagnostic telemetry, not
ownership authority. Every protected mapping without complete canonical Mento
candidate metadata is rollback-only for a new baseline, regardless of its
reported source, Git metadata, or served SHA. Provider discovery and the stable
release manifest retain the exact rollback-only target set and its deployment
ID, URL, project, environment, and served SHA for compensation. The planner
selects those targets before served-SHA and path-aware planning, so an unmarked
mapping cannot suppress reviewed GitHub preparation even when it reports
`DEPLOY_SHA` or an ancestor with no runtime changes. Active-owned targets then
replace the mapping; shadow-owned targets retain their non-mutation contract.
Fresh discovery binds the rollback-only set into the preplan and execution
artifacts. Same-release verify or resume is rejected if its manifest does not
already stage every freshly rollback-only target, while a new baseline must
persist exactly the discovered set. The standalone legacy planning command has
no candidate census and therefore conservatively selects all four targets.

Only complete canonical Mento candidate metadata and the exact stable release
manifest can authorize an already-current GitHub candidate. The final census
may observe the exact manifest-bound original prior, but that prior never
authorizes a public GitHub mapping.

The reconciliation decision is made before ordinary planning:

- `verify-existing-release` fully re-verifies a complete matching release and
  reuses it through the journal-free `current-release-verified` terminal route;
- `resume-existing-release` continues a matching interrupted forward prefix
  through a fresh current-attempt journal;
- `restore-before-planning` restores an older interrupted prefix, or the exact
  terminal App recovery residual, through a fresh current-attempt journal before
  a new baseline is captured; and
- `capture-new-baseline` starts only when no mapped release explains the
  protected state or a completed older release is the baseline.

No prior attempt's journal is resumed or used to authorize a later attempt.
Each attempt owns only its current journal, transaction IDs, snapshots, and
recovery. Do not infer safety from artifact retention, an empty download
directory, or GitHub's rerun count.

For `restore-before-planning`, that fresh current-attempt journal keeps the
interrupted release manifest's `DEPLOY_SHA` together with the current
downstream run ID and attempt. The incoming release `DEPLOY_SHA` remains the
source and planning identity. The restore job binds the validated interrupted
release SHA only to active-journal history lookup so it cannot mistake the
incoming release for the transaction being recovered.

### Served-SHA planning and prior-state handoff

The planning job reads canonical protected state for App, Governance, Reserve,
and UI. It requires each reviewed alias set to resolve
consistently to one expected project, ready deployment, environment, and
healthy public surface. It also records the exact prior deployment ID,
immutable URL, aliases, and served Git SHA in one redacted handoff.

The strict planning handoff uses schema `vercel-main-plan:v2` with these exact
top-level fields:

```text
schema
mode
deploySha
mainOwnershipMode
plan
stagedTargets
activeTargets
shadowTargets
priors
ranges
reasons
```

`mainOwnershipMode` is the exact canonical `{app, governance, reserve, ui}` map;
each value is `github` or `shadow`. Missing, extra, malformed, or unknown values
fail closed. `plan` remains the ordered served-SHA selection for compatibility
and equals `stagedTargets`. `activeTargets` is the ordered selected subset owned
by GitHub, and `shadowTargets` is the ordered selected subset owned by native
Vercel. They are disjoint, and their canonical ordered union equals
`stagedTargets`. The global controller may be `active` with a mixed ownership
map for target-local rollback. Global `shadow` is valid only when all four map
entries are `shadow`. The checked-in configuration is global `active` with all
four entries set to `github`.

Active-main release ID is derived from repository, `DEPLOY_SHA`, and validated
upstream `CI/CD` run ID. Target-specific candidate ID is `releaseId + target`.
Both are deliberately separate from downstream run-and-attempt transaction
identity. The candidate ID and provider-side release manifest remain stable when
rerunning the downstream controller or creating a new controller run for the
same validated upstream CI run. They are evidence lookup only and never
authorize a public mutation.

For Governance, Reserve, and UI, that protected runtime and rollback mapping
contains only the literal public custom domain. Generated project/team,
project-default, and creator-scoped aliases are not protected aliases or
rollback inputs. A fresh ordinary candidate must expose the required
project/scope alias and may also expose only its exact canonical creator alias.

An already-served prior is different, for every target. Promoting a deployment
makes it the project's production deployment, so it also carries every other
production domain that project has — retired, redirect-configured, and
operator-added domains included. `vercel promote <candidate>` and
`vercel rollback <prior>` name no alias, so those **rider domains** move
wholesale on promote and are restored wholesale by the compensating rollback to
the captured prior deployment ID. That symmetry is what makes a reviewed-alias
journal sufficient. A served prior therefore tolerates any rider; the one alias
condition that still fails closed is another main target's reviewed protected
domain, which would mean the reviewed mappings had crossed. Candidate and reused
candidate topologies keep their exact generated-alias contract, and a fresh
candidate carries no rider because it has not been promoted yet.

Riders are named but never verified, and they are same-run evidence only. Each
job that takes a planning census derives the rider set from that census and
publishes it in its evidence artifact, so a reader can see every domain a
release repointed — including from the recovery job, which censuses after its
compensating rollback, or before any compensation on the branch that runs none.
Nothing in selection, verification, or recovery reads the
list: `assertActiveFinalMappings` still verifies the reviewed aliases only, and
the planner validates and then discards the provider's alias evidence. Custom,
wrong-target, near-miss, and unknown aliases on a candidate still fail closed,
and a foreign reviewed protected domain is refused in a rider list too.

Planning compares each target's served SHA with `DEPLOY_SHA`; it does not use
the triggering push's `before` field. For a GitHub-owned target, an exact
served-SHA match skips that target. Otherwise the repository planner evaluates
the complete `served SHA..DEPLOY_SHA` range, which accumulates changes hidden by
coalesced workflow runs. Proven non-runtime changes skip. Missing, malformed,
non-ancestral, wrong-source, or otherwise ambiguous planning metadata selects
the affected target so uncertainty cannot suppress a deployment.
The stable manifest's `rollbackOnlyTargets` are selected before this comparison
and cannot take either no-op path.
Ambiguous alias ownership, project, environment, prior deployment, health, or
rollback state aborts the whole transaction because selecting more targets
cannot make compensation safe.

Immediately after validating the exact checked-out successful-main source, the
controller installs it with the repository's pinned Node/pnpm installer and its
frozen lockfile, before capturing protected or rollback state. The production
Vercel token remains scoped to those later snapshot steps and is unavailable to
the dependency install. The plan step writes a GitHub summary containing only
selected targets, served-SHA ranges, and selection reasons; it intentionally
excludes project IDs, protected snapshots, deployment URLs, and credentials.

This planner install disables lifecycle scripts and `.pnpmfile.cjs` hooks. It
uses the shared action's lockfile-keyed pnpm-store cache, not a restored
`node_modules` tree; `pnpm --filter frontend-monorepo install --frozen-lockfile
--ignore-scripts --ignore-pnpmfile` still validates the source dependency graph,
because `--frozen-lockfile` compares the lockfile against every workspace
manifest regardless of the filter. Every `vercel-main-deployment.yml` job passes
`filter: frontend-monorepo` to `.github/actions/pnpm-install`: the orchestration
scripts these jobs run import only Node.js built-ins and their own sibling
modules, so the app and package workspaces are never needed. The two Chromium
steps therefore call the root `pnpm exec playwright install --with-deps
chromium`; `scripts/vercel-preview-browser-smoke.mjs` resolves `@playwright/test`
upward to that same root `node_modules`. Do not move `VERCEL_TOKEN` to the job or
install-step environment to optimize this path.

For a target whose `mainOwnershipMode` is `shadow`, native Vercel may already
serve `DEPLOY_SHA` before this workflow reaches planning. The planner then uses
the first parent as the comparison base so the GitHub shadow path still proves
the affected-target candidate. If it cannot resolve that parent safely, it
selects the target.

### Credential and build boundary

Every job that can receive `VERCEL_TOKEN_PRODUCTION`, a mirrored build secret,
or an automation-bypass value declares:

```yaml
environment:
  name: vercel-cli-production
  deployment: false
```

Never reference the generic `Production` environment. Map the production token
only as a step-scoped `VERCEL_TOKEN`; never put it in a command argument. Expose
each mirrored build secret only to the literal target build step that consumes
it. `stage-app`'s composite caller now supplies `SENTRY_AUTH_TOKEN` like
Governance and Reserve, so App's production build uploads Sentry source maps
for the first time. Missing configuration fails by variable name. Automation
must never inspect 1Password or another credential store.

Every ordinary member of `stagedTargets` uses production build semantics and
`vercel deploy --prebuilt --prod --skip-domain`. The stage jobs reuse the
protected #521 candidate UID/runtime boundary, inspect exact deployment state,
recheck drift, and run the credential-free candidate HTTP smoke against the
immutable staged URL. These uploads may move only the reviewed
generated Vercel system aliases described below. Those aliases are evidence of
the candidate upload, never runtime-smoke endpoints or rollback mappings. The
uploads cannot move protected or custom production domains.

Before an ordinary upload, the trusted controller writes exact candidate intent
bound to the stable candidate ID, source SHA, validated upstream run, target,
and release manifest. After deployment inspection and immutable smoke, it
writes the matching candidate receipt. A later attempt may reuse only one exact
provider candidate from that manifest after fresh inspection and smoke. Provider
metadata that lacks the canonical manifest, a matching URL, a matching custom
identifier, or zero/multiple provider candidates is insufficient.

When a failed active attempt promotes an ordinary prior during recovery,
Vercel also moves the target's generated project and optional creator aliases
back to that prior. The stable candidate then remains exact and healthy on its
immutable URL but can have no generated aliases. A later attempt may admit that
detached Governance, Reserve, or UI candidate only when the trusted preflight
census captured it before the job could build a candidate, the stable manifest
and candidate identity still match, the fresh immutable smoke passes, and every
remaining alias is in the candidate's reviewed finite generated-alias set. A
candidate absent from that preflight still requires the generated project
alias. A changed candidate, protected/custom alias, Git/default alias,
wrong-target alias, or unknown alias fails closed.

The candidate HTTP smoke reads the immutable deployment root directly for App,
Governance, and Reserve. UI reads `/basic-components` on that same immutable
host because its root intentionally redirects there. Each request uses manual
redirect handling and requires an exact same-URL 2xx response with the expected
`X-Mento-Deployment-Sha`; the candidate receipt continues to record the root
immutable deployment URL.

App now has its own staged Vercel _deployment_, like every other target.
`stage-app` runs the candidate preflight, `vercel pull --environment=production`,
a production build, and `vercel deploy --prebuilt --prod --skip-domain` in
parallel with the three ordinary stages, then runs `candidate-smoke` and
`candidate-finalize` to produce a candidate receipt. That receipt is required
whenever App is selected: the App-only "receipt may be none" carve-out is
gone, and `stage-app`'s receipt is validated by the same literal expectation
as Governance, Reserve, and UI (selected means success plus a receipt;
unselected means skipped with none). If App is in `shadowTargets`, the release
stops there with a genuine staged-but-unpromoted App deployment. If App is in
`activeTargets`, its activation turn runs `vercel promote
<exact-staged-id-or-url>`, the same command every other target uses, verified
to leave `app.mento.org` at its candidate — App's domain lives in the ordinary
Production environment, so the promote alone carries it. See "Transition
complete (2026-09-02)" below.

Because `stage-app` runs in parallel, a failed ordinary stage no longer aborts
the release before the App build starts; that build cost is now spent
regardless. This is deliberate and has no safety consequence: staging creates
no public mapping, and the coordinator still refuses to proceed when any
selected stage did not succeed.

App's candidate reuse now follows the same rules as Governance, Reserve, and
UI: the coordinator consumes `needs.stage-app.outputs.receipt` directly,
re-inspects and re-smokes a reused candidate, and admits a detached candidate
only under the same preflight-captured, reviewed-generated-alias conditions
described above. It no longer needs a separate discovery pass, because App's
candidate `deploymentId` is known from the stage receipt before activation
starts, exactly like every other target.

#### Historical note: same-run App custom-`v3` payload handoff

Before this change, `stage-app` built a custom-`v3` output with no provider
deployment and handed the verified tree to `activate-and-verify` as a single
archive artifact (`vercel-main-app-v3-payload-<run id>-<run attempt>`), which
the coordinator extracted, re-verified, and deployed with `vercel deploy
--prebuilt --target=v3`. That payload-transport apparatus — the archive
contract, its digest/byte-count job outputs, and the coordinator's
post-extraction `assert-output` re-verification — no longer exists. `stage-app`
now uploads its own candidate directly, like every other target, so no tree
ever needs to travel between jobs.

### Reviewed generated-alias topology

Every staged upload runs `vercel deploy --prebuilt --prod --skip-domain`,
which moves only the reviewed generated Vercel system aliases described
here. These aliases are candidate-upload evidence, never runtime-smoke
endpoints or rollback mappings.

`--skip-domain` suppresses custom production-domain assignment. Vercel's
[generated-URL contract](https://vercel.com/docs/deployments/generated-urls)
documents a CLI project/scope URL and, for Team deployments, an optional
project/author/scope URL. The immutable deployment hostname remains separate
deployment identity. Read-only evidence matched both documented provider alias
forms: run `30034411210` exposed only the base alias, while run `30037927329`
exposed the base alias plus the creator-scoped alias. The CLI offers no
supported zero-generated-alias mode.

The controller pins the project and scope slugs for each literal target and
requires its base alias:

- App: `appmentoorg-mentolabs.vercel.app`
- Governance: `governancementoorg-mentolabs.vercel.app`
- Reserve: `reservementoorg-mentolabs.vercel.app`
- UI: `uimentoorg-mentolabs.vercel.app`

It permits at most one additional alias: the exact
`<project-slug>-<creator-username>-<scope-slug>.vercel.app` value derived from
the same deployment response's canonical `creator.username`. The canonical
state retains only that sanitized username; creator IDs, email, avatar, display
name, Git author metadata, and `GITHUB_ACTOR` cannot authorize an alias. A
creator username beginning with the reserved `git-` or `env-` generated-alias
namespace can still produce the required base-only topology, but cannot
authorize an author alias because that hostname is indistinguishable from
Vercel's documented Git branch or custom-environment form. A
creator whose full project/author/scope label exceeds DNS's 63-character limit
can also use only the base topology; the provider's documented truncation is
not stable enough to authorize without a reviewed contract update. A
missing base alias, creator-less or wrong-author alias, protected/custom domain,
branch or global alias, wrong-target alias, second author alias, immutable
hostname in the alias list, or malformed canonical evidence fails closed. The
read-only state inspector normalizes and deduplicates raw provider aliases;
persisted canonical evidence must remain deduplicated and sorted.

That base-required topology applies to an ordinary candidate absent from the
trusted preflight. A candidate captured there before the job could build one
may use a canonical subset of only the reviewed project/scope and creator
aliases, including the empty subset, because recovery promotion can move both
aliases back to the prior deployment. A `create-if-zero` preflight does not
receive this relaxed topology. The
immutable hostname, protected/custom domains, project-default alias, Git alias,
wrong-target alias, and every other alias remain forbidden.

Served-prior planning uses a separate finite contract because generated aliases
can move independently of the protected production domain. For all four
targets — App included, now that its prior is always production-shaped — a
served deployment may retain any canonical subset of its reviewed base
project/scope alias, exact project-default alias, exact canonical creator
alias when that name is safe, and literal native-Git `main` alias:

- App: `appmentoorg-mentolabs.vercel.app`, `appmentoorg.vercel.app`, and
  `appmentoorg-git-main-mentolabs.vercel.app`
- Governance: `governancementoorg-mentolabs.vercel.app`,
  `governancementoorg.vercel.app`, and
  `governancementoorg-git-main-mentolabs.vercel.app`
- Reserve: `reservementoorg-mentolabs.vercel.app`,
  `reservementoorg.vercel.app`, and
  `reservementoorg-git-main-mentolabs.vercel.app`
- UI: `uimentoorg-mentolabs.vercel.app`, `uimentoorg.vercel.app`, and
  `uimentoorg-git-main-mentolabs.vercel.app`

After validating that finite set, the planner removes all generated-alias
evidence from the canonical prior. None of these aliases is a protected mapping
or rollback input. Another project's default alias, another Git branch, a
custom or wrong-target alias, a creator or project-default near miss, an unknown
alias, or duplicate or unsorted canonical evidence fails closed.
For `restore-before-planning`, the workflow calls
`candidate-finalize-inherited`, which is fixed to this served-prior mode for
every inherited target — App, Governance, Reserve, and UI. A target only enters
inherited restoration once all of its reviewed aliases already map to the
inherited candidate, so that candidate necessarily carries its protected public
alias. Ordinary `candidate-finalize` forbids a protected alias on a candidate,
so it cannot finalize any inherited target, App included. Ordinary
`candidate-finalize` requires the base alias for a candidate absent from its
trusted preflight and allows the reviewed detached subset only for the exact
candidate already captured there. The inherited finalizer requires the target's exact protected
public alias in the deployment's full alias list, removes that reviewed alias,
then validates the remaining generated aliases against the finite served-prior
set.
Protected-domain before/after equality remains the decisive proof that the
upload did not activate protected/custom production traffic. A future
provider-generated alias topology must fail first and receive a reviewed
contract update rather than being accepted implicitly.

### Active transaction, durable journal, and recovery

The coordinator validates that every selected stage succeeded and every
unselected stage skipped, then revalidates the captured prior mappings.
`stage-app` is validated the same way as Governance, Reserve, and UI: selected
means the job succeeded with a candidate receipt, unselected means the job
skipped with none.
It checks the remote `main` SHA before preparing the transaction. If `main`
advanced before any durable intent or public mutation, the newer workflow owns
convergence and the current run exits without activation.

The release ID and target-specific candidate ID used to find a reusable
candidate are stable across downstream reruns. The provider-side stable release
manifest is the sole durable cross-attempt authority. The journal transaction
ID, every journal artifact name, and every mutation authorization remain bound
to this downstream `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT`. A rerun therefore
creates and owns its own journal; it does not continue a prior attempt's
journal even when it reuses a candidate.

For a current SHA whose selected targets are all in `shadowTargets`, the
coordinator records the explicit successful `shadow-prepared` outcome after
validating their stage/build evidence. It creates no active journal, skips
active recovery as `not-required`, and issues no public mutation. This is the
target-local main rollback path when no selected GitHub-owned target also needs
activation.

For `verify-existing-release`, the coordinator takes the separate successful
`current-release-verified` route. It creates no journal and executes no public
mutation. It still captures fresh final mappings, the active deployment
census/state, raw runtime-smoke results, and remote-`main`
freshness before emitting terminal evidence. Inactive runtime-smoke inputs are
literal JSON `null`; active inputs remain the raw runtime results for canonical
validation.

When at least one selected target is in `activeTargets`, the workflow creates a
canonical prepared journal, uploads the exact bytes under their
sequence-derived artifact name, and requires a positive artifact ID before it
can continue. Every forward operation follows the same durable sequence:

1. recheck remote `main` freshness and the protected mapping;
2. append and upload the operation's `started` journal transition;
3. execute one allowlisted mutation command;
4. inspect the exact resulting mapping;
5. append and upload the command-returned and verified transitions.

Governance, Reserve, UI, and App use
`vercel promote <exact-staged-id-or-url>` in canonical target order. App
promotes last and is verified at candidate, the same as every other target.
The protected executor binds every Vercel mutation to the validated
`VERCEL_ORG_ID` with the CLI's explicit `--scope` option; the durable command
descriptor cannot supply or override that runner-owned scope.
Targets in `shadowTargets` use the same staged/build verification but never
enter the mutation list. After all active operations and public smokes pass,
the controller persists the committed journal state.

The checked-in all-GitHub-owned path is statically unrolled for up to the
prepared snapshot, three snapshots for each of the four forward operations
(Governance, Reserve, UI, App — one promote per promotable target), then the
committed snapshot: at most 14 journal artifacts (1 prepared + 4 × 3 + 1
committed; sequence 0 through 13). A promote can already move its reviewed
domain, so a later turn safely stops at the reducer's no-journal final-proof
transition and does not upload an unused snapshot. The
reusable transition action accepts only a reviewed reducer authorization; it
does not accept a raw Vercel command or target name. This keeps the
upload-before-mutation boundary visible in the workflow while avoiding shell
iteration over targets.

For `no-target`, `superseded-before-journal`, and the active controller's
no-active-target `shadow-prepared` outcome, recovery is explicitly
`not-required`. Otherwise the recovery job derives journal artifact identities
instead of trusting coordinator outputs, downloads the complete attempt-scoped
sequence, validates its canonical identity and gap-free history, and selects
the highest valid snapshot. A prepared transaction with no started mutation is
`verified-no-mutation`. Any started or uncertain operation is inspected and
either verified as already restored or compensated in reverse mutation order
to the exact captured prior mapping. An unexpected operator-owned mapping
records manual intervention instead of overwriting it. The workflow
therefore has four static recovery turns — one compensation slot for each of
the four promotable targets (Governance, Reserve, UI, App) — followed by one
final terminalization invocation: five composite invocations per recovery
unrolling.
`recover-main-deployment` carries a 60-minute job timeout and
`restore-inherited-release` carries a 90-minute job timeout; each bounds those
composite invocations at the 120-second command limit alongside checkout, API
reads, journal artifacts, and cleanup.

Every current-attempt or inherited recovery source proof still requires the
admitted `DEPLOY_SHA` to exist, equal both the checked-out `HEAD` and
`GITHUB_WORKFLOW_SHA`, and remain an ancestor of freshly fetched `origin/main`.
Unlike forward admission, recovery deliberately permits `origin/main` to be a
newer descendant. A later main push can therefore stop forward work without
blocking compensation for an already-admitted transaction. An unrelated main
history, workflow-SHA mismatch, or checked-out-HEAD mismatch still fails closed
before any recovery step references provider credentials.

Each target's compensation is independent: an uncertain App transition does not
skip restoring exact Governance, Reserve, and UI candidate mappings in reverse
activation order before the controller terminalizes manual intervention.
Recovery, manual intervention, a missing journal after a possible mutation, and
recovery failure all fail the release after publishing redacted evidence.

If an exact current-attempt journal exists but recovery initialization cannot
produce the next durable recovery snapshot, the workflow classifies the outcome
as `recovery-failed`. It performs no recovery transition or provider mutation,
then publishes terminal evidence bound to the unchanged canonical journal
history before failing the release.

When a recovered journal, fresh protected alias mappings, and all four
credential-free restored-prior runtime smokes are verified, a later duplicate
census can still be unproven because a bounded provider read failed or the
census found an unexpected deployment. The workflow records only a fixed,
non-secret census-failure category in terminal evidence, preserves the verified
recovery journal, mappings, and smokes, and reports
`recovered-census-unproven`. It never treats that outcome as a proven census or
as a successful release: the recovery job and final result fail after the
evidence is published. A mapping or smoke failure does not use this path.

If provider reconciliation cannot establish one safe manifest and either a
canonical forward mapping prefix or the exact terminal App recovery residual,
do not delete or recreate evidence. Inspect the live protected state and use
the current-attempt recovery contract where the reconciliation decision permits
it. Otherwise follow the target-local or full-native rollback procedure, verify
the protected mappings, and begin a new release only from a new validated
upstream CI run. Do not create a GitHub-artifact or prior-journal fallback path.

The terminal producer emits one canonical, redacted terminal receipt and
terminal evidence before the `result` job selects the final outcome. They bind
the release manifest and execution digests, final mapping and duplicate census,
public smoke, affected operations, and terminal journal
status. They are deliberately bounded compact values, not another artifact
channel. The `result` job restores only these values for final evaluation; a
final-only rerun does the same. It never downloads verdict artifacts, resumes a
prior journal, or reconstructs a final verdict from earlier attempts. An absent,
malformed, mismatched, or incomplete receipt/evidence pair fails closed instead
of treating the process outcome as deployment success.

The receipt keeps its `vercel-main-terminal-receipt:v3` schema and its exact
key set: it carries proof digests, never artifacts, so rider domains are not
part of it. They travel in the terminal evidence artifact instead. Every
evidence schema that can represent a public mapping mutation carries a
`riderAliases` map in its exact key order: `vercel-main-active-evidence:v2`,
`vercel-main-active-current-release-evidence:v2`, and
`vercel-main-active-failure-evidence:v2`, so a recovered, manual-intervention,
or already-current outcome names the domains its promote moved. Outcomes that
mutate nothing — safe-noop, preparation failure, `no-target` — carry no map.

The map holds one entry per target the release actually promoted; a target that
was not selected, is shadow-owned, or was never promoted moved nothing and gets
no entry and no rendered line. "Actually promoted" is read from the journal, not
from the plan: a failure evidence's scope is the set of targets whose `promote`
reached the `started` state, the same operation log the mutation count comes
from. A journal still at `prepared` therefore names nothing, and one that
started only a prefix of its plan names only that prefix. A committed release
and an already-current one promoted every active target by construction, so
their maps stay keyed on exactly those; a failure evidence keys on a canonical
ordered subset. Both creator and reader also enforce the bound the report makes
visible: a map may never claim more moved targets than the
`publicServingMutationCommands` printed beside it, and a run proving zero
started mutations carries no map at all.

Each entry is `{aliases, omitted}`: canonical, sorted, deduplicated hostnames,
capped at `MAIN_RIDER_ALIAS_TARGET_LIMIT` (16) per target and at
`MAIN_RIDER_ALIAS_BYTE_BUDGET` (4096 bytes) across the map, with `omitted`
counting what the caps dropped. Truncation is deliberate and deterministic:
visibility must never become a new way for a deploy to fail, and the budget sits
far below the 64 KiB terminal-evidence and 256 KiB bridge caps so the rider map
can never be what overruns an artifact.

An entry of `null` is the third state: **not attributed**. Wherever a journal
exists, each censused target is correlated with the deployment identity
(`deploymentId` and `deploymentUrl`) this release owned for it — the captured
prior it would roll back to, or the candidate it promoted. A `manual-intervention`
is defined by a reviewed protected domain the pipeline can no longer account
for, and the post-recovery census can still read that domain successfully while
it points at a third, operator-owned deployment. Those domains are not this
release's to claim, so the entry becomes `null` and renders as
`not attributed (deployment this release does not own)`. The unowned
deployment's hostnames never enter the evidence at all.

A whole map of `null` means the producing job took no census, and how that
renders depends on whether the run could have moved anything at all. When the
journal proves zero public-serving mutation commands — `verified-noop`, and the
journal-free `current-release-verified` path — the report says
`none (no mutation in this run)`; claiming `unknown` there would contradict the
mutation count printed beside it. `unknown (no census in this job)` is reserved
for the case it describes: a mutation may have started and the job holds no
census. Every job that can report a started mutation now takes one, so that
line means exactly one thing: the census read itself did not complete.

`recover-main-deployment` takes two censuses, each with the same read-only
`planning-snapshot` verb the activation job uses, against the same
`create-spec --scope main` specification, inside the protected recovery runtime
the job already prepares for `vercel rollback`. Both are read-only, so neither
is a new credential exposure.

- **After the compensation slots**, for the `recovered`,
  `recovered-census-unproven`, and `manual-intervention` outcomes. It reports
  what each target's reviewed protected domain travels with once recovery is
  finished: the riders a completed rollback restored onto the prior, or, where
  a target was left forward for manual intervention, the ones still riding with
  the candidate. Where it finds neither, the entry is `not attributed` rather
  than a set of somebody else's domains.
- **Before any compensation**, for `recovery-failed` — that branch runs no
  slot, so the provider still serves whatever the forward promote left, and the
  census names the domains that promote moved and nothing moved back.

Together they answer the reader's question — what did this release move — from
the state each branch actually ends in. A second, pre-recovery census on the
recovered branch was considered and rejected: for a completed rollback its
result is the same set observed a moment earlier, the differences it could show
are provider-generated alias churn the pipeline already declares
non-authoritative, and carrying two maps would bump an evidence schema for a
field no decision reads. `preparation-failed-before-journal` needs no census —
it proves no journal was ever created, so its evidence carries no rider line at
all.

Riders are informational: no selection, verification, or recovery decision
reads them. A recovery census read that cannot complete therefore degrades to a
null snapshot — rendered as `unknown (no census in this job)` — instead of
failing its step and taking the terminal evidence with it. The degradation is
bounded to the reader's own failure vocabulary (`provider-read-timeout`,
`-transport`, `-rate-limited`, `-http`, `-malformed`, and
`state-validation-failed`); any other stderr still fails the census step closed,
but only after the null census is written, so the `recovery-failed` consumer —
which runs under `always()` — publishes its evidence instead of dying on a path
that is not there. A target left
mid-recovery whose reviewed domains no longer share one deployment fails the
planning capture as `state-validation-failed`, so that case reports `unknown`
rather than a misleading set.

Only jobs that capture a planning snapshot may pass `--rider-census`, and the
option is read immediately, so a step that supplies a path the job does not
produce fails the terminal handoff outright. The `verify-existing-release`
branch of `activate-and-verify` captures no snapshot and therefore supplies
none, and `restore-inherited-release` publishes no terminal evidence at all, so
it has no rider line to fill and takes no census. A structural workflow test
requires every `terminal-artifacts` invocation that passes `--rider-census` to
have an earlier producer of that file in the same job whose condition is
implied by its own; both recovery producers state their consumer's exact
condition, which is stronger.

The terminal reader carries the map rather than re-deriving it (riders are
mutable, and a later read would legitimately disagree), but still holds it to
the canonical shape, the caps, and the promoted-target scope.

The `result` job evaluates the terminal receipt and evidence and sets the
`Vercel Main Deployment` workflow outcome. The `Fail closed before release
execution exists` sentinel fires whenever no release execution exists and the
deploy mode is not the proven `already-deployed` no-op. A failed admission that
emits no deploy mode therefore still ends red. The duplicate no-op remains the
only journal-free successful path without release execution.

Measured baseline and per-change projections, both from CI run
`33052008461` and deployment run `33052232367` on `54422f5c` (2026-08-27):
push to activation was 17m54s and push to a green check 18m14s, with CI itself
2m56s. The CI-overlap change hides about 84 seconds of that CI time behind
admission and `provider-preplan`, so its component saving is roughly 1m17s.
The parallel `stage-app` change removes about 125 seconds of App
preflight/pull/build/proof from the activation job and adds about 25-60
seconds of payload download, extraction, and re-verification, so its component
saving is roughly 65-100 seconds. The first post-merge run measured 16m32s
push to green (run 33084034097, 2026-08-27), with the difference from the
projection attributable to run variance. The overlap figure assumes admission finishes in seconds,
which is why it reads no jobs: in the same run the `Build and Test` record did
not exist until 2m50s in, so any wait on it would have consumed the whole
saving.

A later change recovered the rest of that overlap. On deployment run
`33084034097` the skipped `restore-inherited-release` reported both its start
and its completion at 14:49:00, exactly the gate job's completion, and
`prepare-release` then ran 14:49:04–14:50:30, of which only the final
1-second `Create and encode release execution` step needed the sentinel; the
stages started at 14:50:33. Moving both jobs off the gate `needs` edge — an
in-job gate for restoration, a self-gate before the sentinel consumer for
preparation — starts `prepare-release` at about 14:47:33 and the stages at
about 14:49:07, a measured 86-second saving with an honest range of 70–90
seconds, against that run's 190-second CI.

That 86 seconds is the value at a 190-second CI, not a constant. The pre-gate
prefix — run-start latency, admission, preplan, and `prepare-release`'s census —
runs 187 seconds from the push and does not depend on how long CI takes. It is
therefore a floor: once CI finishes inside it, the stages start at about that
floor however fast CI gets. Against CI's 190 seconds the overlap hid CI with
about 3 seconds of slack. Below roughly 3.1 minutes of CI the prefix is the
critical path, and the overlap saving becomes the gap between that floor and the
unoverlapped path — CI, then the gate job, the skipped restore, and the full
86-second census — so it shrinks by one second for every second CI drops.

The unit-suite sharding landed in the same change and is expected to put CI
under that floor, so the two savings do not add. Sharding's benefit lands
almost entirely on the `CI/CD` check itself, which is PR feedback. The deploy
path inherits only what CI ran past the prefix: on the measured run that is the
3-second overrun plus the gate's 5-second poll interval, so roughly 8 seconds,
not the whole shard saving. Re-measure both the sharded CI wall and the pre-gate
prefix from the first post-merge runs. If the sharded wall does land below 187
seconds, the next push-to-live win has to come out of the prefix — run-start
latency, admission, preplan, or the census — and not out of CI.

The cost is a wider census window. `prepare-release`'s wholly fresh provider
census now completes before CI succeeds rather than after, so the
census-to-first-mutation gap grows from roughly 8–50 seconds to roughly
16–77 seconds on the fast path, and up to the remaining CI time (bounded by the
30-minute await) on a slow CI. `queue: single` means nothing else writes those
mappings meanwhile, and every stage and activation adapter re-asserts the prior
it is replacing against the execution blob before mutating, so drift still
fails closed at mutation time.

Generic JSON bridge inputs and outputs remain capped at 256 KiB. Full active
journal history and terminal proofs alone use dedicated 1 MiB ceilings. That
bound admits the structurally limited 8-operation transaction envelope: four
forward operations (one promote per promotable target) plus four recovery
operations (one compensation slot per promotable target). It does not widen
single-journal, provider-discovery, plan, mapping, smoke, or other workflow
inputs.

### Historical PR-A shadow canary and copy-safe diagnostics

The `result` job evaluates the complete graph without ending the job, then
writes and uploads one canonical redacted report before it returns the terminal
result. A safe graph uses schema `vercel-main-evidence:v2`; any failed gate,
planner, stage, coordinator, recovery, or final validation uses the separate
`vercel-main-failure-evidence:v1` schema. Failure evidence records only trusted
run identity, valid SHA values when available, whether planner output existed,
the literal job-result graph, and the shadow invariant of zero public-serving
mutation commands. It never parses or embeds an unavailable or malformed plan.
The job fails only after the failure report is uploaded, so the diagnostic
artifact survives without weakening the sentinel.

Both paths append their canonical redacted report to `$GITHUB_STEP_SUMMARY` and
upload the exact JSON as artifact
`vercel-main-evidence-${run_id}-${run_attempt}` with seven-day retention. Link the
first merged PR-A run and artifact on issue #522 or its PR; do not embed observed
IDs in this canonical runbook. The evidence contains only:

- downstream workflow run ID, attempt, URL, and exact workflow-definition SHA;
- upstream run ID/attempt, `Build and Test` URL/conclusion, and `DEPLOY_SHA`;
- each target's canonical prior deployment ID/URL, public aliases, served-prior
  rider domains, served SHA, planner range, reason, and selected/skipped
  outcome;
- each selected ordinary staged deployment ID/URL plus canonical state,
  immutable browser/runtime/security, and protected-mapping results;
- App build result and validated deterministic Next deployment ID, without a
  Vercel deployment ID or URL;
- coordinator outcome; journal name, ID, sequence, status, and transaction ID
  when durable; and the recovery outcome;
- both freshness decisions, per-target and coordinator durations, and Turbo
  cache hits/misses;
- an empty ordinary rollback-state target set;
- a zero count for public-serving activation, alias, promotion, rollback, and
  recovery commands.

The canonical `deploymentUrl` is immutable deployment identity, not an API
alias: its hostname is never added to or derived into the alias topology. The
controller does not authorize creator aliases, arbitrary immutable hosts, or
another project, branch, scope, default, suffix, team, or custom-domain alias.
Any topology difference fails before staging.

If only that generated-alias topology is rejected, the diagnostic contains only
the canonical actual aliases, the canonical creator username (or `null`), and
the finite expected canonical alias topologies. It excludes deployment and
project IDs, deployment URLs, Git metadata, raw provider responses, and secrets.

Use these copy-safe diagnostics:

```bash
gh run view <run-id> \
  --repo mento-protocol/frontend-monorepo \
  --attempt <run-attempt>

gh run view <run-id> \
  --repo mento-protocol/frontend-monorepo \
  --job <failed-job-id> \
  --log-failed
```

Copy only the allowlisted summary fields above. Never attach raw GitHub or
Vercel API bodies, pulled `.env` files, `.vercel/output`, cookies, tokens,
bypass values, environment dumps, or unreviewed workflow artifacts.

### Active ownership and runtime proof

The checked-in ownership configuration keeps the controller in literal
`active` mode and disables the replaced native `main` paths: for Governance,
Reserve, App, and UI, `git.deploymentEnabled` is the boolean `false`,
disabling every native Git deployment.

The canonical `mainOwnershipMode` map assigns all four targets to `github`.
Tests accept only that pairing or a reviewed rollback pairing described below.

Preview and main Vercel Git ownership are independent per target. Vercel treats
an unspecified branch as enabled and creates a deployment when any matching
rule is `true`. The executable model therefore accepts exactly four states:

| Preview owner | Main owner | Exact branch-rule shape                                                  |
| ------------- | ---------- | ------------------------------------------------------------------------ |
| GitHub        | GitHub     | Disable all branches                                                     |
| GitHub        | Native     | Disable `**`, enable `main`                                              |
| Native        | GitHub     | Disable `main` and `dependabot/**`, leave other preview branches enabled |
| Native        | Native     | Disable only `dependabot/**`                                             |

Changing either owner requires the matching exact `vercel.json` state in the
same reviewed commit. A preview rollback must not restore native `main`; a main
rollback must not restore ordinary native previews.

Active mode reuses the prepared transaction and journal identity. It stages and
verifies Governance, Reserve, UI, and App, then mutates targets sequentially
from exact immutable IDs. Before every command it uploads a `started` journal;
after the command it inspects exact public mapping and uploads the verified
next sequence. Governance, Reserve, UI, and App all use
`vercel promote <exact-staged-id-or-url>`, in that canonical order. App's
promote is verified at `candidate`, the same as every other target — the
domain lives in the ordinary Production environment, so the promote carries
it directly. The executor adds the validated runner-owned `VERCEL_ORG_ID` as
the exact CLI `--scope`; command descriptors cannot select a different
account.

#### Transition complete (2026-09-02)

MGP-18's final tighten step removed every transitional mechanism that carried
`app.mento.org` while it still lived in the retiring `v3` custom environment.
App now promotes and is verified exactly like Governance, Reserve, and UI:

- there is no bridge alias operation. `promote` and `ordinary_rollback` are the
  only operation types; `app_alias_set`, `app_alias_restore`, and the
  bridge-specific `verified_noop` rule are deleted;
- prior-facing and candidate-facing validation both require the production
  shape (`target: "production"`, `customEnvironmentSlug: null`) for App. A
  provider deployment in the retired v3 environment (`target: null`,
  `customEnvironmentSlug: "v3"`) fails closed before its metadata is read.
  One narrow historical admission remains, permanently: a mapped production
  deployment whose immutable seal carries a bridge-era release manifest —
  fully valid under the current contract except for the exact bridge-era App
  prior shape — is classified as an unmarked rollback-only prior. Seals are
  immutable and an operator rollback can re-map one at any time. Any other
  deviation in such a seal still fails closed;
- `grep -rn TRANSITION-V3-PRIOR scripts/` returns nothing; every tolerance site
  and its comment are deleted;
- the retired generated alias `appmentoorg-env-v3-mentolabs.vercel.app` is
  rejected everywhere it could appear — priors, candidates, and manual-pilot
  input; and
- `ENVIRONMENT_SEMANTICS.v3` is deleted from
  `scripts/vercel-build-environment.mjs`; `TARGET_ENVIRONMENTS.app` is
  `["preview", "production"]`, the same shape as every other target. No v3
  environment semantics exist anywhere in this repository.

Provider-side, `app.mento.org` is a Production-environment domain,
`v2-app.mento.org` is a 308 redirect to `app.mento.org`, and the `v3` custom
environment is empty. It is deleted from the Vercel project after this PR
merges.

After active-mode activation, run the credential-free public smoke for every
selected target with its literal URL:

| `LOGICAL_TARGET` | `PUBLIC_URL`                    |
| ---------------- | ------------------------------- |
| `app`            | `https://app.mento.org/`        |
| `governance`     | `https://governance.mento.org/` |
| `reserve`        | `https://reserve.mento.org/`    |
| `ui`             | `https://ui.mento.org/`         |

```bash
LOGICAL_TARGET=<app|governance|reserve|ui> \
PUBLIC_URL=<matching-literal-url-above> \
DEPLOY_SHA=<lowercase-40-character-sha> \
node scripts/vercel-main-runtime.mjs
```

The checker binds `X-Mento-Deployment-Sha` and the required security headers,
requires successful same-origin document/script/style/font resources, and
rejects page and console errors, failed critical static resources from any
origin, and failed same-origin fetch/XHR traffic outside its narrow optional
telemetry exception. It exercises Governance voting-power navigation, Reserve
Overview data and Supply state, and UI search, navigation, and checkbox state.
App uses the real production wallet list: MetaMask and WalletConnect must be
visible, the E2E Test Wallet must be absent, and no preview/mock-wallet
local-storage flag may exist.

After activation, the final evidence performs an active duplicate census for
every protected main project. It binds the exact candidate and original-prior
deployment IDs and URLs, project, environment, `DEPLOY_SHA`, stable release
manifest, and relevant release interval. Vercel's optional `source` value is
retained only as telemetry and cannot admit or reject an attempt.

For a GitHub-owned target, the census may contain the canonical candidate and
at most the exact manifest-bound same-SHA original prior. The separate protected
mapping proof must still show that the candidate owns every reviewed public
alias; the historical prior never authorizes that mapping. When the release
plan has no expected candidate for a project, the census records an
exact-project, exact-SHA deployment in terminal `CANCELED` state as
`inertCanceled`. This evidence may coexist with a proven release, but it cannot
satisfy an expected candidate or protected mapping. Any different `READY`
deployment, any canceled expected candidate, any pending deployment, or any
malformed record is an unexpected duplicate or unknown state and fails the
release.
The prior match uses its bound deployment ID, URL, project, environment, and a
freshly inspected response SHA equal to `DEPLOY_SHA`; optional Git organization,
repository, ref, and `source` fields are telemetry and cannot reject that exact
prior. Candidate classification still requires canonical
`mento-protocol/frontend-monorepo@main` Git identity and exact Mento metadata.
For a shadow-owned target, the exact bound prior may remain the public owner
while the staged candidate is verified without mutation. Missing, incomplete,
or ambiguous evidence fails the release.

Record PR-B observed deployment IDs, mappings, mutation sequences, public smoke
results, and native-duplicate proof on PR B or issue #522.
Do not paste observed IDs into this runbook.

### Exact transaction recovery

Recovery always starts from the highest valid journal for the exact repository,
SHA, run ID, run attempt, and transaction ID. It inspects the current mapping
before acting. Mapping already at the captured prior is a no-op; mapping at the
candidate or partially moved is restored in reverse mutation order; an
unexpected operator-owned mapping stops for manual review.

For each promotable target that moved and whose captured prior is
production-shaped, run the journal's exact command:

```text
vercel rollback <captured-prior-id-or-url>
```

Then bounded-wait for readiness, inspect every reviewed public custom domain,
verify the exact captured prior ID, run the public browser smoke, and record
that the project entered rollback state. Never substitute `latest`. App's
prior is always production-shaped, so App recovers through this same
`vercel rollback` command as every other target — there is no separate App
exception.

### Target-local main ownership rollback

Use target-local rollback when one `main` path must return to native Vercel
without disabling proven GitHub-owned targets:

1. In one reviewed recovery PR, change only that target's
   `mainOwnershipMode` from `github` to `shadow` and restore its exact native
   `main` branch rule. Governance, Reserve, UI, and App all use
   `{"**": false, "main": true}`. Keep the global main controller `active`.
2. Leave every target's preview `ownershipMode` as `github` and leave the
   preview controller `active`. Main rollback never re-enables ordinary native
   branch previews.
3. Prove the mixed `vercel-main-plan:v2` partition. The recovered target must
   appear in `shadowTargets` when selected; other GitHub-owned selected targets
   remain in `activeTargets`. The workflow still stages or builds the recovered
   target but cannot include it in the forward mutation list.
4. For an ordinary project in rollback state, capture the recovery PR's exact
   unaliased native deployment and run
   `vercel promote <exact-native-canary-id-or-url>` to exit rollback state.
5. Verify that exact canary on the public domain with deployment state and
   browser smoke. Push a second reviewed target-local canary and prove native
   Vercel Git moves the domain automatically while the GitHub path remains
   mutation-free for that target.
6. Before a later re-cutover, repeat the shadow proof, then change that target's
   main ownership map and exact Vercel branch rule back to the GitHub pairing in
   one reviewed commit.

Restoring only `vercel.json` is insufficient after `vercel rollback`; the exact
promote/canary sequence proves native automatic ownership has resumed.

### Full-native main rollback

Use a separate coordinated rollback when all four `main` paths must return to
native Vercel:

1. In one reviewed recovery PR, set all four `mainOwnershipMode` entries to
   `shadow` and restore every exact native `main` branch rule listed above.
2. Only after all four entries are `shadow` may the global main controller
   change from `active` to literal `shadow`. Mixed ownership with global
   `shadow` is invalid.
3. Prove planning, staging/build verification, and zero GitHub public mutation
   for all selected targets, then prove each native path with exact deployment
   state, public smoke, and the duplicate census.
4. Keep all four previews GitHub-owned unless a separate reviewed preview
   rollback is required. Do not couple main-owner restoration to preview
   ownership or recreate the removed Governance QA environment.
5. Verify App `main -> production` like every other target.
6. Before any rollback that removes a target's catch-all branch rule, confirm
   the retired `v2` branch is deleted and the App project's production-branch
   setting no longer names it. A branch-rule map without a matching rule
   enables native deploys for that branch by default.

## Pinned prerequisites

- Vercel CLI: the exact version recorded in
  `scripts/vercel-cli-runtime/contract.json` in both the root `devDependencies`
  and standalone `scripts/vercel-cli-runtime/package.json` dependency. The root dependency
  remains available for reviewed operator commands; protected
  main-deployment jobs install only the standalone runtime. The project owner approved the dependency as part of delivering the
  epic. The stable npm version was re-queried on 2026-07-14 before it was
  pinned.
- Resolved Next.js: `16.2.11` in `pnpm-lock.yaml`.

Both exceed Vercel's custom deployment-ID prerequisites: Next.js newer than
`16.2.0-canary.15` and Vercel CLI newer than `50.3.3`. Verify this invariant
without contacting Vercel:

```bash
pnpm vercel:versions:check
```

Do not replace the pinned CLI with `npx vercel@latest` in automation.

## Temporary sharp 0.35 output-tracing guard

The root conditional override forces vulnerable `sharp >=0.34.0 <0.35.0`
consumers to `0.35.3`, which includes libvips 8.18.3. Stable Next.js 16.2.11
does not yet recognize sharp 0.35's versioned native-addon filename during
Turbopack output tracing. A build can otherwise succeed while omitting the
native addon or matching libvips shared library from the deployed function.

All four Next configs call `sharpOutputFileTracingConfig` from
`scripts/next-sharp-output-tracing.mjs`. It adds only the build host's exact
platform and architecture packages to `outputFileTracingIncludes`; it must not
fall back to another optional platform package that happens to exist in the
pnpm store. Each app's `postbuild` lifecycle then runs
`scripts/assert-next-sharp-trace.mjs` and fails unless one output trace contains
the exact sharp 0.35.3 manifest, host-native versioned addon, libvips shared
library, and libvips 8.18.3 manifest.

The trusted prebuilt workflow independently scans the final
`.vercel/output` tree before upload. It rejects an output that lacks the exact
Linux runtime pair, even if the earlier Next build succeeded. Keep both checks
until [issue #587](https://github.com/mento-protocol/frontend-monorepo/issues/587)
verifies that a stable Next.js release contains the upstream tracing and image
optimizer fixes. Do not replace this with a canary Next.js release or a patched
compiled `@next/swc-*` binary.

## Affected-deployment planner

`scripts/plan-vercel-deployments.mjs` accepts an immutable base and head commit
SHA and emits one JSON object. Both commits must already be present locally.

```bash
pnpm vercel:plan --base "$BASE_SHA" --head "$HEAD_SHA"
```

Example output:

```json
{
  "deployments": ["app", "reserve"],
  "base": "<full-base-sha>",
  "head": "<full-head-sha>",
  "reason": "affected-packages"
}
```

The only deployment names are `app`, `governance`, `reserve`, and `ui`, always
in that order. Normal source changes are classified with Turborepo's package
graph by running `turbo run build --affected --dry=json` with explicit
`TURBO_SCM_BASE` and `TURBO_SCM_HEAD` values.

The planner returns all four deployments when it cannot prove a narrower plan.
This includes invalid or non-ancestral commits, an empty or unreadable diff,
malformed Turbo output, a change with no deployable task, deployment-planner or
workflow changes, and cross-workspace inputs such as the lockfile, root package
configuration, `turbo.json`, patches, or shared security headers. Proven
documentation and test-only paths return an empty deployment list. There is no
dependency-maintenance workflow exception or prefix-based script exception.
The exact `.github/dependabot.yml`, `.github/dependabot-prep-policy.json`, and
`scripts/dependency-policy.test.mjs` files are retained non-runtime exceptions.
A workflow change mixed with an application, package, lockfile,
security-header, CI, Vercel, unknown, renamed, or near-match path still selects
all four deployments. Every retained non-runtime exception names an exact
reviewed file. It does not use a workflow or script prefix.

The measured full-release baseline was main release
[32613743546](https://github.com/mento-protocol/frontend-monorepo/actions/runs/32613743546)
at 16 minutes 29 seconds. Proven no-target run
[32589062985](https://github.com/mento-protocol/frontend-monorepo/actions/runs/32589062985)
took 4 minutes 5 seconds. The comparison projects a reduction of 12 minutes
24 seconds, or 75 percent, for that release shape. Main release
[32767236124](https://github.com/mento-protocol/frontend-monorepo/actions/runs/32767236124)
for merge `5b9b5d0b` completed in 4 minutes 48 seconds. This was 11 minutes
41 seconds, or a 70.9 percent reduction in duration compared with the baseline.
Its release plan had empty staged, active, and shadow target sets and completed
with the `no-target` outcome. The no-target route still binds the exact
successful main CI attempt. It skips candidate staging, provider mutation
transitions, Chromium installation, and public runtime smoke only when its
evidence binds an explicit empty affected-target set. Affected and mixed
releases retain exact-SHA candidate staging, journal checkpoints, bounded
recovery, public runtime smoke, and the final provider census.

### Trusted-base execution

The planner imports only Node.js built-ins, but its affected-package query uses
the trusted base's pinned Turbo dependency graph. The automatic controller
first checks out the immutable `github.workflow_sha` with full history. It then
requires the exact trusted base to be an ancestor of that workflow commit before
materializing it, fetches the candidate only as an inert Git object, installs
the trusted base's root workspace project without lifecycle scripts, and
executes the base's planner. The filter is safe because the planner needs only
the root `turbo` binary and reads workspace manifests plus the lockfile, never
per-package `node_modules`. Dependency caching is disabled in these planner jobs
so they never restore or save a shared Actions cache across this trust boundary:

```bash
git merge-base --is-ancestor "$BASE_SHA" "$WORKFLOW_SHA"
git checkout --detach "$BASE_SHA"
git fetch --force --no-tags origin "$HEAD_SHA"
pnpm --filter frontend-monorepo install --ignore-scripts --frozen-lockfile
node scripts/plan-vercel-deployments.mjs \
  --base "$BASE_SHA" \
  --head "$HEAD_SHA"
```

Never check out or import classifier code from the pull-request head into this
trusted planner process. Fetch enough history to resolve both exact commits
before calling it. A missing base is a full-deploy plan, not an empty plan.

## Custom Next.js deployment IDs and stable active-main release identity

Every prebuilt deployment attempt gets one ID derived from four immutable
inputs:

- logical target;
- full commit SHA;
- GitHub `run_id`;
- GitHub `run_attempt`.

Generate the ID once per target and workflow attempt:

```bash
MENTO_NEXT_DEPLOYMENT_ID="$(pnpm --silent vercel:deployment-id \
  --target "$TARGET" \
  --sha "$DEPLOY_SHA" \
  --run-id "$GITHUB_RUN_ID" \
  --run-attempt "$GITHUB_RUN_ATTEMPT")"
export MENTO_NEXT_DEPLOYMENT_ID
```

The result is deterministic for the same four inputs, differs between targets
and reruns, is at most 32 characters, uses only Vercel's supported character
set, and never begins with the reserved `dpl_` prefix.

Active-main uses the target-specific candidate ID
(`releaseId + target`) for its Next.js deployment ID across downstream reruns;
release ID is repository, exact SHA, and validated upstream CI run ID. The
downstream run-and-attempt key continues to identify each active-main journal
and public mutation. Do not substitute a candidate identity for mutation
authorization.

All four `next.config.ts` files map `MENTO_NEXT_DEPLOYMENT_ID` to Next.js's
`deploymentId` option and disable Next.js's runtime deployment-ID override only
when that custom ID is set. This is the scoped workaround for
[vercel/next.js#94734](https://github.com/vercel/next.js/issues/94734): it
preserves the build-time custom ID used by prebuilt Skew Protection while
leaving native Vercel Git builds unchanged. Each app's `turbo.json` includes the
variable in the build hash.

After `vercel build`, verify the build-bound ID before uploading anything:

```bash
pnpm vercel:prebuilt:assert \
  --expected "$MENTO_NEXT_DEPLOYMENT_ID" \
  --output "$PROJECT_DIRECTORY/.vercel/output"
```

The assertion reads the selected project's
`apps/<target>/.vercel/output/config.json` and fails when `deploymentId` is
missing or different. Next.js first writes the custom ID to its
`routes-manifest.json`; the pinned Vercel CLI carries that value into the final
Build Output API `config.json` that `--prebuilt` uploads. `vercel deploy
--prebuilt` must upload that exact, unchanged app-root `.vercel/output`
directory in the same job. Do not regenerate the ID, rebuild, transfer an
unverified artifact, or pass an invented deployment-ID option to
`vercel deploy`.

## Build-environment contract

Vercel system variables are injected on Vercel's builders, but a local
`vercel build` used for a prebuilt deployment does not receive those platform
values automatically. GitHub-built preview and main workflows restore the
following safe constants before validating and building:

| Deployment environment | `VERCEL_ENV` | `VERCEL_TARGET_ENV` | `NEXT_PUBLIC_VERCEL_ENV` |
| ---------------------- | ------------ | ------------------- | ------------------------ |
| Standard preview       | `preview`    | `preview`           | `preview`                |
| Production             | `production` | `production`        | `production`             |

App's `main` build uses the Production row, like every other target, and
receives `SENTRY_AUTH_TOKEN`. MGP-18's final tighten step deleted the
`ENVIRONMENT_SEMANTICS.v3` entry from `scripts/vercel-build-environment.mjs`;
`TARGET_ENVIRONMENTS.app` is `["preview", "production"]`, the same shape as
every other target. No v3 build environment exists anywhere in this
repository.

The repository's Vercel-system-variable reads are deliberately limited:

- `VERCEL_ENV` controls Sentry source-map upload in the app, governance, and
  reserve Next.js configurations and labels server/edge Sentry events in those
  apps.
- `NEXT_PUBLIC_VERCEL_ENV` labels browser Sentry events in app, governance, and
  reserve; selects production network behavior in `packages/web3`; and is a
  required governance client variable used by proposal rendering.
- `VERCEL_TARGET_ENV` selects preview-only CSP allowances in
  `scripts/security-headers.mjs`. Only the literal `preview` target permits the
  Vercel toolbar origin; App's production target remains strict, same as
  Governance, Reserve, and UI.
- No other Vercel system variable is a required build-time input in the current
  application source. A future read must be added to this contract and its
  fixture tests before the workflows may rely on it.

Validate the complete required-variable contract after `vercel pull` and after
adding only the applicable GitHub secret mirrors:

```bash
pnpm vercel:env:check \
  --target "$TARGET" \
  --environment "$ENVIRONMENT" \
  --project-directory "$PROJECT_DIRECTORY"
```

`PROJECT_DIRECTORY` identifies the directory whose
`.vercel/.env.<environment>.local` should be checked. The prebuilt worker points
this at a runner-owned, one-way materialization rather than the raw `vercel
pull` directory. The loader selects only requirements whose
`ciClassification` is `vercel-pull`, omits every unknown or Sensitive name, and
then overlays explicit workflow constants and the secrets allowed for that
exact target/environment. This makes the GitHub-scoped mirror the only accepted
source for a Sensitive value without depending on a denylist of names that may
appear in Vercel's raw file. A missing, empty, oversized, controlled, or
unrepresentable required value, missing scoped secret, or cross-target
Sensitive name fails closed. The checker prints variable names on failure but
never values.

Staged main candidates use a separate runner-owned staging boundary.
`PROJECT_DIRECTORY` must be the directory in which the Vercel CLI writes its
`.vercel` state. The main workflow launches the CLI from the
monorepo root, but first materializes a trusted root `.vercel/repo.json` mapping
and selects the literal project with `--project`. The contract-pinned CLI then writes
the pulled environment and project settings below `apps/<target>/.vercel`, so
the checker passes the literal `apps/<target>` directory. In this repo-linked
mode, identity lives only in the exact root `.vercel/repo.json` mapping;
app-root `project.json` must be settings-only and must not duplicate standalone
project, organization, or project-name identity. The controller verifies that
mapping and the configured Root Directory locally, then the following read-only
Vercel project API check independently verifies the literal project ID, name,
and Root Directory. The checker loads
`$PROJECT_DIRECTORY/.vercel/.env.<environment>.local`, then overlays explicit
workflow constants and scoped GitHub secrets so they take precedence. A missing
or invalid pulled file fails closed. Its machine-readable inventory is available
directly:

Production-shadow pulls intentionally omit `--git-branch`: the contract-pinned CLI
accepts that option only with the `preview` target. Every target, App
included, pulls with `--environment production`; the guarded source SHA,
`VERCEL_GIT_COMMIT_REF=main`, and deploy metadata carry exact-main provenance
independently. Those are raw, explicit Git identity and provenance fields;
they do not claim Vercel provider-linked branch-domain behavior.
`githubDeployment=1` remains intentionally forbidden by the issue contract.

```bash
node scripts/vercel-build-environment.mjs inventory \
  --target "$TARGET" \
  --environment "$ENVIRONMENT"
```

### Required application variables

`vercel-pull` means the value is ordinary Vercel project configuration that the
CLI can retrieve. `sensitive-non-exportable` means the value is marked Sensitive
and cannot be read after creation; it must be supplied from GitHub at the narrow
scope documented below.

| Target     | Variable                                | Required environments     | CI classification          |
| ---------- | --------------------------------------- | ------------------------- | -------------------------- |
| app        | `NEXT_PUBLIC_STORAGE_URL`               | preview, production       | `vercel-pull`              |
| app        | `NEXT_PUBLIC_WALLET_CONNECT_ID`         | preview, production       | `vercel-pull`              |
| app        | `NEXT_PUBLIC_SENTRY_DSN_SWAP`           | preview, production       | `vercel-pull`              |
| app        | `SENTRY_AUTH_TOKEN`                     | production semantics only | `sensitive-non-exportable` |
| governance | `NEXT_PUBLIC_BLOCKSCOUT_API_URL`        | preview, production       | `vercel-pull`              |
| governance | `NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL`    | preview, production       | `vercel-pull`              |
| governance | `NEXT_PUBLIC_ETHERSCAN_API_URL`         | preview, production       | `vercel-pull`              |
| governance | `NEXT_PUBLIC_GRAPH_API_KEY`             | preview, production       | `vercel-pull`              |
| governance | `NEXT_PUBLIC_SENTRY_DSN_GOVERNANCE`     | preview, production       | `vercel-pull`              |
| governance | `NEXT_PUBLIC_STORAGE_URL`               | preview, production       | `vercel-pull`              |
| governance | `NEXT_PUBLIC_SUBGRAPH_URL`              | preview, production       | `vercel-pull`              |
| governance | `NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA` | preview, production       | `vercel-pull`              |
| governance | `NEXT_PUBLIC_WALLET_CONNECT_ID`         | preview, production       | `vercel-pull`              |
| governance | `ETHERSCAN_API_KEY`                     | preview, production       | `sensitive-non-exportable` |
| governance | `SENTRY_AUTH_TOKEN`                     | production semantics only | `sensitive-non-exportable` |
| reserve    | `NEXT_PUBLIC_STORAGE_URL`               | preview, production       | `vercel-pull`              |
| reserve    | `NEXT_PUBLIC_ANALYTICS_API_URL`         | preview, production       | `vercel-pull`              |
| reserve    | `NEXT_PUBLIC_SENTRY_DSN_RESERVE`        | preview, production       | `vercel-pull`              |
| reserve    | `SENTRY_AUTH_TOKEN`                     | production semantics only | `sensitive-non-exportable` |
| ui         | `NEXT_PUBLIC_STORAGE_URL`               | preview, production       | `vercel-pull`              |

### Governance Graph API key scopes

Governance uses separate The Graph API keys for production and pre-production
builds. Both keys are public browser configuration. Domain restrictions and
monthly spending limits control their use.

- The Production-scoped `NEXT_PUBLIC_GRAPH_API_KEY` uses the
  `Mento Governance Production` key. The Graph Studio restricts this key to
  `governance.mento.org` and `*-mentolabs.vercel.app`, restricts queries to
  subgraphs `8C3iY7M5mPqYVFYENS6vFSsseZUtuWM5xTLiAqguGG4f` and
  `DQVQkbu1zmuHuW99zqBTVNA8wMidfwHrDEUtaVvzyyRL`, and limits spending to USD 5
  per month. The Vercel suffix lets the controller verify an immutable
  production candidate before it promotes the candidate.
- The Preview- and Development-scoped `NEXT_PUBLIC_GRAPH_API_KEY` uses the
  `Mento Governance Preview` key. The Graph Studio restricts this key to
  `*-mentolabs.vercel.app` and `localhost`, and restricts queries to subgraphs
  `8C3iY7M5mPqYVFYENS6vFSsseZUtuWM5xTLiAqguGG4f` and
  `DQVQkbu1zmuHuW99zqBTVNA8wMidfwHrDEUtaVvzyyRL`. The spending limit is USD 1
  per month. Vercel shows these scopes together as
  `All Pre-Production Environments`. The preview proposal list uses the mainnet
  subgraph. Preview server-rendered proposal metadata uses the Celo Sepolia
  subgraph.

Do not assign the production key to a pre-production environment. Do not add
`*.vercel.app` to either key because that wildcard covers Vercel projects
outside Mento. Keep the `*-mentolabs.vercel.app` domain on the production key so
the controller can test a staged candidate before promotion.

Browser requests supply their current origin. Server-rendered Graph requests
use `apps/governance.mento.org/app/graphql/graph-request-origin.ts`. Production
requests send `https://governance.mento.org`. Preview requests require Vercel's
runtime `VERCEL_URL`, validate the `*-mentolabs.vercel.app` suffix, and send that
exact origin. Local development sends `http://localhost:3002`. Keep `VERCEL_URL`
in the Governance build task's `passThroughEnv` list so Turbo permits this
provider-supplied runtime variable without adding it to the build cache key.

Vercel environment-variable changes apply only to new deployments. Wait for a
fresh `main` push that selects Governance to run the repository-owned production
controller. A `docs/**`-only push is non-runtime-only and does not select a
deployment target. Do not use the Vercel dashboard Redeploy action because the
repository-owned controller is the only supported production owner.

The code also has optional build-time reads that alter behavior only when set:
RPC overrides (`NEXT_PUBLIC_RPC_URL`, chain-specific RPC variables), feature and
test flags (`NEXT_PUBLIC_ENABLE_DEBUG`, `NEXT_PUBLIC_E2E_TEST`,
`NEXT_PUBLIC_USE_FORK`, `NEXT_PUBLIC_SANCTIONS_TEST_MODE`), banner values,
`NEXT_PUBLIC_VERSION`, and Governance's optional Celo Sepolia Blockscout URL.
These are not part of the prebuilt candidate environment unless they are added
to the reviewed inventory above with `ciClassification: vercel-pull`; raw
unknown values are intentionally omitted rather than passed through. They are
not missing-build failures.
`CHAINALYSIS_API_KEY` is optional in the app schema and is not a prebuilt-build
prerequisite.

### Required GitHub secrets

The following Vercel build-value mirrors come from issue #517:

- `vercel-cli-production` environment secret `VERCEL_TOKEN_PRODUCTION`: the
  production-scoped Vercel credential used only as step-scoped
  `VERCEL_TOKEN`. It is separately revocable from the preview credential.
- Repository secret `ETHERSCAN_API_KEY`: governance trusted previews only.
- `vercel-cli-production` environment secret `ETHERSCAN_API_KEY`: governance
  production build step only.
- `vercel-cli-production` environment secret `SENTRY_AUTH_TOKEN`: expose only
  to the app, governance, or reserve production build step that consumes it.
  App's `stage-app` build now receives it like Governance and Reserve,
  uploading Sentry source maps for App's production output for the first
  time.
- Standard previews: no `SENTRY_AUTH_TOKEN`; the isolated build child
  materializes an explicit empty override when the caller omits it.

The automatic preview controller additionally requires repository Actions
secret `GH_PREVIEW_WORKFLOW_DISPATCH_TOKEN`. Create a fine-grained GitHub
personal access token with resource owner `mento-protocol`, access to only the
`frontend-monorepo` repository, and repository permission `Actions: read and
write` (implicit metadata read only otherwise). Store it interactively without
printing or passing its value as an argument:

```bash
gh secret set GH_PREVIEW_WORKFLOW_DISPATCH_TOKEN \
  --repo mento-protocol/frontend-monorepo
```

The token authorizes only the controller's worker `workflow_dispatch` POST. It
never replaces the controller step's primary `GITHUB_TOKEN` client and never
enters the worker, reusable Vercel workflow, candidate checkout, journal, log,
output, or summary. Record an owner, expiration, and rotation date for the
credential outside the repository.

`vercel-cli-production` is the dedicated GitHub deployment environment for this
migration. Do not modify or reuse the generic pre-existing `Production`
environment, which belongs to Vercel's GitHub integration. The Vercel target
name `production` in commands and build semantics is unchanged.

If an existing secret has the correct name, value, and scope, reuse it. Values
are maintainer-entered. Automation must not discover, export, recover, or print
them, and a Vercel Sensitive value must never be assumed to appear in
`vercel pull` output.

## Tests

The ADR, primitive, read-only state-inspector, reusable-workflow, and
automatic-preview suites have no network or Vercel dependency:

```bash
pnpm adr:check:test
pnpm vercel:primitives:test
pnpm vercel:deployment-state:test
pnpm vercel:workflow:test
pnpm vercel:preview:test
pnpm vercel:production-shadow:test
```

Every `vercel:*:test` command above is part of the `pnpm test:ci:vercel` shard
of the canonical root `pnpm test` command; CI runs that shard as its own
`Unit tests (Vercel contracts)` job in parallel with `Unit tests (workspaces)`,
which owns `pnpm adr:check:test`. The
suites cover app/package graph fixtures, fail-closed cases, output ordering,
every deployment-ID constraint, prebuilt-config matching, prerequisite versions,
all target/environment classifications, canonical alias mappings, guarded
rollback evidence, exclusive private-file output, and redaction-safe
missing-variable and API-error handling. `pnpm vercel:production-shadow:test`
covers the staged-candidate toolkit
(`scripts/vercel-production-shadow.mjs`, still named for the retired pilot) and
the shared `vercel-candidate-build` and `vercel-protected-runtime` composite
actions the main pipeline builds every candidate with.
`vercel:workflow:test` also
covers exact-attempt main CI, served-SHA planning, state discovery,
transaction/recovery, public runtime, controller, and automatic-workflow
structure. It also pins that `stage-app` stages and promotes exactly like
Governance, Reserve, and UI — four forward transition slots, the required
candidate receipt, and no App-only carve-out — and that the retired same-run
App custom-`v3` payload handoff (its job outputs, archive tar flags, and
post-extraction `assert-output` re-verification) has no output or job-source
match left. It also pins that `promote` and `ordinary_rollback` are the only
operation types and that `TRANSITION-V3-PRIOR` has no remaining match. Those
commands are offline and do not contact or mutate Vercel.

The test commands above perform no Vercel API call, build upload, deployment,
alias mutation, environment-configuration mutation, or Git-ownership change.

## Current ordinary-project build settings

UI, Reserve, and Governance use these project-level Vercel settings:

- `resourceConfig.buildMachineType`: `standard`
- `resourceConfig.buildMachineSelection`: `fixed`
- `resourceConfig.elasticConcurrencyEnabled`: `false`

App is excluded. Its production deployment shares one Vercel project with
App's preview builds. A project-level setting change could affect more than
the intended target and increase activation-recovery risk.

The read-only `project` mode in `scripts/vercel-deployment-state.mjs` remains
available to verify a project's reviewed ID, name, and Root Directory. It does
not change the project. Use the Vercel dashboard or the read-only
[`GET /v9/projects/{idOrName}`](https://vercel.com/docs/rest-api/projects/find-a-project-by-id-or-name)
response to verify the effective resource settings. Do not infer project
settings from team defaults.

Before any future setting change or rollback, capture the exact current values
and their source. Restore only exact prior values with known endpoint semantics.
Do not assume that a `null` value clears a project override.

## Current reusable prebuilt core interface

`.github/workflows/_vercel-prebuilt.yml` validates one of four frozen preview
build identities before source execution:

| Target       | Workspace package      | Root Directory              |
| ------------ | ---------------------- | --------------------------- |
| `app`        | `app.mento.org`        | `apps/app.mento.org`        |
| `governance` | `governance.mento.org` | `apps/governance.mento.org` |
| `reserve`    | `reserve.mento.org`    | `apps/reserve.mento.org`    |
| `ui`         | `ui.mento.org`         | `apps/ui.mento.org`         |

The workspace and Root Directory are not independent free-form selectors: each
must match the selected target. All four identities are standard `preview`
builds. Automatic identity is also target-bound to
`preview/<target>/pr-<number>` and
`vercel-preview:v1:pr:<number>:target:<target>:sha:<sha>`. This external key
intentionally retains `v1` so existing GitHub/Vercel Deployment identity stays
stable across the internal controller migration. Each literal caller passes
its own opaque `VERCEL_PROJECT_ID_*` value explicitly;
the reusable workflow contains no matrix or dynamic project/secret lookup.

The automatic worker has four literal caller jobs in stable `app`,
`governance`, `reserve`, `ui` order and writes internal
`preview-controller:v2` provenance. There is no matrix, dynamic secret name,
or `secrets: inherit`. Initial uploads and same-upload retries call the single
secretless `_vercel-preview-smoke.yml` workflow with the complete verified
target tuple before canonical Deployment success. The original v2 activation
did not change any target's `vercel.json`; App, Governance, and Reserve
therefore began as dual-run shadow canaries while UI was GitHub-owned. The
current version-controlled map cuts App, Governance, and Reserve over to GitHub
ownership, joining the already GitHub-owned UI target.

The reusable declaration has the three common secrets
(`VERCEL_TOKEN_PREVIEW`, `TURBO_TOKEN`, and
`TURBO_REMOTE_CACHE_SIGNATURE_KEY`) plus one optional Governance-only
`ETHERSCAN_API_KEY` input. App, Reserve, and UI pass only the three common
secrets; Governance alone also passes `ETHERSCAN_API_KEY`. No preview caller
declares or passes `SENTRY_AUTH_TOKEN`. Raw pulled Sensitive names may exist,
but the one-way exact allowlist never writes them into the derived file or the
candidate tree; Governance receives `ETHERSCAN_API_KEY` only from its scoped
GitHub secret in the validation and build process environment.

### One-way preview build-environment materialization

The token-bearing `vercel pull` still runs only in fresh runner-owned staging.
Its raw `.env.preview.local` remains untouched under a `0700` staging root and
never crosses into candidate-owned storage. With the candidate UID stopped, a
trusted controller opens that raw file with no-follow semantics after exact
containment, ownership, `0600` mode, single-link, file-type, and size checks. It
parses the file with Node's pinned dotenv parser, selects only the target's
declared `vercel-pull` requirements, and emits a deterministic canonical dotenv
file under the fresh runner-owned `0700`
`mento-vercel-build-environment` root.

The derived file is created once with exclusive/no-follow flags and `0600`
mode. Serialization must parse back to the exact selected key/value set;
control characters, oversized values, and values that cannot be represented
losslessly fail by variable name only. The controller then reopens the raw
source and proves its inode, bytes, size, mode, ownership, and link count did
not change. It never rewrites, renames, or unlinks the raw file, and a partial
failure leaves the authenticated run root for the always-run final cleanup.
Retries use a new run root; an existing materialization destination is never
reused or overwritten.

Before staging, the controller recomputes the exact derived bytes from the raw
source and rejects any mismatch or ambiguity. Only `repo.json`, `project.json`,
and the derived `.env.preview.local` enter the stopped candidate's `.vercel`
directories. The candidate copy is checked again for the canonical exact key
set before the existing clean `env -i` -> `setpriv --clear-groups
--no-new-privs` -> pinned Vercel CLI build boundary. The raw pull staging and
derived materialization remain runner-private through the build, are
revalidated afterward, and are removed only by the trusted handoff/final
cleanup after the candidate UID has been killed and proven stopped.

## Reusable secretless preview verification

`.github/workflows/_vercel-preview-smoke.yml` is the one smoke implementation
for App, Governance, Reserve, and UI. Its caller supplies an already verified,
target-bound tuple: logical target, immutable team URL, exact SHA, canonical
GitHub Deployment ID, mode-specific verification key, and trusted deployment
metadata. Controller mode additionally binds the literal Vercel
project, Vercel Deployment ID, and target-specific Next.js deployment ID.
Native-adapter mode is restricted to App/Governance and binds the exact native
environment plus Vercel bot identity; it cannot fabricate a controller key.

A Deployment or status created with the repository `GITHUB_TOKEN` does not
trigger another workflow run. GitHub-built workers therefore call the
secretless reusable smoke workflow directly before terminal success. Do not add
a PAT to force deployment-status recursion. The dedicated worker-dispatch
credential authorizes only the controller's exact worker `workflow_dispatch`
request.

The reusable workflow declares no secrets and performs no authenticated Vercel
or GitHub lookup. It validates the tuple before any request, checks the root
response, security headers, representative JavaScript/CSS/font assets, browser
console/page errors, and same-origin failures, then runs the target interaction:

- App/Governance: real wallet list and team-host-only mock wallet connection;
- Reserve: Overview data plus Supply tab and URL/state transition;
- UI: exact build/asset identity, navigation, and hydrated control interaction.

For controller-built Governance and Reserve previews, the HTTP phase requires
the raw response's leading `<html>` start tag to carry exactly one quoted
expected `data-dpl-id`. Their browser phase then uses the same settled,
typed-resource proof as UI: a missing hydrated marker is accepted only when
every observed same-origin Next.js static request carries exactly one expected
`?dpl=`, representative requests are actual scripts and stylesheets, and no
static asset redirects outside the immutable origin. Any retained conflicting
marker fails. Native rollback previews do not claim a custom deployment ID and
keep their existing identity-free adapter contract.

The bounded `.github/workflows/preview-smoke.yml` native adapter classifies
only exact successful `Preview – app.mento.org` and
`Preview – governance.mento.org` events created by Vercel's fixed bot identity
on the exact project-slug team host. App and Governance enter only during
bounded target-local preview rollback. Production/v3, inactive/skipped, main,
controller-payload, actor-lookalike, Reserve, and UI events do not call smoke.
Every qualifying event runs the full reusable workflow. No historical status is
listed or trusted for dedupe, and the adapter deliberately declares no workflow
or job concurrency group: GitHub replaces an older pending run in a shared
group even when `cancel-in-progress` is false, which would violate the
one-full-smoke-per-event contract. The appended terminal status is bounded,
run-specific evidence only. The adapter receives no PAT, Vercel token, Turbo
token, or application secret and remains available only for those bounded
rollback paths. Its presence is not an ordinary native branch-preview path.
It exists only for the documented App and Governance target-local preview
rollback proof.

## Automatic trusted four-target previews (current v2 controller)

`.github/workflows/vercel-preview-controller.yml` is the only automatic event
controller. It runs trusted default-branch code for `pull_request_target`
`opened`, `edited`, `synchronize`, `reopened`, and `closed` (with `edited`
limited to base-branch changes before any snapshot or write); receives
completed `Vercel Preview Worker` callbacks; and accepts the default-branch-bound
`vercel-preview-bootstrap` and `vercel-preview-reconcile` repository events for
one validated PR number. The controller has no Vercel/Turbo credential and no
write-token job checks out or executes PR code.

The workflow-level `VERCEL_PREVIEW_CONTROLLER_MODE` is an executable global
switch, not a secret or an operator-set repository variable. Every
reconciliation passes it to the trusted controller implementation. For each
open trusted PR, the controller reads all four canonical `vercel.json` paths
through the Contents API at immutable 40-character SHAs. Each target is
evaluated independently against its canonical mode in
`scripts/vercel-preview-targets.mjs`: `shadow` always permits the GitHub canary
alongside an exact native configuration, while `github` requires the exact
GitHub-owned configuration. Every selected historical event is rechecked at its
own SHA after PR-lineage proof. Missing, oversized, malformed, or unknown
content fails closed before any worker-dispatch request.

The controller always runs the default branch's constants, so a PR that changes
a target's reviewed `vercel.json` shape can never be recognized until `main`
learns that shape first: the required `Vercel Preview` status fails with
`Candidate <target> Vercel configuration is not recognized`. The optional
per-target `transitionalGithubVercelConfigurations` list in
`scripts/vercel-preview-targets.mjs` resolves that ordering. Each entry is one
additional exact GitHub-owned configuration the recognizer accepts alongside
`activeVercelConfiguration` and `mainShadowVercelConfiguration`. It grants no
new state, changes no tracked configuration, and never widens the
native-owned side; every other candidate still fails closed. Add an entry in
its own PR, merge that PR first, then merge the PR that adopts the shape, and
delete the entry once the migration completes. The mechanism stays, but the
list is empty for all four targets: MGP-18's final tighten step removed App's
transitional pre-retirement active shape (`{"**": false, "v2": true}`) now
that every open head carries the generic active shape. No target may carry an
entry without a migration in flight, and the retired shape can no longer be
recognized anywhere. Executable pins keep every target's list empty so
transitions stay deliberate.

`active` creates at most one independent worker per affected target and
rechecks the current and selected immutable ownership inputs immediately before
the dispatch credential can make its only POST. A selected native-owned receipt
for a GitHub-mode target is persisted as an intent and routed
through the same bounded no-dispatch recovery path: one already-created worker
is attached and drained, while no matching worker produces the durable
`native-owned-selection-without-github-worker` result and advances
reconciliation to the next receipt. That dedicated terminal reason is
ownership-success, not GitHub build evidence; it creates no GitHub Deployment.
The generic `dispatch-disabled-intent-without-worker` result remains an error
for the SHA whose GitHub-owned intent was retired, so a later ownership flip
cannot falsely relabel that historical SHA as native-owned. For a GitHub-mode
target, the exact native configuration also suppresses dispatch when the
default-branch workflow is still `active`, which protects a rollback PR before
it merges. `observe-only`
never creates a new dispatch intent or worker.
It does, however, reconcile every previously persisted `intended` entry in both
the current and epoch-retired ownership slots: one unique existing worker is
attached without the secondary credential, a completed worker is terminalized
in the same reconciliation attempt, an in-progress worker remains durably
attached in its original slot for its callback, and no match after bounded
observation is retired as `dispatch-disabled-intent-without-worker`. Multiple
matches fail closed. An `observe-only` controller fails closed when any target
would otherwise require GitHub ownership, because that target would have no
automatic preview owner.

Dependabot is intentionally split out before any write boundary.
`.github/workflows/vercel-preview-intake.yml` receives the same PR activities
with only `contents: read`, performs metadata validation without a checkout,
artifact, secret, or PR-code execution, and encodes the PR number, exact head
SHA, and action in its strict run name. A completed-intake `workflow_run` then
starts trusted default-branch controller code with a write-capable token. That
follow-up validates the intake workflow identity and its one immutable PR link:
the run's candidate head ref/SHA must match the linked PR and encoded receipt,
while the linked base must remain this repository's `main` branch. GitHub
reports the candidate branch, not the workflow-definition branch, in a
`pull_request_target` run's `head_branch` field. The controller then re-queries
the PR and posts the successful preview-disabled status only when the PR is
still open, still Dependabot-owned/ref-classified, and still on the encoded
exact SHA. Stale or malformed callbacks write nothing.
For a closed event GitHub may omit the run's PR association; that one case
still binds the strict receipt SHA to the run head and is write-inert by
definition.

GitHub runs `repository_dispatch` from the last commit and workflow definition
on the default branch; unlike `workflow_dispatch`, its request cannot select a
branch or tag containing a modified controller. Creating the event requires an
authenticated caller with repository Contents write permission. That proves
caller authorization, not payload safety: a read-only validation job therefore
accepts only the two literal event types above, the expected repository, and a
`client_payload` containing only a bounded positive `pr_number`. Only its
validated outputs can enter bootstrap or a serialized write-token reconcile
job. Do not add a controller `workflow_dispatch` fallback.

The trust decision is explicit: same-repository collaborators who can push a
supported branch name are trusted to build that branch with preview-only
credentials. Forks, Dependabot-authored/ref PRs, and branch names the prebuilt
worker rejects (including `refs/*`) receive a successful unsupported-boundary
`Vercel Preview` commit status, no worker, no Deployment, and no preview
credential. The author decision comes from the PR author/ref/repository, never
`github.actor`. Dependabot receives that status only through the read-only
intake plus trusted `workflow_run` follow-up described above.

GitHub can suppress `pull_request_target` for a head branch whose name resembles
a commit SHA. In that platform edge case the required status remains absent or
pending and therefore fails closed. Do not add a secret-bearing alternate
trigger.

### Event, status, and batching contract

Every controller-owned event is first appended as a logically immutable entry
to the pull request's one canonical bot-owned journal; Dependabot uses the
separate credentialless intake contract above. The journal's hidden marker and
payload schema are exactly:

```text
<!-- vercel-preview-journal:v2 -->
vercel-preview-journal:v2
```

The journal is an internal coordination record, not review feedback. Its
reviewer explanation and stable-order App/Governance/Reserve/UI outcome table
remain visible; useful immutable deployment or worker URLs are linked from the
matching outcome. One collapsed GitHub `<details>` block contains canonical
JSON. The visible table is derived from that JSON and is part of the exact
canonical body, not a second state surface. The document holds the repository
and PR identity, a monotonic revision, an optional deterministic checkpoint, a
top-level numeric controller-workflow admission cursor, and a journal digest
over that cursor, checkpoint, canonical live receipt set, and mutable state.
It also contains logically immutable live
event/selection/worker-evidence/result entries, and bounded mutable controller
state. The state's separate receipts digest binds reconciliation to the
checkpoint plus live receipt set. Writers use compact JSON in the machine block.
During the formatting migration, readers accept only that compact canonical
body or the exact prior two-space canonical body. The next mutation always
rewrites a legacy body in compact form. The canonical Markdown envelope includes
the explicit closing `</details>` tag; missing or additional presentation text
is invalid. The journal keeps one stable comment ID: every update edits it, and
no receipt-specific comment is created.

All jobs that can create or update the journal share one repository-wide,
per-PR concurrency group configured with `queue: max` and
`cancel-in-progress: false`. That serialization is a correctness boundary, not
an optimization. After acquiring the queue, each writer validates the exact
journal count and complete canonical body, applies one idempotent transition,
updates the comment, or initially creates it for an explicit bootstrap or a
strict numbered first-attempt `opened`/`reopened` event whose head commit has no
prior PR-scoped
`Vercel Preview Journal v2 / PR #<number>` initialization status,
then rereads and proves the expected
revision, canonical JSON, journal digest, and, when state exists,
`state.receipts_digest` before publishing a status or dispatching a worker.
Duplicate journals, a writer outside that queue, a conflicting receipt, or an
ambiguous reread fail closed.

Before completed-worker recovery, journal mutation, status publication, or
dispatch, reconciliation compares the live pull request with the journal's
latest uniquely represented operational snapshot: PR number, lifecycle state,
trusted base ref, head SHA/ref/repository, author/trust classification, and
closed timestamp. The base ref is the PR target identity: ordinary base-tip SHA
advancement on that same ref does not imply a missing receipt or deferral,
while an actual base-ref retarget does. The trusted base SHA remains immutable
planning evidence on each receipt. GitHub's `updated_at` is deliberately
excluded because title- or body-only edits advance it without creating a
preview event receipt.
Each `pull_request_target` run has a strict machine name that binds its workflow
run ID and workflow-monotonic run number to the PR, action, head SHA,
synchronize `before` SHA, and whether a receipt is required. Dependabot
author/ref events and edited events without a base change are strict
non-receipt admissions; every other eligible event requires a receipt.
After a trusted `opened` or `synchronize` event enters the journal, a read-only
job waits outside the per-PR writer queue for that event's terminal status
decision and complete selection/result graph. It then uploads one artifact named
`vercel-preview-observation-receipt-v1-<event-run-id>` with 14-day retention.
The artifact binds the original event run ID, source journal digest, and a
canonical event-scoped graph digest. Its retained operational purpose is to
authorize safe journal-capacity checkpointing above the 40,000-byte soft
threshold. It is never state, reconciliation, status, dispatch, or deployment
authority.

The trusted upload step writes the artifact only after the controller validates
and materializes the event's full canonical journal graph. A later exact
artifact therefore retains the admitted prefix that it contains, even if an
earlier event's own artifact is missing. A workflow rerun reuses the existing
immutable artifact instead of uploading another copy under the same event-run
name. An expired, unrelated, ambiguous, or invalid artifact cannot authorize a
capacity checkpoint.

At the 40,000-byte soft threshold, selection, worker-evidence,
result-recovery, and state writers can checkpoint only the longest safe prefix
through a live artifact-covered event. The admission cursor must cover the
cutoff, and every earlier lineage event must have a run number no greater than
the cutoff. The checkpoint retains all later events and all selections,
worker evidence, and results bound to that unsettled suffix. It also preserves
the original ownership epoch for those immutable receipts. A missing cursor,
an artifact on another run, a cutoff beyond the cursor, or an out-of-order
prefix leaves the journal unchanged. The 64,000-byte hard limit remains
fail-closed.

The journal's top-level `admission` cursor stores the active controller's
numeric workflow ID plus the exact run ID and run number proven through. One
scanner instance and request budget are shared by the whole job. It resolves
the workflow file to its active numeric ID, then lists that workflow's runs
newest-first with no branch, event, SHA, or time filter. Every run number above
the cursor must appear exactly once and in descending order, including inert
`repository_dispatch` and `workflow_run` invocations. The scanner validates
each run's workflow ID/path, repository, trigger, immutable identity, state,
and strict event or inert title. It rereads the first page to reject a moving
view, processes at most five 100-run pages, and shares fixed request, raw-run,
and title-hydration budgets across every reconciliation, mutation, dispatch,
and final-publication boundary. A complete proof advances the in-memory cursor;
only that complete monotonic cursor may be persisted. Rerun attempts reuse the
same run ID and number and therefore do not create another sequence entry.

For this PR, every receipt-required admission above the cursor must have its
exact live receipt, and every numbered receipt above the cursor must map back
to one strict admission. A requested, queued, or in-progress run without its
receipt defers without state, status, dispatch, or ownership mutation; a
completed run without one fails closed. Strict foreign-PR runs are classified
as part of the same global interval but never cause a foreign journal lookup.
GitHub may temporarily expose the static workflow name before the dynamic
title, so placeholder titles hydrate through one shared deadline-based queue.
The queue permits at most eight concurrent run-detail requests and stops
cleanly at the shared 30-second deadline, 96 title requests, or the job's 128
total admission requests. It never fans every placeholder out concurrently or
overshoots a request budget. A placeholder still pending at that boundary makes
the proof incomplete and defers without mutation; a completed placeholder or
malformed title fails closed. Closed PRs may have empty run-to-PR linkage;
present linkage is validated, while the strict title and top-level envelope
authenticate an empty-link historical run.

A stable numeric gap, workflow-ID mismatch, unavailable cursor, traversal
overflow, or exhausted structural proof budget fails closed and requires drain
plus an explicit numbered bootstrap. Title-hydration exhaustion follows the
pending-versus-completed rule above instead of throwing a budget-overrun error.
The receipt-event and bootstrap-receipt jobs need least-privilege
`actions: read`; reconciliation jobs already have Actions access for worker
recovery. This global sequence proof catches consecutive pushes and same-head
close/reopen cycles without trusting mutable `updated_at`, branch-name
uniqueness, or fork-controlled branch names.

A first-attempt `opened`/`reopened` event can initialize only from its strict
numbered run; synchronize, edited, and closed events never infer the missing
history. Every durably recorded event ensures a
`Vercel Preview Journal v2 / PR #<number>` success-status witness on its head before
normal reconciliation. That lets a retry repair a witness write that failed
after the journal mutation and carries deletion evidence across every push. The
PR suffix prevents a status left on a reused or stacked commit by another PR
from blocking this PR's first receipt. That dedicated context is never used for
preview results, so delayed old same-SHA events cannot overwrite newer
`Vercel Preview` outcomes. A later missing journal with matching PR-scoped
external initialization evidence, any event rerun, or missing recovery state
fails closed instead of silently resetting controller history. A close with no
journal and no matching witness is inert and explicitly skips reconciliation;
it does not create an anchorless closure-only journal. A delayed non-closed
event is likewise inert when the live PR is already closed and neither journal
nor witness exists. Explicit bootstrap is the sole operator-authorized clean
restart. The controller validates the numbered bootstrap receipt against its
exact strict `repository_dispatch` run under the current numeric workflow ID
and stores that run as the new admission floor. Older controller runs are
intentionally outside the fresh journal; every later controller run is
globally accounted. A brand-new strict `opened` or `reopened` journal may use
the immediately preceding run number as a temporary floor, but a
legacy/unnumbered journal or a first strict `synchronize`, `edited`, or `closed`
receipt requires bootstrap. There is no legacy admission reader or
branch-scoped fallback.

Event and bootstrap receipts persist the workflow-monotonic run number when
GitHub supplies it. Already-persisted v2 receipts without `event_run_number`
retain their existing canonical journal digests, but they cannot establish or
advance the global admission cursor. A legacy cursorless journal therefore
requires the explicit numbered bootstrap described below before another
lifecycle event may mutate it.

When a later event is appended, a terminal journal with no active or retired
worker and no unfinished evidence may fold its completed prefix into one
deterministic in-place checkpoint only after the Actions admission proof is
complete. The admission cursor remains top-level and independent from receipt
compaction. The checkpoint holds cumulative receipt counts and digest, the
verified lifecycle tail event, and independent status, runtime, and
pending-owner evidence for all four targets.
For an open PR the tail is the last reconciled lineage event; for a closed PR
it is the closure whose timestamp matches current GitHub state. State is
rebased onto that tail and completed live receipts are cleared in the same
revision. The checkpoint remains a verified reconciliation anchor even when
its tail is a synchronize or closure event. A new-format semantic replay of
that tail remains live by exact workflow run ID until admission proof succeeds;
only then may it be folded while the top-level cursor advances atomically.
Pre-floor aliases remain idempotent, and the same run ID with conflicting
content still fails closed. Retrying an alias already covered by the cursor is
a no-op, so it cannot increment checkpoint sequence, counts, or digest twice.
When a docs-only
tail is checkpointed, its inherited terminal runtime state, immutable URL, and
failure or cancellation meaning continue across later docs-only pushes rather
than reverting to a fresh no-runtime success. The four-target 50-preview
sequential-cycle fixture remains below a strict 16,000-byte bound. This is still
one comment, schema, and controller path: there is no archive, rollover, second
comment, or alternate-schema reader.

An overlapping push burst uses the same checkpoint field before the rendered
body reaches capacity. At the 40,000-byte soft threshold, the controller proves
one path through the complete receipt graph to its latest uniquely represented
PR tail and folds that graph into the cumulative digest. A pending checkpoint
records the exact unfinished owner, its consumed attempt count, and the latest
runtime event still owed, and retains the matching selection, worker evidence,
and terminal result needed for recovery. Reconciliation waits for that owner.
Its terminal result either
settles a runtime-equivalent docs-only tail or releases the latest required
runtime event for dispatch, so a queued receipt cannot disappear and a
docs-only tail cannot remain pending after its dependency completes. Completed
retired owners are then removed. More than 40 genuinely unfinished retired
owners fails closed instead of silently discarding ownership. No unfinished
worker evidence is truncated.

The complete rendered journal body has a 64,000-byte hard limit measured as
UTF-8. A transition that cannot safely use either terminal or capacity
checkpointing and would cross it fails closed before changing the journal,
reporting success, or dispatching work; active, retired, or unmatched evidence
is never truncated. Compact rendering reduced the live journal that triggered
the migration from 63,133 bytes to 49,772 bytes without changing its JSON data
or digests. This restores 14,228 bytes of headroom while keeping the same hard
limit. The projected terminal recovery is 65,358 bytes with the prior rendering
and 51,457 bytes with compact rendering. The prior rendering exceeds the hard
limit. The compact rendering leaves 12,543 bytes of recovery headroom.

Reconciliation is lossy/replaceable, but it reconstructs from the journal's
entries and mutable state, current PR lifecycle evidence, and GitHub/provider
APIs. Before dispatch, the controller appends a selection entry that binds the
selected SHA to the controller epoch and compactly lists intermediate entry
identities coalesced into the durable later selection. A capacity checkpoint
retains that selection but folds the coalesced entries themselves once they
fall inside the checkpointed prefix, so a durable selection can outlive the
identities it batched away. Reconciliation treats such an identity as settled
checkpoint evidence: it must have left the live receipt set entirely, precede
its own selection, and hold no current-epoch result or selection. A coalesced
identity that is still live but outside the target's candidate lineage, that
does not precede its selection, or that holds current-epoch ownership still
fails closed. Intended-run crash
recovery queries a fixed `created` window around the persisted dispatch
timestamp; older lifetime run history cannot exhaust its proof bound, while
multiple matching runs inside the window fail closed. The bounded terminal
history and compact key digests retain ownership for every accepted
current-epoch result entry. A synchronize entry plans the event's exact
`before -> head` transition with planner code and dependencies from the
immutable trusted base; it does not repeatedly compare the PR base to head. A
base-retarget `edited` entry starts a new same-head epoch and replans the new
base-to-head transition. Title, body, label, and other unrelated edits create
neither an entry nor a reconciliation.

`Vercel Preview` is reserved for a Statuses API commit status, not a workflow
job/check name. Every exact journal event SHA gets one aggregate result whose
bounded description reports `app`, `governance`, `reserve`, and `ui` outcomes
in that stable order. The aggregate fails on any target error/failure, remains
pending while any target is pending, and otherwise succeeds. Each target's
independent outcome and exact-SHA evidence remain in the v2 journal; the status
target prefers the relevant immutable deployment or worker URL over a neutral
controller link.

Terminal status targets are durable evidence rather than the URL of whichever
controller invocation happened to reconcile them. Verified uploads, including
uploads that later fail smoke, point at the immutable `vercel.app` deployment;
terminal failures without an upload point at their exact worker run. Outcomes
that have no more specific artifact, such as no-runtime, coalesced, or
unsupported events, retain the target already recorded in their terminal
journal decision.

An exact canonical replay leaves the journal revision, digest, and status
decision unchanged. Only in that unchanged-state case, the controller reads one
newest-first, 100-row page of commit statuses and suppresses a write when the
latest `Vercel Preview` entry was created by `github-actions[bot]` and exactly
matches state, description, and normalized target URL. A missing, mismatched,
foreign-authored, malformed, or temporarily unreadable witness never blocks
reconciliation: the controller conservatively writes the canonical status
again, so an externally deleted or altered status is repaired while a genuine
pending-to-terminal or target transition remains visible.

For each open/reopen/base-retarget/bootstrap epoch and each target, the oldest
event that affects that target is its `first_eligible_sha` and runs first.
Targets advance independently in canonical order. An identical bootstrap
aliases an existing lifecycle anchor instead of creating a second epoch. While
one target's worker is queued/running, later affected pushes replace only that
target's `latest_desired_sha`; after the first worker terminates, only its latest
SHA runs. A push may therefore deploy one target while another remains active,
coalesced, runtime-equivalent, or unaffected. Documentation/test-only pushes do
not replace any desired runtime SHA.

Each selected transition is bound to its lifecycle epoch, canonical
reconciliation-basis digest, immutable journal event entry, and the exact
controller `github.workflow_sha` authorized to supply the worker
implementation. The authorized worker SHA is persisted as
`expected_workflow_sha` and participates in the selection key digest. Repeated
A -> B -> A transitions, close/reopen cycles at the same SHA, duplicate
callbacks, controller upgrades, and out-of-order event runs therefore remain
distinct. An old-epoch worker may terminalize its own Deployment and append its
own terminal result entry to the journal, but it cannot update current-epoch
state/status or schedule work.

Operator recovery queries the exact persisted worker attempt instead of the
latest rerun. If a retired old-epoch attempt is missing or fails identity
validation, the controller records a bounded recovery quarantine on that
retired selection and continues current-epoch reconciliation without posting a
current-head controller error. The quarantined selection remains in the journal
as audit evidence, but it no longer counts as live GitHub deployment ownership
and therefore cannot hold a native-Vercel ownership handoff pending forever.
When no live GitHub owner remains, terminal journal compaction folds the
quarantine marker and its unfinished receipts into the checkpoint's cumulative
digest and bounded receipt counts before dropping them from the baseline state.
Transient retired-attempt API or journal-write failures remain unquarantined
and retry on the next reconciliation, also without changing the current-head
status. A recovery ambiguity for the current active selection still fails
closed. Durable recovery, ownership-flip, and no-dispatch mutations may require
multiple local reconciliation passes; those bounded progress passes are
separate from the three-attempt budget reserved for serialized journal races.

The worker normally writes its immutable evidence before its run completes. A
reconcile can reconstruct minimal evidence only when that write is the sole
failed operation after a verified build. The persisted owner must bind the
exact original run and attempt. No earlier evidence or result can exist for the
same Deployment key, except the exact successful result for that run and
attempt when an older recovery already wrote it. The attempt-scoped Actions job
census must be complete and bounded. The ownership, selected prerequisite,
build, smoke, and lifecycle jobs must succeed. All mutually exclusive target
and resume jobs must be skipped. The evidence job's checkout must succeed, and
its exact journal-persistence step must be the only failed step. The canonical
GitHub Deployment payload must bind the same PR, target, SHA, head ref, key, run,
and attempt. Its current status must be the only success status and must bind
the same attempt URL and one immutable `vercel.app` environment URL.

When every condition holds, reconcile appends one ordinary evidence receipt for
the original run and attempt. It records `execution_mode=build` and
`build_completed=true`. It copies the GitHub Deployment ID and verified URL.
It leaves `vercel_deployment_id` and `next_deployment_id` null because GitHub's
immutable job and Deployment records do not prove those provider IDs. It then
appends the normal result or returns the already-persisted matching result
without changing it. Any missing, duplicate, unexpected, or conflicting job,
step, receipt, Deployment, status, URL, SHA, run, or attempt fails closed. Do
not rerun the evidence job: a rerun has a different attempt and cannot own the
persisted selection. Do not redispatch the worker or invent provider IDs.

### Durable dispatch and exact Deployment identity

The reconciler writes `dispatch_state=intended`, including
`expected_workflow_sha`, and rereads it before dispatch. It then queries up to
three times for a matching worker run by strict `workflow_run.display_title`.
A title match is not enough: its `head_sha` must equal the persisted authorized
workflow SHA. One valid match is attached and multiple exact matches fail
closed. If GitHub still exposes the workflow's exact default title, the
controller treats that run ID as unresolved, continues listing for additional
candidates, and re-queries the unresolved ID directly. It never attaches an
exact match or dispatches a replacement while any plausible default-title run
remains unresolved. After any recovery wait, it refreshes PR openness, exact-SHA
association, journal event entries, and persisted selection ownership
immediately before attaching or dispatching; a closed or changed lifecycle
cannot launch a new worker. A full-envelope-valid wrong-SHA artifact is never
allowed to own the intent; all other name, event, ref, path, title, attempt, and
URL mismatches also fail closed. GitHub's `workflow_run` callback reports the
static workflow name,
while the Actions REST API may report the configured dynamic `run-name` in both
`name` and `display_title`; recovery accepts those two documented shapes only
when the workflow path, event, default ref, authorized SHA, attempt, and
epoch-bound title identity also validate. Completion follow-ups route by the
exact worker or intake workflow path rather than the presentation name, then
repeat full source validation before any status or Deployment write.

The worker independently repeats the immutable ownership check before emitting
`should_deploy`, inspecting deployment state, or reaching any Vercel secret. It
requires both the then-current PR head and its controller-authorized
`commit_sha` to remain eligible under the target's canonical ownership mode:
`shadow` accepts the exact native configuration for a GitHub canary, while
`github` requires the exact GitHub-owned configuration. This is defense in
depth for a worker that was queued while ownership changed; controller journal
ownership alone cannot authorize a configuration that contradicts the
version-controlled target mode.

Zero matches dispatches `.github/workflows/vercel-preview-worker.yml` on `main`
using a secondary Octokit client authenticated only by repository secret
`GH_PREVIEW_WORKFLOW_DISPATCH_TOKEN`. The fine-grained token is scoped to this
repository with `Actions: read and write`; it performs only the HTTP 200
`return_run_details` dispatch POST. The primary `GITHUB_TOKEN` client continues
all journal, status, Deployment, PR, run-listing, run-validation, and recovery
operations. The controller never falls back to `GITHUB_TOKEN` for dispatch,
because a worker created by that token does not produce the terminal
`workflow_run` callback required by this protocol.

This dispatch description applies only while
`VERCEL_PREVIEW_CONTROLLER_MODE: active`. In `observe-only` mode, event planning,
journal receipts, completed-worker recovery, crash-window intent discovery or
retirement, and the explicit no-dispatch status remain available, but the
secondary client is not populated and the dispatch guard rejects the POST even
if a caller reaches it unexpectedly. Exact native candidate ownership also
disables dispatch while an `active` default-branch controller handles the
rollback PR; candidate configuration errors and ownership ambiguity never make
a secondary-client request.

The dispatch occurs only while the executing controller's own workflow SHA
still equals the persisted intent. If the dedicated secret is missing, the
controller fails closed immediately before a new dispatch, retains the durable
`intended` state, and posts an error status through its primary client. The
secret is not needed to find, attach, validate, or recover an existing worker.
The returned run is re-queried through the primary client once per second with
a bounded 30-second retry-delay budget
because GitHub may temporarily return the workflow's default title before
materializing the configured `run-name`. API request latency is additive; the
workflow timeout remains the outer wall-clock bound. Only that exact transient
default title is retried; every other malformed title or identity mismatch
fails immediately. The materialized run's `head_sha` must equal
`expected_workflow_sha`, in addition to matching the literal workflow path
(either the bare path or GitHub's documented `@main` suffix),
`workflow_dispatch` event, default ref, attempt, PR, target, candidate SHA, and
epoch-bound key digest, before state becomes `dispatched`.
If `main` advances between intent persistence and dispatch, recovery may attach
an already-created worker at the old authorized SHA, but a newer
controller/worker version cannot satisfy or redispatch that old intent. A
worker resolved from the newer `main` SHA fails its credentialless preflight.
The controller appends a logically immutable
`controller-workflow-upgraded-before-dispatch` error result entry, and that
worker's completion callback causes the current controller to reselect the same
desired event entry under its own workflow SHA. The new key therefore advances
automatically without ever pretending that new workflow code fulfilled the
retired intent.

For live acceptance, do not issue a manual reconcile. Verify that the worker's
actor is the fine-grained token owner rather than `github-actions[bot]`, its
completion automatically creates a controller run with event `workflow_run`,
terminal recovery succeeds, the same journal gains the result, active ownership
clears, and `Vercel Preview` becomes terminal at the immutable URL. Repeat with
a controlled failure and a cancelled worker before Deployment creation, then
rerun a callback to prove journal, worker, Deployment, and result idempotency.
That automatic-callback, failure, cancellation, and replay evidence was a Phase
A acceptance gate after credential provisioning and had to pass before the UI
Git-ownership cutover.

The canonical Deployment key and environment are:

```text
vercel-preview:v1:pr:<number>:target:<target>:sha:<40-hex-sha>
preview/<target>/pr-<number>
```

The explicit REST Deployment uses the exact SHA, `auto_merge: false`, empty
required contexts, and transient/non-production flags. No Actions environment
is declared and Vercel metadata omits `githubDeployment=1`, so neither GitHub
nor Vercel creates an implicit duplicate Deployment.

The credential-free worker receives `expected_workflow_sha` as an explicit
dispatch input and first compares it with the actual
`${{ github.workflow_sha }}`. Only then does validation re-read the open PR,
exact SHA ancestry, bot-owned active journal state, and canonical Deployment.
The evidence writer repeats the immutable-SHA comparison and persists that SHA
in non-terminal and terminal journal entries. A mismatch fails before any build
or deployment credential is reachable. A separate trusted preflight prints
only missing repository variable/secret names. Each literal reusable caller
receives only `VERCEL_TOKEN_PREVIEW`, `TURBO_TOKEN`, and
`TURBO_REMOTE_CACHE_SIGNATURE_KEY`, its literal `VERCEL_PROJECT_ID_*`, plus
`VERCEL_ORG_ID` and `TURBO_TEAM`. Governance alone additionally receives
`ETHERSCAN_API_KEY`; no preview caller receives a Sentry token. Direct
smoke/resume jobs receive no deployment credential.

The worker is dispatched on `main`, and the reusable contract requires both
`refs/heads/main` and the exact main-branch `vercel-preview-worker.yml` caller
identity. Candidate dependency lifecycle scripts are disabled. The trusted
controller is restored from `github.workflow_sha` after dependency installation
and after the candidate build; pinned-version and build-output assertions,
upload, inspection, and lifecycle writes therefore run the restored controller
through the protected Node.js runtime copied before candidate execution, not
the hosted toolcache path the candidate can reach.

Lifecycle is `queued -> in_progress -> success|failure|error`. Success and the
public `environment_url` exist only after exact-SHA/ID verification and the
single secretless reusable smoke. Both the initial upload and same-upload retry
pass the complete controller-bound tuple to
`.github/workflows/_vercel-preview-smoke.yml`; the old embedded UI-only HTTP and
parallel browser paths no longer exist. The reusable workflow runs in the
pinned Playwright container and keeps the common bounded
HTTP/header/static-asset checks before the target browser flow. Governance and
Reserve use their existing interaction smoke plus the shared deployment
identity monitor; UI renders the showcase, searches and navigates to a second
route, and changes a form control. The HTTP phase verifies the server-rendered
marker on the leading `<html>` start tag for controller-built Governance,
Reserve, and UI previews. After hydration, those three paths require every
loaded same-origin `/_next/static/` asset to carry exactly the expected
`?dpl=` value, require actual script and stylesheet request types, reject a
static asset redirected outside that immutable identity, and reject any
conflicting retained HTML deployment marker. Request monitoring remains active
through each target interaction, so dynamically loaded chunks cannot escape
the same identity check. The controller waits for all observed static requests
to finish and for a quiet window after each DOM marker read before its identity
assertion. This preserves fail-closed deployment-identity proof when React
reconciles the server-injected HTML attribute out of the live DOM. Native
rollback previews carry no custom deployment ID and keep their existing smoke
contract. Chrome also waits for the initial page load before changing
controlled inputs, then rechecks the interaction after the hydration settle.
Its dependency graph comes from the trusted workflow checkout, candidate
lifecycle scripts stay disabled, and no Vercel or Turbo credential is present
in the smoke job. The worker appends a durable non-terminal upload evidence entry;
the completed-run recovery re-queries the run, Deployment, and statuses before
appending the terminal result entry. Cancellation before Deployment creation
creates/reuses the canonical Deployment and immediately closes it as `error`.

Retry behavior is bounded and serialized:

- an existing verified success is absorbing and never rebuilds;
- a verified upload whose smoke failed retries smoke once against the same URL;
- a build failure before the durable upload-attempt boundary may rebuild once;
- a trusted completed worker that failed before it created its GitHub
  Deployment may rebuild once. The controller records a strict failure-only
  recovery result with no Vercel identity. An observation receipt may retain
  that result without pre-completion worker evidence, but it cannot use this
  path for success. A later controller version may reopen the latest
  same-epoch terminal record under this rule when the original controller
  folded it before selecting the bounded retry;
- after an ambiguous upload result, the trusted credentialed job re-queries a
  bounded Vercel time window using only the
  [documented List Deployments filters](https://vercel.com/docs/rest-api/deployments/list-deployments)
  for project, preview target, exact SHA, and branch. It requests one bounded
  100-row page,
  rejects pagination rather than silently missing a candidate, and validates
  the controller-key plus exact commit metadata client-side. Unrelated native
  or controller deployments are ignored. A matching incomplete Vercel row with
  `url: null` is durable evidence that an upload already exists: lookup retries
  until its immutable URL appears, but persistent incompleteness or disappearance
  fails closed without a second upload. Only three observations containing no
  exact complete or incomplete deployment permit one serialized upload retry.
  The retry then consumes the full bounded convergence window. The union of
  post-retry observations must contain one monotonic deployment identity
  matching the retry's parsed stdout; delayed duplicates, reordered identities,
  persistent zero visibility, or unknown results fail closed;
- a second build/smoke failure is terminal.

This is a bounded convergence protocol that reduces duplicate risk and fails
closed on contradictory evidence. It is not proof of mathematical uniqueness
or exactly-once delivery across GitHub and Vercel.

### Bootstrap and operator recovery

Before `Vercel Preview` became required during Phase A, maintainers had to
inventory every already-open PR and bootstrap each trusted same-repository PR
that should participate. A first strict `synchronize`, `edited`, or `closed`
event without an admitted anchor fails before persistence; it does not wait in
an anchorless journal. Drain the PR's preview ownership and bootstrap the
existing open PR before another lifecycle event. Repeated execution of the same
bootstrap workflow run is idempotent, and a bootstrap identical to an existing
lifecycle anchor aliases that anchor; conflicting lifecycle or planning
evidence still fails closed.

```bash
gh pr list --state open --limit 100 --json number,headRepository,headRefName,author

PR_NUMBER="<pr-number>"
gh api --method POST \
  repos/mento-protocol/frontend-monorepo/dispatches \
  -f event_type=vercel-preview-bootstrap \
  -F "client_payload[pr_number]=$PR_NUMBER"
```

For a durable journal whose live PR state only needs another reconciliation
pass:

```bash
PR_NUMBER="<pr-number>"
gh api --method POST \
  repos/mento-protocol/frontend-monorepo/dispatches \
  -f event_type=vercel-preview-reconcile \
  -F "client_payload[pr_number]=$PR_NUMBER"
```

An open-PR bootstrap is also the recovery for a journal whose persisted
receipts contradict the current reconciler, because the bootstrap receipt
anchors a fresh epoch and the contradicting receipts stay bound to the old
epoch anchor. A push or a `vercel-preview-reconcile` dispatch cannot recover
such a journal: both keep the same epoch and re-read the same receipts. Every
target rebuilds at the current head after that bootstrap.

A closed bootstrap is an exceptional recovery reset, not a way to create a
journal. It is accepted only when the exact PR is live-closed, exactly one
canonical v2 journal already exists, and that journal either has no unfinished
ownership or matches the narrow terminal-active legacy case below. The journal
must be cursorless unless this is an exact rerun of its already-recorded
bootstrap. The numbered `repository_dispatch` run must authenticate the exact
repository, numeric controller workflow ID and path, run ID, run number, strict
title, and durable receipt. Its receipt establishes the new admission floor;
the same run's existing reconciliation job then folds the state and records the
terminal closed anchor/state. Neither step invokes the planner, dispatches a
worker, creates or updates a Deployment, or publishes a pending preview status.
A later `reopened` event starts normally from that terminal anchor.

The terminal-active legacy case exists only for a cursorless closed journal
whose mutable state failed to fold already-durable terminal results. It permits
current `active` slots only: no intended owner, any `retired_active` entry, or
checkpoint pending owner is recoverable through this exception. Every active
slot must bind exactly one canonical selection, one compatible terminal result,
and one distinct exact worker run and attempt. The controller
reads that exact attempt through the authenticated Actions API and validates
the trusted worker path, repository, default ref, authorized workflow SHA,
strict title, run URL, completed status, terminal conclusion, and
result/conclusion compatibility. It does not search for a worker, synthesize a
result, call worker recovery, or read or mutate a Deployment. Missing,
duplicate, nonterminal, contradictory, or changed evidence fails before
journal mutation. The live PR is queried again after proof and must still match
the closed bootstrap snapshot exactly.

The authenticated bootstrap run must also be the complete quiescent admission
frontier. Its receipt establishes that one floor; the existing
`reconcile-bootstrap` job in the same workflow run then consumes the already
persisted results, clears the stale current-active slots, and compacts the
journal. This is not another recovery operation, alternate-schema reader, or
recovery compatibility mode. A
terminal-recovery receipt deliberately defers active-capacity checkpointing so
the old owner lineage survives until that reconcile; the ordinary 60 KB
comment guard still rejects an oversized body before any write. While that
drain is pending, the durable admission cursor remains pinned to the bootstrap
run. If a later controller run appears at the Actions frontier before the drain
and compaction write commits, same-run reconciliation fails before persisting
that later cursor or mutating journal state. A centralized journal-write barrier
also rejects event, selection, worker-evidence, result, cursor, and nonterminal
state writes during this interval. Its only capabilities are an idempotent
replay of the exact admitted bootstrap receipt and the exact same run's terminal
drain-and-compaction state write. `state.closed` alone does not clear this
barrier: recovery remains pending while authenticated ownership is unfinished,
and only a terminal closed-and-drained state clears it.
A later PR event fails before admission refresh, even when its live pull-request
snapshot has already changed.
A distinct reconciliation run is rejected before admission refresh or state
mutation. A
terminal non-pending retired entry remains part of the pre-existing drained
contract and does not enter terminal-active recovery.

If a closed bootstrap partially fails after committing its receipt or terminal
witness, rerun the failed job(s) on that same Actions run. Reruns retain the
same run ID and run number and repair missing witness or reconciliation work
idempotently. Never send a second bootstrap dispatch for the same closed
journal: a distinct run cannot replace its established admission cursor. A
closed bootstrap against a missing journal or unfinished ownership fails before
mutation unless the unfinished state is exactly the authenticated
terminal-active legacy case above.

For a terminal-active cursorless closed journal, recovery after the corrective
change reaches `main` has exactly two operator steps:

1. Freeze lifecycle mutations and confirm the PR is still closed, exactly one
   canonical v2 journal exists with no admission cursor, no checkpoint pending
   owner or `retired_active` entry exists, every current active slot has one
   matching terminal result, every exact worker attempt is completed, and no
   later controller run is in flight. Do not edit the journal, run a standalone
   reconcile, or redispatch a worker.
2. Dispatch one closed bootstrap and wait for both its receipt and same-run
   reconciliation jobs. Verify the journal has the exact bootstrap run
   ID/number as its admission cursor, is terminal-closed with all active and
   retired slots empty, and the run emitted no planner execution, worker
   dispatch, Deployment mutation, or pending `Vercel Preview` status:

   ```bash
   PR_NUMBER="<closed-pr-number>"
   gh api --method POST \
     repos/mento-protocol/frontend-monorepo/dispatches \
     -f event_type=vercel-preview-bootstrap \
     -F "client_payload[pr_number]=$PR_NUMBER"
   ```

If step 2 fails after its receipt commits, rerun the failed job on that same
Actions run. Never dispatch another distinct closed bootstrap.

Do not invent an opened event, manually edit or delete a journal, invent journal
entries, or re-dispatch the worker directly. Missing repository names must be
provisioned by a maintainer; automation may check presence but must never
retrieve, export, reconstruct, or print credential values.

### Global admission-cursor cutover

The global run-number proof has no legacy branch-scan fallback. Roll it out as
one ordered reset protocol:

1. Merge the precursor that adds strict numbered event/inert run names and
   numbered bootstrap receipts, without enabling global admission enforcement.
2. Run one canary and verify the live controller title and durable receipt carry
   the same strict run ID and run number.
3. Update enforcement PR #586 from that precursor exactly once, wait for its
   strict numbered `synchronize` receipt, and freeze it. Do not establish a
   speculative cursor from a branch scan or mutable head ref.
4. Drain controller, worker, intake, and controller-callback activity that can
   still mutate #586's journal, and prove its durable journal has no unfinished
   ownership. Merge #586 only after that quiescence proof. Its close event may
   fail admission because the enforcement implementation was not yet running
   from the default branch when GitHub emitted the close; this is expected
   during this one cutover and must not be repaired by inventing a receipt.
5. From the new default branch, drain again, dispatch exactly one closed
   `vercel-preview-bootstrap` for #586, and verify the exact
   `repository_dispatch` run ID, run number, strict title, controller workflow
   ID/path, repository, durable receipt, and top-level admission cursor all
   agree. Verify the journal is terminal-closed and the run emitted no planner,
   worker dispatch, Deployment, or pending preview status. Let that same run's
   reconciliation job finish; if it failed after the receipt committed, rerun
   that job on the same run or dispatch one `vercel-preview-reconcile`, then
   verify terminal state again. Do not send a second distinct closed bootstrap.
6. Freeze further pull-request lifecycle mutations. Inventory every other open
   canonical v2 journal without an admission cursor, including #535. Drain each
   journal's unfinished ownership and bootstrap every inventoried journal
   immediately. Verify every numbered bootstrap receipt, cursor, and terminal
   reconciliation result before lifting the freeze. Do not resume pushes,
   retargets, reopens, or closes until every bootstrap is proven; no lifecycle
   event may race ahead of this migration.
7. Treat any delayed controller event at or below the authenticated reset floor
   as an exact-run-authenticated, write-free no-op. A receipt above the floor is
   never silently ignored: an incomplete run defers without mutation and a
   completed run missing its receipt fails closed.

A numeric workflow-ID change, deleted run, stable sequence gap, or exhausted
bounded traversal uses the same recovery: stop pushes, drain, deploy any
reviewed corrective change, and establish a new exact numbered bootstrap floor
on an open PR. The closed-bootstrap exception may repair any existing drained,
legacy cursorless journal whose live PR is closed; #586 is the required rollout
instance. It never creates a journal or replaces an existing cursor. Never
infer a floor from a legacy `synchronize`/`edited` receipt or manually edit the
cursor JSON.

### Clean v1-to-v2 journal migration

The four-target v2 controller is a clean replacement for the UI-only v1
controller. Runtime code has no v1 reader, writer, importer, deleter,
compatibility worker, or dual-read window. The migration deliberately abandons
v1 lifecycle continuity and rebuilds authoritative state from current GitHub
PR metadata.

1. Establish a coordinated no-push window. Inventory every non-completed run of
   the preview controller, worker, and intake workflows. Let each run terminate
   or cancel it, then verify that no v1 run can still edit a journal, dispatch a
   worker, or publish preview state.
2. Inventory every open participating PR and record the exact comment ID of
   each `github-actions[bot]` comment whose complete marker is
   `<!-- vercel-preview-journal:v1 -->`. Treat those comments only as retired
   audit evidence; do not copy or translate their payloads.
3. Merge the v2 controller without changing any Vercel project configuration.
4. Dispatch `vercel-preview-bootstrap` once for every open participating PR by
   using the command above. Bootstrap must plan from the live PR head and
   current repository files, never from the v1 journal.
5. For each PR, prove that exactly one trusted-bot comment has the
   `<!-- vercel-preview-journal:v2 -->` marker and record its stable comment ID.
   Verify its `vercel-preview-journal:v2` payload contains independent state and
   checkpoint records for `app`, `governance`, `reserve`, and `ui`; its aggregate
   exact-head `Vercel Preview` status must agree with the expected worker,
   Deployment, native-owner, or no-runtime result for every target. A later
   transition must edit that same v2 comment instead of creating another one.
6. Only after every v2 bootstrap in step 5 is proven, manually delete the
   inventoried v1 comments. Before each deletion, reread the comment and require
   the exact recorded ID, `github-actions[bot]` author, and complete v1 journal
   marker. Do not delete by substring, age, or author alone; leave malformed,
   unknown, human, third-party-bot, and review comments untouched. This is an
   operator cleanup step, not a code path in the v2 controller.
7. Release the no-push window after all open participating PRs have a verified
   v2 journal. Subsequent reconcile, worker callback, close, and reopen events
   must continue using only v2 state.

Rollback is a v2 roll-forward restart: drain or cancel all v2 controller and
worker runs, merge the reviewed corrective change, and bootstrap fresh v2
journals from live PR state. Never restore the v1 controller, import a v1
payload, rematerialize a deleted v1 journal, or claim lifecycle continuity
across the restart.

### Four-target v2 activation canary and later ownership cutovers

This subsection is the historical acceptance record for the completed v2
activation and the Reserve, Governance, and App preview-ownership cutovers. Its
independent rollback procedures remain current. Activating the v2 controller
did not edit a Vercel project configuration. In the initial ownership map,
GitHub Actions was the sole automatic branch-preview owner for `ui`; `app`,
`governance`, and `reserve` remained in shadow mode so their native Vercel and
GitHub-built previews ran together. All four ordinary preview paths are now
GitHub-owned. At the time of this preview acceptance record, public `main`
deployments remained native during #522's automatic PR-A shadow proof. The
current active-main topology is documented at the top of this runbook. App
`v2` remains native throughout this epic.

After the v2 bootstrap, the rollout exercised one runtime-affecting PR per
target before a single PR that affects multiple targets. For every canary, it
recorded the PR and
exact SHA, controller and worker run URLs, canonical Deployment ID and
environment, GitHub-built immutable URL, native immutable URL when the target
is shadowed, v2 journal comment ID and revision, exact-head aggregate status,
and browser evidence. The evidence proved all of the following:

1. only the affected targets advance, while unaffected target checkpoints stay
   stable;
2. each selected target uses
   `preview/<target>/pr-<number>` and the unchanged external key
   `vercel-preview:v1:pr:<number>:target:<target>:sha:<sha>`;
3. all selected targets use the single reusable smoke workflow for both the
   initial upload and same-upload retry;
4. `app`, `governance`, and `reserve` show both a native preview and one
   canonical GitHub Deployment, while `ui` shows only the GitHub Deployment;
5. the one v2 journal comment is edited in place and its four target outcomes
   agree with the compact aggregate `Vercel Preview` status; and
6. first-eligible-plus-latest batching and recovery operate independently per
   target, including a multi-target PR with overlapping pushes.

Each later native-to-GitHub ownership cutover was a separate atomic change per
target. In the same reviewed PR, the rollout changed that target's exact
`vercel.json` from the canonical native configuration to its canonical GitHub
configuration and changed only that target's `ownershipMode` in
`scripts/vercel-preview-targets.mjs` from `shadow` to `github`. Structural tests
and this runbook were updated in the same PR. The rollout did not flip a
global ownership mode or hand-copy a configuration from another target.

Historical acceptance rule: Perform those later cutovers strictly in the order
**Reserve → Governance → App**, with one reviewed merge and completed live
canary between targets. Stop after any failed target: keep every already-proven
target in its accepted owner state, leave all later targets in shadow mode, and
diagnose or roll back only the failed target. The literal ordering rule was
`App may not cut over until Governance`; Governance first had to complete its
own cutover and browser-verified canary. The earlier controller-expansion change
ended at shadow activation and did not include any of those three configuration
cutovers.

Before each Reserve, Governance, or App cutover, the rollout inventoried open
branches and PRs that still contained that target's pre-cutover `vercel.json`.
Every validation branch merged or rebased the resulting current `main` before
its canary was accepted. Any intentionally deferred stale PR required a recorded
owner and follow-up action; repository-wide duplicate prevention was not claimed
while an unaccounted stale branch could still request a native preview.

For rollback, first establish a coordinated no-push window and drain controller
and worker ownership for the target. Atomically restore its canonical
native-preview configuration and `shadow` preview ownership mode while
preserving that target's current main owner. With the current GitHub-owned main
map, this is the native-preview/GitHub-main state whose exact rules appear in
each rollback procedure below. Then require an exact-head native deployment
plus browser proof before accepting the rollback. Never split the configuration
and ownership edits across merges.

### Reserve Vercel Git cutover

Status: completed. The configuration and canary requirements below record the
accepted rollout procedure; the independent rollback remains operative.

This change was the first per-target ownership cutover. It atomically paired
`PREVIEW_TARGET_CONFIG.reserve.ownershipMode` set to `github` with this exact
`apps/reserve.mento.org/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "**": false,
      "main": true
    }
  }
}
```

`main: true` keeps Reserve main and production deployments on Vercel Git. This
PR must not alter App or Governance shadow ownership, UI GitHub ownership, App
`v2`/`v3` behavior, any production domain, or the deleted Governance QA
environment.

Note (2026-09-01): MGP-18 retired the legacy App v2 path. The "App `v2`/`v3`
behavior" reference above is historical; App's `v2 -> production` path no
longer exists.

Note (2026-09-02): MGP-18's final tighten step also retired App's custom `v3`
environment. The "`v3`" half of the reference above is historical too; App now
deploys and promotes through the ordinary production environment like every
other target.

The version-controlled pair is preparation, not proof that Reserve has cut
over successfully. Before accepting the cutover, inventory and rebase every
Reserve-runtime validation branch that still carries the native configuration.
On the cutover PR's exact head, then again on a fresh post-merge canary branched
from the resulting `main`, record and verify all of the following:

1. the planner selects only the targets affected by the immutable runtime
   delta, and the Reserve controller/worker completes successfully;
2. exactly one canonical GitHub Deployment and at most one Vercel preview exist
   for the Reserve target/key/SHA;
3. the immutable Reserve URL passes the repository browser protocol, including
   Overview data, the Supply tab and URL/state transition, console, network,
   assets, fonts, and security headers;
4. no native Reserve branch preview exists for the same exact SHA;
5. the aggregate `Vercel Preview` status and v2 journal agree with the exact
   Reserve outcome; and
6. Reserve `main` remains natively deployed, while App and Governance remain
   shadowed and UI remains GitHub-owned.

Do not call Reserve cut over, begin the Governance cutover, or close the rollout
item until both the live cutover matrix and the post-merge canary pass.

#### Independent Reserve rollback

Rollback changes only Reserve and returns it to the pre-cutover shadow state;
it does not roll back App, Governance, or UI or pause the active controller
globally. App, Governance, and UI keep their GitHub preview owners. First
establish a coordinated no-push window. Exhaustively drain controller, worker,
and intake activity with this copy-safe command, repeating it until two
consecutive inventories are empty after cancellations have settled:

```bash
set -euo pipefail

list_nonterminal_preview_runs() {
  local workflow status
  local -a workflows=(
    vercel-preview-controller.yml
    vercel-preview-worker.yml
    vercel-preview-intake.yml
  )
  local -a statuses=(queued requested waiting pending in_progress)

  for workflow in "${workflows[@]}"; do
    for status in "${statuses[@]}"; do
      gh api --paginate --method GET \
        "repos/mento-protocol/frontend-monorepo/actions/workflows/${workflow}/runs" \
        -f status="$status" \
        -f per_page=100 \
        --jq '.workflow_runs[] | [.id, .status, .path, .html_url] | @tsv'
    done
  done | sort -u
}

list_nonterminal_preview_runs
list_nonterminal_preview_runs |
  cut -f1 |
  sort -u |
  while read -r run_id; do gh run cancel "$run_id"; done
```

In one reviewed rollback PR, restore
`apps/reserve.mento.org/vercel.json` exactly to:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "dependabot/**": false,
      "main": false
    }
  }
}
```

`main: false` preserves GitHub as Reserve's automatic main owner while
unspecified ordinary branches return to native preview ownership.
In that same commit, change only the Reserve entry in
`scripts/vercel-preview-targets.mjs` back to:

```js
ownershipMode: PREVIEW_OWNERSHIP_MODES.SHADOW,
```

Do not change `VERCEL_PREVIEW_CONTROLLER_MODE`: it stays `active` so App,
Governance, and UI keep their GitHub preview owners.
Do not split the two Reserve edits across commits or merges. Run the ownership,
preview, primitives, and workflow structural tests, update the current-state
text in this runbook and `README.md`, and re-inventory every active Reserve
runtime branch carrying the GitHub-owned configuration.

Before merging the rollback, require the native Vercel deployment/status for
the rollback PR's exact head SHA and run the full Reserve browser protocol on
its immutable URL. The aggregate `Vercel Preview` status proves controller
selection and journal state only; it is not native deployment or browser
evidence. After merge, rebase a fresh Reserve-runtime canary onto the restored
`main`, bootstrap or reconcile its v2 journal through the documented operator
events if required, and prove both native-preview recovery and the expected
GitHub shadow canary. Keep Reserve in shadow mode until a new independently
reviewed cutover repeats the full acceptance matrix. Never touch App,
Governance, UI, production domains, or recreate Governance QA as part of this
rollback.

### Governance Vercel Git cutover

Status: completed. The configuration and canary requirements below record the
accepted rollout procedure; the independent rollback remains operative.

This change was the second per-target ownership cutover. It was published only
after the Reserve cutover's fresh post-merge canary passed. The historical gate
was explicit: Reserve evidence must not be reused as proof for Governance. The
Governance change atomically paired
`PREVIEW_TARGET_CONFIG.governance.ownershipMode` set to `github` with this exact
`apps/governance.mento.org/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "**": false,
      "main": true
    }
  }
}
```

`main: true` keeps Governance main and production deployments on Vercel Git.
This PR must preserve App shadow ownership, Reserve and UI GitHub ownership,
App `main`/`v2` and custom-`v3` semantics, every production domain, the active
controller, and the deleted Governance QA environment.

The version-controlled pair is preparation, not proof that Governance has cut
over successfully. Before accepting the cutover, inventory and rebase every
Governance-runtime validation branch that still carries the native
configuration. On the cutover PR's exact head, then again on a fresh post-merge
canary branched from the resulting `main`, record and verify every gate below.

#### Governance target-local acceptance matrix

| Gate                 | Exact evidence required                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan and execution   | A Governance-local runtime delta selects Governance, and its exact-SHA controller and worker complete successfully.                                                                                                         |
| Deployment identity  | One canonical GitHub Deployment points to exactly one corresponding prebuilt Vercel preview for the Governance target/key/SHA.                                                                                              |
| Browser protocol     | The immutable Governance URL renders current proposal and voting data, opens the real wallet list, permits the team-host-only mock-wallet connection, and passes console, network, JS/CSS/font, and security-header checks. |
| Single owner         | No native Governance branch preview or second Vercel Git deployment exists for the same exact SHA.                                                                                                                          |
| Durable state        | The aggregate `Vercel Preview` status and the single v2 journal agree with the exact Governance outcome and immutable URL.                                                                                                  |
| Preserved boundaries | Governance `main` remains natively deployed; App remains shadowed; Reserve and UI remain GitHub-owned; App `v2` and custom `v3` are unchanged; Governance QA remains deleted.                                               |

Note (2026-09-01): MGP-18 retired the legacy App v2 path referenced above (in
the PR-scope paragraph and the acceptance matrix); App's `v2 -> production`
path no longer exists.

Note (2026-09-02): MGP-18's final tighten step also retired App's custom `v3`
environment referenced above; App now deploys and promotes through the
ordinary production environment like every other target.

Do not call Governance cut over, begin the App cutover, or close the rollout
item until both the exact-head matrix and the fresh post-merge Governance
canary pass. Workflow logs, Reserve evidence, a native `main` deployment, or a
mutable alias are not substitutes for Governance exact-SHA deployment and
browser proof.

#### Independent Governance rollback

Rollback changes only Governance and returns it to the pre-cutover shadow
state. It does not roll back App, Reserve, or UI or pause the active controller
globally. App, Reserve, and UI keep their GitHub preview owners. First establish
a coordinated no-push window. Exhaustively
drain controller, worker, and intake activity with this copy-safe command,
repeating it until two consecutive inventories are empty after cancellations
have settled:

```bash
set -euo pipefail

list_nonterminal_preview_runs() {
  local workflow status
  local -a workflows=(
    vercel-preview-controller.yml
    vercel-preview-worker.yml
    vercel-preview-intake.yml
  )
  local -a statuses=(queued requested waiting pending in_progress)

  for workflow in "${workflows[@]}"; do
    for status in "${statuses[@]}"; do
      gh api --paginate --method GET \
        "repos/mento-protocol/frontend-monorepo/actions/workflows/${workflow}/runs" \
        -f status="$status" \
        -f per_page=100 \
        --jq '.workflow_runs[] | [.id, .status, .path, .html_url] | @tsv'
    done
  done | sort -u
}

list_nonterminal_preview_runs
list_nonterminal_preview_runs |
  cut -f1 |
  sort -u |
  while read -r run_id; do gh run cancel "$run_id"; done
```

In one reviewed rollback PR, restore
`apps/governance.mento.org/vercel.json` exactly to:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "dependabot/**": false,
      "main": false
    }
  }
}
```

`main: false` preserves GitHub as Governance's automatic main owner while
unspecified ordinary branches return to native preview ownership.
In that same commit, change only the Governance entry in
`scripts/vercel-preview-targets.mjs` back to:

```js
ownershipMode: PREVIEW_OWNERSHIP_MODES.SHADOW,
```

Do not change `VERCEL_PREVIEW_CONTROLLER_MODE`: it stays `active` so App,
Reserve, and UI keep their GitHub preview owners. Do not split the two
Governance edits across commits or merges. Run the ownership, preview,
primitives, and workflow structural tests, update the current-state text in
this runbook and `README.md`, and re-inventory every active Governance runtime
branch carrying the GitHub-owned configuration.

Before merging the rollback, require the native Vercel deployment/status for
the rollback PR's exact head SHA and run the full Governance browser protocol
on its immutable URL. Prove current proposal/voting data, the real wallet list,
the team-host-only mock-wallet connection, console and network health, assets,
fonts, and security headers. The aggregate `Vercel Preview` status proves
controller selection and journal drain only; it is not native deployment or
browser evidence. After merge, rebase a fresh Governance-runtime canary onto
the restored `main`, bootstrap or reconcile its v2 journal through the
documented operator events if required, and prove both native-preview recovery
and the expected GitHub shadow canary. Keep Governance in shadow mode until a
new independently reviewed cutover repeats the full acceptance matrix. Never
touch App, Reserve, UI, production domains, or recreate Governance QA as part
of this rollback.

### App Vercel Git cutover

Status: completed. The configuration and canary requirements below record the
accepted rollout procedure; the independent rollback remains operative.

This change was the third and final per-target ownership cutover. Governance's
ownership change was already present in the base state, and this App change was
published only after the Governance cutover's fresh post-merge canary passed.
The historical gate was explicit: evidence must not be reused as proof for App.
That applied to Governance and every earlier target. The App change atomically paired
`PREVIEW_TARGET_CONFIG.app.ownershipMode` set to `github` with this exact
`apps/app.mento.org/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "**": false,
      "main": true,
      "v2": true
    }
  }
}
```

`main: true` and `v2: true` preserve the two native Vercel Git release paths
after the catch-all branch rule disables ordinary native previews. Ordinary
pull requests continue to use the standard `preview` target, never App's custom
`v3` target. This PR does not change the custom-`v3` build, activation, domain,
or rollback semantics. It must preserve Governance, Reserve, and UI GitHub
ownership, every production domain, the active controller, and the deleted
Governance QA environment.

Note (2026-09-01): MGP-18 retired the legacy App v2 path. The current
`apps/app.mento.org/vercel.json` is `{"git":{"deploymentEnabled":false}}`, like
the other three apps; the `v2: true` entry shown above no longer exists.

Note (2026-09-02): MGP-18's final tighten step also retired App's custom `v3`
build, activation, domain, and rollback semantics referenced above. App now
builds, deploys, and promotes through the ordinary production environment,
the same as Governance, Reserve, and UI, with no separate `v3` target.

The version-controlled pair is preparation, not proof that App has cut over
successfully. Before accepting the cutover, inventory and rebase every
App-runtime validation branch that still carries the native configuration. On
the cutover PR's exact head, then again on a fresh post-merge canary branched
from the resulting `main`, record and verify every gate below.

#### App target-local acceptance matrix

| Gate                 | Exact evidence required                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan and execution   | An App-local runtime delta selects only App, and its exact-SHA controller and worker complete successfully.                                                                                                                    |
| Deployment identity  | One canonical GitHub Deployment points to exactly one corresponding prebuilt Vercel preview for the App target/key/SHA.                                                                                                        |
| Browser protocol     | The immutable App URL renders the current swap shell, opens the real wallet list, permits the team-host-only mock-wallet connection, and passes primary-navigation, console, network, JS/CSS/font, and security-header checks. |
| Single owner         | No native App branch preview or second Vercel Git deployment exists for the same exact SHA.                                                                                                                                    |
| Durable state        | The aggregate `Vercel Preview` status and the single v2 journal agree with the exact App outcome and immutable URL.                                                                                                            |
| Preserved boundaries | App `main` and `v2` still deploy natively; custom `v3` behavior and every production domain are unchanged; Governance, Reserve, and UI remain GitHub-owned; Governance QA remains deleted.                                     |

Do not call App cut over or close the rollout item until both the exact-head
matrix and the fresh post-merge App canary pass. Workflow logs, Governance or
earlier-target evidence, a native `main`/`v2` deployment, a custom-`v3`
deployment, or a mutable alias are not substitutes for App exact-SHA deployment
and browser proof.

#### Accepted post-merge App canary

The fresh post-cutover canary [PR #610](https://github.com/mento-protocol/frontend-monorepo/pull/610)
used exact head `deb769c17bec83a711f816ed668334f245856173`. Controller run
[`29957406353`](https://github.com/mento-protocol/frontend-monorepo/actions/runs/29957406353)
selected App only, and worker run
[`29957526709`](https://github.com/mento-protocol/frontend-monorepo/actions/runs/29957526709)
created GitHub Deployment `5562894740` in `preview/app/pr-610` for the immutable
URL <https://appmento-dedwx4psr-mentolabs.vercel.app/>. The reusable smoke
passed its bundled-Chromium interaction, root/asset/header, build-identity, console,
and same-origin network checks. Terminal callback run
[`29958427106`](https://github.com/mento-protocol/frontend-monorepo/actions/runs/29958427106)
first updated the single [v2 journal comment](https://github.com/mento-protocol/frontend-monorepo/pull/610#issuecomment-5051499028)
to revision 8 with one verified App result, no active or retired owner for any
target, and aggregate `Vercel Preview` success. After the evidence PR was closed
unmerged, close-event run
[`29959037070`](https://github.com/mento-protocol/frontend-monorepo/actions/runs/29959037070)
advanced the journal to revision 10 with `state.closed: true`, checkpoint
sequence 1, and every target's active and retired queues empty; the disposable
remote branch was deleted only after that compaction succeeded. No native App
branch deployment or status was created for that SHA. The Vercel integration
emitted only inactive `Skipped - Not affected` metadata records for Governance,
Reserve, and UI. Together with the exact-head evidence on PR #609, this satisfies
the App acceptance matrix; ordinary previews for all four targets are now
GitHub-owned.

#### Independent App rollback

Rollback changes only App and returns it to the pre-cutover shadow state. It
does not roll back Governance, Reserve, or UI, alter App's native release
paths, or pause the active controller globally. Governance, Reserve, and UI
keep their GitHub preview owners. First establish a coordinated no-push window.
Exhaustively drain controller, worker, and intake activity with this copy-safe
command, repeating it until two consecutive inventories are empty after
cancellations have settled:

```bash
set -euo pipefail

list_nonterminal_preview_runs() {
  local workflow status
  local -a workflows=(
    vercel-preview-controller.yml
    vercel-preview-worker.yml
    vercel-preview-intake.yml
  )
  local -a statuses=(queued requested waiting pending in_progress)

  for workflow in "${workflows[@]}"; do
    for status in "${statuses[@]}"; do
      gh api --paginate --method GET \
        "repos/mento-protocol/frontend-monorepo/actions/workflows/${workflow}/runs" \
        -f status="$status" \
        -f per_page=100 \
        --jq '.workflow_runs[] | [.id, .status, .path, .html_url] | @tsv'
    done
  done | sort -u
}

list_nonterminal_preview_runs
list_nonterminal_preview_runs |
  cut -f1 |
  sort -u |
  while read -r run_id; do gh run cancel "$run_id"; done
```

In one reviewed rollback PR, restore `apps/app.mento.org/vercel.json` exactly
to:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "dependabot/**": false,
      "main": false
    }
  }
}
```

`main: false` preserves GitHub as App `main -> v3` owner.
In that same commit, change only the App entry in
`scripts/vercel-preview-targets.mjs` back to:

```js
ownershipMode: PREVIEW_OWNERSHIP_MODES.SHADOW,
```

Do not change `VERCEL_PREVIEW_CONTROLLER_MODE`: it stays `active` so
Governance, Reserve, and UI keep their GitHub preview owners. Do not split the
two App edits across commits or merges. Run the ownership, preview, primitives,
and workflow structural tests, update the current-state text in this runbook
and `README.md`, and re-inventory every active App runtime branch carrying the
GitHub-owned configuration.

Before merging the rollback, require the native Vercel deployment/status for
the rollback PR's exact head SHA and run the full App browser protocol on its
immutable URL. Prove the current swap shell, real wallet list, team-host-only
mock-wallet connection, primary navigation, console and network health, assets,
fonts, and security headers. The aggregate `Vercel Preview` status proves
controller selection and journal drain only; it is not native deployment or
browser evidence. After merge, rebase a fresh App-runtime canary onto the
restored `main`, bootstrap or reconcile its v2 journal through the documented
operator events if required, and prove both native-preview recovery and the
expected GitHub shadow canary. Independently prove the GitHub-owned App
`main -> v3` path remains healthy. A native preview for the rollback head is
not evidence for the release path.
Keep App in shadow mode until a new independently reviewed cutover repeats the
full acceptance matrix. Never touch Governance, Reserve, UI, production domains,
or recreate Governance QA as part of this rollback.

Note (2026-09-01): MGP-18 retired the legacy App v2 path. This rollback
procedure and its configuration shapes no longer carry a `v2` entry.

Note (2026-09-02): MGP-18's final tighten step also retired App's custom `v3`
environment. The "App `main -> v3`" references above are historical; App's
`main` now deploys and promotes through the ordinary production environment,
the same as every other target.

## UI Vercel Git cutover (Phase B)

Phase B established UI's GitHub-owned branch-preview state. At that point App
remained shadowed until its separate cutover; App has since joined Governance,
Reserve, and UI in the current all-GitHub-owned preview map. The completed
cutover followed the recorded dual-path canary evidence. This separate merge paired
`VERCEL_PREVIEW_CONTROLLER_MODE: active` in
`.github/workflows/vercel-preview-controller.yml` with the following exact
`apps/ui.mento.org/vercel.json`, preserving its schema and unrelated keys:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "**": false,
      "main": true
    }
  }
}
```

Vercel treats any matching `true` as enabled, so `main` remains natively
deployed even though it also matches `**`. If this Phase B branch waited while
Phase A changed, rebase it onto the final Phase A `main` before merge. Before
the Phase B merge, inventory every active UI-runtime PR and branch. After the
cutover reaches `main`, each active branch must rebase or merge that `main`, or
receive an explicitly reviewed equivalent branch update containing this Phase B
configuration, before repository-wide duplicate prevention can be claimed.

Use a fresh UI canary or rebase an existing UI canary onto the resulting `main`
so it contains this configuration. Prove one canonical GitHub Deployment, one
Vercel preview, no native branch preview, a truthful required status, and an
unchanged native merge/main deployment. A fresh canary proves only its own
branch; stale pre-cutover branches still carry their old static `vercel.json`
and are not valid repository-wide duplicate-prevention evidence.

UI rollback is target-local. One reviewed PR must atomically restore
`apps/ui.mento.org/vercel.json` exactly to:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "dependabot/**": false,
      "main": false
    }
  }
}
```

`main: false` preserves GitHub as UI's automatic main owner while unspecified
ordinary branches return to native preview ownership.
In that same commit, change only the UI entry in
`scripts/vercel-preview-targets.mjs` back to:

```js
ownershipMode: PREVIEW_OWNERSHIP_MODES.SHADOW,
```

Keep `VERCEL_PREVIEW_CONTROLLER_MODE` set to `active`; App, Governance, and
Reserve remain GitHub-owned. Do not split the two UI edits across commits or
merges. A configuration-only or
mode-only rollback is not a supported repository state, and
`pnpm vercel:preview:test` rejects either mismatch. The exact-head runtime guard
is additional pre-merge protection: as soon as the rollback PR contains the
exact native configuration, the still-GitHub-owned workflow from `main` refuses
to dispatch UI for it. This cross-ref safeguard does not make a split rollback
acceptable. After merge, the new shadow mode deliberately permits both the
restored native preview and the GitHub canary for UI.

On the rollback PR, `Vercel Preview` reports `pending` with
`Draining GitHub preview before native ownership` while any journal-owned
GitHub intent or worker remains. The controller attaches a uniquely matching
crash-window worker without dispatching, including ownership retired by a close
or reopen epoch; completion is recovered in that same reconciliation attempt,
and an intent with no worker is durably retired after bounded observation. A
native-owned historical receipt encountered after a later switch back to
GitHub ownership follows that same durable retirement path instead of being
dispatched by the later head's configuration. Its dedicated
`native-owned-selection-without-github-worker` result is reported as
ownership-success and never claims a native build or smoke. Generic retirement
of a GitHub-owned intent keeps its error semantics. Only after no active or
retired GitHub ownership remains does the rollback PR's native-owned context
become `success` with `Native Vercel owns this UI preview`. Missing, malformed,
or unknown candidate configuration and multiple matching workers remain
`error`.

That green context proves only the controller's owner selection and drained
journal state. Its target is the controller run as audit evidence; it does not
prove that native Vercel built, deployed, or smoke-tested the candidate. The
same current-head ownership decision is persisted in the
journal and posted as the external status. A native-ownership checkpoint keeps
that meaning across later docs-only pushes but never updates
`last_successful_runtime_*`; only validated live worker evidence can replace
that build-and-smoke provenance. Before
merging the rollback, separately require the native Vercel deployment/status
for the rollback PR's exact head SHA, open its immutable preview URL, and run the
repository browser protocol: verify rendering and primary navigation, inspect
console errors and failed network requests, confirm assets and fonts, and check
the expected security headers. Record the native deployment and browser
evidence on the PR. Never treat the ownership-only status as this evidence.

Immediately before merging the rollback, establish a coordinated no-push window
and drain or cancel every non-completed run of all three workflows:

```bash
set -euo pipefail

list_nonterminal_preview_runs() {
  local workflow status
  local -a workflows=(
    vercel-preview-controller.yml
    vercel-preview-worker.yml
    vercel-preview-intake.yml
  )
  local -a statuses=(queued requested waiting pending in_progress)

  for workflow in "${workflows[@]}"; do
    for status in "${statuses[@]}"; do
      gh api --paginate --method GET \
        "repos/mento-protocol/frontend-monorepo/actions/workflows/${workflow}/runs" \
        -f status="$status" \
        -f per_page=100 \
        --jq '.workflow_runs[] | [.id, .status, .path, .html_url] | @tsv'
    done
  done | sort -u
}

list_nonterminal_preview_runs
list_nonterminal_preview_runs |
  cut -f1 |
  sort -u |
  while read -r run_id; do gh run cancel "$run_id"; done
```

`gh api --paginate` follows every response page separately for every workflow
and every GitHub nonterminal status; do not replace it with a bounded
`gh run list --limit ...` query. Any query or cancellation error aborts the
shell; correct the cause and rerun the full inventory from the start. Repeat the
inventory and cancellation pipeline until the inventory prints no rows. After
that first empty result, wait for cancellations to settle because worker and
intake completion can start a final controller callback, then require a second
empty exhaustive sweep immediately before merge. Do not merge while any queued,
requested, waiting, pending, or in-progress controller, worker, or intake run
remains. This quiescence proof prevents a run loaded from the pre-rollback
ownership map from dispatching after native ownership is restored.

Before merging the rollback, inventory every active UI-runtime PR and branch
that carries the Phase B `"**": false` rule. After the restored configuration
reaches `main`, each inventoried branch must rebase or merge that `main`, or
receive an explicitly reviewed equivalent branch update containing the exact
rollback configuration, before native preview restoration can be claimed. A
stale Phase B branch still carrying the GitHub-owned configuration continues to
request only its GitHub preview under the restored shadow controller; it is not
evidence that native UI previews have recovered.

The rollback PR must update the current-state ownership text in `README.md` and
this runbook. Do not weaken or remove the executable pairing assertion in
`scripts/vercel-git-ownership.test.mjs`; it is the guard that makes the atomic
mode/configuration change mandatory.

Use a fresh or restored-main-rebased UI canary to prove both the native preview
and expected GitHub shadow canary return. A fresh canary proves only its own
branch and is not evidence that every active Phase B branch was restored. The
rollback PR's `Vercel Preview` owner-selection result is not native deployment
or browser evidence; require both separately anywhere preview readiness gates a
merge. Do not change production domains, other apps, or recreate Governance QA.
