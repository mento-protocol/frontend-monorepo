#!/usr/bin/env bash

# Worktree Setup Script
# This script sets up a new git worktree with all necessary dependencies and builds
# Requires: Bash 4.0 or higher

set -e # Exit on error

# Check Bash version
if ((BASH_VERSINFO[0] < 4)); then
	echo "Error: This script requires Bash 4.0 or higher. Current version: ${BASH_VERSION}"
	exit 1
fi

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_step() {
	echo -e "${BLUE}==>${NC} $1"
}

print_success() {
	echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
	echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
	echo -e "${RED}✗${NC} $1"
}

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
	print_error "Error: package.json not found. Please run this script from the root of the frontend-monorepo."
	exit 1
fi

print_step "Setting up worktree environment..."
echo ""

# Check Node version
print_step "Checking Node.js version..."
if ! command -v node &>/dev/null; then
	print_error "Node.js is not installed. Please install Node.js >= 22"
	exit 1
fi

CURRENT_NODE_VERSION=$(node -v)
NODE_VERSION_TRIMMED=$(echo "${CURRENT_NODE_VERSION}" | cut -d 'v' -f 2)
NODE_VERSION=$(echo "${NODE_VERSION_TRIMMED}" | cut -d '.' -f 1)
if [[ ${NODE_VERSION} -lt 22 ]]; then
	print_error "Node.js version must be >= 22. Current version: ${CURRENT_NODE_VERSION}"
	exit 1
fi
print_success "Node.js version: ${CURRENT_NODE_VERSION}"
echo ""

# Check pnpm version
print_step "Checking pnpm version..."
if ! command -v pnpm &>/dev/null; then
	print_error "pnpm is not installed. Installing pnpm via corepack..."
	# Use corepack (built into Node.js) for secure package manager installation
	# Corepack uses the packageManager field in package.json for version pinning
	corepack enable
	corepack prepare pnpm@10.17.1 --activate
fi

PNPM_VERSION=$(pnpm -v)
print_success "pnpm version: ${PNPM_VERSION}"
echo ""

# Install turbo globally
print_step "Installing turbo globally..."
pnpm add -g turbo
if ! command -v turbo &>/dev/null; then
	print_error "Turbo installation failed. Please check your pnpm configuration."
	exit 1
fi
TURBO_FULL_OUTPUT=$(turbo --version)
TURBO_VERSION=$(echo "${TURBO_FULL_OUTPUT}" | head -n 1)
print_success "Turbo version: ${TURBO_VERSION}"
echo ""

# Install dependencies
print_step "Installing dependencies..."
pnpm install --frozen-lockfile
print_success "Dependencies installed"
echo ""

# Build packages (required before running dev)
print_step "Building packages..."
print_warning "This may take a few minutes..."
turbo run build --filter "./packages/*"
print_success "Packages built successfully"
echo ""

# Check types
print_step "Verifying TypeScript configuration..."
turbo run check-types
print_success "TypeScript checks passed"
echo ""

# Final message
echo ""
print_success "Worktree setup complete!"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  • To start development: ${GREEN}turbo dev --filter <app-name>${NC}"
echo "  • Available apps:"
echo "    - app.mento.org"
echo "    - governance.mento.org"
echo "    - reserve.mento.org"
echo "    - ui.mento.org"
echo ""
echo "  • To run linters: ${GREEN}trunk check --fix${NC}"
echo "  • To check types: ${GREEN}turbo check-types${NC}"
echo ""
