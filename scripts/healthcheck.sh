#!/usr/bin/env sh

# Exit immediately if a command exits with a non-zero status.
# set -euo pipefail

echo "🚀 Running Health Checks..."

# Run checks sequentially, stopping if any fail.
# Faster checks first.

echo "\n🔍 Checking formatting..."
pnpm format:check

echo "\n🧹 Linting..."
pnpm lint

echo "\n🧐 Checking types..."
pnpm check-types

# Once we have a test suite, uncomment this.
# echo "\n🧪 Running tests..."
# pnpm test

echo "\n🧱 Building..."
pnpm build

echo "\n✅ All Health Checks Passed!"
