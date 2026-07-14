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
pnpm quality:bundle:check  # inspect .next/app-build-manifest.json for every app
pnpm quality:budgets       # canonical full sequence used in CI
```

The bundle-only command intentionally does not build. This keeps it useful for
checking an existing production artifact; it reports a missing build explicitly.
CI guarantees freshness by running `pnpm build` immediately before the checker.

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
| `governance.mento.org`      |               8.77% |            61.53% |             51.63% |          8.77% |                  8% |               60% |                50% |             8% |
| `@mento-protocol/ui`        |               5.40% |            82.07% |             81.37% |          5.40% |                  5% |               80% |                80% |             5% |
| `@repo/web3` critical files |              98.62% |            95.31% |            100.00% |         98.62% |                 90% |               90% |                90% |            90% |

The web3 gate intentionally retains its existing deletion-proof critical-file
scope in `packages/web3/vitest.config.ts`; the other three workspaces cover their
full configured source surface.

## Production bundle budgets

`scripts/check-bundle-size.mjs` reads each production
`.next/app-build-manifest.json`, deduplicates the JavaScript files loaded by a
route, gzip-compresses each file at level 9, and fails on the largest route. It
does not count CSS, server chunks, source maps, or the same shared chunk twice.

The observed values came from successful `main` CI run
[`29320972122`](https://github.com/mento-protocol/frontend-monorepo/actions/runs/29320972122)
at `8e7f2e66` on 2026-07-14. Next's build table rounds displayed baselines; the
enforced limits are exact bytes in the checker.

| App                    | Largest observed route    | Observed gzip baseline | Exact enforced limit | Headroom |
| ---------------------- | ------------------------- | ---------------------: | -------------------: | -------: |
| `app.mento.org`        | `/bridge`                 |                1.60 MB |      1,760,000 bytes |    10.0% |
| `governance.mento.org` | `/proposals/[id]`         |                1.18 MB |      1,300,000 bytes |    10.2% |
| `reserve.mento.org`    | `/`                       |                 670 kB |        740,000 bytes |    10.4% |
| `ui.mento.org`         | `/specialized-components` |                 461 kB |        510,000 bytes |    10.6% |

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
release-tag `push` workflows. It partitions state by source workflow,
operational trigger, and target ref, then:

- opens one bot-authored, marker-keyed issue per partition on failure;
- updates/reopens that same issue for repeated failures in the partition;
- closes it only after a newer successful run in the same partition; and
- paginates all completed runs and reconciles to the latest decisive success or
  failure for that partition, so delayed or dropped callbacks still converge on
  current state; neutral, skipped, and cancelled runs do not suppress a
  decisive result.

`Visual Regression` is path-filtered before a default-branch run starts. Any
default-branch run that does start executes both the app and UI visual suites,
so its workflow-level success proves that either previously failing surface
recovered. Pull requests retain the cheaper per-surface changed-file plan.

The notifier uses only the repository `GITHUB_TOKEN`, with `actions: read`,
`contents: read`, and `issues: write` on its single job. It checks out the
event-time trusted `github.workflow_sha` and never the triggering SHA. Its own name is absent
from the static source-workflow list, so its issue mutations cannot recursively
notify it.

When adding or renaming an operational workflow, add its exact top-level `name`
to the notifier's `workflow_run.workflows` list and update
`scripts/quality-workflows.test.mjs`. Run `pnpm quality:budgets:test` before
shipping the workflow change.
