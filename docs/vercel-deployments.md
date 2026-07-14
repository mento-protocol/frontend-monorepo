# Vercel deployment primitives

This runbook documents the repository-owned planning and build primitives used
by the GitHub Actions deployment migration tracked in [issue
#515](https://github.com/mento-protocol/frontend-monorepo/issues/515). It does
not change deployment ownership by itself. Until the later cutover issues ship,
the Vercel Git integration remains the deployment owner.

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

It is also the first stage of the canonical root `pnpm test` command. The suite
covers app/package graph fixtures, fail-closed cases, output ordering, every
deployment-ID constraint, prebuilt-config matching, prerequisite versions, all
target/environment classifications, and redaction-safe missing-variable errors.

This foundation issue performs no Vercel API call, build upload, deployment,
alias mutation, environment mutation, or Git-ownership change.
