# Vercel build-minute validation

This runbook prepares the measurement and closeout work tracked in [issue
#523](https://github.com/mento-protocol/frontend-monorepo/issues/523). It does
not start the observation window, query Vercel or GitHub, change a deployment,
or remove migration scaffolding. The observation window starts only after the
four-target preview and main cutover in issue #522 is complete.

The repository provides a deterministic, network-free analyzer:

```bash
pnpm vercel:cost:analyze \
  --input .vercel-cost-evidence/aggregate.json \
  --format markdown
```

The command exits successfully only when the complete #523 closeout gate
passes. Its Markdown and JSON output omit absolute `EffectiveCost` and
`BilledCost` values. Raw exports, aggregate input, account configuration,
allocations, invoice figures, and dollar values remain private.

Run the fixture suite without credentials or network access:

```bash
pnpm vercel:cost:test
```

## Private evidence boundary

Store working evidence under `.vercel-cost-evidence/`, which is ignored by Git,
or outside the repository. Never commit or paste any of these into a public
issue, pull request, workflow artifact, job summary, or log:

- raw Vercel FOCUS JSONL or usage exports;
- project or team IDs not already public;
- absolute `EffectiveCost`, `BilledCost`, allocation, plan, price, or invoice
  values;
- authentication material or provider responses that may contain it.

The analyzer accepts already aggregated evidence and makes no authenticated
request. A maintainer with billing access obtains the source exports through an
approved Vercel surface and records only their SHA-256 digests and charge counts
in the aggregate input. Automation must not discover or retrieve credentials.

Only the generated public-safe Markdown report, redacted screenshots, and
direct links to non-sensitive workflow or deployment evidence belong on #523.

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

Filter to usage charges with `ConsumedUnit == "Build CPU Minutes"` and the four
in-scope Vercel projects only:

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

## Post-cutover collection protocol

1. Record the successful #522 cutover run, exact commit SHA, completion
   timestamp, and final ownership configuration. Start the measurement interval
   at the next complete UTC-day boundary; never backdate it into the cutover.
2. Keep collecting until the interval contains at least seven complete UTC days
   and ten trusted same-repository PR pushes that affect deployed code. Extend
   the window until every logical target has nonzero baseline and post-cutover
   eligible events.
3. Freeze the exact post interval. Export the matching baseline and post Vercel
   FOCUS data, retain the raw files privately, and record their digests and row
   counts. Re-export or compare the billing surface until ingestion for both
   intervals is confirmed complete.
4. Build a deployment census for every source SHA and logical target. One
   eligible event is one source SHA plus one logical target. Count every native,
   prebuilt, failed, cancelled, and rerun deployment attempt; do not use attempts
   as the event denominator. In both the baseline and post-cutover windows,
   deployment attempts must be at least the number of eligible events.
5. Classify app deployments as migrated PR preview, migrated `main -> v3`,
   preserved native `v2 -> production`, or manual/unknown. Keep v2 visible and
   apply the invoice-grade attribution limitation above.
6. Build a GitHub Actions census from the final preview and main workflows:
   standard-runner minutes, larger-runner minutes, artifact and cache GB-hours,
   queue/build/deploy durations, failures, reruns, and Turbo cache hits/misses.
   Record whether the repository stayed public for the entire interval. Use the
   final workflow inventory from #519 and #522 rather than names proposed before
   those changes merge.
   Re-check the current [GitHub Actions billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
   when closing #523. The analyzer requires a public repository for the whole
   interval and zero larger-runner minutes; it never assumes artifact or cache
   storage is free.
7. Maintain a correctness ledger with direct run/deployment links for every
   anomaly. For PR pushes, record first-preview coverage, planner selection,
   first-plus-latest behavior, deployed SHA, native duplicates, smoke/E2E, and
   sentinel result. For main pushes, record exact-SHA CI gate, planner bases and
   range, selected targets, stale-main decision, activation/recovery result,
   domain SHA, native duplicates, and v2 health.
8. Populate `.vercel-cost-evidence/aggregate.json` using the synthetic
   [`pass.json`](../scripts/fixtures/vercel-cost-analysis/pass.json) fixture as
   the schema example. Do not copy its invented values.
9. Run the analyzer. A failing command lists deterministic evidence gaps; extend
   the window or investigate the named anomaly instead of editing the threshold.
10. After the invoice closes, replace nullable `billedCost` fields with final
    reconciled values, set both `invoiceFinal` flags, rerun the analyzer, and
    retain the private reconciliation.

## Aggregate evidence schema

The input is strict: unknown or missing keys fail instead of being ignored.
Both periods require the exact FOCUS unit `Build CPU Minutes`, billing currency
`USD`, a raw-export digest, row count, ingestion state, and invoice-final state.

Each target has four groups:

- `migratedPath`: raw Build CPU minutes, `EffectiveCost`, nullable `BilledCost`,
  unique eligible target events, deployment attempts, and actual duplicate
  deployment count;
- `grossProject`: the complete project Build CPU minutes and costs, including
  excluded activity;
- `excluded`: attempt counts for legacy v2, manual, and unknown deployments.
- `attribution`: either `project-total-no-exclusions`, which requires migrated
  and gross values to be identical and every excluded count to be zero, or
  `provider-attributed`, which requires the SHA-256 digest of the private
  provider evidence supporting the split.

The post-cutover record also contains:

- trusted same-repository PR push count;
- standard and larger-runner minutes;
- artifact and cache GB-hours;
- whether the repository remained public for the complete interval;
- first-preview totals and every correctness/security/service-quality failure
  count required by #523;
- explicit rollback-procedure verification.

The analyzer rejects malformed evidence such as migrated usage above gross
project usage, a post period beginning before cutover, partial UTC days,
finalized invoices with missing BilledCost, and malformed provenance.
It also rejects guessed clean-project splits, provider-attributed splits without
hashed evidence, legacy-v2 classifications outside the app project, gross
minutes without a classified exclusion, and unknown post-cutover deployment
activity. Either window is invalid when a target has fewer deployment attempts
than eligible events. Derived totals, counterfactuals, ratios, and savings must
remain finite; numeric overflow, `NaN`, and infinity fail closed.

## Calculations

For target `p`, the input supplies baseline minutes `M_B,p`, baseline eligible
events `N_B,p`, post-cutover minutes `M_P,p`, and post-cutover eligible events
`N_P,p`. The analyzer computes:

```text
C = sum over p of N_P,p * (M_B,p / N_B,p)
S = 1 - (sum over p of M_P,p / C)
```

The exact, unrounded `S` must be at least `0.90`. The same target-mix calculation
is applied to `EffectiveCost` and final `BilledCost`, but only savings ratios are
emitted. Gross savings compare total project Build CPU minutes per complete UTC
day. Attempts per eligible event and post-cutover Build CPU minutes per trusted
PR push are reported overall and by target. Every target must independently
produce a finite, positive build-minute counterfactual and a finite savings
ratio; a null per-target minute savings value can never coexist with a passing
report.

The command remains failing when any required closeout condition is missing,
including incomplete billing, a non-final invoice, fewer than seven complete
days or ten trusted PR pushes, a target with zero events or a non-positive
minute counterfactual, an actual duplicate deployment, missing standard-runner measurement,
less than 100% first-preview coverage, native duplicates, affected-target skips,
larger-runner usage, security/service regressions, v2 regressions, or an
unverified rollback procedure. Extra failed, cancelled, or rerun attempts remain
visible in attempts-per-event but are not mislabeled as duplicate deployments.

## Cleanup after a passing observation

Do not remove migration scaffolding in the preparation PR. After the final
analysis passes, diff the merged #519-#522 implementation and remove only items
proven migration-only:

- manual pilot workflow if the production runbook fully supersedes it;
- shadow/canary-only mode and fixtures;
- legacy `deployment_status` preview-smoke handling only when no surviving
  native path consumes it;
- duplicate migration-only logs while retaining stable deployment summaries.

Preserve the planner and tests, reusable prebuilt workflow, active preview/main
workflows, stable sentinels, rollback runbook, topology/environment semantics,
and the cost analyzer. Run the docs-drift audit across `AGENTS.md`, `CLAUDE.md`,
`README.md`, and `docs/**`, then execute the final gates listed in #523.

If the normalized minute threshold or any correctness gate misses, keep the
epic open and create a narrowly scoped issue containing the exact remaining
source and direct evidence links. Generic CI build duplication, Turbo cache
misses, legacy app v2 migration, and `monitoring-dashboard` remain separate
follow-up decisions.
