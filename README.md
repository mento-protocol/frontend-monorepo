# Frontend Monorepo

This is a monorepo for frontend applications, designed to facilitate sharing code like components, styles, utils, and configs between different applications.

## Technology Stack

- **Turborepo**: For monorepo management and build tooling
- **Tailwind CSS**: For styling with shadcn/ui components
- **Changesets**: For managing versions and generating changelogs
- **GitHub Actions**: For CI/CD (with Turborepo caching via Vercel)
- **Vercel**: As the deployment target
- **TypeScript**: As the main language with shared, extendable config
- **PNPM**: As the package manager
- **Husky & Commitlint**: For Git hooks and conventional commits

## Repository Structure

```txt
frontend-monorepo/
├── apps/                     # Frontend applications
│   ├── app.mento.org/        # Example Next.js application
├── packages/                 # Shared packages
│   ├── eslint-config/        # Shared ESLint configuration
│   ├── typescript-config/    # Shared TypeScript configuration
│   └── ui/                   # Shared UI library with tailwind styles and shadcn/ui components
├── .changeset/               # Changesets for versioning
├── .github/                  # GitHub workflows
│   └── workflows/            # CI/CD workflows
├── turbo.json                # Turborepo configuration
└── pnpm-workspace.yaml       # PNPM workspace configuration
```

## Getting Started

### Prerequisites

- Node.js (v22 or later)
- PNPM (v10 or later)

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd frontend-monorepo
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build all packages:

   ```bash
   pnpm build
   ```

4. Start the development server for all applications:

   ```bash
   pnpm dev
   ```

## Development Workflow

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

The pre-commit hook will run linters and type checking, while the commit-msg hook will validate your commit message format.

### Running a Single Application

To run a specific application:

```bash
cd apps/<app-name>
pnpm dev
```

Or from the root directory:

```bash
pnpm --filter <app-name> dev
```

### Building a Single Application

To build a specific application:

```bash
pnpm --filter <app-name> build
```

### Working with Shared UI Components

The UI package is located in `packages/ui/` and contains reusable components built with shadcn/ui.

#### Adding a New Component

1. Create a new component in `packages/ui/src/`
2. Export it from `packages/ui/src/index.ts`
3. Build the UI package:

   ```bash
   pnpm --filter @repo/ui build
   ```

#### Using UI Components in Applications

Import components in your application:

```tsx
import { Button } from "@repo/ui/button";
import "@repo/ui/styles.css"; // Import once in your app
```

### Versioning and Publishing

This repository uses Changesets to manage versions and changelogs.

#### Creating a Changeset

When you make changes that should be published:

```bash
pnpm changeset
```

Follow the prompts to specify the type of change (patch, minor, major) and describe the changes.

#### Versioning Packages

To update versions based on changesets:

```bash
pnpm version
```

#### Publishing Packages

To publish packages to the registry:

```bash
pnpm release
```

## CI/CD Pipeline

The repository is set up with GitHub Actions for CI/CD:

- **CI**: On every PR, it runs linting, type checking, and builds all packages
- **CD**: On merges to main, it deploys applications to Vercel

### Turborepo Remote Caching

The CI/CD pipeline is configured to use Turborepo's remote caching with Vercel for faster builds.

To enable remote caching locally:

```bash
pnpm dlx turbo login
pnpm dlx turbo link
```

## Troubleshooting

### Common Issues

- **Typescript Errors**: Make sure all dependencies are installed and you've built the packages:

  ```bash
  pnpm install
  pnpm build
  ```

- **Component not found**: Ensure the UI package is built and exported correctly:

  ```bash
  pnpm --filter @repo/ui build
  ```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
