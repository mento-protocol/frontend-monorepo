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

## Recorded #523 failure and #842 corrective interval

The completed #523 measurement is immutable failed evidence. Its post-cost
window started at `2026-08-18T07:00:00.000Z` and ended at the exclusive
`2026-08-23T07:00:00.000Z` boundary. The deployment census found 276
GitHub-prebuilt deployments, zero Vercel-native builds, and 42 canceled native
Git requests that never entered the building state. The matching FOCUS export
reported 1,104 Build CPU minutes. Every prebuilt deployment reconciled to
exactly four minutes. Target-mix normalized savings were
`84.3261929579423%`, below the required `90%` gate. This establishes the
finding tracked in
[#842](https://github.com/mento-protocol/frontend-monorepo/issues/842); it does
not establish the provider rule that caused the charge.

Preserve that post-cost export, deployment census, manifest, and verdict as the
failed #523 record. Do not extend, relabel, filter, or reuse that post-cost
window for the corrective result. The original baseline interval remains the
fixed target-mix baseline; it is not a substitute for a new post-change export.

The separately sealed correctness window was
`[2026-08-17T00:00:00.000Z, 2026-08-24T00:00:00.000Z)`. It captured all 119
required preview runs and all 42 required main runs. It also recorded 96
trusted deployed-code PR pushes, 43 of 43 eligible first previews, and zero
collector gaps or boundary straddlers.

The #842 rerun uses a new cost-only interval after the external setting rollout
in [External Standard-build cost pilot](vercel-deployments.md#external-standard-build-cost-pilot).
It may reference the sealed #523 correctness evidence for unchanged preview
ownership, first-plus-latest behavior, exact-SHA main releases, smoke coverage,
security boundaries, and rollback procedures. Do not reopen or append the
frozen correctness collector. The new UI, Reserve, and Governance queue and
canary records supplement that sealed evidence because the external project
setting can change scheduling behavior. For each project, those new records
must include the automatic first-plus-latest scheduler canary and its separate
Production Shadow proof of the ordinary `main` upload path. Both paths
serialize provider requests, so neither proves provider-side deployment
overlap. Record queue timing if provider contention occurs naturally. Do not
require or claim forced provider contention. A natural `main` release is
observation evidence, not a prerequisite for the cost-only interval. Any
workflow, ownership, `vercel.json`, security-boundary, or deployment-path
change invalidates this cost-only route and requires a new correctness
observation.

Start the new half-open post-cost interval at the first complete Vercel charge
boundary after all three ordinary-project settings are proven, the Governance
scheduler and Production Shadow proofs pass, and every relevant queue is
drained. The interval must contain one or more exact 24-hour periods and at
least one eligible migrated deployment for every logical target. Extend only by
complete provider charge periods until that condition holds. Do not backdate
the start into the rollout or a canary.

For the new interval, collect fresh FOCUS exports and fresh complete Vercel
deployment pages for all four projects. Record new raw-file digests, row counts,
ingestion-completeness evidence, project-setting reads at both boundaries, and
the matching deployment census. Never copy a FOCUS row, digest, saved page, or
aggregate from the failed post-cost window. A zero Build CPU row count for an
ordinary project is valid only when the fresh complete deployment census proves
eligible prebuilt deployments and zero excluded builds for that same interval.
Zero cost does not imply zero `ConsumedQuantity`; use the FOCUS quantity that
Vercel actually emits.

Keep the provider response requested by the deployment runbook with the
corrective evidence. Vercel's public documentation does not state whether a
prebuilt upload consumes the one-minute On-Demand Concurrent Builds increment
or which FOCUS `ConsumedQuantity` result follows from Standard plus On-Demand
Concurrent Builds disabled. The fresh billing export and complete deployment
census decide the measured gate. The measurement could finish before support
answered. The original criterion kept issue #842 open until Vercel confirmed
the charging rule or a maintainer changed that criterion.

The fixed corrective interval was
`[2026-08-25T07:00:00.000Z, 2026-08-26T07:00:00.000Z)`. Fresh provider evidence
reported 16 Build CPU minutes against a target-mix counterfactual of
`100.23649463908816` minutes. The normalized saving was
`84.03774986584511%`, so the immutable 90% gate remained false. On 2026-08-26,
the maintainer accepted 84.04% as the product outcome and changed the #842
acceptance criterion. The provider support case remains open and unanswered.
This product decision does not alter the sealed measurement or its historical
90% result.

The decision changes only the savings target. It does not waive the sealed
billing-ingestion and final-invoice blockers, the unanswered provider case, or
the five strict main-deployment failures in runs `32283571311`, `32382097990`,
`32471088506`, `32633658106`, and `32648329877`. The original analyzer must
remain nonzero while those conditions remain unresolved.

Run the same target-mix calculation and keep the exact `90%` threshold. Do not
infer savings from the project setting or from Vercel's statement that Standard
builds without On-Demand Concurrent Builds are unbilled. App remains in the
fresh four-project census and FOCUS export even though its setting is excluded
from this rollout. The corrective interval passes only from fresh provider
evidence and the sealed-plus-canary correctness join.

The repository provides a Vercel-credential-free GitHub evidence collector, a
credential-free offline GitHub billing proof builder, and a deterministic,
network-free analyzer. Initialize the approved half-open
observation interval before its start boundary. The values below are
deliberately invalid placeholders. Before replacing them, read and verify
`.vercel-cost-evidence/github-observation-v2/interval.json` and every record in
its `interval-extensions/` ledger. An existing tree must reuse its exact start
and current end; a new tree requires a separately approved interval. After
`init`, read those private records back and confirm the canonical values:

```bash
START_UTC='<START_UTC>'
END_UTC_EXCLUSIVE='<END_UTC_EXCLUSIVE>'
pnpm vercel:cost:observe -- init \
  --start "$START_UTC" \
  --end "$END_UTC_EXCLUSIVE"
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
# Run after an opened/synchronize controller event settles. The controller
# retains its settled receipt graph for 14 days if the live v2 journal compacts.
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
selection-bound worker result. Each trusted receipt-producing controller run
waits outside the journal-writer concurrency queue until that graph settles,
then uploads one event-ID-bound Actions artifact for 14 days. The collector
prefers that exact validated artifact whenever it exists, including while a
later push still leaves the event in the live journal. If the event is no
longer live, the collector searches the nearest 64 later completed controller
runs on the same branch for a validated artifact that still covers the event.
It falls back to the live journal when no exact artifact exists and the event
is still live. A pending event, an expired or missing artifact after the
bounded compacted-event search, or ambiguous evidence fails without reserving
its append-only destination. Capture promptly after reconciliation and before
the artifact expires.

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

GitHub can omit labels for skipped, startup-failed, or short-lived terminal
jobs. The audit retains those job IDs without inferring a runner class. Skipped
jobs consume no runner minutes and can have inverted synthetic timestamps. The
source-bound detailed usage export owns standard/larger SKU classification.
Its standard minutes must stay within the explicit collector tolerance below.

A run that crosses `startUtc` invalidates that start boundary; extending the
end cannot repair it. Preserve the failed private tree outside the collector's
fixed root for the audit trail, then initialize a clean tree with a later
complete UTC-day start after all relevant workflows have drained.

If the interval ends with fewer than ten eligible pushes, or work straddles its
end boundary, extend it before auditing. Re-run `init` with the same start and a
later complete UTC-day end. Read the start from the private `interval.json`,
verify the full extension ledger, and replace the deliberately invalid new-end
placeholder only with a separately reviewed later boundary:

```bash
START_UTC='<START_UTC_FROM_PRIVATE_INTERVAL>'
EXTENDED_END_UTC_EXCLUSIVE='<EXTENDED_END_UTC_EXCLUSIVE>'
pnpm vercel:cost:observe -- init \
  --start "$START_UTC" \
  --end "$EXTENDED_END_UTC_EXCLUSIVE"
```

The collector appends an immutable
`interval-extensions/<new-end>.json` record. Extensions must form a monotonic
digest chain, cannot shrink the interval, and are rejected after the permanent
freeze marker seals closeout.

At the frozen end boundary, take a final sample. Then verify `interval.json`
and the complete extension ledger again and read the canonical current end;
never reuse the originally scheduled end after an extension. Replace the
deliberately invalid placeholder and run:

```bash
CURRENT_END_UTC_EXCLUSIVE='<CURRENT_END_UTC_EXCLUSIVE_FROM_PRIVATE_LEDGER>'
pnpm vercel:cost:observe -- audit \
  --end "$CURRENT_END_UTC_EXCLUSIVE"
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
public-visibility samples, or drained boundaries make the command fail without
writing `freeze.json`, `audit.json`, or the analyzer fragment; collect the
missing evidence or extend the interval and retry. Once that preflight is
clean, the audit writes a permanent freeze marker, after which `init`, captures,
and samples are rejected. It then deliberately writes
`analyzer-postcutover-fragment.incomplete.json` and exits nonzero while
provider, billing, runtime, burst, rollback, or final closeout fields remain
unresolved. It never manufactures a passing analyzer aggregate. The audit is
an immutable end-of-window record. A crash after the freeze can resume the
same audit, but no later collection or interval extension is allowed.

After the manual/private evidence joins that GitHub record, normalize the saved
Vercel deployment pages without giving the repository tool a Vercel credential:

```bash
pnpm vercel:cost:normalize-deployments \
  --input .vercel-cost-evidence/post-deployment-pages.json \
  --output .vercel-cost-evidence/post.deployments.jsonl \
  --proof .vercel-cost-evidence/post-deployment-census-proof.json
```

The command reads files only. It makes no network request and has no token
option. Output and proof must share one canonical private directory owned by
the current user and not writable by the group or other users. The command uses
a deterministic private journal, then stages and syncs both mode-`0600` regular
files before publishing either with no-overwrite semantics. If the process
stops before the journal commit point, rerun the exact command: it validates
the journal and staged-file identities and bytes, resumes both files, and
removes the journal and stages only after both finals are durable. A caught
staging or publication failure removes only entries created by that invocation.
A different input or an unrelated file at a reserved or destination path fails
closed, and a preexisting destination remains untouched. Symlink, hardlink,
cross-directory, and destination races also fail closed. The private proof
binds the exact input-envelope bytes, normalized JSONL bytes, UTC window, four
project IDs, per-project page and row counts, final request cursors, terminal
`next: null` values, annotation count, and
`deploymentCensusComplete: true`. The schema-version-3 analyzer manifest must
bind all three private files for each window: the raw deployment-page envelope,
the normalized JSONL, and the canonical proof, each with its exact SHA-256. It
does not accept a caller-supplied completeness boolean. The manifest's separate
GitHub Actions proof and digest remain required.

Then run the analyzer:

```bash
pnpm vercel:cost:analyze \
  --input .vercel-cost-evidence/manifest.json \
  --format markdown
```

The command reads the raw project-level FOCUS JSONL, saved Vercel deployment
pages, normalized census, and canonical census proof. It reruns
`normalizeVercelDeploymentPages` over the exact raw bytes, requires the checked-in
normalizer's canonical proof and JSONL bytes, digests, and window to match, and
uses only that rebuilt census. Manifest schema v3 also binds one canonical
GitHub Actions proof and its SHA-256. The analyzer rebuilds that proof from its
raw CSV, selected audit evidence, metadata, and frozen observation tree before
accepting any GitHub aggregate field. It accepts a project total only when the
rebuilt census proves zero legacy-v2, manual, or unknown deployment attempts,
classifies only exact canceled-before-build Git records as suppressed, and
shows that migrated minutes and costs equal the complete FOCUS-backed project total. It exits
successfully only after both the observation gate
and the cleanup/final-closeout gate pass. Before cleanup, a successful
measurement is explicitly `OBSERVATION ONLY` and the command remains nonzero.
Its Markdown and JSON output omit absolute `EffectiveCost` and `BilledCost`
values, raw-export digests, and raw-export charge-row counts. Raw exports,
manifest, aggregate input, account configuration,
allocations, invoice figures, and dollar values remain private.

Run the fixture suite without credentials or network access:

```bash
pnpm vercel:cost:test
```

## Private evidence boundary

Store working evidence under `.vercel-cost-evidence/`, which is ignored by Git,
or outside the repository. Never commit or paste any of these into a public
issue, pull request, workflow artifact, job summary, or log:

- raw Vercel FOCUS JSONL, saved deployment-page envelopes and original page
  responses, normalized deployment-census JSONL, census proofs, and the
  manifest;
- the GitHub detailed-usage CSV, audit-log export, zero-result screenshot, or
  REST transcript, metadata, and canonical GitHub Actions proof;
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

## Build the private GitHub Actions proof

Wait at least 12 hours after the exclusive interval end so GitHub's documented
storage lag can settle. In the GitHub billing web UI, request the **detailed**
usage CSV for the exact complete UTC days in the half-open interval. Keep the
download unchanged; the report covers all paid products and the normalizer
selects exact lowercase product `actions`, organization `mento-protocol`, short
CSV repository `frontend-monorepo`, SKU, unit, and deployment workflow-path
matches. It also retains known storage SKUs with a blank workflow path as a
repository-level upper bound. It ignores other products, repositories, and
canonical nondeployment workflow or GitHub `dynamic/<owner>/<name>` identities.
A nonblank workflow path must match one of those two canonical forms. Malformed
and whitespace-only paths fail closed. The check groups storage rows by exact
date and SKU. Each group must use either blank-path repository attribution or
allowlisted workflow attribution. A mix of both attribution levels fails
closed. Rows on different dates remain additive. Each SKU remains independent.

Inspect its shape before writing metadata:

```bash
pnpm vercel:cost:github -- inspect \
  --usage-csv .vercel-cost-evidence/github/raw/detailed-usage.csv \
  --output .vercel-cost-evidence/github/usage-shape.json
```

The inspector accepts one UTF-8 BOM, quoted RFC 4180 fields, and reordered
exact columns. It writes only header names and distinct products, SKUs, units,
repositories, and workflow paths to its private output. It never prints CSV
rows, quantities, or amounts. Review any new value; `build` rejects unknown
selected Actions SKUs and units instead of guessing. Workflow suffixes must use
a canonical Git ref or a lowercase 40-character commit SHA. Dynamic identity
segments cannot be `.` or `..`.

Create canonical mode-`0600`
`.vercel-cost-evidence/github/raw/detailed-usage.metadata.json`. Read the exact
start and current exclusive end from the verified private interval and
extension ledger; the placeholders below are deliberately invalid:

```json
{
  "schema": "vercel-cost-github-usage-export-metadata:v1",
  "source": "github-detailed-usage-web-csv",
  "reportType": "detailed",
  "startUtc": "<START_UTC_FROM_PRIVATE_INTERVAL>",
  "endUtcExclusive": "<CURRENT_END_UTC_EXCLUSIVE_FROM_PRIVATE_LEDGER>",
  "requestedAtUtc": "<AT_LEAST_12_HOURS_AFTER_END_UTC_EXCLUSIVE>",
  "complete": true,
  "completenessBasis": "maintainer-attested-web-export-after-storage-lag",
  "csvSha256": "<lowercase SHA-256 of the exact CSV bytes>"
}
```

GitHub's detailed web CSV has no machine-readable completion marker. This
metadata records a maintainer attestation and binds the exact download bytes;
retain the request/download confirmation privately. `requestedAtUtc` must be at
least 12 hours after `endUtcExclusive`.

The collector samples visibility before the start and after the end. Cover the
entire gap, not just the billing interval: query the organization audit log from
the whole-second floor of the boundary record's `recordedAtUtc` through a
timestamp strictly after the terminal sample's `capturedAtUtc`. Use the exact phrase
`repo:mento-protocol/frontend-monorepo action:repo.access
created:>=<queryStartUtc> created:<queryEndUtcExclusive>`. Preserve the literal
query and exact bounds in metadata. Choose exactly one of the three evidence
routes below. Do not combine their files or fields.

### Owner web JSON export (Free and Enterprise plans)

An organization owner whose membership role is `admin` can enter the exact
query in the organization **Audit log** page and select **Export > JSON**. Keep
the downloaded JSON bytes unchanged. The file must be one JSON array, not
NDJSON or a wrapper object. Every row must have exact `action: "repo.access"`
and `repo: "mento-protocol/frontend-monorepo"` values, fall inside the covering
half-open query range, and have a nonempty unique `_document_id`.

[GitHub documents](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization#exporting-the-audit-log)
two hard web-export limits: a 100 MB compressed file or 10 minutes of export
processing. Confirm that neither limit nor an export error appeared and that
the visible matching-entry count equals the JSON array length. Create canonical
mode-`0600` `.vercel-cost-evidence/github/raw/audit-log.metadata.json`:

```json
{
  "schema": "vercel-cost-github-audit-export-metadata:v3",
  "source": "github-org-audit-log-owner-web-json-export",
  "format": "json-array",
  "repository": "mento-protocol/frontend-monorepo",
  "startUtc": "<START_UTC_FROM_PRIVATE_INTERVAL>",
  "endUtcExclusive": "<CURRENT_END_UTC_EXCLUSIVE_FROM_PRIVATE_LEDGER>",
  "queryStartUtc": "<whole-second floor of boundary recordedAtUtc>",
  "queryEndUtcExclusive": "<strictly after terminal sample capturedAtUtc>",
  "capturedAtUtc": "<at or after queryEndUtcExclusive>",
  "queryPhrase": "<the exact phrase above>",
  "eventCount": 0,
  "exportByteLength": 1234,
  "exportSha256": "<lowercase SHA-256 of the exact JSON bytes>",
  "ownerAttestation": {
    "role": "admin",
    "exportCompleted": true,
    "sizeLimitReached": false,
    "processingTimeLimitReached": false,
    "exportError": null,
    "matchingEntryCount": 0
  }
}
```

The web route has no provider pagination receipt or signed export. Its
completeness claim is the maintainer attestation bound to the exact
query, byte length, digest, array count, and matching-entry count. Keep the
private export completion screen or equivalent operator record with the
evidence package. Any visibility row remains valid source data but makes the
proof ineligible.

### Owner web zero-result attestation (Free and Enterprise plans)

GitHub can hide **Export** when the exact owner audit-log query has no matching
events. In that case, keep the exact signed-in page URL and capture an
unobscured PNG that shows the zero-result message after the covering query end.
Do not fabricate an empty JSON export. Use this route only when the page shows
`We couldn’t find any events matching your search.` and renders no export
control.

Create canonical mode-`0600`
`.vercel-cost-evidence/github/raw/audit-log.metadata.json`:

```json
{
  "schema": "vercel-cost-github-audit-export-metadata:v3",
  "source": "github-org-audit-log-owner-web-zero-result-attestation",
  "format": "browser-screenshot-png",
  "repository": "mento-protocol/frontend-monorepo",
  "startUtc": "<START_UTC_FROM_PRIVATE_INTERVAL>",
  "endUtcExclusive": "<CURRENT_END_UTC_EXCLUSIVE_FROM_PRIVATE_LEDGER>",
  "queryStartUtc": "<whole-second floor of boundary recordedAtUtc>",
  "queryEndUtcExclusive": "<strictly after terminal sample capturedAtUtc>",
  "capturedAtUtc": "<at or after queryEndUtcExclusive>",
  "queryPhrase": "<the exact phrase above>",
  "pageUrl": "<exact github.com audit-log URL with only q=<queryPhrase>>",
  "zeroResultText": "We couldn’t find any events matching your search.",
  "eventCount": 0,
  "screenshotByteLength": 1234,
  "screenshotSha256": "<lowercase SHA-256 of the exact image bytes>",
  "ownerAttestation": {
    "role": "admin",
    "zeroResultVisible": true,
    "exportControlAvailable": false,
    "pageError": null
  }
}
```

Set `format` to `browser-screenshot-png`. This route binds the exact query URL,
zero-result text, image bytes, and owner attestation. The URL cannot contain
userinfo, a custom port, or a fragment. It does not claim that GitHub produced
an export. The bounded reader rejects the image above 25 MiB before loading its
bytes. The validator requires an image of at least 640 by 480 pixels. It
validates PNG chunks, checksums, and decompressed scanlines. The proof records
the derived pixel dimensions. Chunk names must use valid ASCII bytes and the PNG
reserved bit. The zlib stream must consume all IDAT bytes. JPEG input is
unsupported because the standalone validator does not include a complete JPEG
decoder.
If any matching event exists, use the unchanged owner web JSON export instead.

### REST Link transcript (Enterprise Cloud only)

Organizations entitled to the organization audit-log REST endpoint may use
the API route instead. Add `include=web`, ascending order, and `per_page=100`
to the exact phrase. Save every REST response as its status line, headers,
blank line, and JSON array body. Join pages with this literal delimiter on its
own line:

```text
--- github-audit-page ---
```

Start without an `after` or `before` cursor and follow every
`Link: ...; rel="next"` cursor through the terminal page.
Create canonical mode-`0600`
`.vercel-cost-evidence/github/raw/audit-log.metadata.json` with these keys.
Reuse the same verified interval values; the placeholders remain deliberately
invalid until replaced:

```json
{
  "schema": "vercel-cost-github-audit-export-metadata:v3",
  "source": "github-org-audit-log-rest-link-transcript",
  "format": "http-link-transcript-json-array-pages",
  "repository": "mento-protocol/frontend-monorepo",
  "startUtc": "<START_UTC_FROM_PRIVATE_INTERVAL>",
  "endUtcExclusive": "<CURRENT_END_UTC_EXCLUSIVE_FROM_PRIVATE_LEDGER>",
  "queryStartUtc": "<whole-second floor of boundary recordedAtUtc>",
  "queryEndUtcExclusive": "<strictly after terminal sample capturedAtUtc>",
  "capturedAtUtc": "<at or after queryEndUtcExclusive>",
  "queryPhrase": "<the exact phrase above>",
  "include": "web",
  "order": "asc",
  "perPage": 100,
  "pageUrls": ["<exact first URL>", "<exact next URL if present>"],
  "complete": true,
  "eventCount": 0,
  "transcriptByteLength": 1234,
  "transcriptSha256": "<lowercase SHA-256 of the exact transcript bytes>"
}
```

Each `pageUrls` entry must preserve the same phrase, include, order, and
per-page parameters and must be unique. The first page has no cursor. Each later
page has exactly one nonempty `after` or `before` cursor. No URL can contain
userinfo, a port, a fragment, a duplicate parameter, or another query key. The
transcript's `next` links must equal the next entries exactly, and the final page
must have no next link.

Build the proof without network access or credentials:

```bash
pnpm vercel:cost:github -- build \
  --usage-csv .vercel-cost-evidence/github/raw/detailed-usage.csv \
  --usage-metadata .vercel-cost-evidence/github/raw/detailed-usage.metadata.json \
  --audit-web-export .vercel-cost-evidence/github/raw/audit-log.web-export.json \
  --audit-metadata .vercel-cost-evidence/github/raw/audit-log.metadata.json \
  --observation-root .vercel-cost-evidence/github-observation-v2 \
  --output .vercel-cost-evidence/github/postcutover.github-actions.json
```

For the Enterprise REST route, replace the one web-export option with
`--audit-rest-transcript .vercel-cost-evidence/github/raw/audit-log.transcript.txt`.
For a zero-result page with no export control, use
`--audit-web-zero-screenshot .vercel-cost-evidence/github/raw/audit-log.zero-results.png`.
The CLI requires exactly one of these three options.

All inputs and outputs must share one real `.vercel-cost-evidence/` tree with
mode-`0700` directories and mode-`0600` files. Publication is fsynced and
no-overwrite; archive or delete an obsolete proof deliberately before rebuilding.
The canonical output schema is `vercel-cost-github-actions-proof:v4`. Rebuild
all v3 proofs from their bound raw sources. The audit metadata schema is v3.
The proof binds raw-file SHA-256s, the exact interval, the six deployment
workflow paths, checked-in standard/larger runner SKU allowlists, units, exact
decimal billing amounts, the complete frozen collector tree, and audit
source evidence. The REST source proves its cursor chain. The web export and
zero-result sources bind explicit owner attestations while recording the
absence of provider pagination and signature proof. The builder rejects unknown
selected SKUs, fractional or unsafe runner minutes, and storage quantities that
cannot round-trip through the analyzer number type without decimal drift. A
visibility event in the covering range, interval-crossing non-skipped jobs,
nonzero larger-runner minutes, nonzero custom-image storage, nonzero runner or
storage net cost, or a billed standard-minute difference larger than the
collector tolerance makes the proof ineligible.

The detailed usage CSV is the billing source of record. The collector derives a
corroborative total from second-resolution REST job timestamps and rounds each
non-skipped job up to a whole minute. Those timestamps are not metering
receipts. The proof keeps the exact-match result and the signed collector-minus-
CSV delta. The collector may exceed the CSV by at most one minute per 1,000
reconstructed minutes, capped at 10 minutes. A CSV total above the complete
collector fails closed. Windows below 1,000 minutes still require exact
equality. This tolerance applies only to GitHub billing corroboration. It does
not change, round, or weaken issue #842's 90% normalized Vercel Build CPU gate.

`artifactStorageGbHours` receives the billed `actions_storage` quantity for an
allowlisted deployment workflow. If GitHub leaves the workflow path blank, it
receives the repository-attributed quantity as a conservative upper bound. The
proof records that row count and does not claim that all repository storage came
from this migration. The proof rejects a date and SKU that has both blank-path
and allowlisted workflow rows because GitHub does not identify the blank row as
a subtotal or a separate charge. It aggregates rows for the same SKU across
different dates. It keeps each SKU in a separate attribution group.
`cacheStorageGbHours` applies the same rule to billed
`actions_cache_storage`, which represents billable cache overage after GitHub
allowances, not physical cache size. All retained storage rows must have zero
net cost. Collector snapshots are diagnostic and do not replace billing GB-hour
quantities.

## Source-of-truth intervals

Use separate half-open intervals for cost evidence and correctness evidence.
The cost interval `[startUtc, endUtcExclusive)` must contain one or more exact
24-hour periods. Bind its boundaries to the provider's charge periods. The
correctness and GitHub observation interval must use complete UTC days with both
boundaries at `00:00:00.000Z`. The [FOCUS billing endpoint](https://docs.vercel.com/docs/rest-api/reference/endpoints/billing/list-focus-billing-charges)
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

Filter to rows with `ChargeCategory == "Usage"`,
`ServiceName == "Build CPU Minutes"`, and `ConsumedUnit == "minute"` for the
four in-scope Vercel projects only. The parser accepts the endpoint's quoted decimal values as well as JSON
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
2. leave the migrated-path measurement unresolved and keep #523 open.

Never estimate migrated Build CPU minutes by apportioning a project total using
deployment count or visible build duration. Record excluded deployment attempts
even when they contribute zero invoice-grade minutes. Gross project totals must
remain visible alongside the migrated-path comparison.

The #523 threshold normalizes by logical target, not by preview/main path. The
preview/main census remains mandatory correctness evidence, but it never
allocates project-level Build CPU minutes or cost between those paths. A target
may have both preview and main events only when the complete census proves zero
excluded deployment attempts and `migratedPath` equals `grossProject` for Build
CPU minutes, `EffectiveCost`, and final `BilledCost`. In that case the entire
project total belongs to the migrated path by exclusion; no cost split is
estimated.

## Post-cutover collection protocol

1. Record the successful #522 cutover run, exact commit SHA, completion
   timestamp, and final ownership configuration. Start the correctness and
   GitHub observation interval at the next complete UTC-day boundary. Never
   backdate it into the cutover.
2. Keep collecting until the observation interval contains at least seven complete UTC days
   and ten trusted same-repository PR pushes that affect deployed code. Record
   that observation denominator as `trustedDeployedCodePrPushes`.
3. Select complete provider-aligned baseline and post-cutover cost intervals.
   Keep each cost interval separate from the correctness interval. Export the
   matching Vercel FOCUS data. Retain the raw files privately. Record their
   digests and row counts. Re-export or compare the billing surface until
   ingestion for both cost intervals is confirmed complete. Extend the cost
   interval until every logical target has nonzero baseline and post-cutover
   eligible events.
4. Export every page from Vercel's
   [`GET /v7/deployments`](https://vercel.com/docs/rest-api/reference/endpoints/deployments/list-deployments)
   endpoint for each of the four projects, preserve the original private
   responses, and assemble the strict saved-pages envelope described below.
   Run `pnpm vercel:cost:normalize-deployments` to verify pagination and UTC
   completeness and produce one JSONL row per deployment attempt with exactly
   `deploymentId`, `target`, `path`, `source`, `outcome`, `sourceSha`,
   `createdAtUtc`, and `evidenceUrl`. The analyzer accepts only this public
   repository's GitHub run/deployment URLs or a root `*.vercel.app` deployment
   URL, with no credentials, query string, fragment, or custom port. Vercel
   dashboard URLs are private evidence and fail closed. Duplicate deployment
   IDs, raw timestamps outside the bounded query, digest mismatches, incomplete
   pagination, or incomplete-census assertions fail closed. The exact
   one-millisecond lower query pad is retained only in the private input digest
   and excluded from the census. One eligible event key is
   `target:path:sourceSha`. Count every native,
   prebuilt, failed, cancelled, and rerun deployment attempt; do not use attempts
   as the event denominator. In both the baseline and post-cutover windows,
   deployment attempts must be at least the number of eligible events.
   Keep the axes orthogonal: `path` is `preview`, `main`, `legacy-v2`, or
   `unknown`; `source` is `github-actions-prebuilt`, `vercel-native`,
   `vercel-native-suppressed`, `manual`, or `unknown`; `outcome` is `ready`,
   `error`, or `canceled`. Within each
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
   unexplained native build unless the raw row proves that Vercel canceled the
   Git record before any build started. Classify that exact case as
   `vercel-native-suppressed`. It must have Git source, `CANCELED` state, absent
   or null `buildingAt`, complete repository identity, no Mento metadata, and no
   prebuilt flag. Keep suppression records visible, but do not treat them as
   builds or invoice-grade cost exclusions. Manual and unknown sources remain
   excluded and visible.
5. Classify app deployments as migrated PR preview, migrated `main -> v3`,
   preserved native `v2 -> production`, or manual/unknown. Keep v2 visible and
   apply the invoice-grade attribution limitation above.
6. Build the source-bound GitHub Actions proof above from the final preview workflow inventory
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
   FOCUS, deployment-census, and GitHub proof files using the
   synthetic [`manifest.json`](../scripts/fixtures/vercel-cost-analysis/manifest.json)
   fixture set as the schema example. Do not copy its invented values.
9. Run the analyzer. A failing command lists deterministic evidence gaps; extend
   the window or investigate the named anomaly instead of editing the threshold.
10. After the invoice closes, replace nullable `billedCost` fields with final
    reconciled values, set both `invoiceFinal` flags, rerun the analyzer, and
    retain the private reconciliation.

### Saved Vercel deployment pages

The normalizer accepts one private `vercel-deployment-pages:v2` JSON envelope.
Do not include request headers, cookies, tokens, dashboard URLs, or other
authentication material. Keep the original response files separately as
private provider evidence; the normalizer's input digest binds the complete
envelope, including raw deployment fields it does not interpret.

```json
{
  "schema": "vercel-deployment-pages:v2",
  "window": {
    "startUtc": "<START_UTC_FROM_AGGREGATE_COST_PERIOD>",
    "endUtcExclusive": "<END_UTC_EXCLUSIVE_FROM_AGGREGATE_COST_PERIOD>"
  },
  "projects": [
    {
      "target": "app",
      "projectId": "prj_example123",
      "query": {
        "path": "/v7/deployments",
        "teamId": "team_example123",
        "projectId": "prj_example123",
        "since": 1111111111111,
        "until": 2222222222222,
        "limit": 100
      },
      "pages": [
        {
          "requestCursor": 2222222222222,
          "response": {
            "deployments": [
              {
                "uid": "dpl_example",
                "projectId": "prj_example123",
                "createdAt": 1111111111112,
                "readyState": "READY",
                "url": "example.vercel.app",
                "prebuilt": true,
                "meta": {
                  "githubCommitOrg": "mento-protocol",
                  "githubCommitRepo": "frontend-monorepo",
                  "githubCommitRef": "example-branch",
                  "githubCommitSha": "1111111111111111111111111111111111111111",
                  "mentoControllerKey": "vercel-preview:v1:pr:1:target:app:sha:1111111111111111111111111111111111111111"
                }
              }
            ],
            "pagination": { "count": 1, "next": null, "prev": null }
          }
        }
      ]
    }
  ],
  "annotations": {
    "dpl_example": {
      "path": "preview",
      "source": "github-actions-prebuilt",
      "evidenceUrl": "https://example.vercel.app/"
    }
  }
}
```

The example uses deliberately invalid cost-period placeholders and numeric
epoch sentinels. Build each baseline or post-cutover deployment census from the
matching aggregate cost period. Use the private interval and extension ledger
only for correctness and GitHub evidence. Derive `since`, `until`, and the
initial `requestCursor` from that aggregate cost period. Preserve the JSON
number type and the repeated end/cursor value. Replace `createdAt` with the
exact integer epoch from the saved Vercel response without deriving or altering
it. The example abbreviates the `projects` array; the real envelope must contain
`app`, `governance`, `reserve`, and `ui` exactly once with distinct project IDs
and the same team ID. Each initial query must use:

- `path: "/v7/deployments"`, `limit: 100`, and the exact project and team IDs;
- `since` equal to the inclusive UTC start in epoch milliseconds minus one;
- `until` and the first `requestCursor` equal to the exclusive UTC end in epoch
  milliseconds; and
- for every later page, `requestCursor` equal to the preceding response's
  numeric `pagination.next`, ending with one `next: null` page.

Every response must contain exactly `deployments` and `pagination`, and every
pagination object must contain exactly `count`, `next`, and `prev`. `count` must
equal that page's deployment count. The tool rejects repeated or discontinuous
cursors, more than 100 pages or 100 rows per page, duplicate deployment IDs,
mixed queries, timestamps outside the bounded
`[startUtc - 1 ms, endUtcExclusive)` query, and pages that do not end at
`next: null`. Vercel does not guarantee deployment row order. The normalizer
therefore makes no row-order assumption and deterministically sorts final
census rows by timestamp and deployment ID.

Every raw deployment object must supply a valid `uid`, its exact `projectId`,
and epoch-millisecond `createdAt`. A row at the exact `startUtc - 1 ms` query pad
is excluded before semantic normalization and needs no annotation, but its raw
identity, project, and timestamp are still validated. Duplicate detection also
includes that excluded row, and the input digest binds all of its bytes. Every
in-window row must additionally supply `readyState` and a root `*.vercel.app`
`url`. Raw rows may retain additional provider fields. The normalizer ignores
unrelated additions while the input digest still binds their bytes. It rejects
conflicting known aliases such as `id != uid`, a different `project` ID, or
`state != readyState`. `readyState` must be one of Vercel's documented states;
only `READY`, `ERROR`, and `CANCELED` map to analyzer outcomes. Re-export after
any other state settles.

Every in-window deployment ID needs exactly one annotation, and padding IDs
must not be annotated. The operator must choose the semantic `path` (`preview`,
`main`, `legacy-v2`, or `unknown`) and `source`
(`github-actions-prebuilt`, `vercel-native`, `vercel-native-suppressed`,
`manual`, or `unknown`); the tool
never guesses either axis from `target`, Vercel's best-effort `source`, a
missing Git field, or the project name. `unknown` stays explicit. The
annotation's evidence URL must be a public repository run/deployment URL or the
row's exact root `*.vercel.app` URL.

For a migrated preview or main row and preserved App v2, the raw metadata must
contain the exact lowercase 40-character SHA and complete
`mento-protocol/frontend-monorepo` Git identity. A GitHub-owned preview must
also carry its exact target/SHA-bound `mentoControllerKey`; a GitHub-owned main
deployment must pass the repository's complete `vercel-main-candidate-metadata:v3`
validator and match the target's production or App `v3` environment. The App
v2 annotation requires native source, `v2` ref, and production target. Optional
raw environment fields are cross-checked when present but are never used to
infer a path. Historical native main records can carry a custom-environment ID
without a slug. A preview cannot carry a production or custom environment. Mento
metadata on a native annotation, conflicting SHA
fields, or `prebuilt` evidence that contradicts a native annotation fails
closed. A `vercel-native-suppressed` annotation also requires a preview or main
path, raw Git source, `CANCELED` state, absent or null `buildingAt`, and the same complete
repository identity. Manual and unknown annotations remain authoritative when raw Git or
Mento metadata is present, even when only part of the best-effort Git metadata
exists. The normalizer validates each known field that is present but does not
silently upgrade those sources. Both emit `sourceSha: null`, as required by the
analyzer.

## Manifest and aggregate evidence schema

The CLI input is a strict version-3 manifest. It references the schema-version-4
aggregate, one exact GitHub Actions proof and digest, plus each window's raw
FOCUS JSONL, raw deployment-page envelope, normalized deployment census, and
canonical census proof. The three deployment files each have a manifest-bound
SHA-256. The analyzer rebuilds the normalized bytes and proof from the raw page
bytes, requires every target's Vercel project ID to match across the baseline
and post-cutover proofs, and rejects a caller-added
`deploymentCensusComplete` field. The manifest
also records a distinct FOCUS project-tag selector for each logical target. A
target's selector must be identical in both windows so a comparison cannot
silently switch Vercel projects. Unknown or missing keys, including legacy
provider attribution fields, fail instead of being ignored.

Both aggregate cost periods require FOCUS service name `Build CPU Minutes`,
unit `minute`, billing currency `USD`, a raw-export digest, row count, ingestion
state, and invoice-final state. Raw FOCUS rows are authoritative for
`grossProject`; the analyzer derives and reconciles those totals instead of
accepting the aggregate alone.

Each target has five groups:

- `migratedPath`: raw Build CPU minutes, `EffectiveCost`, nullable `BilledCost`,
  unique eligible target events, deployment attempts, and actual duplicate
  deployment count;
- `migratedDeploymentCensus`: strict `preview` and `main` path buckets, each
  containing eligible events, deployment attempts, and actual duplicate counts;
  each metric must sum exactly to its `migratedPath` aggregate;
- `grossProject`: the complete project Build CPU minutes and costs, including
  excluded activity;
- `excluded`: attempt counts for legacy v2, manual, unknown, and suppressed
  native records;
- `attribution`: exactly `project-total-no-exclusions` with a null evidence
  digest. It requires migrated and gross values to be identical and every
  cost-impacting excluded count to be zero. Suppressed native records are
  visible but do not invalidate project-total attribution because no build
  started. Preview and main may both be active.

The post-cutover record also contains:

- `observationPeriod`, the complete UTC-day interval for correctness and GitHub
  evidence;
- `trustedDeployedCodePrPushes`, the trusted same-repository deployed-code PR
  push denominator in the observation interval;
- `costWindowTrustedDeployedCodePrPushes`, the source-bound unique trusted
  preview SHA denominator in the post-cutover cost interval;
- standard and larger-runner minutes;
- artifact and cache GB-hours;
- whether the repository remained public for the complete interval;
- first-preview totals and every correctness/security/service-quality failure
  count required by #523;
- completed-check and opportunity counts for smoke/E2E, burst first-plus-latest,
  and legacy-v2 health verification;
- opportunity, completed, and failed main-deployment observations from the
  correctness interval;
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
  trusted same-repository PR pushes, and completed previews cannot exceed
  opportunities.
- `trustedDeployedCodePrPushes` is a push-level observation denominator, while
  `costWindowTrustedDeployedCodePrPushes` is a source-bound cost-window
  denominator. The preview census is target-level deployment evidence. Do not
  force a one-to-one relationship between these intervals or counts. One push
  can fan out to several targets. First-plus-latest batching or path-aware
  preview reuse can avoid a distinct deployment for a later push. A passing
  observation requires a nonzero cost-window denominator.
- `smokeOrE2eCheckOpportunities` counts the smoke/E2E checks required by the
  observed trusted PR pushes; it must cover at least every such push.
  `smokeOrE2eChecksCompleted` counts all finished checks, whether passing or
  failing.
- `burstFirstPlusLatestCheckOpportunities` counts deliberately exercised burst
  sequences, and `burstFirstPlusLatestChecksCompleted` counts the sequences
  whose first-plus-latest outcome was fully verified. At least one sequence is
  required.
- `mainDeploymentObservationOpportunities` counts downstream main workflow runs
  in the correctness interval where at least one attempt's
  `Verify exact successful CI attempt` job completed successfully. A later
  rerun does not erase an earlier qualifying attempt. The audit captures every
  attempt for each qualifying run. A downstream no-op triggered only by failed
  or cancelled CI is not an opportunity. A deployment failure after a
  successful gate remains an opportunity. `mainDeploymentObservationsCompleted` counts those events for
  which the complete main-deployment ledger record was verified. One completed
  observation includes the exact-SHA CI gate, planner base and range, selected
  targets, stale-main decision, activation or recovery result, public-domain
  SHA, native duplicate result, and legacy-v2 health result.
  `mainDeploymentObservationFailures` counts completed observations where any
  one of those checks failed. Completed observations must equal explicit
  opportunities; the truthful value is `0/0` when no main event occurred.
- `unexplainedNativeBuilds` belongs to the correctness observation interval.
  The source evidence reports `costWindowUnexplainedNativeBuilds` separately
  for the provider-aligned post-cutover cost census. A nonzero value fails the
  manifest result. Do not force these counts to match when the intervals
  differ.
- `legacyV2HealthCheckOpportunities` counts the v2 health verifications recorded
  for the observation and final closeout, and `legacyV2HealthChecksCompleted`
  counts the checks that finished. At least one health check is required.

For each completed/opportunity pair, completion must be 100%. The corresponding
regression or failure count is a subset of completed checks and must remain
zero for a passing report.

The analyzer rejects malformed evidence such as migrated usage above gross
project usage, a post cost or observation period beginning before cutover,
partial 24-hour cost periods, partial UTC observation days,
finalized invoices with missing BilledCost, and malformed provenance.
It also rejects any legacy-v2, manual, or unknown attempt in either comparison
window; any mismatch between `migratedPath` and the FOCUS-reconciled
`grossProject`; legacy provider-attribution schema fields; reused raw FOCUS
evidence; legacy-v2 classifications outside the app project; preview/main
census totals that do not reconcile exactly; path buckets with fewer attempts
than events; duplicate counts above `attempts - events`; malformed native
suppression signatures; and unknown post-cutover deployment activity.
Completed-check counts cannot exceed their opportunities, regressions cannot
exceed completed checks, and completed main observations cannot exceed explicit
main observation opportunities. Derived totals, counterfactuals, ratios, and savings
must remain finite; numeric overflow, `NaN`, and infinity fail closed.

## Calculations

For each logical target `p`, the input supplies baseline minutes `M_B,p`,
baseline eligible events `N_B,p`, post-cutover minutes `M_P,p`, and post-cutover
eligible events `N_P,p`. The analyzer computes:

```text
C = sum over p of N_P,p * (M_B,p / N_B,p)
S = 1 - (sum over p of M_P,p / C)
```

The exact, unrounded `S` must be at least `0.90`. Every target must have nonzero
baseline and post-cutover events. The same target-mix calculation is applied to
`EffectiveCost` and final `BilledCost`, but only savings ratios are emitted. A
negative aggregate or per-target savings result for either cost metric fails the
observation.
Gross savings compare total project Build CPU minutes per complete 24-hour cost
period. Attempts per eligible event and post-cutover Build CPU minutes per
cost-window trusted deployed-code PR push are reported overall and by target.
Each target's minute contribution is divided by the global
`costWindowTrustedDeployedCodePrPushes` denominator; it is not a target-specific
push count. Every target must independently produce a finite,
positive build-minute counterfactual and a finite savings ratio; a null
per-target minute savings value can never coexist with a passing report.
Per-target savings rows are diagnostic; the 90% threshold applies to the
aggregate target-mix result. Final BilledCost savings must be finite and
available before the observation can pass.

The public-safe output shows migrated and gross Build CPU minutes for every
target in both windows. It also shows each target's preview/main event, attempt,
and duplicate census, plus direct links for any failed or unexplained deployment
attempts. Absolute cost values, raw FOCUS export digests, and charge row counts
remain private in both Markdown and JSON output.

The command remains failing when any required closeout condition is missing,
including incomplete billing, a non-final invoice, fewer than seven complete
days or ten trusted PR pushes, a target with zero events or a non-positive
minute counterfactual, any cost-impacting excluded deployment activity, a project-total
mismatch, a negative cost savings result, an actual duplicate deployment,
missing standard-runner measurement,
no eligible first-preview opportunity, less than 100% first-preview coverage,
missing or incomplete smoke/E2E, burst, or legacy-v2 observation coverage,
incomplete or failed main-deployment observations, native duplicates,
affected-target skips, larger-runner usage,
security/service regressions, v2 regressions, or an unverified rollback
procedure. Smoke/E2E opportunities must cover at least every trusted
same-repository PR push in the observation window. Extra failed, cancelled, or
rerun attempts remain visible in attempts-per-event but are not mislabeled as
duplicate deployments.

## Migration cleanup disposition

The maintainer accepted the fixed corrective result on 2026-08-26. The cleanup
removes only the retired manual prebuilt caller and its compatibility contract.
The following dispositions apply:

- remove the retired manual prebuilt workflow, caller provenance, smoke mode,
  and pilot-only tests;
- preserve PR-A global-shadow support while
  preserving the target-local main `shadow` ownership mode and full-native
  rollback contract;
- retain `deployment_status` preview-smoke handling because App and Governance
  target-local preview rollback still consumes it;
- retain the stable deployment summaries and journals. No separate duplicate
  migration-only logger exists.

Set the corresponding `closeout` flags only after each disposition is complete;
the analyzer deliberately keeps `pass: false` and exits nonzero while the report
is `observation-only`. The maintainer product decision does not rewrite the
immutable analyzer threshold.

Preserve the planner and tests, reusable prebuilt workflow, active preview/main
workflows, stable sentinels, rollback runbook, topology/environment semantics,
and the cost analyzer. Run the docs-drift audit across `AGENTS.md`, `CLAUDE.md`,
`README.md`, and `docs/**`, then execute the final gates listed in #523.

If the normalized minute threshold or any correctness gate misses, keep the
epic open and create a narrowly scoped issue containing the exact remaining
source and direct evidence links. Generic CI build duplication, Turbo cache
misses, legacy app v2 migration, and `monitoring-dashboard` remain separate
follow-up decisions.
