# Quality budgets and CI failure notification

The `Quality Budgets` workflow is an always-reported pull-request and `main`
gate. It runs the repository's zero-network self-tests, measured Vitest coverage
floors, production Next.js builds, and gzip-compressed client-route budgets.
It deliberately lives outside the legacy `CI/CD` workflow so the budgets can be
made required or tuned independently.

## Commands

```bash
pnpm quality:budgets:test  # bundle checker, notifier, and workflow structure tests
pnpm quality:coverage      # all four Vitest workspaces with thresholds
pnpm build                 # production artifacts required by the bundle checker
pnpm quality:bundle:check  # inspect Turbopack route bundle stats for every app
pnpm quality:budgets       # canonical full sequence used in CI
```

The bundle-only command intentionally does not build. This keeps it useful for
checking an existing production artifact; it reports a missing build explicitly.
CI guarantees freshness by running `pnpm build` immediately before the checker.

The canonical gate is sequential: when an early step fails, later build and
bundle steps have not been validated. After fixing a failed step or rebasing
over a framework or toolchain change, run the full `pnpm quality:budgets`
command against the latest `main`, not only the previously failing subcommand.

## Coverage floors

The baselines below were measured with Node 22, Vitest 3.2.6, and
`@vitest/coverage-v8` 3.2.6 on 2026-07-14. Explicit `include` lists restrict the
denominator to production `app/**` or `src/**` modules plus each app's runtime
instrumentation; tests, specs, generated clients, configuration, and tooling
are excluded. `all: true` keeps untested production files in the denominator,
so deleting the last importing test cannot make the gate disappear. Integer
floors leave modest headroom for V8 instrumentation noise while still preventing
material regressions.

| Workspace                   | Measured statements | Measured branches | Measured functions | Measured lines | Enforced statements | Enforced branches | Enforced functions | Enforced lines |
| --------------------------- | ------------------: | ----------------: | -----------------: | -------------: | ------------------: | ----------------: | -----------------: | -------------: |
| `app.mento.org`             |              31.25% |            73.75% |             73.64% |         31.25% |                 30% |               72% |                72% |            30% |
| `governance.mento.org`      |               9.52% |            61.90% |             51.28% |          9.52% |                  8% |               60% |                50% |             8% |
| `@mento-protocol/ui`        |               5.40% |            82.07% |             81.37% |          5.40% |                  5% |               80% |                80% |             5% |
| `@repo/web3` critical files |              98.62% |            95.31% |            100.00% |         98.62% |                 90% |               90% |                90% |            90% |

The web3 gate intentionally retains its existing deletion-proof critical-file
scope in `packages/web3/vitest.config.ts`; the other three workspaces cover their
full configured source surface.

## Production bundle budgets

`scripts/check-bundle-size.mjs` reads each production Turbopack
`.next/diagnostics/route-bundle-stats.json`, deduplicates the JavaScript files
loaded by a route, gzip-compresses each file at level 9, and fails on the
largest route. It does not count CSS, server chunks, source maps, or the same
shared chunk twice.

The observed values were remeasured with Next 16.2.10 at `87ce21c` on
2026-07-14 using the deterministic environment from
`.github/workflows/quality-budgets.yml`. Displayed baselines are rounded; the
measurements and enforced limits are exact bytes in the checker.

| App                    | Largest observed route    | Observed gzip baseline | Exact enforced limit | Headroom |
| ---------------------- | ------------------------- | ---------------------: | -------------------: | -------: |
| `app.mento.org`        | `/bridge`                 |                1.60 MB |      1,760,000 bytes |     9.8% |
| `governance.mento.org` | `/proposals/[id]`         |                1.20 MB |      1,300,000 bytes |     8.5% |
| `reserve.mento.org`    | `/`                       |                 688 kB |        740,000 bytes |     7.6% |
| `ui.mento.org`         | `/specialized-components` |                 487 kB |        510,000 bytes |     4.7% |

When a deliberate feature exceeds a limit:

1. Inspect the route's new chunks and remove accidental client-side imports.
2. Rebuild with the deterministic environment from
   `.github/workflows/quality-budgets.yml`.
3. Record the new largest-route measurement here and adjust only that app's
   exact limit in `scripts/check-bundle-size.mjs` with justified headroom.
4. Run `pnpm quality:budgets:test` and `pnpm quality:bundle:check`.

Do not raise every limit or switch the checker to total `.next` directory size;
that would mix server/build-cache artifacts into the browser budget.

## Failure issue lifecycle

`CI Failure Notifier` listens only to completed operational workflows listed in
`.github/workflows/ci-failure-notifier.yml`. It ignores pull-request and feature
branch runs; branch protection already surfaces those failures. It tracks
default-branch `push`, `schedule`, and `workflow_dispatch` runs plus allowlisted
release-tag `push` workflows. It accepts `workflow_run` only for the
repository-owned `Vercel Main Deployment` workflow on the default branch. It
does not monitor `repository_dispatch`. The workflow trigger supplies a static
name allowlist, and the trusted script rejects an unrecognized event, wrong
branch, fork, or notifier self-callback. Managed issue prose uses the upstream
workflow name. It partitions state by source workflow, operational trigger, and
branch or tag. It then:

- opens one bot-authored, marker-keyed issue per partition on failure;
- updates/reopens that same issue for repeated failures in the partition;
- closes it only after a newer successful run in the same partition; and
- paginates all completed runs and reconciles to the latest decisive success or
  failure for that partition, so delayed or dropped callbacks still converge on
  current state; neutral, skipped, and cancelled runs do not suppress a
  decisive result.

### What failed

A failure body carries a `## What failed` section between the run metadata and
the managed marker, so the issue states what broke instead of only linking the
run. For each failed job of the reconciled run it prints the job name, the name
of the failed step, and one bounded excerpt.

The excerpt comes from the job's structured summary when the API exposes one.
The workflow-jobs API exposes no step output today, so in practice the notifier
downloads the job log with `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`
under the `actions: read` permission the job already holds. It then picks the
excerpt by content, not by job name:

- an OSV-Scanner findings table — every contiguous `| … |` block holding at
  least one `https://osv.dev/` row, with its `Total N packages affected …`
  headline. That is what a daily `Supply Chain` scan failure needs to show; or
- otherwise the lines leading up to each `##[error]` annotation, falling back to
  the tail of the log when the runner recorded no annotation.

Every excerpt is sanitized and bounded. Sanitizing strips ANSI colouring and the
per-line runner timestamp, caps a single line at 500 characters, and replaces
any line matching a defensive credential pattern
(`token|secret|password|passwd|bearer|authorization|ghp_|ghs_|gho_|ghu_|ghr_|github_pat_|-----BEGIN`)
with a fixed redaction line — that guard is what keeps a runner's
`ACTIONS_RUNTIME_TOKEN` echo out of a public issue. Bounding caps each job at 40
lines and 4 KiB, reports at most 10 failed jobs, and holds the assembled body
under 60 KiB against GitHub's 65536-character issue limit. Every cut is marked
in place: `[… N more log lines truncated]` inside an excerpt, and a counted note
for jobs whose excerpts were dropped or that were not listed.

Evidence is best-effort. A failed job listing or log download degrades to a
`job list unavailable: <reason>` or `(log excerpt unavailable: <reason>)` note,
and a reason that itself looks like a credential is reported as
`redacted error`. Log downloads also stop after 90 seconds so a pathologically
large log cannot push the job past its five-minute timeout. The notifier still
opens, updates, and closes its issue in every one of those cases.

`CI/CD` forces its full build, unit-test, type-check, Knip, and Trunk suite on
every default-branch push. Documentation-only planning is limited to pull
requests, so a successful default-branch `CI/CD` run proves the previously
failing checks recovered before the notifier closes its managed issue.

`Visual Regression` is path-filtered before a default-branch run starts. Any
default-branch run that does start executes both the app and UI visual suites,
so its workflow-level success proves that either previously failing surface
recovered. Pull requests retain the cheaper per-surface changed-file plan.

The notifier uses only the repository `GITHUB_TOKEN`, with `actions: read`,
`contents: read`, and `issues: write` on its single job. `actions: read` already
covered the workflow-runs pagination and also covers the job listing and log
download behind `## What failed`, so reading failure evidence added no
permission. It checks out the
event-time trusted `github.workflow_sha` and never the triggering SHA. Its own name is absent
from the static source-workflow list, so its issue mutations cannot recursively
notify it.

When adding or renaming an operational workflow, add its exact top-level `name`
to the notifier's `workflow_run.workflows` list and update
`scripts/quality-workflows.test.mjs`. Run `pnpm quality:budgets:test` before
shipping the workflow change.
