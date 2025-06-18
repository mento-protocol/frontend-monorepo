# Trunk CLI Developer Guide

This guide provides detailed information about how Trunk CLI is configured and used in this monorepo.

## Team Onboarding: VS Code Setup

**🚨 Important**: We use **Trunk extension** instead of the ESLint extension for better monorepo support.

### Required Setup (All Team Members)

1. **Open workspace in VS Code/Cursor**
2. **Install recommended extensions** (VS Code will prompt automatically):

   - ✅ **Trunk.io** - Our main linter/formatter
   - ✅ **Prettier** - Code formatting (integrated with Trunk)
   - ✅ **Tailwind CSS** - Tailwind utilities
   - 🚫 **DO NOT install ESLint extension** (actively discouraged)

3. **If you already have ESLint extension installed**:

   - It's automatically disabled in workspace settings
   - Consider uninstalling it project-wide for consistency

4. **Verify setup**:
   - Open `apps/ui.mento.org/next.config.ts`
   - You should see red error on line 16: `NODE_ENV is not listed...`
   - This confirms Trunk is working correctly

### What This Gives You

- ✅ **Real-time linting** - Same errors as `trunk check --all`
- ✅ **Auto-formatting** - Format on save with all Trunk rules
- ✅ **Monorepo-aware** - Understands workspace structure
- ✅ **Consistent team experience** - Everyone sees the same errors

## Overview

[Trunk CLI](https://trunk.io/) is our universal code quality tool that combines multiple linters and formatters into a single, fast, and consistent experience. It replaces the need for separate ESLint, Prettier, and other tool configurations while preserving all your existing rules.

## What Trunk Does

### 🔍 **Linting & Formatting**

- **ESLint**: Uses your existing configurations (`packages/eslint-config/`)
- **Prettier**: Formats with Tailwind CSS class sorting
- **TypeScript**: Type-aware linting via typescript-eslint
- **Markdown**: Documentation linting (markdownlint)
- **YAML**: Configuration file formatting (yamllint)
- **Shell Scripts**: shellcheck + shfmt formatting

### ⚡ **Performance**

- **Incremental**: Only checks changed files by default
- **Parallel**: Runs multiple linters simultaneously
- **Cached**: Results are cached for speed
- **Smart**: Understands monorepo structure

### 🔧 **Git Integration**

- **Pre-commit**: Auto-formats staged files
- **Pre-push**: Comprehensive checks before pushing
- **VS Code**: Real-time feedback and auto-fixing

## Configuration

### Main Configuration: `.trunk/trunk.yaml`

```yaml
# Core linters enabled for development
lint:
  enabled:
    - actionlint@1.7.7      # GitHub Actions workflow linting
    - eslint@9.29.0         # JavaScript/TypeScript linting
    - git-diff-check        # Git diff validation
    - markdownlint@0.45.0   # Markdown documentation
    - prettier@3.5.3        # Code formatting
    - shellcheck@0.10.0     # Shell script linting
    - shfmt@3.6.0          # Shell script formatting
    - yamllint@1.37.1      # YAML configuration files

# Performance optimizations
lint:
  ignore:
    - linters: [ALL]
      paths:
        - "**/node_modules/**"
        - "**/.next/**"
        - "**/dist/**"
        - "**/.turbo/**"
```

### ESLint Integration

Trunk uses your existing ESLint configurations without modification:

- **Root**: `eslint.config.mjs` → `@repo/eslint-config/base`
- **Apps**: Each app uses `@repo/eslint-config/next-js`
- **Packages**: Use `@repo/eslint-config/react-internal`

**All your existing ESLint rules continue to work exactly as before.**

### Prettier Integration

Trunk respects your existing `.prettierrc` configuration:

```json
{
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./packages/ui/src/theme.css",
  "tailwindFunctions": ["clsx", "tw"]
}
```

This ensures Tailwind classes are properly sorted according to your custom configuration.

## Usage

### Basic Commands

```bash
# Check all files (or just changed files)
trunk check

# Check specific files/directories
trunk check apps/app.mento.org/
trunk check README.md

# Auto-fix issues
trunk check --fix

# Format files
trunk fmt

# Check only specific linters
trunk check --filter=eslint,prettier
```

### Monorepo Usage

```bash
# From root: Check entire monorepo
pnpm lint

# From root: Check specific app
trunk check apps/app.mento.org/

# From app directory: Check only that app
cd apps/app.mento.org && pnpm lint
```

### Advanced Options

```bash
# Check all files (not just changed)
trunk check --all

# Show detailed progress
trunk check --verbose

# Sample a few files for quick feedback
trunk check --sample=5

# Exclude specific linters
trunk check --filter=-markdownlint

# Check only security-related linters
trunk check --scope=security
```

## VS Code Integration

### Auto-formatting Setup

The workspace is configured in `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit",
    "trunk.check": "explicit"
  },
  "[typescript]": {
    "editor.defaultFormatter": "trunk.io"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "trunk.io"
  }
}
```

### Required Extension

Install the [Trunk VS Code extension](https://marketplace.visualstudio.com/items?itemName=Trunk.io) for:

- Real-time linting feedback
- Auto-formatting on save
- Quick fix suggestions
- Inline error/warning displays

## CI/CD Integration

### GitHub Actions

The CI workflow (`.github/workflows/ci.yml`) uses the official Trunk action:

```yaml
- name: Install Trunk
  uses: trunk-io/trunk-action@v1
  with:
    check-mode: fix

- name: Lint with Trunk
  run: pnpm lint
```

This ensures the same linting rules run in CI as in local development.

### Performance in CI

- **Parallel execution**: Multiple linters run simultaneously
- **Incremental checking**: Only changed files are checked by default
- **Cached results**: Repeated runs are faster
- **Fail fast**: Issues are caught early in the pipeline

## Troubleshooting

### Common Issues

#### 1. "Command not found: trunk"

```bash
# Install Trunk CLI
curl https://get.trunk.io -fsSL | bash

# Or use the VS Code extension
```

#### 2. "ESLint configuration not found"

```bash
# Trunk automatically detects ESLint configs
# Verify your eslint.config.js is in the right location
trunk check --verbose  # Shows configuration loading
```

#### 3. "Plugin not found" errors

```bash
# Update Trunk to latest version
trunk upgrade

# Check plugin status
trunk check --verbose
```

#### 4. Performance issues

```bash
# Check what's taking time
trunk check --verbose

# Reduce scope for development
trunk check --sample=10
```

### Debug Mode

```bash
# Verbose output for debugging
trunk check --verbose

# See which files are being checked
trunk check --print-failures

# Test specific linter
trunk check --filter=eslint --verbose
```

## Migration from Previous Setup

### What Changed

**Before (Next.js lint):**

- Each app ran `next lint` independently
- Prettier run separately
- Manual coordination between tools
- Inconsistent configurations

**After (Trunk):**

- Single `trunk check` command
- All linters run together
- Consistent rules across monorepo
- Auto-fixing capabilities
- Better performance

### What Stayed the Same

- ✅ All ESLint rules preserved
- ✅ Prettier configuration unchanged
- ✅ TypeScript checking unchanged
- ✅ Git hooks still work
- ✅ CI/CD integration maintained

### Commands Mapping

| Old Command        | New Command     | Notes                             |
| ------------------ | --------------- | --------------------------------- |
| `next lint`        | `pnpm lint`     | Now runs Trunk with ESLint + more |
| `prettier --write` | `pnpm format`   | Uses Trunk formatting             |
| `eslint --fix`     | `pnpm lint:fix` | Auto-fixes all supported issues   |

## Advanced Configuration

### Adding New Linters

To enable additional linters (e.g., for production CI):

```yaml
# .trunk/trunk.yaml
lint:
  enabled:
    - checkov@3.2.442 # Security scanning
    - osv-scanner@2.0.3 # Vulnerability scanning
    - oxipng@9.1.5 # Image optimization
```

### Custom Ignore Patterns

```yaml
# .trunk/trunk.yaml
lint:
  ignore:
    - linters: [prettier]
      paths:
        - "legacy-code/**"
    - linters: [eslint]
      paths:
        - "generated/**"
```

### App-Specific Configuration

Create `.trunk/trunk.yaml` in specific apps for custom rules:

```yaml
# apps/special-app/.trunk/trunk.yaml
lint:
  ignore:
    - linters: [markdownlint]
      paths: ["**/*.md"]
```

## Best Practices

### 1. **Commit Workflow**

```bash
# Make changes
git add .

# Pre-commit hook automatically formats
git commit -m "feat: add new feature"

# Pre-push hook runs comprehensive checks
git push
```

### 2. **Development Workflow**

```bash
# Start development
pnpm dev

# Quick check during development
trunk check --sample=5

# Before committing
pnpm lint:fix
```

### 3. **Performance Tips**

- Use `--sample` for quick feedback during development
- Let pre-commit hooks handle formatting automatically
- Run full checks (`pnpm lint`) before creating PRs

### 4. **Team Collaboration**

- Trunk configuration is committed to git
- All team members get consistent results
- VS Code extension provides immediate feedback
- CI enforces the same rules

## Support & Resources

- **Trunk Documentation**: <https://docs.trunk.io>
- **VS Code Extension**: <https://marketplace.visualstudio.com/items?itemName=Trunk.io>
- **GitHub Action**: <https://github.com/trunk-io/trunk-action>
- **Community Slack**: <https://slack.trunk.io>

## Configuration Reference

For the complete, up-to-date configuration, see:

- Main config: `.trunk/trunk.yaml`
- VS Code: `.vscode/settings.json`
- CI: `.github/workflows/ci.yml`
- ESLint: `packages/eslint-config/`
- Prettier: `.prettierrc`
