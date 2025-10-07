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
- **[GitHub Actions](https://github.com/features/actions)**: For CI/CD (with Turborepo caching for builds via Vercel)

## Repo Structure

```txt
frontend-monorepo/
├── apps/                     # Frontend applications
│   ├── app.mento.org/        # Mento Exchange UI
│   ├── governance.mento.org/ # Governance UI
│   ├── minipay.mento.org/    # MiniPay DApp
│   ├── reserve.mento.org/    # Reserve UI
│   └── ui.mento.org/         # Component Library Showcase
│
├── packages/                 # Shared packages
│   ├── eslint-config/        # Shared ESLint configuration
│   ├── typescript-config/    # Shared TypeScript configuration
│   ├── ui/                   # Shared UI library with tailwind styles and shadcn/ui components
│   └── web3/                 # Shared library with web3-specific components and hooks
│
├── .github/                  # GitHub workflows
│   └── workflows/            # CI/CD workflows
├── .trunk/                   # Trunk CLI configuration and cache
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

3. Build all packages:

   ```bash
   turbo build
   ```

4. Start the development server for all applications:

   ```bash
   turbo dev
   ```

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
```

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

### Working with Shared UI Components

The UI package is located in `packages/ui/` and contains reusable components built with shadcn/ui.

#### Adding a New Component via shadcn/ui

shadcn/ui is our component base layer we extend from.

1. Install the shadcn/ui component you need: `pnpm dlx shadcn@latest add button`
1. Customize it to your needs by simply editing `./packages/ui/src/components/ui/button.tsx`
1. Export the new component from the main barrel file `./packages/ui/src/index.ts`
1. Build the UI package: `pnpm build --filter @repo/ui`

#### Adding a New Custom Component (without shadcn/ui)

1. Create a new component in `packages/ui/src/components`
1. Export it from `packages/ui/src/index.ts`
1. Build the UI package: `pnpm build --filter @repo/ui`

#### Using UI Components in Applications

Import components into an application:

```tsx
// layout.tsx
import "@repo/ui/globals.css"; // Import once at the top of the app
import { Button } from "@repo/ui";
```

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
- **Pre-push**: Run comprehensive checks before pushing
- **Commit-msg**: Validate commit message format

## CI/CD Pipeline

The repository is set up with GitHub Actions for CI/CD:

- **CI**: On every PR, it runs linting (via Trunk), type checking, and builds all packages
- **CD**: On merges to main, it deploys applications to Vercel

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

This repository has Signed Remote Caching enabled (`"signature": true` in `turbo.json`) for enhanced security. This prevents cache poisoning by ensuring only trusted sources can write to the cache.

- **How it works:** Artifacts uploaded to the cache are signed using a secret key. Artifacts downloaded are verified against this signature.
- **CI Requirement:** The signing key must be provided to the CI environment via the `TURBO_REMOTE_CACHE_SIGNATURE_KEY` environment variable. This should be configured as a Repository Secret in GitHub Actions settings.
- **Local Requirement:** If you need to _write_ to the cache locally (i.e., upload artifacts that weren't already there) with signing enabled, you would also need to set the `TURBO_REMOTE_CACHE_SIGNATURE_KEY` environment variable in your local shell. Reading from the cache generally doesn't require the key.

## Potential Future Improvements

<!-- This link is working, idk what markdownlint's problem is here 🤷‍♂️ -->
<!-- markdown-link-check-disable -->

- [ ] Add [syncpack](https://www.npmjs.com/package/syncpack) for consistent dependency versions across all monorepo packages
<!-- markdown-link-check-enable -->
- [ ] Finetune builds. There's probably ways to make the builds of both packages and apps smaller and/or more performant.
- [ ] Make VS Code's "Go To Definition" on a component jump to the actual TypeScript source file instead of the compiled JS file in ./dist
- [ ] Enable additional Trunk linters for production CI (security scanning, image optimization)
