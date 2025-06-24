#!/usr/bin/env sh

# Exit immediately if a command exits with a non-zero status.
# set -euo pipefail

echo "🚀 Running Health Checks..."

# Run checks sequentially, stopping if any fail.
# Faster checks first.

printf "\n🔍 Checking formatting...\n"
pnpm format:check

printf "\n🧹 Linting...\n"
pnpm lint

printf "\n🧐 Checking types...\n"
pnpm check-types

# Once we have a test suite, uncomment this.
# printf "\n🧪 Running tests...\n"
# pnpm test

printf "\n🧱 Building...\n"
pnpm build

printf "\n✅ All Health Checks Passed!\n"
