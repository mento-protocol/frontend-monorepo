# Vercel deployment primitives

This runbook documents the repository-owned planning and build primitives used
by the GitHub Actions deployment migration tracked in [issue
#515](https://github.com/mento-protocol/frontend-monorepo/issues/515). It does
not change deployment ownership by itself. The ownership boundary and its
trade-offs are recorded in
[ADR 0001](adr/0001-github-actions-vercel-deployment-orchestration.md). Until the
later cutover issues ship, the Vercel Git integration remains the deployment
owner for paths not explicitly cut over.

## Pinned prerequisites

- Vercel CLI: exactly `56.2.0` in the root `devDependencies`. The project owner
  approved the dependency as part of delivering the epic. The stable npm version
  was re-queried on 2026-07-14 before it was pinned.
- Resolved Next.js: `16.2.10` in `pnpm-lock.yaml`.

Both exceed Vercel's custom deployment-ID prerequisites: Next.js newer than
`16.2.0-canary.15` and Vercel CLI newer than `50.3.3`. Verify this invariant
without contacting Vercel:

```bash
pnpm vercel:versions:check
```

Do not replace the pinned CLI with `npx vercel@latest` in automation.

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
documentation and test-only paths return an empty deployment list.

### Trusted-base execution

The planner imports only Node.js built-ins. A pull-request workflow must read
the planner from the trusted base commit and execute that copy against the
checked-out head, for example:

```bash
git show "$BASE_SHA:scripts/plan-vercel-deployments.mjs" > "$RUNNER_TEMP/plan-vercel-deployments.mjs"
node "$RUNNER_TEMP/plan-vercel-deployments.mjs" \
  --base "$BASE_SHA" \
  --head "$HEAD_SHA" \
  --repo "$GITHUB_WORKSPACE"
```

Never import classifier code from the pull-request head into this trusted
planner process. Fetch enough history to resolve both exact commits before
calling it. A missing base is a full-deploy plan, not an empty plan.

## Custom Next.js deployment IDs

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
  --output .vercel/output
```

The assertion reads `.vercel/output/config.json` and fails when `deploymentId`
is missing or different. Next.js first writes the custom ID to its
`routes-manifest.json`; the pinned Vercel CLI carries that value into the final
Build Output API `config.json` that `--prebuilt` uploads. `vercel deploy
--prebuilt` must upload that exact, unchanged `.vercel/output` directory in the
same job. Do not regenerate the ID, rebuild, transfer an unverified artifact, or
pass an invented deployment-ID option to `vercel deploy`.

## Build-environment contract

Vercel system variables are injected on Vercel's builders, but a local
`vercel build` used for a prebuilt deployment does not receive those platform
values automatically. The future workflow must restore the following safe
constants before validating and building:

| Deployment environment | `VERCEL_ENV` | `VERCEL_TARGET_ENV` | `NEXT_PUBLIC_VERCEL_ENV` |
| ---------------------- | ------------ | ------------------- | ------------------------ |
| Standard preview       | `preview`    | `preview`           | `preview`                |
| Production             | `production` | `production`        | `production`             |
| App custom `v3`        | `preview`    | `v3`                | `preview`                |

The app's `main` deployment must keep the `v3` row. In particular, it must not
turn on production Sentry source-map behavior while `VERCEL_ENV` remains
`preview`. The legacy app `v2` branch remains Vercel Git's production target and
is outside the custom-CI migration.

The repository's Vercel-system-variable reads are deliberately limited:

- `VERCEL_ENV` controls Sentry source-map upload in the app, governance, and
  reserve Next.js configurations; labels server/edge Sentry events in those
  apps; and selects preview CSP behavior in `scripts/security-headers.mjs`.
- `NEXT_PUBLIC_VERCEL_ENV` labels browser Sentry events in app, governance, and
  reserve; selects production network behavior in `packages/web3`; and is a
  required governance client variable used by proposal rendering.
- `VERCEL_TARGET_ENV` is not read directly by application source. The Vercel
  CLI's `--target v3` option selects the custom target; setting
  `VERCEL_TARGET_ENV` does not select it. The workflow restores this variable
  only to reproduce the system semantics Vercel's builder would inject and to
  prevent `v3` from being mistaken for standard preview or production
  semantics.
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

`PROJECT_DIRECTORY` must be the same app directory used by `vercel pull` and
`vercel build` (for example, `apps/ui.mento.org`). The checker loads
`$PROJECT_DIRECTORY/.vercel/.env.<environment>.local`, then overlays explicit
workflow constants and scoped GitHub secrets so they take precedence. A missing
or invalid pulled file fails closed. The checker prints variable names on
failure but never values. Its machine-readable inventory is available directly:

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
| app        | `NEXT_PUBLIC_STORAGE_URL`               | preview, `v3`, production | `vercel-pull`              |
| app        | `NEXT_PUBLIC_WALLET_CONNECT_ID`         | preview, `v3`, production | `vercel-pull`              |
| app        | `NEXT_PUBLIC_SENTRY_DSN_SWAP`           | preview, `v3`, production | `vercel-pull`              |
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

The code also has optional build-time reads that alter behavior only when set:
RPC overrides (`NEXT_PUBLIC_RPC_URL`, chain-specific RPC variables), feature and
test flags (`NEXT_PUBLIC_ENABLE_DEBUG`, `NEXT_PUBLIC_E2E_TEST`,
`NEXT_PUBLIC_USE_FORK`, `NEXT_PUBLIC_SANCTIONS_TEST_MODE`), banner values,
`NEXT_PUBLIC_VERSION`, and Governance's optional Celo Sepolia Blockscout URL.
These are pulled when they exist but are not missing-build failures.
`CHAINALYSIS_API_KEY` is optional in the app schema and is not a prebuilt-build
prerequisite.

### Required GitHub secret mirrors from issue #517

- Repository secret `ETHERSCAN_API_KEY`: governance trusted previews only.
- `vercel-cli-production` environment secret `ETHERSCAN_API_KEY`: governance
  production build step only.
- `vercel-cli-production` environment secret `SENTRY_AUTH_TOKEN`: expose only
  to the governance or reserve production build step that consumes it. If app
  production is ever migrated separately, scope it to that app step as well.
- Standard previews and app `v3`: no `SENTRY_AUTH_TOKEN`.

`vercel-cli-production` is the dedicated GitHub deployment environment for this
migration. Do not modify or reuse the generic pre-existing `Production`
environment, which belongs to Vercel's GitHub integration. The Vercel target
name `production` in commands and build semantics is unchanged.

If an existing secret has the correct name, value, and scope, reuse it. Values
are maintainer-entered. Automation must not discover, export, recover, or print
them, and a Vercel Sensitive value must never be assumed to appear in
`vercel pull` output.

## Tests

The primitive suite has no network or Vercel dependency:

```bash
pnpm vercel:primitives:test
```

It also runs near the start of the canonical root `pnpm test` command, after the
offline ADR-reminder tests. The suite covers app/package graph fixtures,
fail-closed cases, output ordering, every deployment-ID constraint,
prebuilt-config matching, prerequisite versions, all target/environment
classifications, and redaction-safe missing-variable errors.

This foundation issue performs no Vercel API call, build upload, deployment,
alias mutation, environment mutation, or Git-ownership change.

## Cost validation preparation

The network-free analyzer and private/public evidence boundary for the final
build-minute observation are documented in
[Vercel build-minute validation](vercel-cost-validation.md). Preparing that
tool does not start the observation window; collection begins only after the
four-target cutover is complete.

## Manual UI prebuilt pilot

`.github/workflows/vercel-prebuilt-pilot.yml` is the only entry point for the
first prebuilt preview. It has only a manual `workflow_dispatch` trigger and
accepts exactly three selectors: the fixed `ui` target, an immutable lowercase
40-character commit SHA, and the same-repository branch that contains that SHA.
It does not replace or disable the Vercel Git integration. Native Vercel Git
previews remain the source of truth while this pilot gathers functional and
timing evidence.

The caller maps only the UI preview configuration:

- repository variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_UI`, and
  `TURBO_TEAM`;
- repository secrets `VERCEL_TOKEN_PREVIEW`, `TURBO_TOKEN`, and
  `TURBO_REMOTE_CACHE_SIGNATURE_KEY`.

The reusable worker declares each secret separately. It never inherits all
caller secrets, never receives a production Vercel token, never selects a
production GitHub environment, and never passes a token on a command line. The
separate smoke job receives no Vercel or Turbo credential and has only
`contents: read` permission; the immutable preview must therefore be publicly
reachable for this pilot.

### Dispatch

This is a privileged maintainer action, not an automatic PR trigger. Dispatch
only after reviewing the selected SHA and accepting its same-repository author
as trusted: dependency installation and the UI build execute that source with
the pulled UI preview variables and signed Turbo cache credentials. The
candidate process never receives the Vercel token, but it can read its own
build inputs and execute arbitrary build code. Fork sources cannot be selected,
and the workflow rejects Dependabot branches. If the source is not trusted, do
not dispatch the pilot.

The dispatch is accepted only from `refs/heads/main`. The caller invokes the
reusable worker from the same main commit, and the worker validates the caller
workflow identity again before any candidate code or credentialed step runs. A
dispatch that selects another branch or tag is rejected before the reusable
job receives its preview credentials.

Choose a SHA that already has a native Vercel Git UI preview and a branch that
contains it. Verify both locally before dispatching:

```bash
SHA="<lowercase-40-character-sha>"
BRANCH="<same-repository-branch>"
git check-ref-format --branch "$BRANCH"
git fetch --no-tags origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git merge-base --is-ancestor "$SHA" "refs/remotes/origin/$BRANCH"
gh workflow run vercel-prebuilt-pilot.yml \
  --ref main \
  -f target=ui \
  -f commit_sha="$SHA" \
  -f git_branch="$BRANCH"
```

The workflow independently rejects malformed, option-like, newline-bearing,
missing, or unreachable refs. It checks out the exact SHA with full history and
uses the recorded `HEAD` for the custom Next deployment ID, Vercel metadata,
GitHub Deployment ref, smoke evidence, and outputs.

Do not dispatch from a pull-request ref. After the main-only guard, the workflow
controller is checked out from the trusted `github.workflow_sha`; the requested
source is checked out separately and is never executed automatically with
preview credentials. Candidate dependency lifecycle scripts are disabled. The
worker also restores the controller from its trusted workflow SHA after
dependency installation and again after the candidate build, before upload and
inspection.

The Vercel CLI is a separate trusted tool install. Pinned pnpm `10.24.0` reads
the main controller's exact `package.json` and frozen `pnpm-lock.yaml`, disables
lifecycle scripts, and copies packages into a runner-owned directory outside
the checkout. Its `--modules-dir` and `--virtual-store-dir` values are validated
relative paths from the controller to that directory; pnpm treats an absolute
`--modules-dir` as project-relative and would otherwise materialize the CLI at
the wrong path. The zero-network fixture requires the already-hydrated package
store with `--offline`; it cannot contact the registry to repair missing data.
Before any credentialed command, the worker proves the CLI
resolves inside the protected directory, its package version is exactly
`56.2.0`, the candidate UID cannot write it, and `node <cli> --version`
executes successfully. The workflow test suite repeats this with the actual
pinned pnpm install in a temporary checkout while retaining a frozen-lockfile
failure boundary.

The candidate dependency install intentionally does **not** reuse setup-node's
writable pnpm store. Its isolated `HOME` and XDG directories place that store
under the disposable candidate home, which is deleted before upload. Sharing a
runner store here would let selected source code mutate cache state that an
Actions post-step could save from the trusted `main` run. Treat candidate
dependency installation as a cold, measured pilot cost; record its duration
separately from `vercel build`. The signed Turbo remote build cache remains
enabled and its hit/miss evidence remains part of the comparison.

Before candidate installation, the worker proves the checked-out index tree is
the exact selected commit tree, then materializes only that index with
`git checkout-index` into the isolated candidate root. It deliberately does not
use `git archive`: candidate-controlled `export-ignore` and `export-subst`
attributes must not omit files or rewrite bytes in the selected source.

### Root Directory and command sequence

The pinned Vercel CLI commands execute from monorepo-shaped roots. Before
`vercel pull`, the worker creates a fresh runner-owned staging tree at a fixed
path under `RUNNER_TEMP`. That tree contains only real
`apps/ui.mento.org` directory components and an ephemeral repo-level link built
from trusted repository variables; it contains no checked-out candidate file.
This lets CLI `56.2.0` resolve the configured UI Root Directory without giving
the token-bearing pull command a candidate-controlled write path. The pulled
mapping and project-local state are:

```text
.vercel/repo.json
apps/ui.mento.org/.vercel/project.json
apps/ui.mento.org/.vercel/.env.preview.local
apps/ui.mento.org/.vercel/output/
```

The repo link contains only the organization ID, project ID, `origin` remote
name, and `apps/ui.mento.org` directory mapping; it contains no token or
environment value. After pull, the worker recursively requires the staging
tree to contain exactly the expected directories and three regular files
(`repo.json`, `project.json`, and `.env.preview.local`), all runner-owned,
single-linked, size-bounded, and inaccessible to other users. It rejects
symlinks, hardlinks, special nodes, extra entries, unsafe ownership, and unsafe
permissions. With the candidate UID stopped, a trusted root helper removes any
candidate-provided `.vercel` paths and copies only those three files into new
candidate-owned directories. Before that copy, the worker validates the UI
preview build-variable contract directly against the runner-owned staging
tree. After the copy, clean-environment trusted root helpers validate the exact
candidate-owned tree and read only the non-secret repo/project mapping: first
after staging, again with exact-SHA provenance immediately before build, and
once more for the project/output contract after the candidate build has been
stopped. These helpers may traverse and `lstat` the candidate-owned `0700` /
`0600` state, but they never parse the candidate copy of
`.env.preview.local`; environment values are parsed only from the runner-owned
staging tree. The internal `validate-candidate-pull` controller action exists
for this privileged check and is not an operator-facing command. The
controller validates the ID variables but deliberately withholds them from the
Vercel CLI child process: CLI `56.2.0` otherwise gives those variables
precedence over `repo.json` and loses the monorepo Root Directory mapping.

The credentialed worker runs this sequence in one standard `ubuntu-latest`
job:

1. create the fresh runner-owned pull staging and exact repo-level UI link;
2. run `vercel pull --yes --environment preview --git-branch
<validated-branch>` only inside that staging tree;
3. recursively validate the pulled tree;
4. run the equivalent of `pnpm vercel:env:check --target ui --environment
preview --project-directory "$RUNNER_TEMP/mento-vercel-pull-staging/apps/ui.mento.org"`
   against that runner-owned tree, with explicit preview system constants
   overriding pulled values;
5. copy only the three required files into freshly created candidate `.vercel`
   directories, then use the trusted privileged controller to prove their
   exact ownership, permissions, shape, and project mapping while the candidate
   UID has no process;
6. immediately before build, repeat the trusted privileged exact-SHA
   provenance, candidate-tree, and project-mapping checks;
7. `vercel build --yes --target preview` as the isolated candidate UID with the
   signed Turbo remote cache, immutable Git metadata, and generated
   `MENTO_NEXT_DEPLOYMENT_ID`;
8. stop all candidate-UID processes, then use the trusted privileged controller
   to assert the UI project mapping, Build Output API v3 config, custom
   deployment ID, preview target, pinned CLI build record, output ownership,
   and runner-owned exact-SHA provenance;
9. create a runner-owned upload handoff containing only the validated output,
   trusted project settings, repo link, and exact-SHA provenance;
10. `vercel deploy --prebuilt --target preview --archive=tgz --format=json`;
11. `vercel inspect --wait --timeout 5m --format=json --scope <org-id>`. The
    explicit scope prevents inspection from falling back to the token owner's
    default Vercel team.

Only after that job emits the verified immutable URL does a second trusted job
perform direct HTTP smoke of the URL, navigation, custom build identity,
representative JS/CSS/font assets, and preview security headers. That smoke job
checks out only `github.workflow_sha`; it never checks out or executes the
deployment source, downloads an executable artifact, or receives a
Vercel/Turbo/protection-bypass credential. A third always-run trusted job owns
the terminal GitHub Deployment status.

The upload command supplies `githubCommitOrg`, `githubCommitRepo`,
`githubCommitSha`, and `githubCommitRef`. It intentionally omits
`githubDeployment=1`, so Vercel cannot create a duplicate GitHub Deployment.
The build output never becomes a GitHub artifact and never crosses jobs.

### Canonical GitHub Deployment

The worker owns one explicit REST Deployment for the exact SHA. It uses only
`contents: read` and `deployments: write`; no job-level Actions environment is
declared, so GitHub does not create an implicit event-SHA Deployment. The create
request uses `auto_merge: false`, empty required contexts, the deterministic
`vercel-preview-ui` environment, and transient/non-production flags.

The run-scoped pilot key is:

```text
vercel-pilot:v1:ui:sha:<sha>:run:<run_id>:attempt:<run_attempt>
```

Retries with that exact key reuse the existing record. A deliberate workflow
rerun has a different attempt key and creates a new pilot attempt. Only
non-secret provenance is stored in the payload.

Statuses progress through `queued` and `in_progress`. `success` is posted with
the immutable Vercel `environment_url` and Actions `log_url` only after direct
smoke passes. Build, deploy, or smoke failures post `failure`; cancellation or
controller/infrastructure failures post `error`. The `if: always()` lifecycle
job closes any record that did not reach success. It is independent of
best-effort timing and run-summary steps, so a metrics failure cannot overwrite
a verified deployment's lifecycle truth. The reusable workflow publishes
`deployment_url` only from the smoke-backed success step; it never falls back
to the unverified upload output.

A Deployment or status created with the repository `GITHUB_TOKEN` does not
trigger another workflow run. Therefore `.github/workflows/preview-smoke.yml`
will not recurse for this pilot. Direct smoke in the reusable worker is the
required success gate. Do not add a PAT to force `deployment_status` recursion.

### Evidence and browser verification

The run summary records the exact SHA, immutable URL, Vercel Deployment ID,
GitHub Deployment ID, build duration, upload duration, and total controller
duration. Turbo prints remote-cache hit/miss evidence in the build log. Compare
those values with the same-SHA native Vercel Git preview, but do not infer
billing savings from elapsed time alone.

Before treating the pilot as accepted, follow the repository browser protocol
on the immutable GitHub-built URL: verify page rendering and primary
navigation, inspect console errors and failed network requests, confirm static
assets/fonts, and compare security headers plus the Vercel toolbar/CSP behavior
with the native preview. Attach the URL and concise evidence to the PR or issue.

The final automatic cutover remains blocked on the cost go/no-go evidence in
issue #518: machine tiers, On-Demand Concurrent Builds state, actual billed
usage/contracted MIUs, GitHub public-repository runner treatment, and a
conservative monthly estimate.

### Cleanup

After evidence is saved, a maintainer may remove only the pilot's immutable
preview using the preview-scoped CLI credential:

```bash
export VERCEL_TOKEN="<preview-scoped-token>"
pnpm exec vercel remove "<immutable-vercel-deployment-url-or-id>" --yes
```

Confirm the value is the unique pilot URL or `dpl_` ID from the run summary.
Never pass a production domain or alias, and do not change Vercel Git settings.

The complete zero-network pilot/controller suite is:

```bash
pnpm vercel:workflow:test
```
