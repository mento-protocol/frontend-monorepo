# Trunk CLI Developer Guide

[Trunk CLI](https://trunk.io/) is a metalinter that combines multiple linters and formatters into a single, fast, and consistent experience. It replaces the need for separate ESLint, Prettier, and other tool configurations while preserving all your existing rules.

This guide provides detailed information about how Trunk CLI is configured and used in this monorepo.

## VS Code & Cursor Setup

**🚨 Important**: We use the **[Trunk extension](https://marketplace.cursorapi.com/items?itemName=trunk.io)** instead of the ESLint extension for better monorepo support and consistent error detection between CLI and editor.

### Required Setup

1. **Open workspace in VS Code/Cursor**
2. **Install recommended extensions** (VS Code will prompt automatically):
   - ✅ **[Trunk](https://marketplace.cursorapi.com/items?itemName=trunk.io)** - Our main linter/formatter
   - ✅ **Prettier** - Code formatting (integrated with Trunk)
   - ✅ **Tailwind CSS** - Tailwind utilities
   - 🚫 **Disable the ESLint extension for this workspace**

### What This Gives You

- ✅ **Real-time linting** - Same errors as `trunk check --all`
- ✅ **Auto-formatting** - Format on save with all Trunk rules
- ✅ **Monorepo-aware** - Understands workspace structure
- ✅ **Consistent team experience** - Everyone sees the same errors

## What Trunk Does

### 🔍 **Linting & Formatting**

- **ESLint**: Uses your existing configurations (`packages/eslint-config/`)
- **Prettier**: Formats with Tailwind CSS class sorting
- **TypeScript**: Type-aware linting via typescript-eslint
- **Markdown**: Documentation linting (markdownlint + link checking)
- **YAML**: Configuration file formatting (yamllint)
- **Shell Scripts**: shellcheck + shfmt formatting
- **Package.json**: Automatic sorting (sort-package-json)

### 🔒 **Security & Quality**

- **Security Scanning**: Checkov for infrastructure security
- **Secret Detection**: Gitleaks and TruffleHog for credential scanning
- **Vulnerability Scanning**: OSV-scanner for dependency vulnerabilities
- **Git Integrity**: Git diff validation and pre-commit hooks

### 🎨 **Asset Optimization**

- **Image Optimization**: oxipng for PNG compression, svgo for SVG optimization
- **Dependency Management**: dustilock for dependency integrity

### ⚡ **Performance**

- **Incremental**: Only checks changed files by default
- **Parallel**: Runs multiple linters simultaneously
- **Cached**: Results are cached for speed
- **Smart**: Understands monorepo structure

### 🔧 **Git Integration**

- **Pre-commit**: Auto-formats staged files
- **Pre-push**: Comprehensive checks before pushing
- **Commit linting**: Conventional commit validation
- **VS Code**: Real-time feedback and auto-fixing

## Configuration

### Config Reference

- Trunk: [`.trunk/trunk.yaml`](.trunk/trunk.yaml)
- VS Code: [`.vscode/settings.json`](.vscode/settings.json)
- CI: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- ESLint: [`packages/eslint-config/`](packages/eslint-config/)
- Prettier: [`.prettierrc`](.prettierrc)

### [Trunk Configuration](.trunk/trunk.yaml)

The configuration is heavily commented to explain what each tool does.
It includes:

#### Core Development Tools

- ESLint (uses existing monorepo configs)
- Prettier (with Tailwind CSS class sorting)
- TypeScript checking via ESLint

#### Security & Quality

- Multiple secret scanners (Gitleaks, TruffleHog)
- Vulnerability scanning (OSV-Scanner)
- Infrastructure security (Checkov)
- Git integrity validation

#### Asset Optimization

- PNG compression (oxipng)
- SVG optimization (svgo)
- Package.json sorting

#### Documentation & Config

- Markdown linting with link validation
- YAML file validation
- Shell script linting and formatting

#### Git Integration

- Pre-commit formatting hooks
- Pre-push comprehensive checks
- Conventional commit validation

### ESLint Integration

Trunk uses the existing ESLint configurations without modification:

- **Root**: `eslint.config.mjs` → `@repo/eslint-config/base`
- **Apps**: Each app uses `@repo/eslint-config/next-js`
- **Packages**: Use `@repo/eslint-config/react-internal`

**All existing ESLint rules continue to work exactly as before.**

### Prettier Integration

Trunk respects the existing `.prettierrc` configuration

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

# Check only specific linters
trunk check --filter=eslint,gitleaks

# Exclude specific linters
trunk check --exclude=-markdownlint
```

## CI/CD Integration

### GitHub Actions

The CI workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) uses the official Trunk action:

```yaml
- name: Trunk Code Quality
  uses: trunk-io/trunk-action@v1
  with:
    check-mode: all
```

This ensures the same linting rules run in CI as in local development.

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

#### 3. Performance issues

```bash
# Check what's taking time
trunk check --verbose
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

## Advanced Configuration

### Adding New Linters

Here are [all linters supported by trunk](https://docs.trunk.io/code-quality/linters/supported)

To add a new linter, run:

```sh
trunk check enable <linter>
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
    - linters: [gitleaks, trufflehog]
      paths:
        - "test-fixtures/**"
```

### App-Specific Configuration

Create `.trunk/trunk.yaml` in specific apps for custom rules:

```yaml
# apps/specific-app/.trunk/trunk.yaml
lint:
  ignore:
    - linters: [markdownlint]
      paths: ["**/*.md"]
    - linters: [checkov]
      paths: ["**/*"] # Disable security scanning for this app
```
