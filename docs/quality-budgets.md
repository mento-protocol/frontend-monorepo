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

`CI/CD` forces its full build, unit-test, type-check, Knip, and Trunk suite on
every default-branch push. Documentation-only planning is limited to pull
requests, so a successful default-branch `CI/CD` run proves the previously
failing checks recovered before the notifier closes its managed issue.

`Visual Regression` is path-filtered before a default-branch run starts. Any
default-branch run that does start executes both the app and UI visual suites,
so its workflow-level success proves that either previously failing surface
recovered. Pull requests retain the cheaper per-surface changed-file plan.

The notifier uses only the repository `GITHUB_TOKEN`, with `actions: read`,
`contents: read`, and `issues: write` on its single job. It checks out the
event-time trusted `github.workflow_sha` and never the triggering SHA. Its own name is absent
from the static source-workflow list, so its issue mutations cannot recursively
notify it.

## Slack notification

`.github/workflows/notify-slack-on-main-failure.yml` is the push-notification
side channel for the same failures. It watches the identical static workflow
allowlist and applies the identical admission rules, then narrows to the
`FAILURE_CONCLUSIONS` set from `scripts/ci-failure-issue.mjs`
(`action_required`, `failure`, `startup_failure`, `timed_out`) and posts one
message to `#ci-failures` through Slack's `chat.postMessage`. A structural test
reads that set out of the script, so the two notifiers cannot drift apart on
which conclusions count. The message links the failed run and the managed-issue
search; it opens, updates, and closes nothing, so the issue lifecycle above
stays the single source of truth.

`chat.postMessage` accepts a channel name for a public channel, so the payload
passes `#ci-failures` rather than an encoded ID. Configure an ID instead only
if the channel is ever renamed; the step fails loudly on a `channel_not_found`
response either way.

Because the notifier checks out nothing, it cannot import `targetRefFor()`. It
mirrors that function in jq — `head_branch`, else `release tag` for a `push`,
else the default branch — so a scheduled run or a tag push with a null
`head_branch` names the same ref the managed issue does. A parity test pins the
source of `targetRefFor()`, pins the jq expression's exact text, and checks
both null forms.

Those parity tests reimplement the jq semantics in JavaScript rather than
shelling out to `jq`. `pnpm quality:budgets:test` is a required gate and must
run with nothing but Node and pnpm — no network, and no binary outside the
documented prerequisites. Pin drift with exact-text assertions; never add a
tool dependency to make a gate runnable.

It uses `secrets.SLACK_BOT_TOKEN` (which needs Slack's `chat:write.public`
scope). The workflow grants no permissions; the job grants exactly
`actions: read`, the single scope the freshness reconciliation below needs to
list this workflow's completed runs. It writes nothing back to GitHub, checks
out no code, and runs no action. Every
`workflow_run` field it reports — commit title included — is bound to an
environment variable and passed to `jq --arg`, never interpolated into the
shell, because a commit title can contain backticks or `$(…)`. The commit title
is additionally escaped for Slack mrkdwn so a title like `<!channel>` cannot
render as a real mass-page mention.

Its bare `workflow_dispatch` (no inputs; checkov `CKV_GHA_7` forbids them)
posts a fixed "🧪 wiring test" message. The workflow must be on `main` to be
dispatchable at all, so the smoke test can only be run after it has merged.

### Suppressing stale callbacks

A `workflow_run` callback can arrive out of order: run N's failure can land
after run N+1 already succeeded, and an older attempt can land after a
successful rerun. `reconcileCiFailureIssue()` handles that by resolving every
callback to the latest decisive run in its partition — `workflow_id` plus
`event` plus target ref, ordered by `run_number` then `run_attempt`, where
"decisive" is `success` plus `FAILURE_CONCLUSIONS` — and acting on that run, so
it closes or leaves closed the managed issue.

Slack is not idempotent the way one managed issue is, so the mirror is: post
only when the triggering run is itself the latest decisive run in its
partition. A newer decisive run either succeeded, in which case there is
nothing to announce, or failed and owns its own message. A `Reconcile against
the latest decisive run` step lists the workflow's completed runs for the
callback's own event with `actions: read` and sets a `stale` output the post
step is gated on; the smoke-test dispatch skips it entirely.

It fails open. Any API error, an unexpected workflow id, or a callback run
outside the fetched page posts anyway — a rare duplicate beats a dropped alert.
Parity is pinned by exact-source assertions on `runPosition()`, `compareRuns()`,
and `isDecisiveRun()`, by exact-text assertions on the jq pipeline, and by a
scenario table asserting the mirror and the reference agree on all seven cases.

### Keeping the Slack token off non-default branches

`gh workflow run --ref <branch>` runs the workflow version on that ref, so a
branch-selected dispatch of an edited copy would otherwise read
`SLACK_BOT_TOKEN`. Two layers narrow that:

1. The job's `if:` requires `github.ref` to equal the default branch for every
   event, so a branch dispatch skips before any step reads the secret. GitHub
   always sets the ref to the default branch for `workflow_run`, so real
   notifications are unaffected.
2. The job declares the `slack-ci-notifications` GitHub Environment, whose
   deployment branch policy allows `main` only. GitHub enforces that
   server-side before the job starts — the same shape
   `vercel-main-deployment.yml` uses with `vercel-cli-production`.

Neither layer is complete while `SLACK_BOT_TOKEN` stays an org-shared secret,
because an attacker editing this file on their own branch can delete both. The
control becomes airtight only once the token is an **environment** secret on
`slack-ci-notifications` and the org-level copy is removed: a copy without the
`environment:` key then resolves an empty token. Note that push access already
grants every repository and organization secret through an ordinary `on: push`
workflow, so this is hardening rather than a repair of a unique hole.

When adding or renaming an operational workflow, add its exact top-level `name`
to both notifiers' `workflow_run.workflows` lists and update
`scripts/quality-workflows.test.mjs`; a structural test asserts the two lists
stay identical. Run `pnpm quality:budgets:test` before shipping the workflow
change.
