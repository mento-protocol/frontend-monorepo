# Vercel deployments from GitHub Actions

This runbook documents the repository-owned planning, build, and automatic
four-target preview controller used by the GitHub Actions deployment migration tracked in
[issue #515](https://github.com/mento-protocol/frontend-monorepo/issues/515).
The ownership boundary and its trade-offs are recorded in
[ADR 0001](adr/0001-github-actions-vercel-deployment-orchestration.md).
The v2 controller builds App, Governance, Reserve, and UI independently from one
target-ordered plan. Reserve and UI branch-preview ownership is GitHub-only.
App and Governance remain in shadow mode: GitHub builds run alongside their
native Vercel Git previews until each target completes its own canary and a
separate atomic ownership cutover. The Reserve configuration change is not an
accepted live cutover until the merge and post-merge canary gates in
[Reserve Vercel Git cutover](#reserve-vercel-git-cutover) pass. Vercel Git
continues to own every main and production deployment.

The automatic controller's version-controlled
`VERCEL_PREVIEW_CONTROLLER_MODE` is `active` in this ownership state. The only
other accepted value is `observe-only`, which records receipts, recovers or
retires already-persisted dispatch ownership, and publishes a truthful
no-dispatch status but cannot create a worker. The canonical target order,
workspace/root/project mapping, exact native/GitHub `vercel.json` shapes, and
per-target `shadow` or `github` mode live together in
`scripts/vercel-preview-targets.mjs`. The workflow topology, runtime ownership
guards, and ownership tests import or structurally verify that source; do not
copy a second ownership table into executable code.

## Pinned prerequisites

- Vercel CLI: exactly `56.2.0` in the root `devDependencies`. The project owner
  approved the dependency as part of delivering the epic. The stable npm version
  was re-queried on 2026-07-14 before it was pinned.
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
never values. Its machine-readable inventory is available directly:

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
These are not part of the prebuilt candidate environment unless they are added
to the reviewed inventory above with `ciClassification: vercel-pull`; raw
unknown values are intentionally omitted rather than passed through. They are
not missing-build failures.
`CHAINALYSIS_API_KEY` is optional in the app schema and is not a prebuilt-build
prerequisite.

### Required GitHub secrets

The following Vercel build-value mirrors come from issue #517:

- Repository secret `ETHERSCAN_API_KEY`: governance trusted previews only.
- `vercel-cli-production` environment secret `ETHERSCAN_API_KEY`: governance
  production build step only.
- `vercel-cli-production` environment secret `SENTRY_AUTH_TOKEN`: expose only
  to the governance or reserve production build step that consumes it. If app
  production is ever migrated separately, scope it to that app step as well.
- Standard previews and app `v3`: no `SENTRY_AUTH_TOKEN`.

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
current version-controlled map cuts Reserve over to GitHub ownership while App
and Governance remain shadowed.

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

## Historical Phase A manual UI prebuilt pilot (audit record)

> **Historical evidence only.** This section preserves the Phase A pilot's
> controls and native-preview comparison procedure for audit. It is not a
> current operator entry point: under Phase B, do not dispatch the manual pilot
> or expect a same-SHA native UI branch preview. Current operators must use the
> [Phase B canary and rollback procedures](#ui-vercel-git-cutover-phase-b).
> The commands and implementation details below are retained only as audited
> Phase A evidence and must not be treated as a supported Phase B procedure.

During Phase A, `.github/workflows/vercel-prebuilt-pilot.yml` was the only entry
point for the first prebuilt preview. It had only a manual `workflow_dispatch`
trigger and accepted exactly three selectors: the fixed `ui` target, an
immutable lowercase 40-character commit SHA, and the same-repository branch
that contained that SHA. It did not replace or disable the Vercel Git
integration. Native Vercel Git previews remained the source of truth while the
pilot gathered functional and timing evidence.

The Phase A caller mapped only the UI preview configuration:

- repository variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_UI`, and
  `TURBO_TEAM`;
- repository secrets `VERCEL_TOKEN_PREVIEW`, `TURBO_TOKEN`, and
  `TURBO_REMOTE_CACHE_SIGNATURE_KEY`.

The reusable worker declared each secret separately. It never inherited all
caller secrets, received a production Vercel token, selected a production
GitHub environment, or passed a token on a command line. The separate smoke job
received no Vercel or Turbo credential and had only `contents: read` permission;
the immutable preview therefore had to be publicly reachable for the pilot.

The reusable contract accepted only `refs/heads/main` and the exact main-branch
pilot caller identity. A dispatch selecting another branch, tag, or caller was
rejected before candidate dependency or build code executed.

### Historical Phase A dispatch procedure

This was a privileged maintainer action, not an automatic PR trigger. Phase A
maintainers dispatched only after reviewing the selected SHA and accepting its
same-repository author as trusted: dependency installation and the UI build
executed that source with the pulled UI preview variables and signed Turbo cache
credentials. The candidate process never received the Vercel token, but it
could read its own build inputs and execute arbitrary build code. Fork sources
could not be selected, and the workflow rejected Dependabot branches.

The dispatch was accepted only from `refs/heads/main`. The caller invoked the
reusable worker from the same main commit, and the worker validated the caller
workflow identity again before any candidate code or credentialed step ran. A
dispatch selecting another branch or tag was rejected before the reusable job
received its preview credentials.

Phase A maintainers chose a SHA that already had a native Vercel Git UI preview
and a branch that contained it. They verified both locally before dispatching:

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

The workflow independently rejected malformed, option-like, newline-bearing,
missing, or unreachable refs. It checked out the exact SHA with full history
and used the recorded `HEAD` for the custom Next deployment ID, Vercel metadata,
GitHub Deployment ref, smoke evidence, and outputs.

The Phase A pilot did not dispatch from a pull-request ref. After the main-only
guard, the workflow controller was checked out from the trusted
`github.workflow_sha`; the requested source was checked out separately and was
never executed automatically with preview credentials. Candidate dependency
lifecycle scripts were disabled. The worker also restored the controller from
its trusted workflow SHA after dependency installation and again after the
candidate build, before output assertion, upload, and inspection.

The Vercel CLI was a separate trusted tool install. Pinned pnpm `10.34.4` read
the main controller's exact `package.json` and frozen `pnpm-lock.yaml`, disabled
lifecycle scripts, and copied packages into a runner-owned directory outside
the checkout. Its `--modules-dir` and `--virtual-store-dir` values are validated
relative paths from the controller to that directory; pnpm treats an absolute
`--modules-dir` as project-relative and would otherwise materialize the CLI at
the wrong path. The zero-network fixture requires the already-hydrated package
store with `--offline`; it cannot contact the registry to repair missing data.
The hosted setup-node location is treated only as a trusted staging input
because runner-image permissions can make that original path writable by the
isolated candidate UID. The credentialed build job does not use
`pnpm/action-setup`: its standalone update path installs `@pnpm/exe`, whose
`preinstall` lifecycle runs before a downloaded target can be authenticated.
Instead, pinned setup-node first provides Node.js and its bundled npm with
package-manager caching explicitly disabled. Trusted controller code validates
the exact manifest and complete npm lockfile under
`scripts/vercel-pnpm-bootstrap`, then copies them into a fresh fixed directory
under the job-scoped Vercel isolation work root.

Each build job derives that boundary from the immutable Actions run identity:
`/var/lib/mento-vercel-runtime-<run-id>-<run-attempt>` is a fresh root-owned
`0711` directory, its `.mento-vercel-runtime` marker is a root-owned `0400`
file containing the exact run ID and attempt, and `work/` is a runner-owned
`0711` directory. Before creating it, the worker proves `/`, `/var`, and
`/var/lib` are real root-owned directories with no group or other write bit.
The root-owned outer directory prevents the isolated candidate from replacing
the runner-owned work entry through a writable parent; the work directory
allows traversal to reviewed fixed children without allowing the candidate to
list, create, rename, or remove those children. The workflow does not grant
ACLs or loosen permissions on runner home or workspace ancestors.

That lock has one dependency only: `@pnpm/linux-x64@10.34.4` from the official
npm registry with its reviewed sha512 SRI. The worker runs `npm ci` outside the
checkout with lifecycle scripts, audit, and funding calls disabled; ambient npm
configuration, cache, home, and temporary state are replaced with fresh
runner-owned paths. It never executes npm's `.bin` shim. Trusted code requires
the literal installed `node_modules/@pnpm/linux-x64/pnpm` to remain inside the
fixed staging root, be a single-link runner-owned regular file, declare the
expected Linux x64 package metadata and no lifecycle scripts, and match
SHA-256
`e02c01738ce850754cf00111fd97bec24de550e1e963690486f02d9dae1a2193`.
Only after that source digest passes does the worker make an independent
read-only copy under the protected tool directory, re-hash the copy, execute
its absolute path to require version `10.34.4`, and remove the extraction plus
npm cache.

The protected copy is then placed on `PATH` and revalidated before a second,
cache-only setup-node invocation. That invocation deliberately has no
`node-version`, `node-version-file`, or architecture input, so pinned
setup-node skips Node installation and cannot prepend another Node tool
directory before it asks the already-authenticated pnpm for its store path.
The resolved store is runner-owned and proven non-writable by the candidate.
Before candidate code starts, Node.js is likewise copied into the protected
tool directory, and only the protected copies install trusted controller
tools.

Candidate-controlled installs use a separate JavaScript pnpm runtime pinned by
`scripts/vercel-pnpm-runtime/package.json` and its standalone frozen lockfile.
That manifest is deliberately outside the workspace globs, staged under
`$TRUSTED_VERCEL_TOOLS_PATH/pnpm-runtime`, and installed with lifecycle scripts
disabled and package copies rather than links to candidate-writable storage.
Before staging, the controller requires the manifest to match its exact allowed
fields and binds the complete one-importer lockfile bytes to
`PINNED_PNPM_RUNTIME_LOCKFILE_SHA256`; this rejects extra dependency/config
sections, custom tarballs, changed integrity, or extra importers/packages before
the bootstrap install. Any Phase A pnpm bump had to update the bootstrap npm
manifest and lockfile, reviewed registry SRI and Linux x64 executable digest,
isolated JavaScript-runtime manifest and pnpm lockfile, `PINNED_PNPM_VERSION`,
and both complete-lockfile digests together. On a non-Linux development host,
`npm install --package-lock-only --force` could be used only to regenerate this
Linux-specific lock; the CI installation was never allowed to use `--force`.
The protected launcher always uses protected Node plus that runtime's
`pnpm.cjs`; it disables pnpm's package-manager self-switch and strict patch
version check so an older candidate `packageManager` field cannot silently
downgrade the trusted runtime or reject the intentional patched v10 version.
This removes the standalone executable's own image from the cross-identity
execution path: the pilot failed when that image was not effectively readable
after switching to the isolated candidate identity, even though the
runner-owned executable checks had passed. Candidate pnpm probes execute from
the candidate-owned home rather than the runner workspace, which is
intentionally not readable after the identity switch. The root and
candidate-runtime pnpm locks remain covered by OSV and sha512/registry
validation. The bootstrap npm lock has a separate OSV job, exact byte/shape
validation, npm's SRI enforcement, and a Linux CI installation that hashes the executable before
running it.
Before any credentialed command, the worker proves the runtime root, its
replacement-relevant parents, Node.js, pnpm, and the CLI are not candidate
writable; it also proves the CLI resolves inside the protected directory, its
package version is exactly `56.2.0`, and protected `node <cli> --version`
executes successfully. It then switches to the dedicated candidate UID and
executes the protected pnpm launcher once before materializing or running the
selected source, proving that every isolation ancestor is searchable by that
identity. The workflow test suite repeats the CLI install with the actual
pinned pnpm version in a temporary checkout while retaining a frozen-lockfile
failure boundary.

The candidate dependency install intentionally does **not** reuse setup-node's
runner-owned pnpm store, even though the candidate is proven unable to write it.
Its isolated `HOME` and XDG directories place that store under the disposable
candidate home, which is deleted before upload. Sharing a runner store here
would let selected source code mutate cache state that an Actions post-step
could save from the trusted `main` run if an isolation boundary regressed.
Phase A treated candidate dependency installation as a cold, measured pilot
cost and recorded its duration separately from `vercel build`. The signed Turbo
remote build cache remained enabled, and its hit/miss evidence remained part of
the historical comparison.

Before candidate installation, the worker proves the checked-out index tree is
the exact selected commit tree. The candidate UID cannot write `/var/lib`, the
run-scoped root, its marker, or the runner-owned work directory. A trusted,
bounded materializer then lists the exact commit with `git ls-tree`, reads every
raw blob with `git cat-file`, and writes only supported regular files and
symbolic links into the fixed candidate-source child that is subsequently
handed to the candidate UID. It rejects unsafe paths, unsupported modes
(including gitlinks), oversized trees, and filesystem collisions. Reading raw
objects deliberately bypasses both archive attributes (`export-ignore` and
`export-subst`) and checkout filters (`eol`, `ident`, and custom filters), so
the candidate always receives the selected commit's stored bytes.

The always-run cleanup is authorized separately from normal job success. A
readiness flag is written only after the root, work directory, and run marker
pass their exact ownership, mode, path, and content checks. The candidate
identity similarly records its UID and GID before its readiness flag. Cleanup
does nothing when no proven root exists, but fails closed if an unproven root
does exist. For a proven root it revalidates the protected ancestors and marker,
matches every removable child to its fixed path, kills and verifies all
candidate-UID processes, removes the known state without crossing filesystems,
removes the empty work and outer directories, and proves the outer root is
absent before deleting the recorded candidate user and group. Unexpected
top-level state or a pre-existing/unmatched candidate identity is never deleted.

### Historical Phase A Root Directory and command sequence

The pinned Vercel CLI commands executed from monorepo-shaped roots. Before
`vercel pull`, the worker created a fresh runner-owned staging tree at a fixed
path under `$VERCEL_ISOLATION_ROOT`. That tree contains only real
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

The credentialed worker ran this sequence in one standard `ubuntu-latest` job:

1. create the fresh runner-owned pull staging and exact repo-level UI link;
2. run `vercel pull --yes --environment preview --git-branch
<validated-branch>` only inside that staging tree;
3. recursively validate the pulled tree;
4. run the equivalent of `pnpm vercel:env:check --target ui --environment
preview --project-directory "$VERCEL_ISOLATION_ROOT/mento-vercel-pull-staging/apps/ui.mento.org"`
   against that runner-owned tree, with explicit preview system constants
   overriding pulled values;
5. copy only the three required files into freshly created candidate `.vercel`
   directories, then use the trusted privileged controller to prove their
   exact ownership, permissions, shape, and project mapping while the candidate
   UID has no process;
6. immediately before build, repeat the trusted privileged exact-SHA
   provenance, candidate-tree, and project-mapping checks;
7. `vercel build --yes --standalone --target preview` as the isolated candidate UID with
   `VERCEL_BUILD_MONOREPO_SUPPORT=1`, the signed Turbo remote cache, immutable
   Git metadata, and generated `MENTO_NEXT_DEPLOYMENT_ID`;
8. stop all candidate-UID processes, then use the trusted privileged controller
   to assert the UI project mapping, Build Output API v3 config, custom
   deployment ID, preview target, pinned CLI build record, output ownership,
   safe filesystem shape, and runner-owned exact-SHA provenance;
9. create a runner-owned upload handoff containing only the validated output,
   trusted project settings, repo link, and exact-SHA provenance;
10. `vercel deploy --prebuilt --target preview --archive=tgz --format=json`;
11. `vercel inspect --wait --timeout 5m --format=json --scope <org-id>`. The
    explicit scope prevents inspection from falling back to the token owner's
    default Vercel team.

The standalone build flag is mandatory for the narrow upload handoff. Without
it, Vercel function configs can retain repo-root `filePathMap` references into
the build tree (including `node_modules`) that no longer exists after the
candidate source is removed. Standalone mode inlines those dependencies into
the function output; the trusted output validator rejects every non-empty
`filePathMap` before the handoff or upload can proceed. Standalone function
bundles may retain package-manager symlinks, but validation permits only direct,
relative file or directory links whose lexical and canonical targets remain
inside the same physical `.func` directory. A bounded relative link to a
missing in-function target is allowed because dependency tracing can preserve
unused package-manager links; absolute links, escaping links, and link chains
remain rejected. Before reading or copying the handoff, the validator also caps
each `.vc-config.json` at 1 MiB, each regular file at 250 MiB, and the complete
output at 1 GiB.

Only after that job emitted the verified immutable URL did a second trusted job
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

The Next.js builder can legitimately represent multiple prerender routes with
relative symbolic links to one generated function directory. Output validation
permits only bounded, control-character-free `functions/**/*.func` aliases to a
directly materialized `.func` directory in that same output tree. Absolute,
broken, chained, cyclic, non-function, file-targeting, ancestor/self, and
escaping links remain rejected. The trusted handoff preserves accepted links
without dereferencing them and changes the link ownership explicitly before
applying the same validation again immediately before upload.

CLI `56.2.0` gates its local Root Directory monorepo defaults behind
`VERCEL_BUILD_MONOREPO_SUPPORT=1`. The worker supplies that trusted constant to
the clean candidate environment so the CLI activates its Turborepo default,
`turbo run build`, for the Root Directory project. Turbo then included upstream
workspace packages such as `@mento-protocol/ui` before the selected Next.js
app. The Phase A design required this internal, version-coupled flag to be
re-audited whenever the pinned CLI changed and forbade replacing it with a
separate app dependency prebuild, which would have duplicated work before the
CLI's own build and could have diverged from Vercel's project settings.

### Historical Phase A canonical GitHub Deployment

The worker owned one explicit REST Deployment for the exact SHA. It used only
`contents: read` and `deployments: write`; no job-level Actions environment was
declared, so GitHub did not create an implicit event-SHA Deployment. The create
request used `auto_merge: false`, empty required contexts, the deterministic
`vercel-preview-ui` environment, and transient/non-production flags.

The run-scoped pilot key is:

```text
vercel-pilot:v1:ui:sha:<sha>:run:<run_id>:attempt:<run_attempt>
```

Retries with that exact key reused the existing record. A deliberate workflow
rerun had a different attempt key and created a new pilot attempt. Only
non-secret provenance was stored in the payload.

Statuses progressed through `queued` and `in_progress`. `success` was posted
with the immutable Vercel `environment_url` and Actions `log_url` only after
direct smoke passed. Build, deploy, or smoke failures posted `failure`;
cancellation or controller/infrastructure failures posted `error`. The
`if: always()` lifecycle job closed any record that did not reach success. It
was independent of best-effort timing and run-summary steps, so a metrics
failure could not overwrite a verified deployment's lifecycle truth. The
reusable workflow published `deployment_url` only from the smoke-backed success
step; it never fell back to the unverified upload output.

A Deployment or status created with the repository `GITHUB_TOKEN` does not
trigger another workflow run. Therefore workers call the secretless
`.github/workflows/_vercel-preview-smoke.yml` directly before terminal success;
they never depend on `deployment_status` recursion. Do not add a PAT to force
that recursion. The dedicated worker-dispatch credential is not an exception;
its sole purpose is the automatic controller's worker `workflow_dispatch` POST
described below.

### Historical Phase A evidence and browser verification

The Phase A run summary recorded the exact SHA, immutable URL, Vercel Deployment
ID, GitHub Deployment ID, build duration, upload duration, and total controller
duration. Turbo printed remote-cache hit/miss evidence in the build log. Phase A
reviewers compared those values with the same-SHA native Vercel Git preview but
did not infer billing savings from elapsed time alone.

Phase A acceptance also required the repository browser protocol on the
immutable GitHub-built URL: reviewers verified page rendering and primary
navigation, inspected console errors and failed network requests, confirmed
static assets/fonts, and compared security headers plus Vercel toolbar/CSP
behavior with the native preview. They attached the URL and concise evidence to
the PR or issue. This same-SHA native comparison is intentionally unavailable
after Phase B disables native UI branch previews; current validation uses the
[Phase B canary and rollback procedures](#ui-vercel-git-cutover-phase-b).

The cost go/no-go record in issue #518 and the Phase A live-canary evidence
below were prerequisites for the final UI Git-ownership cutover. The current
Phase B ownership model reflects that gate having completed.

## Reusable secretless preview verification

`.github/workflows/_vercel-preview-smoke.yml` is the one smoke implementation
for App, Governance, Reserve, and UI. Its caller supplies an already verified,
target-bound tuple: logical target, immutable team URL, exact SHA, canonical
GitHub Deployment ID, mode-specific verification key, and trusted deployment
metadata. Controller/manual-pilot mode additionally binds the literal Vercel
project, Vercel Deployment ID, and target-specific Next.js deployment ID.
Native-adapter mode is restricted to App/Governance and binds the exact native
environment plus Vercel bot identity; it cannot fabricate a controller key.

The reusable workflow declares no secrets and performs no authenticated Vercel
or GitHub lookup. It validates the tuple before any request, checks the root
response, security headers, representative JavaScript/CSS/font assets, browser
console/page errors, and same-origin failures, then runs the target interaction:

- App/Governance: real wallet list and team-host-only mock wallet connection;
- Reserve: Overview data plus Supply tab and URL/state transition;
- UI: exact build/asset identity, navigation, and hydrated control interaction.

The temporary `.github/workflows/preview-smoke.yml` native adapter classifies
only exact successful `Preview – app.mento.org` and
`Preview – governance.mento.org` events created by Vercel's fixed bot identity
on the exact project-slug team host. Production/v3, inactive/skipped, main,
controller-payload, actor-lookalike, Reserve, and UI events do not call smoke.
Every qualifying event runs the full reusable workflow. No historical status
is listed or trusted for dedupe, and the adapter deliberately declares no
workflow or job concurrency group: GitHub replaces an older pending run in a
shared group even when `cancel-in-progress` is false, which would violate the
one-full-smoke-per-event contract. The appended terminal status is bounded,
run-specific evidence only. The adapter receives no PAT, Vercel token, Turbo
token, or application secret and is deleted after all native consumers leave
the observation window.

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
checkpoint plus live receipt set. The canonical Markdown envelope includes the explicit closing
`</details>` tag; missing or additional presentation text is invalid. The
journal keeps one stable comment ID: every update edits it, and no
receipt-specific comment is created.

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
comment, or compatibility reader.

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

The complete rendered journal body has a 60,000-byte hard limit measured as
UTF-8. A transition that cannot safely use either terminal or capacity
checkpointing and would cross it fails closed before changing the journal,
reporting success, or dispatching work; active, retired, or unmatched evidence
is never truncated.

Reconciliation is lossy/replaceable, but it reconstructs from the journal's
entries and mutable state, current PR lifecycle evidence, and GitHub/provider
APIs. Before dispatch, the controller appends a selection entry that binds the
selected SHA to the controller epoch and compactly lists intermediate entry
identities coalesced into the durable later selection. Intended-run crash
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
HTTP/header/static-asset checks before the trusted UI deployment-identity
browser flow renders the showcase, searches and navigates to a second route,
changes a form control, and fails on page/console errors or failed same-origin
requests and responses. The HTTP phase verifies the server-rendered
`data-dpl-id`; after hydration, the browser phase requires every loaded
same-origin `/_next/static/` asset to carry exactly the expected `?dpl=` value
and rejects any conflicting retained HTML deployment marker. Request monitoring
remains active through the second-route interaction, so dynamically loaded
chunks cannot escape the same identity check. The controller waits for all
observed static requests to finish and for a quiet window before its final
assertion. This preserves fail-closed deployment-identity proof when
React reconciles the server-injected HTML attribute out of the live DOM. Chrome
also waits for the initial page load before changing controlled inputs, then
rechecks the changed form control after the hydration/interaction settle. Its
dependency graph comes from the trusted workflow checkout, candidate lifecycle
scripts stay disabled, and no Vercel or Turbo credential is present in the
smoke job. The worker appends a durable non-terminal upload evidence entry;
the completed-run recovery re-queries the run, Deployment, and statuses before
appending the terminal result entry. Cancellation before Deployment creation
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

A closed bootstrap is an exceptional recovery reset, not a way to create a
journal. It is accepted only when the exact PR is live-closed, exactly one
canonical v2 journal already exists, and that journal has no unfinished worker,
selection, result, or dispatch ownership. The journal must be cursorless unless
this is an exact rerun of its already-recorded bootstrap. The numbered
`repository_dispatch` run must authenticate the exact repository, numeric
controller workflow ID and path, run ID, run number, strict title, and durable
receipt. The reset records a terminal closed anchor/state and the new admission
floor without invoking the planner, dispatching a worker, creating or updating
a Deployment, or publishing a pending preview status. A later `reopened` event
starts normally from that terminal anchor.

If a closed bootstrap partially fails after committing its receipt or terminal
witness, rerun the failed job(s) on that same Actions run. Reruns retain the
same run ID and run number and repair missing witness or reconciliation work
idempotently. Never send a second bootstrap dispatch for the same closed
journal: a distinct run cannot replace its established admission cursor. A
closed bootstrap against a missing journal or unfinished ownership fails before
mutation.

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

Activating the v2 controller does not edit a Vercel project configuration. In
the initial ownership map, GitHub Actions is the sole automatic branch-preview
owner for `ui`; `app`, `governance`, and `reserve` remain in shadow mode so
their native Vercel and GitHub-built previews run together. Main and production
deployments remain native for every target.

After the v2 bootstrap, exercise one runtime-affecting PR per target before a
single PR that affects multiple targets. For every canary, record the PR and
exact SHA, controller and worker run URLs, canonical Deployment ID and
environment, GitHub-built immutable URL, native immutable URL when the target
is shadowed, v2 journal comment ID and revision, exact-head aggregate status,
and browser evidence. Prove all of the following:

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

A later native-to-GitHub ownership cutover is a separate atomic change per
target. In the same reviewed PR, change that target's exact `vercel.json` from
the canonical native configuration to its canonical GitHub configuration and
change only that target's `ownershipMode` in
`scripts/vercel-preview-targets.mjs` from `shadow` to `github`. Update structural
tests and this runbook in that PR. Do not flip a global ownership mode or
hand-copy a configuration from another target; the app target intentionally has
an additional `v2` branch exception in its canonical GitHub configuration.

Perform those later cutovers strictly in the order **Reserve → Governance →
App**, with one reviewed merge and completed live canary between targets. Stop
after any failed target: keep every already-proven target in its accepted owner
state, leave all later targets in shadow mode, and diagnose or roll back only
the failed target. App may not cut over until Governance has completed its own
cutover and browser-verified canary. The earlier controller-expansion change
ended at shadow activation and did not include any of those three configuration
cutovers.

Before each Reserve, Governance, or App cutover, inventory open branches and
PRs that still contain that target's pre-cutover `vercel.json`. Every branch
used to validate the cutover must merge or rebase the resulting current `main`
before its canary is accepted. Record any intentionally deferred stale PR with
its owner and follow-up action; do not claim repository-wide duplicate
prevention while an unaccounted stale branch can still request a native
preview.

For rollback, first establish a coordinated no-push window and drain controller
and worker ownership for the target. Atomically restore both its canonical
native Vercel configuration and `shadow` ownership mode, then require an exact
head native deployment plus browser proof before accepting the rollback. Never
split the configuration and ownership edits across merges.

### Reserve Vercel Git cutover

This change is the first per-target ownership cutover. It atomically pairs
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
it does not roll back UI or pause the active controller globally. First establish
a coordinated no-push window. Exhaustively drain controller, worker, and intake
activity with this copy-safe command, repeating it until two consecutive
inventories are empty after cancellations have settled:

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
      "dependabot/**": false
    }
  }
}
```

In that same commit, change only the Reserve entry in
`scripts/vercel-preview-targets.mjs` back to:

```js
ownershipMode: PREVIEW_OWNERSHIP_MODES.SHADOW,
```

Do not change `VERCEL_PREVIEW_CONTROLLER_MODE`: it stays `active` so UI keeps
its GitHub preview owner and App/Governance keep their existing shadow canaries.
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

### Phase A canary evidence template

Phase A kept native Vercel Git UI previews enabled. For every canary, record the
PR, exact SHA(s), controller/worker run URLs, controller key/digest, canonical
GitHub Deployment ID, GitHub-built immutable URL, native Vercel immutable URL,
canonical journal comment ID/revision/`journal_digest`/`state.receipts_digest`,
terminal `Vercel Preview` status, and browser evidence.

The Phase A gate required all of these before changing the ruleset or starting
Phase B:

1. trusted UI-affecting A produces both native and GitHub previews;
2. rapid UI pushes A -> B -> C deploy A then C, with B durably coalesced;
3. a docs-only PR creates no Deployment and succeeds as no-runtime;
4. a docs-only push after runtime work reuses the prior immutable URL;
5. after the controller is idle, a later UI-runtime SHA E deploys normally;
6. replaying an event, reconciliation request, and terminal callback is
   idempotent: it creates no second worker, GitHub Deployment, Vercel preview,
   journal, journal entry, or conflicting status, and it preserves the original
   journal comment ID;
7. fork and Dependabot PRs succeed unsupported without a Deployment/worker,
   with Dependabot proven through the credentialless intake and trusted
   exact-head follow-up;
8. a controlled build/smoke failure posts terminal failure and bounded retry;
9. cancelling a worker before Deployment creation produces one canonical
   `error` Deployment/result and advances the latest desired SHA;
10. close/reopen and a force-reset SHA revisit preserve distinct epochs;
11. one old-epoch callback terminalizes only its own journal evidence;
12. after the clean-cutover cleanup, exact validated legacy comments are absent
    while human, malformed, unknown-bot, and journal comments remain untouched;
13. representative strict-ruleset merges still work.

For the GitHub-built immutable URL, follow the repository browser protocol:
verify rendering and primary navigation, inspect console errors and failed
network requests, confirm JS/CSS/font assets, and compare security headers plus
Vercel toolbar/CSP behavior with the native preview. A canary is not accepted
from workflow logs alone.

The Phase A ruleset change was gated on recent successful-deploy, no-runtime,
runtime-reuse, coalesced, after-idle, idempotent replay/reconcile,
unsupported-trust, failure, cancellation, and old-epoch evidence.

## UI Vercel Git cutover (Phase B)

Phase B established UI's GitHub-owned branch-preview state, which remains part
of the current ownership map alongside Reserve. Its completed precondition was
that every Phase A dual-path canary above passed and its
GitHub-built/native-preview evidence was recorded. This separate merge paired
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
      "dependabot/**": false
    }
  }
}
```

In that same commit, change only the UI entry in
`scripts/vercel-preview-targets.mjs` back to:

```js
ownershipMode: PREVIEW_OWNERSHIP_MODES.SHADOW,
```

Keep `VERCEL_PREVIEW_CONTROLLER_MODE` set to `active`; Reserve remains
GitHub-owned and App/Governance retain their independent shadow canaries. Do not
split the two UI edits across commits or merges. A configuration-only or
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

### Historical Phase A pilot cleanup

This is historical Phase A evidence, not a current Phase B operation. After the
Phase A pilot evidence was saved, a maintainer could remove only that pilot's
immutable preview using the preview-scoped CLI credential:

```bash
export VERCEL_TOKEN="<preview-scoped-token>"
pnpm exec vercel remove "<immutable-vercel-deployment-url-or-id>" --yes
```

Confirm the value is the unique pilot URL or `dpl_` ID from the run summary.
Never pass a production domain or alias, and do not change Vercel Git settings.
Do not use this retired pilot command to remove current controller-managed
previews.

The complete zero-network pilot and automatic-preview suites are:

```bash
pnpm vercel:workflow:test
pnpm vercel:preview:test
```
