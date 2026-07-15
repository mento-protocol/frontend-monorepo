# Frontend Monorepo

A monorepo for all our frontend apps, designed to simplify sharing of code like components, styles, utils, and configs between different applications.

## Technology Stack

- **[Turborepo](https://turborepo.com/)**: For monorepo management and build tooling
- **[PNPM](https://pnpm.io/)**: Our package manager
- **[TypeScript](https://www.typescriptlang.org/)**: Our main language with shared, extendable config
- **[NextJS](https://nextjs.org/)**: The framework for all our frontend apps
- **[Tailwind CSS](https://tailwindcss.com/)**: For styling
- **[shadcn/ui](https://ui.shadcn.com/)**: Our UI component base library to extend from
- **[Trunk CLI](https://trunk.io/)**: Metalinter and formatter (ESLint, Prettier, Markdown, YAML, Shell, Commitlint)
- **[Vercel](https://vercel.com/)**: For deployments and turborepo build remote caching
- **[GitHub Actions](https://github.com/features/actions)**: For CI (with Turborepo caching for builds via Vercel)

## Repo Structure

```txt
frontend-monorepo/
├── apps/                     # Frontend applications
│   ├── app.mento.org/        # Mento Exchange UI
│   ├── governance.mento.org/ # Governance UI
│   ├── reserve.mento.org/    # Reserve UI
│   └── ui.mento.org/         # Component Library Showcase
│
├── packages/                 # Shared packages
│   ├── eslint-config/        # Shared ESLint configuration
│   ├── typescript-config/    # Shared TypeScript configuration
│   ├── ui/                   # Shared UI library with tailwind styles and shadcn/ui components
│   ├── vitest-config/        # Shared Vitest configuration
│   └── web3/                 # Shared library with web3-specific components and hooks
│
├── .github/                  # GitHub workflows
│   └── workflows/            # CI/CD workflows
├── .trunk/                   # Trunk CLI configuration and cache
├── docs/
│   └── adr/                  # Architecture decision records and lifecycle
├── turbo.json                # Turborepo configuration
└── pnpm-workspace.yaml       # PNPM workspace configuration
```

## Getting Started

### Prerequisites

- Node.js (v22 or later)
- PNPM (v10 or later)
- [Trunk CLI](https://trunk.io/) (automatically installed during development)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/mento-protocol/frontend-monorepo && cd frontend-monorepo
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Configure environment variables for each app you plan to build or run:

   ```bash
   cd apps/<app-name>
   cp .env.example .env.local
   ```

4. Build all packages:

   ```bash
   pnpm build
   ```

5. Start the development server for all applications:

   ```bash
   pnpm dev
   ```

### Environment Variables

Each app has its own `.env.example` listing the variables it needs:

- `apps/app.mento.org/.env.example`
- `apps/governance.mento.org/.env.example`
- `apps/reserve.mento.org/.env.example`
- `apps/ui.mento.org/.env.example`

For each app you run locally, copy its example file to `.env.local` and fill in the values before building or starting dev:

```bash
cd apps/<app-name>
cp .env.example .env.local
```

Most values are public config and safe to copy as-is. A few require secrets from a teammate or the Vercel project settings:

- `app.mento.org` needs `NEXT_PUBLIC_STORAGE_URL`, `NEXT_PUBLIC_WALLET_CONNECT_ID`, and `CHAINALYSIS_API_KEY`
- `governance.mento.org` needs `NEXT_PUBLIC_WALLET_CONNECT_ID`, `NEXT_PUBLIC_GRAPH_API_KEY`, and `ETHERSCAN_API_KEY`
- `reserve.mento.org` needs `NEXT_PUBLIC_STORAGE_URL` and `NEXT_PUBLIC_ANALYTICS_API_URL`
- `ui.mento.org` needs `NEXT_PUBLIC_STORAGE_URL` for showcase static assets

## Development Workflow

### Code Quality & Formatting

We use **[Trunk CLI](https://trunk.io/)** as our universal linter and formatter. It combines ESLint, Prettier, Markdown linting, YAML linting, and more into a single, fast tool.

#### Available Commands

```bash
# Lint all files (comprehensive check)
pnpm lint

# Lint with auto-fix
pnpm lint:fix

# Format all files
pnpm format

# Check formatting without making changes
pnpm format:check

# Verify every third-party GitHub Action uses an immutable SHA + version comment
pnpm ci:action-pins

# Run the action-pin scanner and REST materializer fixture suites
pnpm ci:action-pins:test

# Remind on newly added architecture-significant workflows/workspaces
pnpm adr:check

# Test the offline ADR reminder and repository wiring
pnpm adr:check:test

# Test the network-free Vercel planning and prebuilt-build primitives
pnpm vercel:primitives:test

# Test the manual UI prebuilt workflow, GitHub Deployment lifecycle, and smoke controller
pnpm vercel:workflow:test

# Verify exact Next.js and Vercel CLI custom deployment-ID prerequisites
pnpm vercel:versions:check

# Test and run the redaction-safe Vercel build-minute closeout analyzer
pnpm vercel:cost:test
pnpm vercel:cost:analyze --input .vercel-cost-evidence/aggregate.json --format markdown
```

Two always-run checks protect the policy on every pull request:
`GitHub Actions Policy` runs the trusted base-branch checker against only the
PR head's Actions YAML, fetched as inert blobs from its exact commit through the
GitHub Git API. It never checks out or executes pull-request files. `GitHub
Actions Policy Source` runs the proposed checker, REST materializer, and fixtures
in a credential-free `pull_request` workflow. After these workflows merge, branch
protection must require both `Action Pin Policy` and `Action Pin Policy Source`
so neither trusted enforcement nor proposed-policy validation can be skipped.
Because the source lane necessarily runs pull-request-controlled policy code,
changes to either policy workflow, checker, or fixture suite must also require
protected human/code-owner review or an organization required-workflow rule;
the two status contexts alone are not a tamper-proof approval boundary.
Canonical structure changes such as pnpm/Node versions, commands, or triggers
intentionally require a protected two-PR transition: first teach the trusted
checker to allow the transition while retaining the old workflow, then change
the workflow and tighten the checker. Immutable action SHA bumps are normalized
by the checker and can remain a single PR. When adding or updating a third-party
action, pin its full 40-character commit SHA and retain the release tag as an
inline comment (for example, `uses: org/action@<sha> # v1.2.3`).

#### App-Specific Linting

To lint a specific application:

```bash
cd apps/<app-name>
pnpm lint                    # Lints only this app
```

Or from the root directory:

```bash
trunk check apps/<app-name>  # Direct Trunk usage
```

#### What Trunk Checks

- **JavaScript/TypeScript**: ESLint with your existing rules
- **Code Formatting**: Prettier (including Tailwind CSS class sorting)
- **Markdown**: Documentation formatting and best practices
- **YAML**: Configuration file formatting
- **Shell Scripts**: shellcheck and shfmt
- **Git**: Pre-commit and pre-push hooks

#### VS Code Integration

The workspace is configured to use Trunk for:

- **Auto-formatting on save** for JS/TS files
- **Lint-on-type** feedback
- **Code actions** for quick fixes

### Running a Single Application

To run a specific application:

```bash
cd apps/<app-name>
pnpm dev
```

Or from the root directory:

```bash
pnpm dev --filter <app-name>
# i.e. pnpm dev --filter ui.mento.org
```

### Building a Single Application

To build a specific application:

```bash
pnpm build --filter <app-name>
```

### Local Celo fork

For wallet-gated testing against real Mento contracts, run a local anvil fork of Celo mainnet:

```bash
pnpm fork:mainnet  # anvil --celo --auto-impersonate --fork-url https://forno.celo.org --port 8545
pnpm fork:seed     # fund anvil's junk accounts (CELO + cUSD/cEUR/USDC/MENTO) and re-report oracle prices (mainnet forks only)
pnpm fork:testnet  # same anvil flags, forking Celo Sepolia instead (fork:seed does not support testnet forks)
```

`--celo` requires [Foundry](https://book.getfoundry.sh/) >= 1.4 — without it, CELO's native/ERC-20 token duality breaks and `transfer()` silently no-ops. `fork:seed` is idempotent; re-run it after every `evm_revert` and whenever Broker quotes start reverting (SortedOracles reports go stale on a wall-clock timescale).

### Local Monad fork

Monad mainnet (chain 143) runs a different Mento stack than Celo (Router + FPMM, no Broker), so it has its own scripts and port:

```bash
pnpm fork:monad       # anvil --auto-impersonate --fork-url https://rpc.monad.xyz --fork-block-number <finalized> --port 8546 (no --celo)
pnpm fork:seed:monad  # fund anvil's junk accounts with MON + Reserve collateral + every Mento stable (via real Router swaps), re-report oracles
```

`fork:seed:monad` is idempotent (re-run after every `evm_revert` / when quotes stall). To point the app at this fork, dev/build with `NEXT_PUBLIC_MONAD_RPC_URL=http://localhost:8546` — Monad has no `--celo`/`NEXT_PUBLIC_USE_FORK` redirect, so that override is the seam (it redirects both wagmi and the mento-sdk). See [docs/wallet-testing.md](docs/wallet-testing.md) for the full Monad runbook.

Full runbook with localStorage activation, on-chain verification, safety rules, and troubleshooting: [docs/wallet-testing.md](docs/wallet-testing.md)

### Dependency Management with PNPM Catalog

This monorepo uses [PNPM's catalog feature](https://pnpm.io/catalogs) to centralize dependency version management. This ensures all packages and apps use consistent versions of shared dependencies, reducing conflicts and simplifying updates.

#### How It Works

The catalog is defined in `pnpm-workspace.yaml` under the `catalog` section. Instead of specifying version numbers directly in each `package.json`, we reference the catalog using `"catalog:"`.

**Example in `package.json`:**

```json
{
  "dependencies": {
    "react": "catalog:",
    "jotai": "catalog:",
    "@tanstack/react-query": "catalog:"
  }
}
```

The actual versions are defined once in `pnpm-workspace.yaml`:

```yaml
catalog:
  "react": ^19.2.5
  "jotai": ^2.16.2
  "@tanstack/react-query": 5.90.16
```

Root `pnpm.overrides` are used for security patches and compatibility pins.
`@tanstack/react-query` and `@tanstack/query-core` are pinned there to the
verified app-compatible version; newer compatible-range releases caused a
production QueryClient context split in `app.mento.org`. Remove those overrides
only after a production build and browser verification of the swap and pools
routes. Note the catalog entry above matches the override exactly (`5.90.16`,
not a caret range) — pnpm overrides rewrite `catalog:` references too, so the
catalog value must stay truthful about what's actually installed. See
[`docs/dependency-overrides.md`](docs/dependency-overrides.md) for the reason
and removal condition behind every unconditional override.

#### Adding a New Dependency

When adding a new dependency that should be shared across packages:

1. **Add the dependency to the catalog** in `pnpm-workspace.yaml`:

   ```yaml
   catalog:
     "new-package": ^1.0.0
   ```

2. **Reference it in your `package.json`**:

   ```json
   {
     "dependencies": {
       "new-package": "catalog:"
     }
   }
   ```

3. **Run `pnpm install`** to update the lockfile.

#### Updating a Dependency Version

To update a dependency version across the entire monorepo:

1. **Update the version in `pnpm-workspace.yaml`**:

   ```yaml
   catalog:
     "react": ^19.2.0 # Updated from ^19.1.0
   ```

2. **Run `pnpm install`** to update all packages using this dependency.

All packages referencing `"react": "catalog:"` will automatically use the new version.

#### When to Use Catalog vs Direct Versions

- **Use catalog (`"catalog:"`)**: For dependencies shared across multiple packages/apps (React, TypeScript, common utilities, etc.)
- **Use direct versions**: For app-specific dependencies that aren't shared (e.g., a Next.js plugin only used in one app)

### Working with Shared UI Components

The UI package is located in `packages/ui/` and contains reusable components built with shadcn/ui.

#### Adding a New Component via shadcn/ui

shadcn/ui is our component base layer we extend from.

1. Install the shadcn/ui component you need: `pnpm dlx shadcn@latest add button`
1. Customize it to your needs by simply editing `./packages/ui/src/components/ui/button.tsx`
1. Export the new component from the main barrel file `./packages/ui/src/index.ts`
1. Build the UI package: `pnpm build --filter @mento-protocol/ui`

#### Adding a New Custom Component (without shadcn/ui)

1. Create a new component in `packages/ui/src/components`
1. Export it from `packages/ui/src/index.ts`
1. Build the UI package: `pnpm build --filter @mento-protocol/ui`

#### Using UI Components in Applications

Import components into an application:

```tsx
// layout.tsx
import "@mento-protocol/ui/globals.css"; // Import once at the top of the app
import { Button } from "@mento-protocol/ui";
```

#### Using UI Components Outside This Monorepo

Install the public package once it has been manually published:

```bash
pnpm add @mento-protocol/ui
```

Import the bundled stylesheet once at the app root, then import components from
the package entrypoint:

```tsx
import "@mento-protocol/ui/globals.css";
import { Button } from "@mento-protocol/ui";
```

`globals.css` includes the Mento token layer, Tailwind-generated utilities,
component styles, and the bundled unmodified Aspekta font. Consumers that only
need the CSS variables and Tailwind v4 token declarations can import
`@mento-protocol/ui/theme.css` instead. React and React DOM are peer
dependencies; Tailwind CSS is an optional peer dependency unless the consuming
app compiles or extends the package's Tailwind token layer.

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/) for standardized commit messages. This helps with automated versioning and generating changelogs.

Each commit message should follow this format:

```txt
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

Types include:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code changes that neither fix bugs nor add features
- `test`: Adding or fixing tests
- `chore`: Changes to the build process or auxiliary tools
- `perf`: Performance improvements

Example:

```txt
feat(ui): add new button component
```

**Git Hooks**: Trunk automatically manages git hooks that will:

- **Pre-commit**: Format and lint staged files
- **Pre-push**: Run comprehensive checks and the advisory `pnpm adr:check`
  reminder before pushing
- **Commit-msg**: Validate commit message format

## CI/CD Pipeline

The repository is set up with GitHub Actions for CI:

- **CI**: On every PR, it plans the changed-file scope, fans build, unit tests, and static analysis out in parallel, then reports the existing required `Build and Test` sentinel. Markdown- and `docs/**`-only PRs skip builds, unit tests, type checking, and Knip, but retain the Trunk static checks for Markdown validation and secret scanning. Scope-planning errors and all other PR paths fail closed into full validation. Every `main` push runs the full suite so a successful `CI/CD` workflow is trustworthy recovery evidence for the failure notifier.
- **Quality budgets**: The always-reported [Quality Budgets](docs/quality-budgets.md)
  check enforces production-source coverage and gzip route limits. Its general
  CI failure notifier opens or updates one issue for an operational workflow
  failure and closes the issue after recovery.
- **CD**: The accepted direction is for GitHub Actions to own compilation and
  prebuilt deployment orchestration while Vercel remains the hosting/runtime
  platform. The migration is still rolling out, so Vercel Git remains
  authoritative for paths not explicitly cut over. Dependabot branches skip
  Vercel previews. See [ADR 0001](docs/adr/0001-github-actions-vercel-deployment-orchestration.md)
  for the boundary and [`docs/vercel-deployments.md`](docs/vercel-deployments.md)
  for the current implementation/runbook state.

Dependency-installing jobs use `.github/actions/pnpm-install`, which pins the
Node/pnpm bootstrap, relies on `actions/setup-node` as the single pnpm-store
cache owner, and enforces `pnpm install --frozen-lockfile`. Publishing overrides
the composite's Node version and disables its cache; zero-dependency jobs may
set up Node directly.

The docs-only decision is implemented by `scripts/ci-change-plan.mjs` and
covered by `pnpm ci:change-plan:test`, which the Unit tests job runs before the
workspace test suite. The always-run sentinel accepts skipped build and unit
test jobs only when that planner explicitly reports a documentation-only diff;
the static-analysis job must always succeed. Its dependency-heavy type-check
and Knip steps follow the planner, while Trunk remains mandatory for every diff.
Failures, cancellations, unexpected skips, and invalid planner outputs remain blocking.
Rename detection is disabled for the planning diff so both the old and new
paths are classified; moving source into `docs/**` cannot masquerade as a
documentation-only change. Until the target branch contains a trusted planner
(including the workflow's bootstrap PR), CI runs the full quality suite instead
of executing planner code from the pull-request checkout. Default-branch pushes
also bypass changed-file planning and always run the full build, unit-test,
type-check, Knip, and Trunk suite before `CI/CD` can report a successful
recovery.

### Trunk in CI

The CI pipeline uses the [Trunk GitHub Action](https://github.com/trunk-io/trunk-action) to:

- Install Trunk CLI in the CI environment
- Run the same linting and formatting checks as local development
- Ensure consistent code quality across all environments

### Turborepo Remote Caching

This repo utilizes [Turborepo's Remote Caching](https://turbo.build/repo/docs/core-concepts/remote-caching), to speed up local development and CI/CD runs. It works by storing the outputs (build artifacts, logs) of tasks (like `build`, `test`, `lint`) in a shared remote cache on Vercel. Before running a task, Turborepo calculates a hash based on the input files, environment variables, and dependencies. If that hash exists in the remote cache, Turborepo downloads the stored output and logs instead of executing the task locally, saving a lot of time.

#### Local Development Remote Caching Setup

To connect your local machine to the remote cache:

1. **Login to Vercel via Turbo CLI:**

   ```bash
   pnpm dlx turbo login
   ```

   Follow the prompts to authenticate with your Vercel account.

2. **Link the Repository:**

   ```bash
   pnpm dlx turbo link
   ```

   This connects the local repository instance to your Vercel account/team's remote cache storage.

Once linked, `turbo` commands (like `pnpm build`, `pnpm test`) will automatically attempt to use the remote cache. You generally don't need to set `TURBO_TOKEN` or `TURBO_TEAM` locally after linking, as `turbo` stores the necessary credentials automatically.

#### CI/CD (GitHub Actions) Setup

The `.github/workflows/ci.yml` workflow is configured to automatically leverage remote caching:

- It uses the `TURBO_TOKEN` (a Vercel Access Token) and `TURBO_TEAM` (your Vercel team slug/ID) environment variables.
- These variables **must** be configured in the GitHub repository settings under **Settings > Secrets and variables > Actions**:
  - `TURBO_TOKEN`: As a Repository Secret.
  - `TURBO_TEAM`: As a Repository Variable.
- With these variables set, the CI runner can authenticate with Vercel to read from and write to the remote cache.

#### Signed Remote Caching

Signed Remote Caching is **enabled** (`"signature": true` in `turbo.json`). Artifacts are HMAC-signed with `TURBO_REMOTE_CACHE_SIGNATURE_KEY` before upload, and signatures are verified on download. This prevents cache poisoning: an attacker who steals `TURBO_TOKEN` (read/write API access) but not the signing key cannot inject malicious build artifacts.

The signing key is provisioned in:

- GitHub Actions, as the `TURBO_REMOTE_CACHE_SIGNATURE_KEY` Repository Secret.
- Each Vercel project (`app.mento.org`, `governance.mento.org`, `reserve.mento.org`, `ui.mento.org`) for production, preview, and development environments.

**Local development:** With signing enabled, both reads and writes require the key — a Turbo client without `TURBO_REMOTE_CACHE_SIGNATURE_KEY` cannot verify signatures on downloaded artifacts and treats every task as a remote-cache miss (it then runs the task locally and uses local cache normally). To get remote-cache hits locally, export the key in your shell with the same value used in CI:

```bash
export TURBO_REMOTE_CACHE_SIGNATURE_KEY="<value from a maintainer>"
```

Never commit the key. If you don't set it, nothing breaks — you just lose the remote-cache speedup.

**Rotating the key:** generate a new value (`openssl rand -hex 64`), then update all 13 locations in lockstep (1 GitHub secret + 4 projects × 3 envs). After rotation, the cache is effectively wiped — first build per task repopulates it.

## Potential Future Improvements

<!-- This link is working, idk what markdownlint's problem is here 🤷‍♂️ -->
<!-- markdown-link-check-disable -->

- [x] ~~Add [syncpack](https://www.npmjs.com/package/syncpack) for consistent dependency versions across all monorepo packages~~ (Now using PNPM catalog)

<!-- markdown-link-check-enable -->

- [ ] Finetune builds. There's probably ways to make the builds of both packages and apps smaller and/or more performant.
- [ ] Make VS Code's "Go To Definition" on a component jump to the actual TypeScript source file instead of the compiled JS file in ./dist
- [ ] Enable additional Trunk linters for production CI (security scanning, image optimization)
