# Vercel build-minute validation

This runbook defines the measurement and closeout work tracked in [issue
#523](https://github.com/mento-protocol/frontend-monorepo/issues/523). The
collector reads GitHub through the maintainer's logged-in `gh` session. It does
not query Vercel, change a deployment, or remove migration scaffolding. The
observation window starts only after the
four-target preview ownership and active-main cutover in issue #522 have live
runtime and ownership proof. The checked-in active topology alone does not
start the window or mark #522 complete. Historical automatic PR-A
`Vercel Main Deployment` shadow runs are canary evidence, not post-cutover
observations. Each historical shadow run writes a canonical redacted job
summary and uploads
`vercel-main-evidence-${run_id}-${run_attempt}` for 14 days before returning its
terminal result. Successful runs contain build, deploy, runner, and Turbo-cache
measurements; failed runs contain only the redacted failure graph. Successful
shadow measurements help diagnose the canary, but they remain log-duration
evidence rather than invoice-grade Build CPU allocation.

The repository provides a Vercel-credential-free GitHub evidence collector and a
deterministic, network-free analyzer. Initialize the approved half-open
observation interval before its start boundary:

```bash
pnpm vercel:cost:observe -- init \
  --start 2026-07-29T00:00:00.000Z \
  --end 2026-08-05T00:00:00.000Z
```

The collector writes only below the fixed ignored root
`.vercel-cost-evidence/github-observation-v2/`. It requires a normal logged-in
`gh` session, makes no Vercel request, accepts no token option, reads no token
environment variable, and never prints captured response bodies. Every `gh`
request is pinned to `github.com`; the subprocess receives only the narrow
path, home/config, temporary-directory, and locale allowlist needed for the
stored `gh` login. Vercel, 1Password, cloud-provider, proxy, and arbitrary host
environment variables are neither read nor forwarded. It requires
real mode-`0700` directories and single-link mode-`0600` files, rejects
symlinks and paths outside the fixed root, and publishes a capture only after
all raw files validate. One root operation lock serializes every mutation.
Single files use fsynced temporary writes and atomic no-overwrite publication;
capture directories are fsynced after publication, and a later locked command
removes safely bounded staging trees left by a crashed process. Each capture
has a separate seal over canonical
`capture.json` bytes and the exact payload tree, so verification rejects
changed, missing, and unlisted files. Repeating an identical capture verifies
and returns the existing immutable record; a partial or conflicting record
fails instead of being replaced. These local hashes detect accidental changes
and unsynchronized edits. They do not protect against a local actor who can
rewrite both the evidence and its seal; copy the completed private tree to an
access-controlled immutable store for long-term provenance.
The start record calls its visibility fact `publicAtCapture`: `init` runs
before `startUtc`, so that observation cannot prove future visibility at the
boundary. `interval.json` binds the canonical start-record digest, and each
interval extension binds the preceding interval-chain digest.

Capture each authoritative GitHub milestone promptly:

```bash
# Run after an opened/synchronize controller event settles, while its v2
# journal receipts still exist.
pnpm vercel:cost:observe -- capture-preview \
  --pr <number> \
  --event-run-id <pull_request_target-controller-run-id>

# Run after every Vercel Main Deployment run settles. All run attempts are
# retained, including failed or superseded attempts.
pnpm vercel:cost:observe -- capture-main \
  --run-id <vercel-main-deployment-run-id>

# Run at useful checkpoints and once after the final end.
pnpm vercel:cost:observe -- sample-github
```

`capture-preview` requires exactly one canonical
`vercel-preview-journal:v2` comment owned by `github-actions[bot]`, correlates
the immutable event receipt, controller run title, selections, referenced
worker attempts, bot-owned final sentinel, commit statuses, and exact GitHub
Deployment/status evidence, then seals every raw file. It publishes only after
the event has a terminal decision and every planned target has a complete,
selection-bound worker result. A pending, compacted-away, or ambiguous event
fails without reserving its append-only destination; retry after reconciliation
while the live event receipt still exists.

`capture-main` records every run attempt, job list, combined log, artifact
inventory, upstream CI run when a journal binds it, and every available
`main-journal.json`. It validates canonical append-only journal histories
before publishing them. A later rerun verifies the existing contiguous attempt
prefix and atomically appends only the newly completed tail after rechecking
the current attempt. GitHub's REST API does not expose job outputs or the
step-summary payload that carries `vercel-main-terminal-evidence:v3`; the
capture records that limitation explicitly instead of reconstructing terminal
evidence from logs. The same boundary applies to provider deployment census,
public-domain SHA probes, and legacy-v2 health. A failed early attempt can
still have complete raw GitHub evidence even when no successful release
terminal route ran. The audit counts those release-terminal anomalies
separately instead of treating a fully captured failed attempt as missing.

`sample-github` records repository visibility at the sample time, the relevant
preview/main workflow inventory, job runner labels, pending runs, and
point-in-time Actions cache and artifact storage. Run discovery queries each
workflow and complete UTC day separately, falls back to hourly shards above
GitHub's 1,000-result search cap, reconciles shard totals, and excludes the
half-open end boundary. Each later sample re-queries the complete interval so
its run/job coverage can backfill earlier complete UTC days. Cache, artifact,
and repository-visibility values remain point-in-time snapshots and cannot be
backfilled. The final audit therefore leaves continuous visibility,
invoice-grade runner minutes, and storage GB-hours unresolved. Every sample
also refreshes runs that were in flight when `init` captured the pre-start
boundary. A run clears that boundary only when the terminal sample proves it
completed strictly before `startUtc`. Each sample also discovers relevant
workflow runs created in `[boundary.recordedAtUtc, startUtc)` with the same
sharded query and unions them with the runs in flight during `init`; only runs
from that complete union that actually cross `startUtc` fail the boundary
drain check. Samples use the same atomically published
and tree-sealed capture-directory format as preview and main evidence; the
audit never trusts an unsealed sample JSON file.

A run that crosses `startUtc` invalidates that start boundary; extending the
end cannot repair it. Preserve the failed private tree outside the collector's
fixed root for the audit trail, then initialize a clean tree with a later
complete UTC-day start after all relevant workflows have drained.

If the interval ends with fewer than ten eligible pushes, or work straddles its
end boundary, extend it before auditing. Re-run `init` with the same start and a
later complete UTC-day end:

```bash
pnpm vercel:cost:observe -- init \
  --start 2026-07-29T00:00:00.000Z \
  --end 2026-08-06T00:00:00.000Z
```

The collector appends an immutable
`interval-extensions/<new-end>.json` record. Extensions must form a monotonic
digest chain, cannot shrink the interval, and are rejected after the permanent
freeze marker seals closeout.

At the frozen end boundary, take a final sample and run:

```bash
pnpm vercel:cost:observe -- audit \
  --end 2026-08-05T00:00:00.000Z
```

The offline audit requires complete cumulative run/job coverage for every UTC
day and a terminal sample; one later sample may provide coverage for several
earlier days. It inventories in-window controller and main runs against
captures, verifies every capture seal, and reports missing, incomplete, or
ambiguous evidence. A run observed in flight before the start fails only when
the terminal sample cannot prove that it completed strictly before the start.
Runs, jobs, deployment statuses, or sentinels that finish at or after the
exclusive end are reported by explicit IDs and fail closeout; drain them and
extend the interval instead of mixing billing denominators. A PR already open
at the start counts toward the first-preview metric only when its boundary
journal proves that no eligible push occurred before the window and its first
eligible in-window `synchronize` receipt has `beforeSha` equal to the boundary
head SHA. A mismatch is excluded and reported as ambiguous. The audit
first runs a repairable GitHub-evidence preflight under the exclusive operation
lock. Missing terminal coverage, captures, attempts, eligible opportunities,
runner classification, public-visibility samples, or drained boundaries make
the command fail without writing `freeze.json`, `audit.json`, or the analyzer
fragment; collect the missing evidence or extend the interval and retry. Once
that preflight is clean, the audit writes a permanent freeze marker, after
which `init`, captures, and samples are rejected. It then deliberately writes
`analyzer-postcutover-fragment.incomplete.json` and exits nonzero while
provider, billing, runtime, burst, rollback, or final closeout fields remain
unresolved. It never manufactures a passing analyzer aggregate. The audit is
an immutable end-of-window record. A crash after the freeze can resume the
same audit, but no later collection or interval extension is allowed.

After the manual/private evidence joins that GitHub record, run the analyzer:

```bash
pnpm vercel:cost:analyze \
  --input .vercel-cost-evidence/manifest.json \
  --format markdown
```

The command reads the raw FOCUS JSONL, an unchanged provider-attribution
artifact plus its derived target/path mapping, and a complete normalized Vercel
deployment census. It exits successfully only after both the observation gate
and the cleanup/final-closeout gate pass. Before cleanup, a successful
measurement is explicitly `OBSERVATION ONLY` and the command remains nonzero.
Its Markdown and JSON output omit absolute `EffectiveCost` and `BilledCost`
values, raw-export digests, and raw-export charge-row counts. Raw exports,
manifest, aggregate input, provider artifacts, account configuration,
allocations, invoice figures, and dollar values remain private.

Run the fixture suite without credentials or network access:

```bash
pnpm vercel:cost:test
```

## Private evidence boundary

Store working evidence under `.vercel-cost-evidence/`, which is ignored by Git,
or outside the repository. Never commit or paste any of these into a public
issue, pull request, workflow artifact, job summary, or log:

- raw Vercel FOCUS JSONL, unchanged provider-attribution artifacts, derived
  attribution JSONL, normalized deployment-census JSONL, and the manifest;
- project or team IDs not already public;
- absolute `EffectiveCost`, `BilledCost`, allocation, plan, price, or invoice
  values;
- authentication material or provider responses that may contain it.

The analyzer makes no authenticated request. A maintainer with billing access
obtains the source exports through an approved Vercel surface and stores them in
the private evidence workspace. The manifest names those local files and their
digests; the analyzer reads and reconciles them rather than trusting hand-entered
project totals or deployment counts. Automation must not discover or retrieve
credentials.

Only generated public-safe analyzer output (Markdown or JSON), redacted
screenshots, and direct links to non-sensitive workflow or deployment evidence
belong on #523.

## Source-of-truth intervals

Use half-open UTC intervals `[startUtc, endUtcExclusive)` with both boundaries
at `00:00:00.000Z`. The [FOCUS billing endpoint](https://docs.vercel.com/docs/rest-api/reference/endpoints/billing/list-focus-billing-charges)
uses an inclusive UTC `from`, exclusive UTC `to`, one-day granularity, and
streams FOCUS v1.3 JSONL. The interactive [`vercel usage`](https://vercel.com/docs/cli/usage)
date flags are interpreted in Los Angeles time, so their dates are not a
substitute for the exact UTC FOCUS interval used by this analysis.

For each baseline and post-cutover export, preserve privately:

1. exact inclusive UTC start and exclusive UTC end;
2. unchanged raw export;
3. lowercase SHA-256 digest of that export;
4. number of matching Build CPU charge rows, which may be zero after cutover;
5. evidence that billing ingestion is complete;
6. whether the invoice for the complete interval is final.

The baseline and post-cutover raw-export digests must differ. Reusing one file
for both non-overlapping intervals is contradictory evidence and fails
validation.

Filter to rows with `ChargeCategory == "Usage"` and
`ConsumedUnit == "Build CPU Minutes"` for the four in-scope Vercel projects
only. The parser accepts the endpoint's quoted decimal values as well as JSON
numbers and validates every in-scope charge timestamp against its half-open UTC
window:

- `app.mento.org`;
- `governance.mento.org`;
- `reserve.mento.org`;
- `ui.mento.org`.

Do not include `monitoring-dashboard`, runtime/function usage, bandwidth, data
transfer, image optimization, or any other Vercel product.

### Invoice-grade attribution limitation

The documented FOCUS charge schema identifies the Vercel project through tags;
it does not document deployment ID, Git ref, or source SHA as charge
dimensions. Consequently, project-level Build CPU minutes cannot be divided
between app v3, legacy app v2, manual deployments, and migrated automation by
using visible build-log duration. Log duration is diagnostic, not invoice-grade
allocation evidence.

If legacy v2, manual, or unknown builds overlap a project interval, use one of
these defensible paths:

1. extend or select a complete comparison interval with enough eligible events
   and no overlapping excluded builds;
2. obtain provider-generated usage evidence that attributes the charge at the
   required granularity; or
3. leave the migrated-path measurement unresolved and keep #523 open.

Never estimate migrated Build CPU minutes by apportioning a project total using
deployment count or visible build duration. Record excluded deployment attempts
even when they contribute zero invoice-grade minutes. Gross project totals must
remain visible alongside the migrated-path comparison.

Target-by-path (`preview` versus `main`) normalization always requires path
usage. FOCUS cannot provide it. Preserve the unchanged provider-generated
artifact and its digest, then derive a separate strict target/path JSONL mapping
from that artifact. The manifest binds both files; their paths and digests must
differ, the derived cells must reconcile exactly to `migratedPath`, and the
provider digest must match `attribution.evidenceSha256`. The analyzer can prove
that the two frozen inputs and aggregate agree, but it cannot independently
interpret an opaque provider artifact. Reviewer/operator confirmation that the
derived cells faithfully represent that provider artifact remains mandatory.
Never create those cells from census counts or build durations.

Provider evidence and the derived mapping are also separate from the raw FOCUS
export, whose documented dimensions are insufficient for this split. Their
digests must differ from the corresponding raw-export digest, and one target
cannot reuse the same provider evidence for its baseline and post-cutover split.

## Post-cutover collection protocol

1. Record the successful #522 cutover run, exact commit SHA, completion
   timestamp, and final ownership configuration. Start the measurement interval
   at the next complete UTC-day boundary; never backdate it into the cutover.
2. Keep collecting until the interval contains at least seven complete UTC days
   and ten trusted same-repository PR pushes that affect deployed code. Record
   that push-level denominator as `trustedDeployedCodePrPushes`. Extend
   the window until every logical target has nonzero baseline and post-cutover
   eligible events.
3. Freeze the exact post interval. Export the matching baseline and post Vercel
   FOCUS data, retain the raw files privately, and record their digests and row
   counts. Re-export or compare the billing surface until ingestion for both
   intervals is confirmed complete.
4. Export every Vercel deployment page for the interval and assert
   `deploymentCensusComplete: true` only after pagination and UTC-boundary
   completeness are verified. Normalize one JSONL row per deployment attempt
   with `deploymentId`, `createdAtUtc`, `target`, `path`, `source`, `outcome`,
   `sourceSha`, and a public-safe direct `evidenceUrl`. The analyzer accepts only
   this public repository's GitHub run/deployment URLs or a root `*.vercel.app`
   deployment URL, with no credentials, query string, fragment, or custom port.
   Vercel dashboard URLs are private evidence and fail closed. Duplicate deployment
   IDs, rows outside the interval, digest mismatches, or incomplete-census
   assertions fail closed. One eligible event key is `target:path:sourceSha`. Count every native,
   prebuilt, failed, cancelled, and rerun deployment attempt; do not use attempts
   as the event denominator. In both the baseline and post-cutover windows,
   deployment attempts must be at least the number of eligible events.
   Keep the axes orthogonal: `path` is `preview`, `main`, `legacy-v2`, or
   `unknown`; `source` is `github-actions-prebuilt`, `vercel-native`, `manual`,
   or `unknown`; `outcome` is `ready`, `error`, or `canceled`. Within each
   target, classify migrated events, attempts, and actual duplicates as either
   `preview` or `main`; those two path counts must sum exactly to the
   migrated-path aggregates in both windows.
   Each path bucket must also be internally possible: attempts cannot be lower
   than eligible events, and duplicate counts cannot exceed the attempts beyond
   the first attempt for each eligible event (`attempts - events`). The same
   duplicate bound applies to the migrated-path aggregate. Only the second and
   later `ready` rows for the same event key are duplicates. Failed/canceled
   attempts increase measured waste and appear with direct links, but are not
   mislabeled as duplicates. A post-cutover native preview/main attempt is an
   unexplained native build; manual and unknown sources remain excluded and
   visible.
5. Classify app deployments as migrated PR preview, migrated `main -> v3`,
   preserved native `v2 -> production`, or manual/unknown. Keep v2 visible and
   apply the invoice-grade attribution limitation above.
6. Build a GitHub Actions census from the final preview workflow inventory
   (`Vercel Preview Intake`, `Vercel Preview Controller`,
   `Vercel Preview Worker`, and their reusable build/smoke workflows) plus
   `Vercel Main Deployment`: standard-runner minutes, larger-runner minutes,
   artifact and cache GB-hours, queue/build/deploy durations, failures, reruns,
   and Turbo cache hits/misses. Record whether the repository stayed public for
   the entire interval. Use the final workflow inventory from #519 and #522
   rather than names proposed before those changes merge.
   Re-check the current [GitHub Actions billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
   when closing #523. The analyzer requires a public repository for the whole
   interval and zero larger-runner minutes; it never assumes artifact or cache
   storage is free.
7. Maintain a correctness ledger with direct run/deployment links for every
   anomaly. For PR pushes, record first-preview coverage, planner selection,
   first-plus-latest behavior, deployed SHA, native duplicates, smoke/E2E, and
   sentinel result. For main pushes, record exact-SHA CI gate, planner bases and
   range, the complete `vercel-main-plan:v2` ownership map and
   staged/active/shadow partitions, stale-main decision, activation/recovery
   result, domain SHA, the active duplicate census, and v2 health.
8. Populate `.vercel-cost-evidence/manifest.json` and its referenced aggregate,
   FOCUS, provider, derived-attribution, and deployment-census files using the
   synthetic [`manifest.json`](../scripts/fixtures/vercel-cost-analysis/manifest.json)
   fixture set as the schema example. Do not copy its invented values.
9. Run the analyzer. A failing command lists deterministic evidence gaps; extend
   the window or investigate the named anomaly instead of editing the threshold.
10. After the invoice closes, replace nullable `billedCost` fields with final
    reconciled values, set both `invoiceFinal` flags, rerun the analyzer, and
    retain the private reconciliation.

## Manifest and aggregate evidence schema

The CLI input is a strict manifest. It references the aggregate plus each
window's raw FOCUS JSONL, unchanged provider artifact, derived attribution
JSONL, and normalized deployment census. The manifest records separate digests,
the complete-census assertion, and a distinct FOCUS project-tag selector for
each logical target. A target's selector must be identical in both windows so a
comparison cannot silently switch Vercel projects. Unknown or missing keys fail
instead of being ignored.

Both aggregate periods require the exact FOCUS unit `Build CPU Minutes`, billing
currency `USD`, a raw-export digest, row count, ingestion state, and
invoice-final state. Raw FOCUS rows are authoritative for `grossProject`; the
analyzer derives and reconciles those totals instead of accepting the aggregate
alone.

Each target has six groups:

- `migratedPath`: raw Build CPU minutes, `EffectiveCost`, nullable `BilledCost`,
  unique eligible target events, deployment attempts, and actual duplicate
  deployment count;
- `migratedDeploymentCensus`: strict `preview` and `main` path buckets, each
  containing eligible events, deployment attempts, and actual duplicate counts;
  each metric must sum exactly to its `migratedPath` aggregate;
- `migratedUsageByPath`: strict `preview` and `main` Build CPU minute,
  `EffectiveCost`, and nullable `BilledCost` cells derived from the separately
  preserved provider artifact; each metric must sum exactly to `migratedPath`;
- `grossProject`: the complete project Build CPU minutes and costs, including
  excluded activity;
- `excluded`: attempt counts for legacy v2, manual, and unknown deployments;
- `attribution`: either `project-total-no-exclusions`, which requires migrated
  and gross values to be identical, every excluded count to be zero, and only
  one active path, or
  `provider-attributed`, which requires the SHA-256 digest of the private
  provider evidence supporting the split.

The post-cutover record also contains:

- `trustedDeployedCodePrPushes`, the trusted same-repository deployed-code PR
  push denominator;
- standard and larger-runner minutes;
- artifact and cache GB-hours;
- whether the repository remained public for the complete interval;
- first-preview totals and every correctness/security/service-quality failure
  count required by #523;
- completed-check and opportunity counts for smoke/E2E, burst first-plus-latest,
  and legacy-v2 health verification;
- completed and failed main-deployment observations, bound to the derived total
  post-cutover `main` eligible events;
- explicit rollback-procedure verification.

The top-level `closeout` checklist records disposition of the manual pilot,
PR-A-only global-shadow/canary scaffolding, legacy `deployment_status` handling,
migration-only logging, docs drift, and final verification. It does not permit
removing the target-local main `shadow` ownership mode required for rollback.
Until every item is true, the measurement can pass only as
`observationPass`; `closeoutPass` and the final `pass` remain false and
`reportStage` remains `observation-only`.

Derive every opportunity and completion count from the private observation
ledger rather than entering a blanket success value:

- `eligibleFirstPreviewOpportunities` counts PRs whose first eligible push is in
  the observation window, and `eligibleFirstPreviews` counts those that received
  the preview. At least one opportunity is required, opportunities cannot exceed
  trusted same-repository PR pushes, and claimed first previews cannot exceed
  the derived total of post-cutover `preview` eligible target events.
- `trustedDeployedCodePrPushes` is a push-level observation denominator, while
  the preview census is target-level deployment evidence. Do not force a
  one-to-one relationship between them: one push can fan out to several targets,
  and first-plus-latest batching or path-aware preview reuse can avoid a distinct
  deployment for a later push. The derived preview-event bound applies to the
  first-preview PR counters because every claimed first preview must have at
  least one corresponding preview target event.
- `smokeOrE2eCheckOpportunities` counts the smoke/E2E checks required by the
  observed trusted PR pushes; it must cover at least every such push.
  `smokeOrE2eChecksCompleted` counts all finished checks, whether passing or
  failing.
- `burstFirstPlusLatestCheckOpportunities` counts deliberately exercised burst
  sequences, and `burstFirstPlusLatestChecksCompleted` counts the sequences
  whose first-plus-latest outcome was fully verified. At least one sequence is
  required.
- `mainDeploymentObservationsCompleted` counts post-cutover main events for
  which the complete main-deployment ledger record was verified. One completed
  observation includes the exact-SHA CI gate, planner base and range, selected
  targets, stale-main decision, activation or recovery result, public-domain
  SHA, native duplicate result, and legacy-v2 health result.
  `mainDeploymentObservationFailures` counts completed observations where any
  one of those checks failed. Completed observations must equal the derived sum
  of post-cutover main eligible events; the truthful value is `0/0` when no main
  event occurred.
- `legacyV2HealthCheckOpportunities` counts the v2 health verifications recorded
  for the observation and final closeout, and `legacyV2HealthChecksCompleted`
  counts the checks that finished. At least one health check is required.

For each completed/opportunity pair, completion must be 100%. The corresponding
regression or failure count is a subset of completed checks and must remain
zero for a passing report.

The analyzer rejects malformed evidence such as migrated usage above gross
project usage, a post period beginning before cutover, partial UTC days,
finalized invoices with missing BilledCost, and malformed provenance.
It also rejects guessed clean-project splits, provider-attributed splits without
distinct hashed evidence, provider-attributed minute or cost splits without a
classified excluded deployment, reused raw or target-attribution evidence,
legacy-v2 classifications outside the app project, preview/main census totals
that do not reconcile exactly, path buckets with fewer attempts than events,
duplicate counts above `attempts - events`, first-preview counters unsupported
by the derived preview census, and unknown post-cutover deployment activity.
Completed-check counts cannot exceed their opportunities, regressions cannot
exceed completed checks, and completed main observations cannot exceed the
derived main-event total. Derived totals, counterfactuals, ratios, and savings
must remain finite; numeric overflow, `NaN`, and infinity fail closed.

## Calculations

For target-and-path cell `c = (p, path)`, the input supplies baseline minutes
`M_B,c`, baseline eligible events `N_B,c`, post-cutover minutes `M_P,c`, and
post-cutover eligible events `N_P,c`. The analyzer computes:

```text
C = sum over c of N_P,c * (M_B,c / N_B,c)
S = 1 - (sum over c of M_P,c / C)
```

The exact, unrounded `S` must be at least `0.90`. A post-cutover path with zero
events contributes zero to the counterfactual. Any path with observed
post-cutover events must have nonzero baseline events, so newly observed work
cannot silently inherit another path's baseline. The same target-by-path
calculation is applied to `EffectiveCost` and final `BilledCost`, but only
savings ratios are emitted. A negative savings result for either cost metric,
at the aggregate or individual path level, fails the observation. Gross savings
compare total project Build CPU minutes per complete UTC day. Attempts per
eligible event and post-cutover Build CPU minutes per trusted deployed-code PR
push are reported overall and by target. Each target's minute contribution is
divided by the global `trustedDeployedCodePrPushes` denominator; it is not a
target-specific push count. Every target must independently produce a finite,
positive build-minute counterfactual and a finite savings ratio; a null
per-target minute savings value can never coexist with a passing report.
Per-target savings rows are diagnostic; the 90% threshold applies to the
aggregate target-by-path result. Final BilledCost savings must be finite and
available before the observation can pass.

The public-safe output shows migrated and gross Build CPU minutes for every
target in both windows. It also shows each target's preview/main event, attempt,
and duplicate census, plus direct links for any failed or unexplained deployment
attempts. Absolute cost values, raw FOCUS export digests, and charge row counts
remain private in both Markdown and JSON output.

The command remains failing when any required closeout condition is missing,
including incomplete billing, a non-final invoice, fewer than seven complete
days or ten trusted PR pushes, a target with zero events or a non-positive
minute counterfactual, an observed path without a baseline, a negative cost
savings result, an actual duplicate deployment, missing standard-runner measurement,
no eligible first-preview opportunity, less than 100% first-preview coverage,
missing or incomplete smoke/E2E, burst, or legacy-v2 observation coverage,
incomplete or failed main-deployment observations, native duplicates,
affected-target skips, larger-runner usage,
security/service regressions, v2 regressions, or an unverified rollback
procedure. Smoke/E2E opportunities must cover at least every trusted
same-repository PR push in the observation window. Extra failed, cancelled, or
rerun attempts remain visible in attempts-per-event but are not mislabeled as
duplicate deployments.

## Cleanup after a passing observation

Do not remove migration scaffolding in the preparation PR. After the final
analysis passes, diff the merged #519-#522 implementation and remove only items
proven migration-only:

- manual pilot workflow if the production runbook fully supersedes it;
- PR-A-only global-shadow canary workflow branches and fixtures, while
  preserving the target-local main `shadow` ownership mode and full-native
  rollback contract;
- legacy `deployment_status` preview-smoke handling only when no surviving
  native path consumes it;
- duplicate migration-only logs while retaining stable deployment summaries.

Set the corresponding `closeout` flags only after each disposition is complete;
the analyzer deliberately keeps `pass: false` and exits nonzero while the report
is `observation-only`, even when `observationPass` is true.

Preserve the planner and tests, reusable prebuilt workflow, active preview/main
workflows, stable sentinels, rollback runbook, topology/environment semantics,
and the cost analyzer. Run the docs-drift audit across `AGENTS.md`, `CLAUDE.md`,
`README.md`, and `docs/**`, then execute the final gates listed in #523.

If the normalized minute threshold or any correctness gate misses, keep the
epic open and create a narrowly scoped issue containing the exact remaining
source and direct evidence links. Generic CI build duplication, Turbo cache
misses, legacy app v2 migration, and `monitoring-dashboard` remain separate
follow-up decisions.
