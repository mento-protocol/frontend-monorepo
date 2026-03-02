# Mento V3 Borrow Section — Project Plan

> **Base branch:** `feat/borrow` (branched from `feat/v3`)
> **Feature flag:** `NEXT_PUBLIC_ENABLE_BORROW` (always `"true"` in development)
> **Source reference:** [Liquity V2 / BOLD](https://github.com/mento-protocol/bold) (Mento fork)
> **SDK version:** `@mento-protocol/mento-sdk@^3.0.0-beta.18` — BorrowService (complete, beta published)
> **Previous agent plan:** SDK work is complete (beta published); this plan covers web3 hooks → app UI
> **Date:** 2026-03-01
> **Last updated:** 2026-03-01 — Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 complete

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Mento SDK BorrowService — What It Gives Us](#3-mento-sdk-borrowservice--what-it-gives-us)
4. [Data Model](#4-data-model)
5. [Technical Decisions](#5-technical-decisions)
6. [Phase 0 — Foundation](#6-phase-0--foundation)
7. [Phase 1 — Read Path (Dashboard + Positions)](#7-phase-1--read-path)
8. [Phase 2 — Transaction Flow Engine](#8-phase-2--transaction-flow-engine)
9. [Phase 3 — Core Trove Operations](#9-phase-3--core-trove-operations)
10. [Phase 4 — Stability Pool](#10-phase-4--stability-pool)
11. [Phase 5 — Leverage / Multiply](#11-phase-5--leverage--multiply)
12. [Phase 6 — Multi-Debt Expansion](#12-phase-6--multi-debt-expansion)
13. [Cross-Cutting Concerns](#13-cross-cutting-concerns)
14. [What We Drop from BOLD](#14-what-we-drop-from-bold)
15. [Risk Register](#15-risk-register)
16. [Reference: BOLD → Mento Mapping](#16-reference-bold--mento-mapping)

---

## 1. Overview

### What we're building

A **Borrow** section within `app.mento.org` that lets users open and manage
Liquity-style Troves on Celo. Users deposit USDm (a wrapper for USDT/USDC) as
collateral and mint local-currency stablecoins (starting with GBPm, then CHFm,
JPYm). The section includes Stability Pool operations and, in a later phase,
leveraged/multiply positions.

### How it fits into the monorepo

```
apps/app.mento.org          — Existing swap + pool app; borrow tab added here
packages/web3               — Thin integration layer: hooks wrapping SDK + Stability Pool
packages/ui                 — Extend as needed with borrow-specific components
@mento-protocol/mento-sdk   — BorrowService handles all trove chain logic
```

The borrow tab already exists in the header navigation (`header.tsx` line 49)
with a "Coming soon" placeholder (`page.tsx` line 84–89). We replace that
placeholder with the actual borrow UI, guarded by a feature flag.

### Navigation model

The app uses **tab-based navigation** via a Jotai atom (`activeTabAtom`), not
URL routing. The borrow section follows this same pattern:

- Top-level tabs: `swap | pool | borrow`
- Within the borrow tab: sub-views managed by a borrow-specific Jotai atom
  (e.g., `borrowViewAtom`: `dashboard | open-trove | manage-trove | earn | redeem`)
- This keeps the borrow section consistent with how swap and pool work today

If the team later decides to move to URL-based routing (Next.js App Router),
the borrow components are structured to make that migration straightforward —
each sub-view is a self-contained component.

---

## 2. Architecture

### Layer diagram

```
┌──────────────────────────────────────────────────────────┐
│  UI Layer (apps/app.mento.org/app/components/borrow/)    │
│  Built with @repo/ui (shadcn + Tailwind)                 │
│  Follows pool/ component pattern for consistency         │
├──────────────────────────────────────────────────────────┤
│  View Logic (Jotai atoms + React hooks)                  │
│  borrowViewAtom, form atoms, flow atoms                  │
├──────────────────────────────────────────────────────────┤
│  Integration Layer (packages/web3/src/features/borrow/)  │
│  React hooks wrapping SDK calls                          │
│  Tx flow engine (Jotai-based)                            │
│  Stability Pool (not in SDK — built from scratch)        │
├──────────────────────────────────────────────────────────┤
│  Mento SDK — BorrowService                               │
│  Transaction building, reads, math, approvals, hints     │
│  All ABIs, address resolution, multi-deployment          │
├──────────────────────────────────────────────────────────┤
│  Chain Layer (wagmi + viem)                               │
│  Shared wagmi provider from @repo/web3                   │
│  SDK uses viem PublicClient internally                   │
└──────────────────────────────────────────────────────────┘
```

### Package structure

The SDK covers trove operations end-to-end, so `packages/web3/src/features/borrow/`
is a **thin integration layer** — primarily React hooks and the tx flow engine.

```
packages/web3/src/features/borrow/
├── sdk.ts                        # BorrowService singleton/factory
├── stability-pool/               # NOT in SDK — built from scratch
│   ├── abi.ts                    # StabilityPool ABI
│   ├── hooks.ts                  # use-stability-pool, use-sp-stats
│   └── tx-builders.ts            # SP transaction builders
├── hooks/
│   │  # --- Read hooks (thin wrappers around SDK via React Query) ---
│   ├── use-borrow-service.ts     # SDK BorrowService access hook
│   ├── use-trove-data.ts         # sdk.getTroveData(symbol, troveId)
│   ├── use-user-troves.ts        # sdk.getUserTroves(symbol, owner)
│   ├── use-system-params.ts      # sdk.getSystemParams(symbol)
│   ├── use-collateral-price.ts   # sdk.getCollateralPrice(symbol)
│   ├── use-branch-stats.ts       # sdk.getBranchStats(symbol) + getAverageInterestRate()
│   ├── use-interest-rate-brackets.ts  # sdk.getInterestRateBrackets(symbol)
│   ├── use-predict-upfront-fee.ts     # sdk.predictOpenTroveUpfrontFee() etc.
│   ├── use-borrow-allowance.ts   # sdk.getCollateralAllowance() / getDebtAllowance()
│   ├── use-next-owner-index.ts   # sdk.getNextOwnerIndex(symbol, owner)
│   │  # --- Derived/computed hooks (SDK reads + SDK math, no direct contract calls) ---
│   ├── use-loan-details.ts       # use-collateral-price + SDK getLoanDetails() math
│   ├── use-debt-suggestions.ts   # use-loan-details + SDK calculateDebtSuggestions()
│   ├── use-interest-rate-chart-data.ts  # Transforms rate brackets into chart format
│   ├── use-redemption-risk.ts    # rate brackets + SDK getRedemptionRisk()
│   │  # --- Write hooks (SDK build*Transaction → wagmi sendTransaction) ---
│   ├── use-open-trove.ts         # approve → sdk.buildOpenTroveTransaction() → send
│   ├── use-adjust-trove.ts       # approve? → sdk.buildAdjustTroveTransaction() → send
│   ├── use-close-trove.ts        # approve? → sdk.buildCloseTroveTransaction() → send
│   ├── use-adjust-interest-rate.ts  # sdk.buildAdjustInterestRateTransaction() → send
│   ├── use-claim-collateral.ts   # sdk.buildClaimCollateralTransaction() → send
│   ├── use-borrow-approval.ts    # sdk.buildCollateralApprovalParams() → send
│   │  # --- Stability Pool hooks (not in SDK) ---
│   ├── use-stability-pool.ts     # Direct contract reads
│   ├── use-sp-deposit.ts         # Direct StabilityPool.provideToSP() → send
│   ├── use-sp-withdraw.ts        # Direct StabilityPool.withdrawFromSP() → send
│   └── index.ts
├── tx-flows/
│   ├── engine.ts                 # Flow state machine (Jotai atoms)
│   ├── types.ts                  # FlowDeclaration, FlowStep, FlowStatus
│   └── send-tx.ts                # CallParams → wagmi sendTransaction bridge
├── atoms/
│   ├── deployment-atoms.ts       # Selected debt token symbol
│   ├── trove-form-atoms.ts       # Open/adjust trove form state
│   ├── earn-form-atoms.ts        # Stability pool form state
│   └── flow-atoms.ts             # Current tx flow state
├── leverage/                     # Phase 5 — not in SDK
│   └── math.ts                   # Flash loan calculations (from BOLD)
├── types.ts                      # Frontend-specific types (extends SDK types)
└── index.ts                      # Public API exports

apps/app.mento.org/app/components/borrow/
├── borrow-view.tsx            # Main borrow tab container (view router)
├── dashboard/
│   ├── borrow-dashboard.tsx   # Position overview
│   ├── position-card.tsx      # Single trove summary card
│   └── stability-card.tsx     # SP position summary card
├── open-trove/
│   ├── open-trove-form.tsx    # Main form (3 sections: collateral, debt, rate)
│   ├── collateral-input.tsx
│   ├── debt-input.tsx
│   ├── interest-rate-input.tsx  # Manual/delegate/batch manager modes
│   ├── interest-rate-chart.tsx  # Mini bar chart of debt distribution by rate
│   └── loan-summary.tsx       # LTV, liquidation price, risk badge
├── manage-trove/
│   ├── manage-trove-view.tsx  # Tab container (adjust | rate | close)
│   ├── adjust-form.tsx
│   ├── rate-form.tsx
│   └── close-form.tsx
├── earn/
│   ├── earn-view.tsx          # Stability pool main view
│   ├── deposit-form.tsx
│   └── withdraw-form.tsx
├── redeem/
│   └── redeem-form.tsx
├── leverage/                  # Phase 5
│   ├── leverage-form.tsx
│   └── leverage-slider.tsx
├── shared/
│   ├── debt-token-selector.tsx
│   ├── flow-dialog.tsx        # Multi-step tx progress modal
│   ├── flow-step.tsx
│   ├── risk-badge.tsx
│   ├── currency-display.tsx   # FX-aware price formatting
│   └── trove-metrics.tsx      # Reusable LTV, CR, liquidation price display
└── atoms/
    └── borrow-navigation.ts   # borrowViewAtom + sub-view state
```

---

## 3. Mento SDK BorrowService — What It Gives Us

The SDK's `feat/trove-management` branch provides a comprehensive `BorrowService`
(~2,600 LOC) that eliminates most chain interaction work. This is the single
biggest simplification to the project plan.

### SDK provides (we DON'T build)

| Capability                 | SDK Method                                      | Notes                                  |
| -------------------------- | ----------------------------------------------- | -------------------------------------- |
| **Open trove**             | `buildOpenTroveTransaction()`                   | Returns `CallParams` (to, data, value) |
| **Adjust trove**           | `buildAdjustTroveTransaction()`                 | Handles coll+debt changes              |
| **Close trove**            | `buildCloseTroveTransaction()`                  |                                        |
| **Add collateral**         | `buildAddCollTransaction()`                     | Convenience wrapper                    |
| **Withdraw collateral**    | `buildWithdrawCollTransaction()`                |                                        |
| **Borrow more**            | `buildBorrowMoreTransaction()`                  |                                        |
| **Repay debt**             | `buildRepayDebtTransaction()`                   |                                        |
| **Change interest rate**   | `buildAdjustInterestRateTransaction()`          |                                        |
| **Claim surplus**          | `buildClaimCollateralTransaction()`             |                                        |
| **Batch managers**         | `buildSetBatchManagerTransaction()` etc.        | Join/leave/switch                      |
| **Interest delegates**     | `buildSetInterestDelegateTransaction()` etc.    |                                        |
| **Approve collateral**     | `buildCollateralApprovalParams()`               | ERC20 approve calldata                 |
| **Approve debt token**     | `buildDebtApprovalParams()`                     |                                        |
| **Approve gas token**      | `buildGasCompensationApprovalParams()`          |                                        |
| **Check allowances**       | `getCollateralAllowance()` etc.                 |                                        |
| **Read trove**             | `getTroveData(symbol, troveId)`                 | Returns `BorrowPosition`               |
| **List user troves**       | `getUserTroves(symbol, owner)`                  | All troves for address                 |
| **Collateral price**       | `getCollateralPrice(symbol)`                    | From oracle                            |
| **System params**          | `getSystemParams(symbol)`                       | MCR, CCR, minDebt, etc.                |
| **Branch stats**           | `getBranchStats(symbol)`                        | Total coll, total debt                 |
| **Interest brackets**      | `getInterestRateBrackets(symbol)`               | Rate distribution                      |
| **Avg interest rate**      | `getAverageInterestRate(symbol)`                | Weighted average                       |
| **Fee predictions**        | `predictOpenTroveUpfrontFee()` etc.             | For all operations                     |
| **Shutdown check**         | `isSystemShutDown(symbol)`                      |                                        |
| **Next owner index**       | `getNextOwnerIndex(symbol, owner)`              |                                        |
| **Math: LTV**              | `getLtv()`                                      | Pure function                          |
| **Math: Liquidation**      | `getLiquidationPrice()`, `getLiquidationRisk()` |                                        |
| **Math: Redemption**       | `getRedemptionRisk()`                           |                                        |
| **Math: Loan details**     | `getLoanDetails()`                              | Full computed metrics                  |
| **Math: Debt suggestions** | `calculateDebtSuggestions()`                    | 30/60/80% presets                      |
| **Hint computation**       | Internal — used by tx builders                  | We don't call this                     |
| **Address resolution**     | Via `AddressesRegistry` per debt token          | Lazy + cached                          |
| **ABIs**                   | All 10+ contract ABIs exported                  |                                        |
| **Multi-deployment**       | `borrowRegistries[chainId][symbol]`             | GBPm on Celo mainnet                   |

### SDK does NOT provide (we MUST build)

| Capability                        | Approach                                            |
| --------------------------------- | --------------------------------------------------- |
| **Stability Pool operations**     | Direct contract calls with SP ABI from BOLD         |
| **Redemptions**                   | Direct contract call to CollateralRegistry          |
| **Leverage / Multiply**           | Flash loan math from BOLD + Zapper contract calls   |
| **Transaction signing/sending**   | Bridge SDK's `CallParams` → wagmi `sendTransaction` |
| **Gas estimation**                | `publicClient.estimateGas()` on SDK's CallParams    |
| **Multi-step flow orchestration** | Jotai-based tx flow engine                          |
| **All UI components**             | Rewrite with @repo/ui (shadcn/Tailwind)             |
| **FX-aware price formatting**     | Currency display component                          |

### SDK integration pattern

```typescript
// 1. Create BorrowService from viem PublicClient
import { BorrowService } from "@mento-protocol/mento-sdk";

const borrowService = new BorrowService(publicClient, chainId);

// 2. Read data — pass debt token symbol, SDK resolves all addresses
const troves = await borrowService.getUserTroves("GBPm", userAddress);
const params = await borrowService.getSystemParams("GBPm");
const price = await borrowService.getCollateralPrice("GBPm");

// 3. Build transactions — SDK returns CallParams { to, data, value }
const openTx = await borrowService.buildOpenTroveTransaction("GBPm", {
  owner: userAddress,
  ownerIndex: 0,
  collAmount: parseEther("1000"),
  boldAmount: parseEther("500"),
  annualInterestRate: parseEther("0.05"),   // 5%
  maxUpfrontFee: parseEther("100"),
});

// 4. Send via wagmi — bridge CallParams to wallet
const hash = await walletClient.sendTransaction({
  to: openTx.to as Address,
  data: openTx.data as Hex,
  value: BigInt(openTx.value),
});

// 5. Use SDK math for display
const loanDetails = getLoanDetails(collateral, debt, price, mcr, ...);
```

### `use-borrow-service` hook

```typescript
// packages/web3/src/features/borrow/hooks/use-borrow-service.ts
import { BorrowService } from "@mento-protocol/mento-sdk";
import { usePublicClient } from "wagmi";

let cachedService: BorrowService | null = null;

export function useBorrowService(): BorrowService {
  const publicClient = usePublicClient();
  // BorrowService caches deployment context internally,
  // so we only need one instance per public client
  if (!cachedService || /* client changed */) {
    cachedService = new BorrowService(publicClient, chainId);
  }
  return cachedService;
}
```

---

## 4. Data Model

### The 2D problem

BOLD has one debt token (BOLD) and N collateral branches. Mento has M debt
tokens and N collateral types per debt token.

```
BOLD:   1 debt token  ×  N branches  =  N  contract sets
Mento:  M debt tokens ×  N branches  =  M×N contract sets
```

The SDK handles this via `borrowRegistries`:

```typescript
// In SDK: src/core/constants/borrowRegistries.ts
borrowRegistries = {
  [ChainId.CELO]: {
    GBPm: "0x7C88934470A7297C7B63654d78ccC6B61eEf79E1", // AddressesRegistry
  },
};
```

Each registry address points to an `AddressesRegistry` contract that resolves
all 19 contract addresses for that deployment. The SDK reads and caches this
lazily on first use.

### Key types (from SDK)

The SDK exports these types — we use them directly, no need to redefine:

```typescript
// From @mento-protocol/mento-sdk
interface BorrowPosition {
  troveId: string;
  collateral: bigint;
  debt: bigint;
  annualInterestRate: bigint;
  status: TroveStatus; // "active" | "closedByOwner" | "closedByLiquidation" | "zombie" | "nonExistent"
  interestBatchManager: string | null;
  lastDebtUpdateTime: number;
  redistBoldDebtGain: bigint;
  redistCollGain: bigint;
  accruedInterest: bigint;
  recordedDebt: bigint;
  accruedBatchManagementFee: bigint;
}

interface LoanDetails {
  collateral: bigint | null;
  collateralUsd: bigint | null;
  collPrice: bigint | null;
  debt: bigint | null;
  interestRate: bigint | null;
  ltv: bigint | null;
  maxLtv: bigint;
  maxLtvAllowed: bigint; // 91.6% of maxLtv
  liquidationPrice: bigint | null;
  liquidationRisk: RiskLevel | null; // "low" | "medium" | "high"
  maxDebt: bigint | null;
  maxDebtAllowed: bigint | null;
  status: "healthy" | "at-risk" | "liquidatable" | "underwater" | null;
}

interface SystemParams {
  mcr: bigint; // Min collateral ratio (e.g., 1.1e18 = 110%)
  ccr: bigint; // Critical collateral ratio
  scr: bigint; // System collateral ratio
  bcr: bigint; // Batch collateral ratio
  minDebt: bigint;
  ethGasCompensation: bigint;
  minAnnualInterestRate: bigint;
}

interface CallParams {
  to: string; // Contract address
  data: string; // Encoded calldata (hex)
  value: string; // Native value in wei (hex)
}
```

### Frontend-specific types

We only need to define what the SDK doesn't cover:

```typescript
// packages/web3/src/features/borrow/types.ts

// Debt token metadata for UI (currency formatting, icons, etc.)
interface DebtTokenConfig {
  symbol: string; // "GBPm"
  currencySymbol: string; // "£"
  currencyCode: string; // "GBP"
  locale: string; // "en-GB"
}

// Sub-view navigation
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
  debtTokenGain: bigint; // GBPm yield
}
```

---

## 5. Technical Decisions

### A. TransactionFlow → Jotai atoms

BOLD's `TransactionFlow` is a React Context + localStorage system (~700 LOC).
We reimplement the same state machine as Jotai atoms:

```typescript
const borrowFlowAtom = atomWithStorage<BorrowFlowState | null>(
  "mento:borrow:flow",
  null,
);

interface BorrowFlowState {
  flowId: string;
  account: Address;
  request: Record<string, unknown>;
  steps: FlowStep[];
  currentStepIndex: number;
}

interface FlowStep {
  id: string;
  label: string;
  status:
    | "idle"
    | "awaiting-commit"
    | "awaiting-verify"
    | "confirmed"
    | "error";
  txHash?: string;
  error?: { name: string | null; message: string };
}
```

Same state transitions as BOLD: `idle → awaiting-commit → awaiting-verify → confirmed`.
Same recovery: if page reloads during `awaiting-verify`, resume verification.

**Why Jotai:** Consistent with existing app state (swap uses Jotai atoms),
simpler than Context for cross-component state, `atomWithStorage` gives us
localStorage for free.

### B. Subgraph — Hybrid approach (direct reads for MVP)

MVP uses **direct contract reads only** via SDK:

- `BorrowService.getUserTroves()` enumerates via TroveNFT ownership
- `BorrowService.getTroveData()` for individual trove reads
- `BorrowService.getBranchStats()` for aggregate data

Subgraph integration is a **separate workstream** tracked independently.
When available, it will be used for historical data, batch manager discovery,
and faster position enumeration.

### C. Contract addresses — From SDK

The SDK's `feat/trove-management` branch already includes the GBPm
AddressesRegistry address on Celo mainnet:

```typescript
// SDK: borrowRegistries[ChainId.CELO].GBPm
"0x7C88934470A7297C7B63654d78ccC6B61eEf79E1";
```

The registry contract resolves all 19 contract addresses automatically.
No local address config needed. When CHFm/JPYm deploy, the SDK adds their
registry addresses and our frontend picks them up on SDK upgrade.

**Action needed:** Ensure the `feat/trove-management` SDK branch is published
to npm (or use a git dependency) before development starts.

### D. Feature flag

```typescript
// apps/app.mento.org/app/env.mjs
NEXT_PUBLIC_ENABLE_BORROW: (z
  .enum(["true", "false"])
  .optional()
  .default("false"),
  // .env.development (always on)
  (NEXT_PUBLIC_ENABLE_BORROW = "true"));

// Production: off until launch
// Vercel env: NEXT_PUBLIC_ENABLE_BORROW="false"
```

The borrow tab visibility in the header and the borrow view in `page.tsx` both
check this flag. When `"false"`, the tab is hidden and the borrow components
are never imported (tree-shaken out of the production bundle).

### E. SDK → wagmi bridge (`send-tx.ts`)

The SDK returns `CallParams` (encoded calldata). We need a thin bridge to
send them via wagmi:

```typescript
// packages/web3/src/features/borrow/tx-flows/send-tx.ts
import { sendTransaction, waitForTransactionReceipt } from "@wagmi/core";

export async function sendSdkTransaction(
  wagmiConfig: Config,
  callParams: CallParams,
  gasHeadroom = 0.25,
): Promise<Hash> {
  const hash = await sendTransaction(wagmiConfig, {
    to: callParams.to as Address,
    data: callParams.data as Hex,
    value: BigInt(callParams.value),
    // Gas estimation with headroom handled by wagmi
  });
  return hash;
}

export async function waitForTx(
  wagmiConfig: Config,
  hash: Hash,
): Promise<TransactionReceipt> {
  return waitForTransactionReceipt(wagmiConfig, { hash });
}
```

---

## 6. Phase 0 — Foundation

> **Goal:** Scaffolding, feature flag, SDK integration, stability pool ABI
>
> **Status:** Complete (2026-03-01) — all 11 tasks done
>
> **PRD:** `tasks/prd-phase-0-foundation.md`

### Tasks

- [x] **P0-1: Create `feat/borrow` branch** from `feat/v3`
- [x] **P0-2: Add feature flag** `NEXT_PUBLIC_ENABLE_BORROW` to `env.mjs`
  - Added to `createEnv` schema (client, default `"false"`) + `runtimeEnv`
  - Added to `.env.example` and `.env.local`
  - Added to `turbo.json` globalEnv for cache invalidation
  - Gated borrow tab in `header.tsx` — filters tab array when flag is `"false"`
  - Gated borrow section in `page.tsx` — `shouldEnableBorrow` check
- [x] **P0-3: Add SDK dependency**
  - Updated `@mento-protocol/mento-sdk` to `^3.0.0-beta.18` (workspace catalog + app override)
  - Fixed breaking changes in liquidity types from SDK upgrade (deadline, renamed fields)
  - `BorrowService` importable and constructible
- [x] **P0-4: Scaffold `packages/web3/src/features/borrow/`**
  - Created full directory structure with barrel exports
  - `sdk.ts` — BorrowService factory with Map-based cache by chainId
  - Added to features barrel (`features/index.ts`) alphabetically
  - `tsup` build passes
- [x] **P0-5: Scaffold `apps/app.mento.org/app/components/borrow/`**
  - `borrow-view.tsx` — placeholder view matching pools-view layout pattern
  - `atoms/borrow-navigation.ts` — `borrowViewAtom` with `BorrowView` type
  - Replaced "Coming soon" in `page.tsx` with `<BorrowView />`
- [x] **P0-6: Create `use-borrow-service` hook**
  - Uses `usePublicClient({ chainId })` + `useChainId()` + `useMemo`
  - Returns `BorrowService | null`
  - Delegates to `getBorrowService()` factory in `sdk.ts`
- [x] **P0-7: Create `send-tx` bridge**
  - `sendSdkTransaction()` — gas estimation + 25% headroom + wagmi sendTransaction
  - `waitForTx()` — wraps `waitForTransactionReceipt`
  - Error normalization (user rejection, revert with reason, insufficient funds)
  - **Note:** This also completes Phase 2's P2-1
- [x] **P0-8: Copy Stability Pool ABI** from BOLD
  - Copied from `bold/frontend/app/src/abi/StabilityPool.ts`
  - Placed in `stability-pool/abi.ts` as `stabilityPoolAbi` typed const
  - Includes: `provideToSP`, `withdrawFromSP`, `getDepositorCollGain`, `getDepositorYieldGain`, `getTotalBoldDeposits`, `getCompoundedBoldDeposit`
- [x] **P0-9: Extract leverage math** from BOLD's `liquity-leverage.ts`
  - `leverage/math.ts`: 4 pure bigint functions (no BOLD imports, no Dnum)
  - `getOpenLeveragedTroveParams()`, `getLeverUpTroveParams()`, `getLeverDownTroveParams()`, `getCloseFlashLoanAmount()`
- [x] **P0-10: Define frontend-specific types**
  - `types.ts`: `DebtTokenConfig`, `BorrowView`, `StabilityPoolPosition`, `DEBT_TOKEN_CONFIGS`
  - Re-exports SDK types: `BorrowPosition`, `LoanDetails`, `SystemParams`, `CallParams`, `OpenTroveParams`, `AdjustTroveParams`, `InterestRateBracket`, `TroveStatus`, `RiskLevel`
- [x] **P0-11: Create FX-aware currency display utility**
  - `format.ts`: `formatDebtAmount`, `formatCollateralAmount`, `formatPrice`, `formatInterestRate`, `formatLtv`
  - Uses `Intl.NumberFormat` with locale from `DebtTokenConfig`
  - All functions handle `null`/`undefined` → `"—"` placeholder

### What we NO LONGER need (SDK provides)

The following Phase 0 tasks from the previous plan are **eliminated**:

| Previous task                        | Now provided by                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| P0-5: Extract pure math from BOLD    | SDK: `getLoanDetails()`, `getLtv()`, `getLiquidationPrice()`, `getLiquidationRisk()`, `getRedemptionRisk()`, `calculateDebtSuggestions()` |
| P0-7: Copy and adapt ABIs            | SDK exports all 10+ ABIs. Only StabilityPool ABI needed separately                                                                        |
| P0-8: Create deployment config       | SDK: `borrowRegistries` + `AddressesRegistry` auto-resolution                                                                             |
| P0-9: Create type definitions        | SDK exports: `BorrowPosition`, `LoanDetails`, `SystemParams`, `OpenTroveParams`, etc.                                                     |
| P0-10: Create use-price-feed hook    | SDK: `getCollateralPrice(symbol)`                                                                                                         |
| P0-11: Create use-system-params hook | SDK: `getSystemParams(symbol)`                                                                                                            |

### Acceptance criteria

- Feature flag works: borrow tab visible in dev, hidden in prod
- `useBorrowService()` returns a working SDK instance
- `sdk.getUserTroves("GBPm", address)` returns data on Celo mainnet/fork
- `sdk.getSystemParams("GBPm")` returns valid MCR, CCR, minDebt
- `sendSdkTransaction()` successfully sends a test tx on Celo fork
- StabilityPool ABI compiles without TypeScript errors
- Currency formatting produces correct output for GBP

---

## 7. Phase 1 — Read Path

> **Goal:** Dashboard showing positions, read-only trove + SP data
>
> **Status:** Complete (2026-03-01) — all tasks done
>
> **PRD:** `tasks/prd-phase-1-read-path.md`

### Tasks

- [x] **P1-1: Read hooks** (thin React Query wrappers around SDK)
      All follow identical pattern: `useQuery` + `useBorrowService()` + `enabled: !!sdk`
  - `use-system-params.ts` — `staleTime: Infinity` (immutable contract params)
  - `use-collateral-price.ts` — `refetchInterval: 60_000`
  - `use-user-troves.ts` — `refetchInterval: 15_000`, guarded by `!!address`
  - `use-trove-data.ts` — `refetchInterval: 15_000`, guarded by `!!troveId`
  - `use-branch-stats.ts` — `Promise.all` for `getBranchStats` + `getAverageInterestRate`
  - `use-interest-rate-brackets.ts` — `refetchInterval: 60_000`
  - `use-borrow-allowance.ts` — collateral + debt allowance (SDK resolves spender internally for collateral; debt needs explicit spender)
  - `use-next-owner-index.ts` — returns `number` (not bigint)
  - `use-predict-upfront-fee.ts` — uses `useDebounce(amount, 350)` from shared utils; bigints `.toString()` in query keys
- [x] **P1-2: Derived hooks** (combine SDK reads with SDK math via `useMemo`)
  - `use-loan-details.ts` — `useCollateralPrice` + `getLoanDetails()` from `@mento-protocol/mento-sdk/dist/services/borrow/borrowMath`
  - `use-debt-suggestions.ts` — `useLoanDetails` + `calculateDebtSuggestions(maxDebt, minDebt)`
  - `use-interest-rate-chart-data.ts` — transforms brackets to `{ rate: number, debt: number, isCurrentRate: boolean }[]`
  - `use-redemption-risk.ts` — sums `debtInFront` from brackets below user's rate, calls `getRedemptionRisk()`
  - **Key learning:** SDK pure math functions import from deep path `@mento-protocol/mento-sdk/dist/services/borrow/borrowMath`
- [x] **P1-3: Stability Pool hooks** (direct contract reads — not in SDK)
  - Created internal `useStabilityPoolAddress` helper — resolves via `getBorrowRegistry` + `resolveAddressesFromRegistry`, cached `staleTime: Infinity`
  - `use-stability-pool.ts` — wagmi `useReadContracts` batch read: `getCompoundedBoldDeposit`, `getDepositorCollGain`, `getDepositorYieldGain`
  - `use-stability-pool-stats.ts` — wagmi `useReadContract` for `getTotalBoldDeposits()`
  - **Key learning:** SDK borrow helpers import from `@mento-protocol/mento-sdk/dist/services/borrow/borrowHelpers`
- [x] **P1-7: Dashboard view** (`borrow-dashboard.tsx`)
  - Three states: not-connected, loading (shimmer), empty (CTAs)
  - Renders PositionCards and StabilityCard
  - `borrow-view.tsx` now routes all BorrowView states (dashboard, open-trove, manage-trove, earn, redeem)
  - DebtTokenSelector in header, persistent across views
- [x] **P1-8: Position card** — Card composable (CardHeader+CardAction+CardContent), RiskBadge in action slot, click → `{ view: 'manage-trove', troveId }`
- [x] **P1-9: Stability card** — pool share calculation, click → `"earn"`, shows collateral gain + yield
- [x] **P1-10: Debt token selector** — Radix Select, GBPm active, CHFm/JPYm disabled with "Soon" Badge
- [x] **P1-11: Risk badge + Trove metrics**
  - RiskBadge: Low=green, Medium=amber, High=red, null=N/A outline
  - TroveMetrics: 4-metric responsive grid (2 cols mobile, 4 cols desktop)

### Acceptance criteria

- Connected wallet sees all open troves on dashboard
- Position metrics (LTV, liquidation price) match SDK calculations
- SP position shows correct deposit and pending rewards
- All amounts display in the correct local currency (£)
- Empty state guides new users to open a trove

---

## 8. Phase 2 — Transaction Flow Engine

> **Goal:** Write hooks for all trove operations, multi-step flow orchestration, UI feedback
>
> **Status:** Complete (2026-03-01) — all tasks done
>
> **PRD:** `tasks/prd-phase-2-tx-flow-engine.md`

### Tasks

- [x] **P2-1: `send-tx` bridge** (`tx-flows/send-tx.ts`) — ✅ Completed in Phase 0 (P0-7)
  - `sendSdkTransaction(wagmiConfig, callParams)` — bridges SDK `CallParams` to wagmi
  - `waitForTx(wagmiConfig, hash)` — wraps `waitForTransactionReceipt`
  - Error normalization (user rejection, revert, gas failure)
  - Gas estimation with headroom (25% buffer)
- [x] **P2-2: Flow state atom** (`atoms/flow-atoms.ts`)
  - `BorrowFlowState` + `FlowStep` types with full state machine
  - `borrowFlowAtom` — `atomWithStorage` from `jotai/utils`, key `mento:borrow:flow`, persisted to localStorage
  - Status flow: `idle → pending → confirming (with txHash) → confirmed | error`
- [x] **P2-3: Flow execution engine** (`tx-flows/engine.ts`)
  - `executeFlow(wagmiConfig, setFlowAtom, flowId, operation, account, stepDefs)` — orchestrates multi-step tx flows
  - `FlowStepDefinition` type: `{ id, label, buildTx: () => Promise<CallParams | null> }` — null means skip
  - Engine iterates steps sequentially, updates atom at each state transition
  - Skipped steps (null buildTx) auto-marked confirmed with "Skipped" label
  - Returns `{ success: boolean, txHashes: string[] }`
- [x] **P2-4: Write hooks** (one per operation, all use `useMutation` + `executeFlow`)
  - `use-open-trove.ts` — two-step: check collateral allowance → approve if insufficient (null = skip) → `sdk.buildOpenTroveTransaction(symbol, params)`
  - `use-adjust-trove.ts` — two-step: approve collateral if adding AND allowance insufficient → `sdk.buildAdjustTroveTransaction(symbol, params)` (account passed separately — `AdjustTroveParams` has no owner)
  - `use-close-trove.ts` — two-step: check debt token allowance for BorrowerOperations → approve with `maxUint256` → `sdk.buildCloseTroveTransaction(symbol, troveId)` (resolves BorrowerOps via `getChainId` + `getPublicClient` from `wagmi/actions` → SDK registry)
  - `use-adjust-interest-rate.ts` — single-step: `sdk.buildAdjustInterestRateTransaction(symbol, troveId, newRate, maxUpfrontFee)`
  - `use-claim-collateral.ts` — single-step: `sdk.buildClaimCollateralTransaction(symbol)`
  - Each invalidates relevant query keys on success + shows toast
  - **Key learnings:**
    - Collateral approval: SDK resolves spender internally (2 args: `symbol, amount`)
    - Debt approval: requires explicit spender (BorrowerOperations address) — `sdk.getDebtAllowance(symbol, owner, spender)` + `sdk.buildDebtApprovalParams(symbol, spender, amount)`
    - Use `maxUint256` from viem for debt approval to cover interest accrual
    - `borrowViewAtom` in app layer — navigation handled by calling components, not hooks
- [x] **P2-5: Stability Pool transaction builders + write hooks**
  - `buildSpDeposit(spAddress, amount, doClaim)` — viem `encodeFunctionData` with `stabilityPoolAbi` → `provideToSP(uint256, bool)`
  - `buildSpWithdraw(spAddress, amount, doClaim)` — encodes `withdrawFromSP(uint256, bool)`
  - `useSpDeposit` — two-step: check debt token allowance for SP address → approve with `maxUint256` → buildSpDeposit
  - `useSpWithdraw` — single-step: buildSpWithdraw (no approval needed)
  - SP address resolved imperatively inside mutationFn via `getBorrowRegistry` + `resolveAddressesFromRegistry` → `addresses.stabilityPool`
  - **Note:** This also completes Phase 4's P4-2 (SP transaction builders)
- [x] **P2-6: Flow step component** (`shared/flow-step.tsx`)
  - Inline SVG status icons: idle (circle), pending (spinner), confirming (spinner + tx link), confirmed (green check), error (red X)
  - Block explorer links via `useExplorerUrl()` from `@repo/web3`
  - Tailwind `animate-spin` for spinner, no external icon library
- [x] **P2-7: Flow dialog component** (`shared/flow-dialog.tsx`)
  - Uses `@repo/ui` Dialog (Radix-based) with `open` prop controlled by `borrowFlowAtom`
  - Three states: in-progress (wallet prompt), success (all confirmed + "Back to Dashboard"), error (message + "Try Again")
  - Self-managing: visible when `borrowFlowAtom` not null, hidden when null
  - "Back to Dashboard" clears flow atom + sets `borrowViewAtom` to "dashboard"
  - "Try Again" clears flow atom (user re-submits from form)
- [x] **P2-8: Integration with `borrow-view.tsx`**
  - `<FlowDialog />` rendered once in borrow-view — no props needed, self-manages via atom
  - Radix Dialog uses portal, overlays regardless of DOM position
  - Must rebuild web3 package (`pnpm --filter @repo/web3 build`) before app tsc can see new exports

### What the SDK handles internally (no hooks needed)

| Capability         | SDK handles it                                       |
| ------------------ | ---------------------------------------------------- |
| Hint computation   | Internal to `build*Transaction()`                    |
| Calldata encoding  | `encodeFunctionData()` in `BorrowTransactionService` |
| Address resolution | Lazy via `AddressesRegistry`                         |
| Input validation   | `BorrowValidation` module                            |

### Acceptance criteria

- Each write hook handles the full approve → execute → verify lifecycle
- Page reload during confirmation correctly resumes waiting for receipt
- Error in any step allows retry
- Toast notifications on success/error
- Flow dialog shows progress for multi-step operations
- All queries invalidated correctly after mutations

### BOLD reference files

| BOLD source                                        | What to reference                         |
| -------------------------------------------------- | ----------------------------------------- |
| `services/TransactionFlow.tsx`                     | State machine states and recovery pattern |
| `screens/TransactionsScreen/TransactionStatus.tsx` | Step status display logic                 |

### Monorepo reference files (follow these patterns)

| File                                                                | Pattern to follow                      |
| ------------------------------------------------------------------- | -------------------------------------- |
| `packages/web3/src/features/swap/hooks/use-swap-transaction.tsx`    | Write hook with approve → send → toast |
| `packages/web3/src/features/swap/hooks/use-approve-transaction.tsx` | Approval hook pattern                  |
| `apps/app.mento.org/app/components/pools/add-liquidity-form.tsx`    | Multi-step form + tx submission        |

---

## 9. Phase 3 — Core Trove Operations

> **Goal:** Open, adjust, and close troves using SDK transaction builders
>
> **Status:** Complete (2026-03-01) — all tasks done
>
> **PRD:** `tasks/prd-phase-3-trove-operations.md`

### Tasks

#### Open Trove

- [x] **P3-1: Form state atoms** (`atoms/trove-form-atoms.ts`)
  - `openTroveFormAtom`: `{ collAmount: string, debtAmount: string, interestRate: string }` — plain `atom()`, no persistence
- [x] **P3-2: Collateral input** (`open-trove/collateral-input.tsx`)
  - `CoinInput` + USDm balance via `useReadContract` + `erc20Abi` + `getTokenAddress(chainId, "USDm" as TokenSymbol)`
  - Max button, insufficient balance warning
  - **Key learning:** `getTokenAddress(chainId, "USDm" as TokenSymbol)` requires `TokenSymbol` cast
- [x] **P3-3: Debt input** (`open-trove/debt-input.tsx`)
  - `CoinInput` + min debt from `useSystemParams()` + suggestion chips from `useDebtSuggestions`
  - **Key learning:** `selectedDebtTokenAtom` holds a `DebtTokenConfig` object (not a string) — use `debtToken.symbol`
  - **Key learning:** `useDebtSuggestions` returns `{ amount, ltv, risk }[]` — use `risk` as key for chips
- [x] **P3-4: Interest rate input** (`open-trove/interest-rate-input.tsx`)
  - Radix Slider synced with manual text input, annual cost estimate, `RiskBadge` for redemption risk
  - **Key learning:** `SystemParams.minAnnualInterestRate` (not `minInterestRate`) — 18-decimal bigint, convert via `Number(bigint) / 1e16`
  - **Key learning:** Radix Slider `value` must be an array even for single thumb — `value={[number]}`
- [x] **P3-5: Interest rate chart** (`open-trove/interest-rate-chart.tsx`)
  - Recharts `BarChart` via `ChartContainer` from `@repo/ui` — highlights selected rate bar
  - Exported `ChartContainer` + `ChartConfig` from `@repo/ui` (was internal-only)
  - Added `recharts` as direct app dependency (was only in `@repo/ui`)
  - **Key learning:** Recharts `Cell` for per-bar colors, `ChartConfig` uses `satisfies ChartConfig` pattern
- [x] **P3-6: Loan summary** (`open-trove/loan-summary.tsx`)
  - Real-time LTV, liquidation price, risk badge, collateral ratio, upfront fee, annual cost
  - **Key learning:** `LoanDetails` has no `collateralRatio` — compute as `10n ** 36n / ltv`
  - **Key learning:** Commitlint rejects uppercase subjects — place story ID at end: `feat: add foo (US-006)`
- [x] **P3-7: Open trove form container** (`open-trove/open-trove-form.tsx`)
  - Composes all inputs + chart + summary in responsive 2-col grid layout
  - Submit wired to `useOpenTrove` — builds `OpenTroveParams` with `ownerIndex` from `useNextOwnerIndex`, `maxUpfrontFee` + 5% buffer
  - Button disabled with descriptive text for each invalid state
  - **Key learning:** `useOpenTrove` has no separate `account` field — `owner` is inside `params`
  - **Key learning:** `useNextOwnerIndex(symbol)` derives owner internally
- [x] **P3-8: Wire open trove into borrow-view**
  - Replaced placeholder with `<OpenTroveForm />`

#### Manage Trove

- [x] **P3-9: Manage trove view** (`manage-trove/manage-trove-view.tsx`)
  - Tab container (Adjust | Interest Rate | Close) + trove header with `TroveMetrics`
  - Loading state with `Skeleton` from `@repo/ui`
  - **Key learning:** `useTroveData(troveId, symbol)` — troveId first, symbol second (opposite of other hooks)
- [x] **P3-10: Adjust form** (`manage-trove/adjust-form.tsx`)
  - Add/Remove collateral toggle + Borrow more/Repay toggle
  - Before → After comparison panel (LTV, liquidation price, collateral, debt)
  - Submit wired to `useAdjustTrove` — `{ symbol, params: AdjustTroveParams, wagmiConfig, account }`
  - **Key learning:** `collChange`/`debtChange` are absolute amounts, direction via booleans
  - **Key learning:** `maxUpfrontFee` should be `0n` when not borrowing more
- [x] **P3-11: Rate change form** (`manage-trove/rate-form.tsx`)
  - Current rate display + slider/input for new rate + before/after cost comparison
  - Redemption risk + fee estimate via `usePredictUpfrontFee(0n, newRate, symbol)`
  - Submit wired to `useAdjustInterestRate`
- [x] **P3-12: Close form** (`manage-trove/close-form.tsx`)
  - Debt repay summary + collateral return + wallet balance check + confirmation text
  - `Button variant="destructive"` for close action
  - Submit wired to `useCloseTrove` — hook handles debt approval internally
- [x] **P3-13: Wire manage-trove into borrow-view + connect tab forms**
  - All forms share prop interface: `{ troveId: string, troveData: BorrowPosition }`
  - Tab content guards on `troveData` existence for loading state
- [x] **P3-14: Claim collateral on dashboard**
  - Created `useSurplusCollateral` hook — reads `CollSurplusPool.getCollateral(address)` with inline ABI
  - `collSurplusPool` address from `resolveAddressesFromRegistry`
  - Dashboard shows claim banner when surplus > 0, wired to `useClaimCollateral`
  - Surplus treated as separate "has something" condition (prevents false empty state)

### Acceptance criteria

- User can open a trove: deposit USDm, borrow GBPm, set interest rate
- User can adjust: add/remove collateral, borrow/repay
- User can change interest rate
- User can close trove and receive collateral back
- All operations show accurate before/after comparisons
- Min debt, max LTV, and other protocol limits are enforced in the UI
- Transaction flows handle approval + execution correctly
- Fee estimates display before submission

---

## 10. Phase 4 — Stability Pool

> **Goal:** Deposit/withdraw from stability pools, claim rewards
>
> **Status:** In progress
>
> **PRD:** `tasks/prd-phase-4-stability-pool.md`

**Note:** The SDK does NOT cover stability pool operations. This phase requires
direct contract interaction using the StabilityPool ABI copied from BOLD.

### Tasks (all complete)

- [x] **P4-1: Stability Pool read hooks** — ✅ Completed in Phase 1 (P1-3)
  - `useStabilityPool` — batch reads: `getCompoundedBoldDeposit`, `getDepositorCollGain`, `getDepositorYieldGain`
  - `useStabilityPoolStats` — reads `getTotalBoldDeposits()`
  - Internal `useStabilityPoolAddress` — resolves SP address via SDK registry, cached
- [x] **P4-2: Stability Pool transaction builders** — ✅ Completed in Phase 2 (P2-5)
  - `buildSpDeposit(spAddress, amount, doClaim)` + `buildSpWithdraw(spAddress, amount, doClaim)` — viem `encodeFunctionData` with `stabilityPoolAbi`
  - `useSpDeposit` + `useSpWithdraw` write hooks — resolve SP address imperatively inside mutationFn
  - Returns `CallParams` format compatible with `sendSdkTransaction`
- [x] **P4-3: Earn view container** (`earn/earn-view.tsx`)
  - Pool stats: total deposits, pool share percentage (bigint math: `deposit * 10000n / total / 100`)
  - User position: deposit amount, collateral gain (USDm), yield gain (debt token)
  - Back to Dashboard navigation via `borrowViewAtom`
  - Not-connected and empty-deposit states
  - **Key learning:** `useStabilityPool(symbol)` gets account internally — no need to pass address; `useStabilityPoolStats(symbol)` returns `{ data: bigint | undefined }` directly
- [x] **P4-4: Deposit form** (`earn/deposit-form.tsx`)
  - Debt token amount input with wallet balance display (ERC-20 `balanceOf` pattern)
  - Max button fills with formatted wallet balance
  - `doClaim` checkbox (default true when rewards exist)
  - Pending rewards summary (collateral gain + yield gain)
  - Submit calls `spDeposit.mutate({ symbol, amount, doClaim, wagmiConfig, account })`
  - **Key learning:** `useConfig()` from `wagmi` (not `@repo/web3/wagmi`) provides wagmiConfig
- [x] **P4-5: Withdraw form** (`earn/withdraw-form.tsx`)
  - Amount input with max = current deposit balance
  - `doClaim` checkbox (default true)
  - Submit calls `spWithdraw.mutate({ symbol, amount, doClaim, wagmiConfig, account })`
  - Structurally mirrors deposit form; no ERC-20 balance needed — uses deposit from props
- [x] **P4-6: Claim rewards** (`earn/claim-rewards.tsx`)
  - Shows pending rewards: collateral gain (USDm) + yield gain (debt token)
  - Returns `null` when no rewards — hidden entirely
  - Calls `spWithdraw.mutate({ symbol, amount: 0n, doClaim: true, ... })` — withdraw 0 triggers claim-only
- [x] **P4-7: Wire earn view into borrow-view**
  - Replaced placeholder div with `<EarnView />`
  - Composed: Tabs (Deposit | Withdraw) + ClaimRewards outside tabs
  - SP position data passed from `useStabilityPool` to child forms
  - **Key learning:** ClaimRewards returns null when no rewards — don't wrap in Card or you get empty shell; Tabs only need `defaultValue` prop for uncontrolled usage; all earn forms read `selectedDebtTokenAtom` internally

---

## 11. Phase 5 — Leverage / Multiply

> **Goal:** Flash-loan-powered leveraged positions
>
> **Separate PRD:** `tasks/prd-phase-5-leverage.md`

**Not in SDK.** Leverage requires Zapper contracts + flash loan provider + DEX,
none of which are in the SDK's BorrowService.

### Prerequisites (must be confirmed before starting)

- [ ] Flash loan provider available on Celo (Aave V3 or alternative)
- [ ] DEX with sufficient GBPm/USDm liquidity for the swap leg
- [ ] Zapper contracts deployed (LeverageZapper for USDm collateral)
- [ ] ExchangeHelpers contract deployed pointing to Celo DEX

### Tasks

- [ ] **P5-1: Research & confirm prerequisites**
- [ ] **P5-2: Leverage form** with slider, slippage display
- [ ] **P5-3: Slippage check hook** via ExchangeHelpers
- [ ] **P5-4: Open leverage tx flow** using Zapper contract
- [ ] **P5-5: Adjust leverage tx flow** (lever up / lever down)
- [ ] **P5-6: Leverage position display** (factor, total exposure)

### BOLD reference files

| BOLD source                           | What to extract                                       |
| ------------------------------------- | ----------------------------------------------------- |
| `liquity-leverage.ts`                 | Flash loan parameter calculations (extracted in P0-9) |
| `screens/LeverageScreen.tsx`          | Leverage form layout                                  |
| `tx-flows/openLeveragePosition.tsx`   | Open leverage step definitions                        |
| `tx-flows/updateLeveragePosition.tsx` | Adjust leverage step definitions                      |

---

## 12. Phase 6 — Multi-Debt Expansion

> **Goal:** Add CHFm, JPYm and cross-deployment views
>
> **Separate PRD:** `tasks/prd-phase-6-multi-debt.md`

### How the SDK makes this easy

Adding a new debt token is primarily an SDK change:

```typescript
// SDK: borrowRegistries gets a new entry
borrowRegistries[ChainId.CELO] = {
  GBPm: "0x7C88...",
  CHFm: "0xNEW_REGISTRY...",
  JPYm: "0xNEW_REGISTRY...",
};
```

On the frontend, the only changes are:

1. Update SDK dependency to version with new registries
2. Add `DebtTokenConfig` entries for CHFm and JPYm (currency symbol, locale)
3. Enable them in the debt token selector

### Tasks

- [ ] **P6-1: Add CHFm config** — `DebtTokenConfig` with `"Fr."`, `"CHF"`, `"de-CH"`
- [ ] **P6-2: Add JPYm config** — `DebtTokenConfig` with `"¥"`, `"JPY"`, `"ja-JP"`
- [ ] **P6-3: Enable debt token selector** — remove "Coming soon" badges
- [ ] **P6-4: Cross-deployment dashboard** — aggregate positions across all debt tokens
- [ ] **P6-5: Per-deployment stability pools** — SP per debt token

### Acceptance criteria

- User can switch between GBPm, CHFm, JPYm
- Each debt token's troves and SP are independent
- Dashboard aggregates positions across all debt tokens
- Currency formatting is correct for each locale

---

## 13. Cross-Cutting Concerns

### Feature flag implementation

```typescript
// env.mjs — add to client schema
NEXT_PUBLIC_ENABLE_BORROW: z.enum(["true", "false"]).optional().default("false"),

// header.tsx — conditionally show tab
const isBorrowEnabled = process.env.NEXT_PUBLIC_ENABLE_BORROW === "true";

const tabs = [
  { value: "swap", label: "Swap" },
  { value: "pool", label: "Pool" },
  ...(isBorrowEnabled ? [{ value: "borrow", label: "Borrow" }] : []),
];

// page.tsx — conditionally render
{activeTab === "borrow" && isBorrowEnabled && <BorrowView />}
```

The `<BorrowView />` import should use `next/dynamic` for code splitting:

```typescript
const BorrowView = dynamic(
  () => import("./components/borrow/borrow-view").then(m => m.BorrowView),
  { loading: () => <LoadingSpinner /> }
);
```

### FX price display

All price-dependent UI must work in the debt token's local currency:

- Collateral value: "1,234.56 USDm ($1,234.56)"
- Debt value: "£987.65 GBPm"
- Liquidation price: "£0.82 per USDm" (not $1.00)
- LTV: percentage (currency-agnostic)
- Collateral ratio: percentage (currency-agnostic)

The `FXPriceFeed` returns the price of the collateral (USDm) denominated in
the debt token's currency. For GBPm, this is approximately 0.79 (1 USD ≈ 0.79 GBP).

### Testing strategy

- **Unit tests** for tx-flow step builders (step ordering, request validation)
- **Unit tests** for currency formatting
- **Component tests** for form validation and display logic
- **Integration tests** on Celo fork (Anvil) for full tx flows
- SDK's own tests cover math and transaction encoding
- Use existing vitest setup from `@repo/web3`

### Accessibility

- All form inputs have labels and aria attributes
- Risk badges have aria-label describing the risk level
- Flow dialog traps focus and supports escape to close
- Color is not the only indicator for risk (use icons + text)

---

## 14. What We Drop from BOLD

These BOLD features are **not included** in the Mento borrow section:

| BOLD Feature                       | Reason                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| LQTY staking + governance voting   | Mento has its own governance app                              |
| sBOLD vault (ERC-4626)             | No Mento equivalent                                           |
| Legacy V1 migration flows          | Not applicable                                                |
| Allocation voting / bribe claiming | Liquity-specific governance                                   |
| Account statistics screen          | Not needed for MVP                                            |
| PandaCSS UIKit                     | Replaced by @repo/ui (shadcn/Tailwind)                        |
| ConnectKit wallet connection       | Replaced by RainbowKit (already in Mento)                     |
| ENS resolution                     | Celo doesn't use ENS                                          |
| VPN/blocking list                  | Not needed initially                                          |
| Custom math library                | SDK provides `getLoanDetails()`, `getLtv()`, risk calcs, etc. |
| Custom ABI management              | SDK exports all ABIs                                          |
| Manual address config              | SDK resolves via AddressesRegistry                            |
| Hint helpers hooks                 | SDK computes hints internally                                 |

---

## 15. Risk Register

| #   | Risk                                                                  | Likelihood | Impact | Mitigation                                                                             |
| --- | --------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------- |
| R1  | FX price display bugs (wrong currency, inverted rate)                 | Medium     | High   | Build `currency-display` component first; test with known FX rates; snapshot tests     |
| R2  | Leverage prerequisites not met on Celo (no flash loans/DEX liquidity) | Medium     | Medium | Phase 5 is explicitly deferred; research prerequisites in P5-1 before committing       |
| R3  | Mento V3 contracts not yet deployed to mainnet                        | High       | High   | SDK has GBPm registry on mainnet (`0x7C88...`); use testnet/fork if contracts not live |
| R4  | SDK `feat/trove-management` not published to npm                      | High       | High   | Use git dependency initially; coordinate with SDK team on publish timeline             |
| R5  | SDK API changes before stabilization                                  | Medium     | Medium | Pin exact version; review SDK changelog before updating                                |
| R6  | StabilityPool ABI mismatch with deployed contracts                    | Low        | High   | Verify ABI against deployed bytecode before Phase 4                                    |
| R7  | Bundle size increase from SDK + borrow components                     | Low        | Medium | Dynamic import behind feature flag ensures tree-shaking; monitor with bundle analyzer  |
| R8  | Tab-based nav limits deep linking to specific troves                  | Medium     | Low    | Each view stores enough state in atoms for restoration; URL routing can be added later |
| R9  | SDK BorrowService caching stale data                                  | Low        | Medium | React Query handles refetch intervals; SDK caches addresses (immutable) not state      |

---

## 16. Reference: BOLD → Mento Mapping

### What comes from where

| Capability                 | Source                 | Notes                                      |
| -------------------------- | ---------------------- | ------------------------------------------ |
| Trove transaction building | **SDK**                | `buildOpenTroveTransaction()` etc.         |
| Trove reads                | **SDK**                | `getTroveData()`, `getUserTroves()`        |
| System params              | **SDK**                | `getSystemParams()`                        |
| Price reads                | **SDK**                | `getCollateralPrice()`                     |
| Loan math                  | **SDK**                | `getLoanDetails()`, `getLtv()`, risk calcs |
| Fee predictions            | **SDK**                | `predictOpenTroveUpfrontFee()` etc.        |
| Approvals + allowances     | **SDK**                | `buildCollateralApprovalParams()` etc.     |
| Hint computation           | **SDK**                | Internal to transaction builders           |
| ABIs                       | **SDK**                | All exported (except StabilityPool)        |
| Address resolution         | **SDK**                | Via `AddressesRegistry`                    |
| Multi-deployment           | **SDK**                | `borrowRegistries[chainId][symbol]`        |
| Stability Pool ops         | **BOLD** (adapt)       | Copy ABI + build tx encoders               |
| Leverage math              | **BOLD** (extract)     | `liquity-leverage.ts` pure functions       |
| Redemptions                | **BOLD** (adapt)       | `CollateralRegistry.redeemCollateral()`    |
| Tx flow engine             | **BOLD** (reimplement) | State machine → Jotai atoms                |
| All UI components          | **Rewrite**            | shadcn/@repo/ui, using BOLD as wireframes  |
| Wallet connection          | **Mento monorepo**     | RainbowKit (existing @repo/web3)           |
| State management           | **Mento monorepo**     | Jotai (existing pattern)                   |

### Concept mapping

| BOLD Concept                    | Mento Equivalent                                         |
| ------------------------------- | -------------------------------------------------------- |
| BOLD token                      | StableTokenV3 (GBPm / CHFm / JPYm)                       |
| Branch (ETH/rETH/wstETH)        | Branch (USDm, future: EURm)                              |
| Single CollateralRegistry       | One CollateralRegistry per debt token                    |
| Chainlink PriceFeed             | FXPriceFeed → OracleAdapter                              |
| Hardcoded constants (MCR, etc.) | SystemParams contract (configurable)                     |
| `BranchId` (0-9)                | SDK uses `COLL_INDEX = 0` (single branch per deployment) |
| `PrefixedTroveId` ("0:0xabc")   | SDK uses `troveId: string` per debt token symbol         |
| Manual contract config          | SDK's `AddressesRegistry` auto-resolution                |
| ConnectKit                      | RainbowKit                                               |
| PandaCSS / UIKit                | Tailwind / shadcn / @repo/ui                             |
| React Context (TransactionFlow) | Jotai atoms                                              |
| Subgraph (required)             | SDK direct reads (MVP) → Subgraph (later)                |

### Effort reduction summary

| Phase                      | Previous estimate | With SDK                   | Savings                                         |
| -------------------------- | ----------------- | -------------------------- | ----------------------------------------------- |
| Phase 0 — Foundation       | 11 tasks          | 11 tasks (different scope) | ~40% less code (no ABIs, math, types, config)   |
| Phase 1 — Read Path        | 11 tasks          | 11 tasks                   | ~50% less code (hooks are thin wrappers)        |
| Phase 2 — Tx Flow Engine   | 8 tasks           | 6 tasks                    | ~30% less (no hint helpers, approval utilities) |
| Phase 3 — Trove Operations | 14 tasks          | 14 tasks                   | ~60% less code per flow (SDK builds calldata)   |
| Phase 4 — Stability Pool   | 7 tasks           | 7 tasks                    | No change (not in SDK)                          |
| Phase 5 — Leverage         | 7 tasks           | 7 tasks                    | No change (not in SDK)                          |
| Phase 6 — Multi-Debt       | 5 tasks           | 5 tasks                    | Trivial (SDK handles address resolution)        |
