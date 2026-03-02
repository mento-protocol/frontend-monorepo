# PRD: Phase 0 — Borrow Foundation

## Introduction

Phase 0 lays the groundwork for the Mento V3 Borrow section within `app.mento.org`. It covers feature flagging, SDK integration, directory scaffolding, foundational hooks, transaction bridging, Stability Pool ABI extraction, currency formatting, and leverage math extraction. No user-facing functionality ships in this phase — the goal is a solid foundation that Phase 1 (Read Path) and Phase 2 (Write Hooks + Tx Flow) build on top of.

**Base branch:** `feat/borrow` (branched from `feat/v3`)
**Source plan:** `tasks/v3-borrow-project-plan.md` — Section 6

## Goals

- Gate the entire borrow feature behind `NEXT_PUBLIC_ENABLE_BORROW` so it can be developed without affecting production
- Integrate the Mento SDK (`@mento-protocol/mento-sdk@beta`) and verify `BorrowService` works against Celo mainnet
- Scaffold the directory structure in `packages/web3` and `apps/app.mento.org` following existing monorepo patterns
- Provide a `useBorrowService()` hook and `sendSdkTransaction()` bridge so later phases can focus on business logic
- Extract the Stability Pool ABI from the BOLD reference repo (the SDK does not cover stability pools)
- Define frontend-specific types and FX-aware currency formatting utilities
- Extract leverage math from BOLD for Phase 5 use (cheap now, avoids future context-switching)

## User Stories

### US-001: Add feature flag for borrow section

**Description:** As a developer, I need the borrow tab and its content gated behind a feature flag so we can develop iteratively without exposing unfinished work in production.

**Acceptance Criteria:**

- [ ] `NEXT_PUBLIC_ENABLE_BORROW` added to `apps/app.mento.org/app/env.mjs` using the same pattern as `NEXT_PUBLIC_ENABLE_DEBUG` — `z.enum(["true", "false"]).optional().default("false")`
- [ ] Added to `.env.example` with a comment explaining its purpose
- [ ] Set to `"true"` in `.env.development` or `.env.local`
- [ ] Borrow tab in `header.tsx` (line ~49 in the `tabs` array) only renders when flag is `"true"`
- [ ] Borrow section in `page.tsx` (line ~66, the "Coming soon" block) only renders when flag is `"true"`; when `"false"`, selecting the borrow tab is impossible (tab hidden)
- [ ] Typecheck passes (`pnpm check-types`)

### US-002: Install Mento SDK beta with BorrowService

**Description:** As a developer, I need `@mento-protocol/mento-sdk` (beta with `BorrowService`) available in `packages/web3` so that borrow hooks can call SDK methods.

**Acceptance Criteria:**

- [ ] `@mento-protocol/mento-sdk` beta (with `BorrowService`) is listed in `packages/web3/package.json` dependencies — use the published npm beta tag
- [ ] `pnpm install` succeeds without peer dependency conflicts
- [ ] `import { BorrowService } from "@mento-protocol/mento-sdk"` compiles without errors
- [ ] Typecheck passes

### US-003: Scaffold borrow directories in packages/web3

**Description:** As a developer, I need the `packages/web3/src/features/borrow/` directory structure created following the existing `swap/` and `pools/` patterns, so later phases have a clear place to add hooks, atoms, and utilities.

**Acceptance Criteria:**

- [ ] Directory structure created:
  ```text
  packages/web3/src/features/borrow/
  ├── sdk.ts                        # BorrowService factory (placeholder)
  ├── hooks/
  │   └── index.ts                  # Barrel export (empty for now)
  ├── atoms/
  │   └── index.ts                  # Barrel export (empty for now)
  ├── stability-pool/
  │   └── index.ts                  # Barrel export (empty for now)
  ├── tx-flows/
  │   └── index.ts                  # Barrel export (empty for now)
  ├── leverage/
  │   └── index.ts                  # Barrel export (empty for now)
  ├── types.ts                      # Frontend-specific types (see US-009)
  └── index.ts                      # Public API barrel export
  ```
- [ ] `packages/web3/src/features/borrow/index.ts` re-exports from sub-modules
- [ ] Borrow module is exported from the top-level `packages/web3/src/index.ts` (or the relevant features barrel)
- [ ] `tsup` build succeeds (`pnpm --filter @repo/web3 build`)
- [ ] Typecheck passes

### US-004: Scaffold borrow components directory in app

**Description:** As a developer, I need the `apps/app.mento.org/app/components/borrow/` directory created with a placeholder view component and navigation atom, replacing the "Coming soon" text.

**Acceptance Criteria:**

- [ ] Directory structure created:
  ```text
  apps/app.mento.org/app/components/borrow/
  ├── borrow-view.tsx               # Main borrow tab container
  └── atoms/
      └── borrow-navigation.ts      # borrowViewAtom
  ```
- [ ] `borrow-view.tsx` renders a simple placeholder (e.g., "Borrow" heading) — this replaces the existing "Coming soon" `<span>` in `page.tsx`
- [ ] `borrowViewAtom` defined with type `BorrowView` from `packages/web3` types: initial value `"dashboard"`
- [ ] `page.tsx` imports and renders `<BorrowView />` inside the existing borrow tab conditional block
- [ ] Typecheck passes
- [ ] Verify in browser: switching to the Borrow tab shows the new placeholder component (when feature flag is enabled)

### US-005: Create useBorrowService hook

**Description:** As a developer, I need a `useBorrowService()` hook that returns a ready-to-use `BorrowService` instance backed by wagmi's public client, so all borrow hooks can access SDK methods without boilerplate.

**Acceptance Criteria:**

- [ ] Hook lives at `packages/web3/src/features/borrow/hooks/use-borrow-service.ts`
- [ ] Uses `usePublicClient()` from wagmi to get the viem `PublicClient`
- [ ] Uses `useChainId()` from wagmi to detect chain
- [ ] Caches the `BorrowService` instance — only recreates when `publicClient` or `chainId` changes (use `useMemo` or a ref-based cache)
- [ ] Returns `BorrowService` instance (or `null` if client not ready)
- [ ] Exported from `packages/web3/src/features/borrow/hooks/index.ts`
- [ ] Typecheck passes
- [ ] Smoke test: calling `sdk.getSystemParams("GBPm")` from a test component on Celo mainnet (or fork) returns valid data with `mcr`, `ccr`, `minDebt` fields

### US-006: Create send-tx bridge

**Description:** As a developer, I need a `sendSdkTransaction()` function that bridges the SDK's `CallParams` format to wagmi's `sendTransaction`, so write hooks can send SDK-built transactions without manual conversion.

**Acceptance Criteria:**

- [ ] File at `packages/web3/src/features/borrow/tx-flows/send-tx.ts`
- [ ] `sendSdkTransaction(wagmiConfig, callParams, gasHeadroom?)` function:
  - Accepts SDK `CallParams` (`{ to, data, value }` — all strings/hex)
  - Converts to wagmi format: `to` as `Address`, `data` as `Hex`, `value` as `bigint`
  - Calls `sendTransaction` from `@wagmi/core`
  - Returns the transaction hash
  - Default `gasHeadroom` is `0.25` (25% buffer) — if implementing gas estimation, multiply estimated gas by `1 + gasHeadroom`
- [ ] `waitForTx(wagmiConfig, hash)` function:
  - Wraps `waitForTransactionReceipt` from `@wagmi/core`
  - Returns the `TransactionReceipt`
- [ ] Error normalization: catches common wagmi/viem errors and rethrows with user-friendly messages:
  - User rejected → `"Transaction rejected by user"`
  - Reverted → `"Transaction reverted: [reason]"`
  - Insufficient funds → `"Insufficient funds for transaction"`
  - Other → pass through original error message
- [ ] Exported from `packages/web3/src/features/borrow/tx-flows/index.ts`
- [ ] Typecheck passes

### US-007: Extract Stability Pool ABI from BOLD

**Description:** As a developer, I need the `StabilityPool` ABI available in our codebase so that Phase 1 can build direct-contract read hooks for stability pool positions (the SDK does not cover stability pools).

**Acceptance Criteria:**

- [ ] ABI copied from `bold/frontend/app/src/abi/StabilityPool.ts` (the BOLD reference repo at `/home/sol/projects/bold/`)
- [ ] Placed at `packages/web3/src/features/borrow/stability-pool/abi.ts`
- [ ] Exported as a typed const (e.g., `export const stabilityPoolAbi = [...] as const`)
- [ ] Verify the ABI includes these key functions (check against the BOLD source):
  - `provideToSP(uint256 _amount, address _dappAddress)` — deposit
  - `withdrawFromSP(uint256 _amount, address _dappAddress)` — withdraw
  - `getDepositorCollGain(address _depositor)` — read collateral gains
  - `getDepositorYieldGain(address _depositor)` — read yield gains
  - `getTotalBoldDeposits()` — read total pool deposits
  - `getCompoundedBoldDeposit(address _depositor)` — read user's compounded deposit
- [ ] Typecheck passes

### US-008: Extract leverage math from BOLD

**Description:** As a developer, I need the leverage/multiply math functions extracted from BOLD's `liquity-leverage.ts` into our codebase for Phase 5 use, adapted as pure functions with no BOLD-specific imports.

**Acceptance Criteria:**

- [ ] File at `packages/web3/src/features/borrow/leverage/math.ts`
- [ ] Functions extracted from BOLD's `frontend/app/src/liquity-leverage.ts` (at `/home/sol/projects/bold/`):
  - `getOpenLeveragedTroveParams(...)` — calculates collateral/debt for a leveraged open
  - `getLeverUpTroveParams(...)` — calculates params for leveraging up an existing trove
  - `getLeverDownTroveParams(...)` — calculates params for deleveraging
  - `getCloseFlashLoanAmount(...)` — calculates flash loan amount for closing leveraged position
- [ ] All functions are **pure** (no side effects, no contract calls, no imports from BOLD)
- [ ] Parameters use `bigint` types (matching SDK conventions), not BOLD's `Dnum` or similar
- [ ] Each function has a brief JSDoc comment explaining its purpose and parameters
- [ ] Exported from `packages/web3/src/features/borrow/leverage/index.ts`
- [ ] Typecheck passes

### US-009: Define frontend-specific types

**Description:** As a developer, I need frontend-specific TypeScript types that supplement what the SDK provides, so the UI layer and hooks have consistent type contracts.

**Acceptance Criteria:**

- [ ] File at `packages/web3/src/features/borrow/types.ts`
- [ ] Types defined:

  ```typescript
  // Debt token metadata for UI (currency formatting, icons, etc.)
  interface DebtTokenConfig {
    symbol: string; // "GBPm"
    currencySymbol: string; // "£"
    currencyCode: string; // "GBP"
    locale: string; // "en-GB"
  }

  // Sub-view navigation within the borrow tab
  type BorrowView =
    | "dashboard"
    | "open-trove"
    | { view: "manage-trove"; troveId: string }
    | "earn"
    | "redeem";

  // Stability Pool position (not in SDK)
  interface StabilityPoolPosition {
    deposit: bigint;
    collateralGain: bigint; // USDm from liquidations
    debtTokenGain: bigint; // e.g., GBPm yield
  }
  ```

- [ ] Re-export SDK types that the UI layer needs: `BorrowPosition`, `LoanDetails`, `SystemParams`, `CallParams` (verify these are exported by the SDK — if not, define compatible interfaces)
- [ ] A `DEBT_TOKEN_CONFIGS` constant (or `Record<string, DebtTokenConfig>`) with at least `GBPm` defined
- [ ] All types and the config are exported from `packages/web3/src/features/borrow/index.ts`
- [ ] Typecheck passes

### US-010: Create FX-aware currency display utilities

**Description:** As a developer, I need formatting utilities that display amounts in the correct local currency format (e.g., "£1,234.56" for GBPm) so the borrow UI consistently renders monetary values.

**Acceptance Criteria:**

- [ ] File at `packages/web3/src/features/borrow/format.ts` (or similar)
- [ ] `formatDebtAmount(amount: bigint, debtToken: DebtTokenConfig): string`
  - Converts from 18-decimal bigint to human-readable
  - Formats with currency symbol and locale (e.g., `£1,234.56`)
  - Handles zero, very small amounts, and very large amounts gracefully
- [ ] `formatCollateralAmount(amount: bigint): string`
  - Formats as `"1,234.56 USDm"` (always USDm for now)
- [ ] `formatPrice(price: bigint, debtToken: DebtTokenConfig): string`
  - Formats as `"£0.79 per USDm"` — used for liquidation price display
- [ ] `formatInterestRate(rate: bigint): string`
  - Converts 18-decimal rate to percentage string (e.g., `"5.50%"`)
- [ ] `formatLtv(ltv: bigint): string`
  - Converts 18-decimal ratio to percentage string (e.g., `"72.3%"`)
- [ ] All functions handle `null`/`undefined` input gracefully (return `"—"` or similar placeholder)
- [ ] Exported from `packages/web3/src/features/borrow/index.ts`
- [ ] Typecheck passes

## Functional Requirements

- **FR-1:** The system must add `NEXT_PUBLIC_ENABLE_BORROW` to the env schema with default `"false"`, gating the borrow tab and borrow content.
- **FR-2:** When `NEXT_PUBLIC_ENABLE_BORROW` is `"false"`, the borrow tab must not appear in the header navigation and the borrow view must not render. No borrow-related code should be imported (tree-shaken).
- **FR-3:** When `NEXT_PUBLIC_ENABLE_BORROW` is `"true"`, the borrow tab appears in the header and clicking it renders the `BorrowView` component.
- **FR-4:** `@mento-protocol/mento-sdk` (beta with `BorrowService`) must be installed in `packages/web3` and importable.
- **FR-5:** `useBorrowService()` must return a cached `BorrowService` instance using wagmi's public client, recreated only on chain/client change.
- **FR-6:** `sendSdkTransaction()` must convert SDK `CallParams` to wagmi `sendTransaction` format and handle gas estimation with a configurable buffer.
- **FR-7:** `waitForTx()` must return a `TransactionReceipt` or throw a normalized error.
- **FR-8:** The Stability Pool ABI must include all functions needed for deposit, withdraw, and read operations.
- **FR-9:** Leverage math functions must be pure (no side effects, no external imports) and use `bigint` parameters.
- **FR-10:** Currency formatting must use `Intl.NumberFormat` with the correct locale from `DebtTokenConfig` for locale-aware formatting.
- **FR-11:** All new code must be exported through barrel files and included in the `tsup` build output.

## Non-Goals

- **No user-facing borrow functionality** — this phase is scaffolding only. No forms, dashboards, or transaction flows.
- **No tests for individual hooks** — testing of read/write hooks happens in Phase 1 and Phase 2 when there's actual logic to test. If fork infrastructure is available, a single smoke test for `useBorrowService` is sufficient.
- **No Stability Pool hook logic** — we extract the ABI only. Hooks for SP reads/writes come in Phase 1 and Phase 3.
- **No subgraph integration** — MVP uses direct contract reads via SDK. Subgraph is a separate workstream.
- **No multi-debt-token support beyond types** — `DEBT_TOKEN_CONFIGS` defines GBPm only. CHFm and JPYm configs are added when those deployments are ready.
- **No CI/CD changes** — the feature flag keeps borrow hidden in production without needing pipeline changes.

## Technical Considerations

### Existing patterns to follow

- **Hooks:** Follow `packages/web3/src/features/swap/` and `pools/` patterns — React Query for async data, Jotai atoms for UI state, wagmi hooks for chain interaction.
- **Atoms:** Follow `apps/app.mento.org/app/atoms/navigation.ts` pattern — simple `atom()` calls, co-located with the feature.
- **Env vars:** Follow `NEXT_PUBLIC_ENABLE_DEBUG` pattern in `env.mjs` — `z.enum(["true", "false"]).optional().default("false")`.
- **Barrel exports:** Every sub-directory gets an `index.ts` that re-exports its public API.

### SDK dependency

- Use the published beta from npm: `@mento-protocol/mento-sdk@beta` (or the specific beta version with `BorrowService`).
- If the beta isn't on npm yet, fall back to a git dependency pointing to the `feat/trove-management` branch — but prefer npm.
- The SDK is already in the workspace catalog (`catalog:` reference in `package.json`), so the version may need updating there.

### Build

- `packages/web3/tsup.config.ts` already handles the build. New files in `src/features/borrow/` will be included automatically as long as they're reachable from `src/index.ts`.
- No new entry points needed in tsup config.

### Fork-based testing (if available)

- The monorepo already has `fork:mainnet` and `fork:testnet` scripts using Anvil.
- Fork mode is detected via `NEXT_PUBLIC_USE_FORK` env var or `localStorage`.
- No formal test framework (vitest/jest) is set up — don't introduce one in this phase.
- A manual smoke test against a Celo fork (run `pnpm fork:mainnet`, set `NEXT_PUBLIC_USE_FORK=true`, call `sdk.getSystemParams("GBPm")` from a component) is sufficient validation.

### BOLD reference repo

- Located at `/home/sol/projects/bold/`
- Stability Pool ABI: `bold/frontend/app/src/abi/StabilityPool.ts`
- Leverage math: `bold/frontend/app/src/liquity-leverage.ts`
- When extracting, strip all BOLD-specific imports (Dnum, BOLD constants, etc.) and adapt to use `bigint` directly.

## Success Metrics

- All typechecks pass (`pnpm check-types`)
- `tsup` build succeeds for `packages/web3`
- Feature flag correctly hides/shows the borrow tab
- `useBorrowService()` returns a `BorrowService` instance that can call `getSystemParams("GBPm")` on Celo
- `formatDebtAmount(1000000000000000000000n, gbpmConfig)` returns `"£1,000.00"` (or locale-appropriate equivalent)
- All new files follow existing monorepo conventions (barrel exports, file naming, etc.)

## Open Questions

- **SDK beta availability:** Is the `BorrowService` beta published to npm, or do we need a git dependency? Check `npm view @mento-protocol/mento-sdk versions` for available tags.
- **Stability Pool ABI compatibility:** The BOLD ABI may have minor differences from the Mento V3 deployment. Verify function signatures match the deployed contract on Celo.
- **Leverage math adaptations:** BOLD uses `Dnum` (a decimal number library) internally. When converting to `bigint`, confirm precision is preserved for flash loan calculations.
