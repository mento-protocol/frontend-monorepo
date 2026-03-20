# TODO - app.mento.org Technical Debt

**Last Updated**: 2026-01-21

## Table of Contents

- [High Priority](#high-priority)
- [Medium Priority](#medium-priority)
- [Low Priority](#low-priority)
- [Code Quality Notes](#code-quality-notes)

---

## High Priority

### 1. Sentry Configuration Deprecation Warnings

**Severity**: 🟠 HIGH
**File**: `next.config.ts:64-66, 75, 81`

**Warnings**:

```bash
DEPRECATION WARNING: disableLogger is deprecated. Use webpack.treeshake.removeDebugLogging instead.
DEPRECATION WARNING: automaticVercelMonitors is deprecated. Use webpack.automaticVercelMonitors instead.
DEPRECATION WARNING: reactComponentAnnotation is deprecated. Use webpack.reactComponentAnnotation instead.
```

**Recommended Fix**:
Update Sentry configuration to use the new `webpack` key structure.

**Why High Priority**: Will break in future @sentry/nextjs versions.

---

### 2. Environment Variable Name Inconsistency

**Severity**: 🟠 HIGH
**Files**: `.env.example`, `.env`, `app/env.mjs`

**Issue**:
Confusion between variable names:

- `.env.example` shows: `NEXT_PUBLIC_WALLET_CONNECT_ID`
- Actual `.env` has: `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` (line 11)
- `env.mjs` expects: `NEXT_PUBLIC_WALLET_CONNECT_ID`

**Recommended Fix**:
Standardize on `NEXT_PUBLIC_WALLET_CONNECT_ID` across all files and update documentation.

---

## Medium Priority

### 3. Node Version Mismatch

**Severity**: 🟡 MEDIUM
**Files**: `package.json`, root `package.json`

**Issue**:

- app.mento.org `volta.node`: `18.20.7`
- Root monorepo `engines.node`: `>=22`

**Recommended Fix**:
Update app.mento.org package.json to align with monorepo requirements.

---

### 4. Missing Tailwind Configuration

**Severity**: 🟡 MEDIUM
**File**: `apps/app.mento.org/` (missing `tailwind.config.ts`)

**Issue**:
App has `postcss.config.mjs` referencing `@tailwindcss/postcss`, but no explicit Tailwind configuration file at app level.

**Recommended Fix**:
Either add explicit `tailwind.config.ts` or document that Tailwind config is intentionally handled by @repo/ui package.

---

### 5. TSUP Self-Reference in web3 Package

**Severity**: 🟡 MEDIUM
**File**: `packages/web3/tsup.config.ts:19-26`

**Issue**:
`@repo/web3` is listed in its own `external` dependencies array.

**Recommended Fix**:
Remove `@repo/web3` from external dependencies list as it's the package being built.

---

### 6. Dependency Version Conflicts

**Severity**: 🟡 MEDIUM
**File**: Root `package.json:47-83`

**Issue**:
pnpm overrides and resolutions show potential version conflicts (zod, @tanstack/react-query).

**Recommended Fix**:
Audit dependency tree and align catalog versions with overrides, or document why overrides are needed.

---

### 7. Missing Sentry Auth Token in .env.example

**Severity**: 🟡 MEDIUM
**Files**: `.env.example`, `next.config.ts:58`

**Issue**:
`SENTRY_AUTH_TOKEN` required for source map uploads but missing from .env.example.

**Recommended Fix**:
Add `SENTRY_AUTH_TOKEN` to `.env.example` with documentation.

---

## Low Priority

### 8. Redundant Webpack Fallback Configuration

**Severity**: 🟢 LOW
**File**: `next.config.ts:28-43`

**Issue**:
React Native module exclusion uses both `fallback` and `alias` set to `false` (redundant).

**Recommended Fix**:
Use only `fallback` configuration (remove redundant alias).

---

### 9. Type Assertion Documentation

**Severity**: 🟢 LOW
**File**: `app/components/swap/swap-form.tsx`

**Issue**:
Multiple type assertions using `as` keyword without JSDoc explaining why they're safe.

**Recommended Fix**:
Add JSDoc comments explaining type safety guarantees from form validation.

---

### 10. Unsafe Type Assertion in web3 Config

**Severity**: 🟢 LOW
**File**: `packages/web3/src/config/config.ts:13`

**Issue**:
Using `as string` without runtime validation for env var.

**Recommended Fix**:
Use zod validation like main `env.mjs` does.

---

### 11. Magic Number - Celo Chain ID Default

**Severity**: 🟢 LOW
**File**: `app/components/swap/swap-form.tsx:79`

**Issue**:
Hardcoded `42220` for Celo mainnet chain ID.

**Recommended Fix**:
Extract to named constant.

---

## Code Quality Notes

### Null/Undefined Handling Patterns

**Files**: Multiple

**Observations**:

- Some optional chaining patterns that could fail silently
- Most have proper fallbacks or validation
- No runtime errors expected

---

### Error Boundary Coverage

**Status**: ✅ GOOD

Proper React Error Boundary implementation with Sentry logging in `app/components/errors.tsx`.

---

## Summary

| Priority  | Count  |
| --------- | ------ |
| 🟠 High   | 2      |
| 🟡 Medium | 5      |
| 🟢 Low    | 4      |
| 📝 Notes  | 2      |
| **Total** | **13** |
