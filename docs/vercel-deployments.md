# Vercel deployments from GitHub Actions

This runbook documents the repository-owned planning, build, and automatic UI
preview controller used by the GitHub Actions deployment migration tracked in
[issue #515](https://github.com/mento-protocol/frontend-monorepo/issues/515).
The ownership boundary and its trade-offs are recorded in
[ADR 0001](adr/0001-github-actions-vercel-deployment-orchestration.md).
Phase A enables GitHub-built previews for trusted same-repository UI pull
requests while native Vercel Git UI previews remain enabled for canary
comparison. Production/main and every non-UI application remain owned by Vercel
Git. Phase B changes only UI branch-preview ownership after the live canaries in
this runbook pass.

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

The planner imports only Node.js built-ins, but its affected-package query uses
the trusted base's pinned Turbo dependency graph. The automatic controller
first checks out the immutable `github.workflow_sha` with full history. It then
requires the exact trusted base to be an ancestor of that workflow commit before
materializing it, fetches the candidate only as an inert Git object, installs
trusted-base dependencies without lifecycle scripts, and executes the base's
planner. Dependency caching is disabled in these planner jobs so they never
restore or save a shared Actions cache across this trust boundary:

```bash
git merge-base --is-ancestor "$BASE_SHA" "$WORKFLOW_SHA"
git checkout --detach "$BASE_SHA"
git fetch --force --no-tags origin "$HEAD_SHA"
pnpm install --ignore-scripts --frozen-lockfile
node scripts/plan-vercel-deployments.mjs \
  --base "$BASE_SHA" \
  --head "$HEAD_SHA"
```

Never check out or import classifier code from the pull-request head into this
trusted planner process. Fetch enough history to resolve both exact commits
before calling it. A missing base is a full-deploy plan, not an empty plan.

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

The ADR, primitive, reusable-workflow, and automatic-preview suites have no
network or Vercel dependency:

```bash
pnpm adr:check:test
pnpm vercel:primitives:test
pnpm vercel:workflow:test
pnpm vercel:preview:test
```

They are stages near the start of the canonical root `pnpm test` command. The
suites cover app/package graph fixtures, fail-closed cases, output ordering, every
deployment-ID constraint, prebuilt-config matching, prerequisite versions, all
target/environment classifications, and redaction-safe missing-variable errors.

The test commands perform no Vercel API call, build upload, deployment, alias
mutation, environment mutation, or Git-ownership change.

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

The reusable contract accepts only `refs/heads/main` and the exact main-branch
pilot caller identity. A dispatch that selects another branch, tag, or caller is
rejected before candidate dependency or build code executes.

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
dependency installation and again after the candidate build, before output
assertion, upload, and inspection.

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
the exact selected commit tree. Before any candidate process starts, it
normalizes `RUNNER_TEMP` to runner-owned `0711` permissions and proves the
candidate UID cannot write that parent. A trusted, bounded materializer then
lists the exact commit with `git ls-tree`, reads every raw blob with
`git cat-file`, and writes only supported regular files and symbolic links into
a fresh fixed child path that is subsequently handed to the candidate UID. It
rejects unsafe paths, unsupported modes (including gitlinks), oversized trees,
and filesystem collisions. Reading raw objects deliberately bypasses both
archive attributes (`export-ignore` and `export-subst`) and checkout filters
(`eol`, `ident`, and custom filters), so the candidate always receives the
selected commit's stored bytes.

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

The final UI Git-ownership cutover remains blocked on the cost go/no-go evidence
in issue #518 and the Phase A live canaries below.

## Automatic trusted UI previews (Phase A)

`.github/workflows/vercel-preview-controller.yml` is the only automatic event
controller. It runs trusted default-branch code for `pull_request_target`
`opened`, `edited`, `synchronize`, `reopened`, and `closed` (with `edited`
limited to base-branch changes before any snapshot or write); receives
completed `Vercel Preview Worker` callbacks; and accepts the default-branch-bound
`vercel-preview-bootstrap` and `vercel-preview-reconcile` repository events for
one validated PR number. The controller has no Vercel/Turbo credential and no
write-token job checks out or executes PR code.

Dependabot is intentionally split out before any write boundary.
`.github/workflows/vercel-preview-intake.yml` receives the same PR activities
with only `contents: read`, performs metadata validation without a checkout,
artifact, secret, or PR-code execution, and encodes the PR number, exact head
SHA, and action in its strict run name. A completed-intake `workflow_run` then
starts trusted default-branch controller code with a write-capable token. That
follow-up validates the intake workflow identity, re-queries the PR, and posts
the successful preview-disabled status only when the PR is still open, still
Dependabot-owned/ref-classified, and still on the encoded exact SHA. Stale or
malformed callbacks write nothing.

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

Every controller-owned event is first written as an immutable bot comment;
Dependabot uses the separate credentialless intake contract above.
Reconciliation is lossy/replaceable, but it always reconstructs from event,
selection, and completed-worker receipts, current PR lifecycle evidence, and
the one bounded mutable state comment. Before dispatch, the controller writes
an immutable selection receipt. That receipt binds the selected SHA to the
controller epoch and compactly lists intermediate receipt IDs coalesced into
the durable later selection, so a long push burst does not require scanning all
historical workflow runs or Deployments. Intended-run crash recovery queries a
fixed `created` window around the persisted dispatch timestamp; older lifetime
run history cannot exhaust its proof bound, while multiple matching runs inside
the window fail closed. Its rendered terminal history remains bounded, while
compact key digests retain ownership for every still-accepted current-epoch
result receipt. A synchronize receipt plans the event's exact `before -> head`
transition with planner code and dependencies from the immutable trusted base;
it does not repeatedly compare the PR base to head. A base-retarget `edited`
receipt starts a new same-head epoch and replans the new base-to-head transition.
Title, body, label, and other unrelated edits do not create a receipt or
reconciliation.

`Vercel Preview` is reserved for a Statuses API commit status, not a workflow
job/check name. Every exact receipt SHA gets one truthful result: pending,
verified, no runtime impact, runtime-equivalent to a prior preview, unsupported
trust boundary, durably coalesced, failure, or controller error. Detailed
PR/SHA/key/run/Deployment evidence remains in the bot comments because status
descriptions are bounded.

For each open/reopen/base-retarget/bootstrap epoch, the oldest receipt that
actually affects the UI is `first_eligible_sha`. It always runs first. An
identical bootstrap aliases an existing lifecycle anchor instead of creating a
second epoch. While that worker is queued/running, later runtime pushes replace
only `latest_desired_sha`; when the first worker terminates, only that latest
SHA runs. Documentation/test-only pushes never replace the desired runtime SHA.
After a verified runtime preview, a later non-runtime SHA succeeds by linking
to that runtime-equivalent immutable preview without rebuilding.

Each selected transition is bound to its lifecycle epoch, canonical
reconciliation-basis digest, immutable receipt run, and the exact controller
`github.workflow_sha` authorized to supply the worker implementation. The
authorized worker SHA is persisted as `expected_workflow_sha` and participates
in the selection key digest. Repeated A -> B -> A transitions, close/reopen
cycles at the same SHA, duplicate callbacks, controller upgrades, and
out-of-order event runs therefore remain distinct. An old-epoch worker may
terminalize its own Deployment and write its own receipt, but it cannot update
current-epoch state/status or schedule work.

Operator recovery queries the exact persisted worker attempt instead of the
latest rerun. If a retired old-epoch attempt is missing or fails identity
validation, the controller records a bounded recovery quarantine on that
retired selection and continues current-epoch reconciliation without posting a
current-head controller error. Transient retired-attempt API or evidence-write
failures remain unquarantined and retry on the next reconciliation, also
without changing the current-head status. A recovery ambiguity for the current
active selection still fails closed.

### Durable dispatch and exact Deployment identity

The reconciler writes `dispatch_state=intended`, including
`expected_workflow_sha`, and rereads it before dispatch. It then queries up to
three times for a matching worker run by strict `workflow_run.display_title`.
A title match is not enough: its `head_sha` must equal the persisted authorized
workflow SHA. One valid match is attached and multiple exact matches fail
closed. A full-envelope-valid wrong-SHA artifact is never allowed to own the
intent; all other name, event, ref, path, title, attempt, and URL mismatches also
fail closed.

Zero matches dispatches `.github/workflows/vercel-preview-worker.yml` on `main`
using the HTTP 200 `return_run_details` API contract only while the executing
controller's own workflow SHA still equals the persisted intent. The returned
run is re-queried and its `head_sha` must equal `expected_workflow_sha`, in
addition to matching the literal workflow path (either the bare path or
GitHub's documented `@main` suffix), `workflow_dispatch` event, default ref,
attempt, PR, target, candidate SHA, and epoch-bound key digest, before state
becomes `dispatched`. If `main` advances between intent persistence and
dispatch, recovery may attach an already-created worker at the old authorized
SHA, but a newer controller/worker version cannot satisfy or redispatch that
old intent. A worker resolved from the newer `main` SHA fails its credentialless
preflight. The controller records an immutable
`controller-workflow-upgraded-before-dispatch` error result, and that worker's
completion callback causes the current controller to reselect the same desired
receipt under its own workflow SHA. The new key therefore advances
automatically without ever pretending that new workflow code fulfilled the
retired intent.

The canonical Deployment key and environment are:

```text
vercel-preview:v1:pr:<number>:target:ui:sha:<40-hex-sha>
preview/ui/pr-<number>
```

The explicit REST Deployment uses the exact SHA, `auto_merge: false`, empty
required contexts, and transient/non-production flags. No Actions environment
is declared and Vercel metadata omits `githubDeployment=1`, so neither GitHub
nor Vercel creates an implicit duplicate Deployment.

The credential-free worker receives `expected_workflow_sha` as an explicit
dispatch input and first compares it with the actual
`${{ github.workflow_sha }}`. Only then does validation re-read the open PR,
exact SHA ancestry, bot-owned active state, and canonical Deployment. The
evidence writer repeats the immutable-SHA comparison and persists that SHA in
non-terminal and terminal receipts. A mismatch fails before any build or
deployment credential is reachable. A separate trusted preflight prints only
missing repository variable/secret names. The literal UI reusable caller
receives only `VERCEL_TOKEN_PREVIEW`, `TURBO_TOKEN`, and
`TURBO_REMOTE_CACHE_SIGNATURE_KEY`, plus `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID_UI`, and `TURBO_TEAM`. The direct smoke/resume jobs receive no
deployment credential.

The worker is dispatched on `main`, and the reusable contract requires both
`refs/heads/main` and the exact main-branch `vercel-preview-worker.yml` caller
identity. Candidate dependency lifecycle scripts are disabled. The trusted
controller is restored from `github.workflow_sha` after dependency installation
and after the candidate build; pinned-version and build-output assertions,
upload, inspection, and lifecycle writes therefore run the restored controller.

Lifecycle is `queued -> in_progress -> success|failure|error`. Success and the
public `environment_url` exist only after exact-SHA/ID verification and direct
UI smoke. Every initial or resumed credential-free smoke attempt keeps the
HTTP/header/static-asset checks, then uses the trusted main-branch smoke
controller with Playwright and the GitHub runner's system Chrome to render the
showcase, search and navigate to a second route, change a form control, and fail
on page/console errors or failed same-origin requests and responses. Its
dependency graph comes from the trusted workflow checkout, candidate lifecycle
scripts stay disabled, and no Vercel or Turbo credential is present in the
smoke job. The worker records a durable non-terminal upload evidence receipt;
the completed-run recovery re-queries the run, Deployment, and statuses before
writing the terminal result receipt. Cancellation before Deployment creation
creates/reuses the canonical Deployment and immediately closes it as `error`.

Retry behavior is bounded and serialized:

- an existing verified success is absorbing and never rebuilds;
- a verified upload whose smoke failed retries smoke once against the same URL;
- a build failure before the durable upload-attempt boundary may rebuild once;
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

Before `Vercel Preview` becomes required, inventory every already-open PR and
bootstrap each trusted same-repository PR that should participate. A lone
synchronize receipt deliberately waits for an opened/reopened/bootstrap anchor.
Repeated semantically identical bootstrap requests are idempotent, and a
bootstrap identical to an existing lifecycle anchor aliases that anchor;
conflicting lifecycle or planning evidence still fails closed.

```bash
gh pr list --state open --limit 100 --json number,headRepository,headRefName,author

PR_NUMBER="<pr-number>"
gh api --method POST \
  repos/mento-protocol/frontend-monorepo/dispatches \
  -f event_type=vercel-preview-bootstrap \
  -F "client_payload[pr_number]=$PR_NUMBER"
```

For a durable receipt/state that only needs another reconciliation pass:

```bash
PR_NUMBER="<pr-number>"
gh api --method POST \
  repos/mento-protocol/frontend-monorepo/dispatches \
  -f event_type=vercel-preview-reconcile \
  -F "client_payload[pr_number]=$PR_NUMBER"
```

Do not bootstrap a closed PR, invent an opened event, mutate bot receipts, or
re-dispatch the worker directly. Missing repository names must be provisioned by
a maintainer; automation may check presence but must never retrieve, export,
reconstruct, or print credential values.

### Phase A canary evidence template

Keep native Vercel Git UI previews enabled. For every canary, record the PR,
exact SHA(s), controller/worker run URLs, controller key/digest, canonical
GitHub Deployment ID, GitHub-built immutable URL, native Vercel immutable URL,
terminal `Vercel Preview` status, and browser evidence.

Verify all of these before changing the ruleset or starting Phase B:

1. trusted UI-affecting A produces both native and GitHub previews;
2. rapid UI pushes A -> B -> C deploy A then C, with B durably coalesced;
3. a docs-only PR creates no Deployment and succeeds as no-runtime;
4. a docs-only push after runtime work reuses the prior immutable URL;
5. after the controller is idle, a later UI-runtime SHA E deploys normally;
6. replaying an event, reconciliation request, and terminal callback is
   idempotent: it creates no second worker, GitHub Deployment, Vercel preview,
   receipt, or conflicting status;
7. fork and Dependabot PRs succeed unsupported without a Deployment/worker,
   with Dependabot proven through the credentialless intake and trusted exact-head follow-up;
8. a controlled build/smoke failure posts terminal failure and bounded retry;
9. cancelling a worker before Deployment creation produces one canonical
   `error` Deployment/result and advances the latest desired SHA;
10. close/reopen and a force-reset SHA revisit preserve distinct epochs;
11. one old-epoch callback terminalizes only its own evidence;
12. representative strict-ruleset merges still work.

For the GitHub-built immutable URL, follow the repository browser protocol:
verify rendering and primary navigation, inspect console errors and failed
network requests, confirm JS/CSS/font assets, and compare security headers plus
Vercel toolbar/CSP behavior with the native preview. A canary is not accepted
from workflow logs alone.

Only after successful deploy, no-runtime, runtime-reuse, coalesced, after-idle,
idempotent replay/reconcile, unsupported-trust, failure, cancellation, and
old-epoch evidence is recent may the ruleset require the Statuses API
`Vercel Preview` context.

## UI Vercel Git cutover (Phase B)

Phase B must be a separate merge after Phase A canaries pass. Change only
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

Vercel treats any matching `true` as enabled, so `main` remains native even
though it also matches `**`. Use a fresh/main-rebased UI canary containing this
configuration. Prove one canonical GitHub Deployment, one Vercel preview, no
native branch preview, a truthful required status, and an unchanged native
merge/main deployment. Inventory pre-cutover open branches and require them to
rebase/merge `main` before using them as duplicate-prevention evidence.

Rollback changes that same file exactly to:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": {
      "dependabot/**": false
    }
  }
}
```

Merge the rollback normally, use a fresh UI canary to prove native previews
return, and remove/leave non-required the `Vercel Preview` ruleset context until
the controller is repaired. Do not change production domains, other apps, or
recreate Governance QA.

### Cleanup

After evidence is saved, a maintainer may remove only the pilot's immutable
preview using the preview-scoped CLI credential:

```bash
export VERCEL_TOKEN="<preview-scoped-token>"
pnpm exec vercel remove "<immutable-vercel-deployment-url-or-id>" --yes
```

Confirm the value is the unique pilot URL or `dpl_` ID from the run summary.
Never pass a production domain or alias, and do not change Vercel Git settings.

The complete zero-network pilot and automatic-preview suites are:

```bash
pnpm vercel:workflow:test
pnpm vercel:preview:test
```
