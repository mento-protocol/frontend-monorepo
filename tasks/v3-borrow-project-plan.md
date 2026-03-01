# Mento V3 Borrow Section — Project Plan

> **Base branch:** `feat/v3`
> **Feature flag:** `NEXT_PUBLIC_ENABLE_BORROW` (always `"true"` in development)
> **Source reference:** [Liquity V2 / BOLD](https://github.com/mento-protocol/bold) (Mento fork)
> **Date:** 2026-03-01

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Data Model](#3-data-model)
4. [Technical Decisions](#4-technical-decisions)
5. [Phase 0 — Foundation](#5-phase-0--foundation)
6. [Phase 1 — Read Path (Dashboard + Positions)](#6-phase-1--read-path)
7. [Phase 2 — Transaction Flow Engine](#7-phase-2--transaction-flow-engine)
8. [Phase 3 — Core Trove Operations](#8-phase-3--core-trove-operations)
9. [Phase 4 — Stability Pool](#9-phase-4--stability-pool)
10. [Phase 5 — Leverage / Multiply](#10-phase-5--leverage--multiply)
11. [Phase 6 — Multi-Debt Expansion](#11-phase-6--multi-debt-expansion)
12. [Cross-Cutting Concerns](#12-cross-cutting-concerns)
13. [What We Drop from BOLD](#13-what-we-drop-from-bold)
14. [Risk Register](#14-risk-register)
15. [Reference: BOLD → Mento Mapping](#15-reference-bold--mento-mapping)

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
packages/web3               — New `features/borrow/` module for chain logic
packages/ui                 — Extend as needed with borrow-specific components
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
│  Domain Logic (packages/web3/src/features/borrow/)       │
│  Pure math, types, hooks, tx-flows                       │
│  Extracted from BOLD: liquity-math.ts, liquity-utils.ts  │
├──────────────────────────────────────────────────────────┤
│  Chain Layer (wagmi + viem)                               │
│  ABIs, contract config, price feeds                      │
│  Shared wagmi provider from @repo/web3                   │
└──────────────────────────────────────────────────────────┘
```

### Package structure

```
packages/web3/src/features/borrow/
├── config/
│   ├── deployments.ts          # DebtTokenId → contract addresses per chain
│   ├── abis/                   # Mento V3 contract ABIs
│   │   ├── BorrowerOperations.ts
│   │   ├── TroveManager.ts
│   │   ├── StabilityPool.ts
│   │   ├── CollateralRegistry.ts
│   │   ├── ActivePool.ts
│   │   ├── SortedTroves.ts
│   │   ├── HintHelpers.ts
│   │   ├── MultiTroveGetter.ts
│   │   ├── FXPriceFeed.ts
│   │   ├── PriceFeed.ts
│   │   ├── TroveNFT.ts
│   │   ├── SystemParams.ts
│   │   └── Erc20.ts
│   └── constants.ts            # MIN_DEBT, gas compensation, LTV limits, etc.
├── math/
│   ├── loan-details.ts         # getLoanDetails, getLtv, getLiquidationPrice
│   ├── risk.ts                 # getLiquidationRisk, getRedemptionRisk
│   └── leverage.ts             # getOpenLeveragedTroveParams, getLeverUpTroveParams
├── hooks/
│   ├── use-deployment.ts       # Current deployment context (GBPm contracts)
│   ├── use-trove.ts            # Single trove read by ID
│   ├── use-troves-by-account.ts  # All troves for connected wallet
│   ├── use-branch-stats.ts     # TVL, total debt, avg interest rate
│   ├── use-stability-pool.ts   # SP balance, rewards, yield
│   ├── use-price-feed.ts       # FX price from OracleAdapter
│   ├── use-hint-helpers.ts     # Sorted trove insertion hints
│   ├── use-system-params.ts    # Read SystemParams contract
│   └── use-leverage-slippage.ts  # DEX slippage check (Phase 5)
├── tx-flows/
│   ├── engine.ts               # Flow state machine (Jotai atoms)
│   ├── types.ts                # FlowDeclaration, FlowStep, FlowStatus
│   ├── open-trove.ts
│   ├── adjust-trove.ts
│   ├── close-trove.ts
│   ├── change-interest-rate.ts
│   ├── stability-deposit.ts
│   ├── stability-withdraw.ts
│   ├── claim-sp-rewards.ts
│   ├── claim-coll-surplus.ts
│   ├── redeem.ts
│   ├── open-leverage.ts        # Phase 5
│   └── adjust-leverage.ts      # Phase 5
├── atoms/
│   ├── deployment-atoms.ts     # Selected debt token, resolved contracts
│   ├── trove-form-atoms.ts     # Open/adjust trove form state
│   ├── earn-form-atoms.ts      # Stability pool form state
│   └── flow-atoms.ts           # Current tx flow state
├── types.ts                    # DebtTokenId, BranchId, Trove, Position, etc.
└── index.ts                    # Public API exports

apps/app.mento.org/app/components/borrow/
├── borrow-view.tsx             # Main borrow tab container (view router)
├── dashboard/
│   ├── borrow-dashboard.tsx    # Position overview
│   ├── position-card.tsx       # Single trove summary card
│   └── stability-card.tsx      # SP position summary card
├── open-trove/
│   ├── open-trove-form.tsx     # Main form
│   ├── collateral-input.tsx
│   ├── debt-input.tsx
│   ├── interest-rate-input.tsx
│   └── loan-summary.tsx        # LTV, liquidation price, risk badge
├── manage-trove/
│   ├── manage-trove-view.tsx   # Tab container (adjust | rate | close)
│   ├── adjust-form.tsx
│   ├── rate-form.tsx
│   └── close-form.tsx
├── earn/
│   ├── earn-view.tsx           # Stability pool main view
│   ├── deposit-form.tsx
│   └── withdraw-form.tsx
├── redeem/
│   └── redeem-form.tsx
├── leverage/                   # Phase 5
│   ├── leverage-form.tsx
│   └── leverage-slider.tsx
├── shared/
│   ├── debt-token-selector.tsx # GBPm / CHFm / JPYm selector
│   ├── flow-dialog.tsx         # Multi-step tx progress modal
│   ├── flow-step.tsx           # Individual step status display
│   ├── risk-badge.tsx          # Low / Medium / High risk indicator
│   ├── currency-display.tsx    # FX-aware price formatting
│   └── trove-metrics.tsx       # Reusable LTV, CR, liquidation price display
└── atoms/
    └── borrow-navigation.ts    # borrowViewAtom + sub-view state
```

---

## 3. Data Model

### The 2D problem

BOLD has one debt token (BOLD) and N collateral branches. Mento has M debt
tokens and N collateral types per debt token.

```
BOLD:   1 debt token  ×  N branches  =  N  contract sets
Mento:  M debt tokens ×  N branches  =  M×N contract sets
```

Each debt token (GBPm, CHFm, JPYm) is a completely independent Liquity
deployment with its own `CollateralRegistry`, `BorrowerOperations`,
`TroveManager`, `StabilityPool`, etc. The "BOLD token" in each deployment
is the Mento `StableTokenV3` (GBPm/CHFm/JPYm).

### Key types

```typescript
// Which stable are we minting?
type DebtTokenId = "GBPm" | "CHFm" | "JPYm";

// Which collateral within a deployment?
type BranchId = number; // 0 = USDm, future: 1 = EURm, etc.

// A full deployment = all contracts for one debt token
interface Deployment {
  debtTokenId: DebtTokenId;
  debtTokenAddress: Address;
  debtTokenSymbol: string;
  debtTokenCurrencySymbol: string; // "£", "Fr.", "¥"
  collateralRegistry: Address;
  hintHelpers: Address;
  multiTroveGetter: Address;
  branches: BranchConfig[];
}

interface BranchConfig {
  branchId: BranchId;
  collateralSymbol: string;      // "USDm"
  collateralAddress: Address;
  borrowerOperations: Address;
  troveManager: Address;
  stabilityPool: Address;
  sortedTroves: Address;
  activePool: Address;
  priceFeed: Address;            // FXPriceFeed
  troveNFT: Address;
  systemParams: Address;
}

// Identifies a specific trove globally
interface TroveKey {
  deploymentId: DebtTokenId;
  branchId: BranchId;
  troveId: bigint;
}
```

### Contract resolution

```typescript
// Get all contracts for GBPm
const deployment = getDeployment("GBPm", chainId);

// Get branch-specific contract
const borrowerOps = deployment.branches[0].borrowerOperations;

// Read from the price feed
const price = useReadContract({
  address: deployment.branches[0].priceFeed,
  abi: FXPriceFeedAbi,
  functionName: "fetchPrice",
});
```

### Initial config (GBPm on Celo)

```typescript
// packages/web3/src/features/borrow/config/deployments.ts
// Addresses TBD — will come from Mento SDK V3 once available
// For now: local config, migrated to SDK when CDPLiquidityStrategy addresses ship

const deployments: Record<ChainId, Deployment[]> = {
  [ChainId.CELO]: [
    {
      debtTokenId: "GBPm",
      debtTokenAddress: "0x...",     // StableTokenV3 for GBP
      debtTokenSymbol: "GBPm",
      debtTokenCurrencySymbol: "£",
      collateralRegistry: "0x...",
      hintHelpers: "0x...",
      multiTroveGetter: "0x...",
      branches: [{
        branchId: 0,
        collateralSymbol: "USDm",
        collateralAddress: "0x...",
        borrowerOperations: "0x...",
        troveManager: "0x...",
        stabilityPool: "0x...",
        sortedTroves: "0x...",
        activePool: "0x...",
        priceFeed: "0x...",          // FXPriceFeed (USD/GBP)
        troveNFT: "0x...",
        systemParams: "0x...",
      }],
    },
  ],
  [ChainId.CELO_SEPOLIA]: [/* testnet addresses */],
};
```

---

## 4. Technical Decisions

### A. TransactionFlow → Jotai atoms

BOLD's `TransactionFlow` is a React Context + localStorage system (~700 LOC).
We reimplement the same state machine as Jotai atoms:

```typescript
// Core flow atom
const borrowFlowAtom = atomWithStorage<BorrowFlowState | null>(
  "mento:borrow:flow",
  null
);

// Flow state
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
  status: "idle" | "awaiting-commit" | "awaiting-verify" | "confirmed" | "error";
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

MVP uses **direct contract reads only**:

- `MultiTroveGetter` for batch-reading all troves for an account
- `useReadContract` / `useReadContracts` for individual position data
- Event-based enumeration as fallback

Subgraph integration is a **separate workstream** tracked independently.
When available, it will be used for:

- Historical interest rate data
- Batch manager/delegate discovery
- Redemption history
- Faster position enumeration

### C. Contract addresses — Local config, migrate to SDK

The Mento SDK V3 (`feat/sdk-v3` branch) doesn't yet include Liquity deployment
addresses. The `CDPLiquidityStrategy` address is a placeholder (`0x...0002`).

**Current plan:**
1. Define addresses in `packages/web3/src/features/borrow/config/deployments.ts`
2. When SDK V3 ships with Liquity addresses, refactor to use
   `mento.getContractAddress("BorrowerOperations_GBPm")` or equivalent
3. The `deployments.ts` abstraction makes this swap trivial — only one file changes

### D. Feature flag

```typescript
// apps/app.mento.org/app/env.mjs
NEXT_PUBLIC_ENABLE_BORROW: z.enum(["true", "false"]).optional().default("false"),

// .env.development (always on)
NEXT_PUBLIC_ENABLE_BORROW="true"

// Production: off until launch
// Vercel env: NEXT_PUBLIC_ENABLE_BORROW="false"
```

The borrow tab visibility in the header and the borrow view in `page.tsx` both
check this flag. When `"false"`, the tab is hidden and the borrow components
are never imported (tree-shaken out of the production bundle).

---

## 5. Phase 0 — Foundation

> **Goal:** Scaffolding, feature flag, pure logic extraction, ABIs, deployment config
>
> **Separate PRD:** `tasks/prd-phase-0-foundation.md`

### Tasks

- [ ] **P0-1: Create `feat/v3` branch** from `main`
- [ ] **P0-2: Add feature flag** `NEXT_PUBLIC_ENABLE_BORROW` to `env.mjs`
  - Add to `createEnv` schema (client, default `"false"`)
  - Add to `.env.example`
  - Set `"true"` in `.env.development` (or `.env.local`)
  - Guard borrow tab in `header.tsx` — only show when flag is `"true"`
  - Guard borrow section in `page.tsx` — only render when flag is `"true"`
- [ ] **P0-3: Scaffold `packages/web3/src/features/borrow/`**
  - Create directory structure per architecture section
  - Add `index.ts` with public exports
  - Ensure `tsup` build includes the new module
- [ ] **P0-4: Scaffold `apps/app.mento.org/app/components/borrow/`**
  - Create directory structure
  - `borrow-view.tsx` — initial placeholder that replaces "Coming soon"
  - `atoms/borrow-navigation.ts` — `borrowViewAtom`
- [ ] **P0-5: Extract pure math** from BOLD's `liquity-math.ts`
  - `loan-details.ts`: `getLoanDetails()`, `getLtv()`, `getLiquidationPrice()`
  - `risk.ts`: `getLiquidationRisk()`, `getRedemptionRisk()`
  - Remove BOLD-specific dependencies (env imports, branch lookups)
  - Add unit tests for extracted functions
- [ ] **P0-6: Extract leverage math** from BOLD's `liquity-leverage.ts`
  - `leverage.ts`: `getOpenLeveragedTroveParams()`, `getLeverUpTroveParams()`,
    `getLeverDownTroveParams()`, `getCloseFlashLoanAmount()`
  - Keep as pure functions, parameterize prices/amounts
- [ ] **P0-7: Copy and adapt ABIs**
  - Copy from `bold/frontend/app/src/abi/`
  - Add `FXPriceFeed` ABI (new in Mento V3)
  - Add `SystemParams` ABI (new in Mento V3)
  - Verify `BorrowerOperations`, `TroveManager`, `StabilityPool` ABIs match
    deployed Mento V3 contracts
- [ ] **P0-8: Create deployment config**
  - `deployments.ts` with `Deployment` and `BranchConfig` types
  - GBPm config for Celo mainnet (addresses TBD, use placeholders initially)
  - GBPm config for Celo Sepolia (if testnet deployment exists)
  - `getDeployment(debtTokenId, chainId)` helper function
  - `getDeployments(chainId)` to list all available deployments
- [ ] **P0-9: Create type definitions**
  - `types.ts`: `DebtTokenId`, `BranchId`, `TroveKey`, `Trove`, `Position`,
    `StabilityPoolPosition`, `LoanDetails`, `RiskLevel`
- [ ] **P0-10: Create `use-price-feed` hook**
  - Read `FXPriceFeed.fetchPrice()` via wagmi `useReadContract`
  - Handle `isShutdown` state
  - FX-aware price formatting utility (`formatFxPrice(price, currencySymbol)`)
  - Polling interval: 60s (same as BOLD)
- [ ] **P0-11: Create `use-system-params` hook**
  - Read `SystemParams` contract for MIN_DEBT, MCR, CCR, etc.
  - Cache as these are immutable per deployment

### Acceptance criteria

- Feature flag works: borrow tab visible in dev, hidden in prod
- Pure math functions extracted with tests passing
- ABIs compile without TypeScript errors
- Deployment config resolves contracts for GBPm
- Price feed hook returns a valid FX rate on Celo testnet/fork

---

## 6. Phase 1 — Read Path

> **Goal:** Dashboard showing positions, read-only trove + SP data
>
> **Separate PRD:** `tasks/prd-phase-1-read-path.md`

### Tasks

- [ ] **P1-1: `use-deployment` hook**
  - Provides current deployment context based on selected debt token
  - Returns `Deployment` object with all resolved addresses
  - Atom: `selectedDebtTokenAtom` (defaults to "GBPm")
- [ ] **P1-2: `use-troves-by-account` hook**
  - Use `MultiTroveGetter` contract for batch reads (no subgraph dependency)
  - Returns all troves owned by connected wallet across branches
  - Includes: troveId, collateral, debt, interest rate, status
  - Computes derived data via `getLoanDetails()` math
- [ ] **P1-3: `use-trove` hook**
  - Read single trove by ID
  - Full detail: collateral, debt, interest rate, status, pending rewards
  - Real-time updates on block change
- [ ] **P1-4: `use-stability-pool` hook**
  - Read user's SP deposit balance
  - Read pending rewards (collateral gains + debt token yield)
  - Read pool stats (total deposits, current yield rate)
- [ ] **P1-5: `use-branch-stats` hook**
  - Total value locked (TVL) per branch
  - Total debt
  - Average interest rate
  - Number of active troves
- [ ] **P1-6: Dashboard view (`borrow-dashboard.tsx`)**
  - List of open trove positions (position cards)
  - List of SP positions (stability cards)
  - Empty state with CTA to open first trove or deposit into SP
  - "Open Trove" and "Earn" action buttons
  - Debt token selector (functional but single-option for now)
- [ ] **P1-7: Position card component**
  - Collateral amount + symbol (USDm)
  - Debt amount + symbol (GBPm)
  - LTV with color-coded risk badge
  - Liquidation price
  - Interest rate
  - Click → navigate to manage-trove view
- [ ] **P1-8: Stability card component**
  - Deposit amount (GBPm)
  - Pending rewards (USDm gains + GBPm yield)
  - Pool share percentage
  - Click → navigate to earn view
- [ ] **P1-9: Debt token selector**
  - Dropdown or segmented control: GBPm (active), CHFm (coming soon), JPYm (coming soon)
  - Drives `selectedDebtTokenAtom`
  - Disabled options show "Coming soon" badge
- [ ] **P1-10: Currency display component**
  - FX-aware formatting: `£1,234.56`, `Fr.1'234.56`, `¥123,456`
  - Handles locale-specific number formatting
  - Shows FX rate tooltip (e.g., "1 GBPm ≈ £1.00 ≈ $1.27")
- [ ] **P1-11: Risk badge component**
  - Low (green), Medium (amber), High (red)
  - Based on LTV relative to max LTV (using extracted risk math)

### Acceptance criteria

- Connected wallet sees all open troves on dashboard
- Position metrics (LTV, liquidation price) are accurate
- SP position shows correct deposit and pending rewards
- All amounts display in the correct local currency
- Empty state guides new users to open a trove

---

## 7. Phase 2 — Transaction Flow Engine

> **Goal:** Jotai-based multi-step transaction orchestration with persistence
>
> **Separate PRD:** `tasks/prd-phase-2-tx-flow-engine.md`

### Tasks

- [ ] **P2-1: Flow state machine** (`tx-flows/engine.ts`)
  - Jotai atoms: `borrowFlowAtom`, `flowActionsAtom`
  - States: `idle → awaiting-commit → awaiting-verify → confirmed | error`
  - localStorage persistence via `atomWithStorage` (key: `mento:borrow:flow`)
  - Recovery: on mount, if step is `awaiting-verify`, resume verification
  - Auto-advance: when step confirms, advance to next step
  - Discard: clear flow state and return to previous view
- [ ] **P2-2: Flow type system** (`tx-flows/types.ts`)
  - `FlowDeclaration<TRequest>`: title, steps, getSteps, parseRequest
  - `FlowStepDefinition`: name, commit(ctx), verify(ctx, hash)
  - `FlowContext`: account, contracts, wagmiConfig, writeContract, readContract
  - Flow registry: `Record<string, FlowDeclaration<any>>`
- [ ] **P2-3: `writeContract` wrapper**
  - Gas estimation with headroom (25% buffer, min 100k)
  - Error normalization (user rejection, gas estimation failure, revert)
  - Returns tx hash
- [ ] **P2-4: Approval/permit utilities**
  - `checkAllowance(token, spender, amount)` — read current allowance
  - `buildApproveStep(token, spender, amount)` — ERC20 approve step
  - Permit support for StableTokenV3 (if ERC-2612 is supported)
  - Fallback to standard approve if permit fails
- [ ] **P2-5: Hint helpers integration** (`hooks/use-hint-helpers.ts`)
  - `getTroveOperationHints(branchId, interestRate)` via HintHelpers contract
  - Used by open-trove and adjust-trove flows for gas-efficient insertion
- [ ] **P2-6: Flow dialog component** (`shared/flow-dialog.tsx`)
  - Modal overlay showing multi-step progress
  - Step indicators (pending / active / complete / error)
  - Current step action button (triggers commit)
  - Error state with retry button
  - Success state with link back to dashboard
  - Follows the same card-based visual language as the pools liquidity drawer
- [ ] **P2-7: Flow step component** (`shared/flow-step.tsx`)
  - Individual step display: icon + label + status
  - Animated transitions between states
  - Shows tx hash link to block explorer when available
- [ ] **P2-8: Integration with `borrow-view.tsx`**
  - Flow dialog opens when a tx flow is started
  - On completion, returns to the originating view
  - Back navigation warning if flow is in progress

### Acceptance criteria

- Flow engine handles the full lifecycle: start → multi-step → complete
- Page reload during `awaiting-verify` correctly resumes verification
- Error in any step allows retry without restarting the entire flow
- Approve + execute two-step pattern works correctly
- Flow dialog matches Mento design language

### BOLD reference files

| BOLD source | What to extract |
|---|---|
| `services/TransactionFlow.tsx` | State machine logic, step execution pattern |
| `comps/FlowButton/FlowButton.tsx` | Flow trigger pattern |
| `screens/TransactionsScreen/TransactionStatus.tsx` | Step status display logic |
| `permit.ts` | ERC-2612 permit implementation |
| `liquity-utils.ts` → `getTroveOperationHints()` | Hint helper calls |

---

## 8. Phase 3 — Core Trove Operations

> **Goal:** Open, adjust, and close troves
>
> **Separate PRD:** `tasks/prd-phase-3-trove-operations.md`

### Tasks

#### Open Trove

- [ ] **P3-1: Open trove form** (`open-trove/open-trove-form.tsx`)
  - Collateral input (USDm amount, shows wallet balance, max button)
  - Debt input (GBPm amount, shows min debt from SystemParams)
  - Interest rate input (slider + manual entry, min from SystemParams)
  - Optional: batch manager / delegate selection (reads from contract)
  - Real-time loan summary (LTV, liquidation price, risk level)
  - "Open Trove" button → triggers tx flow
- [ ] **P3-2: Open trove tx flow** (`tx-flows/open-trove.ts`)
  - Dynamic steps via `getSteps()`:
    1. Approve USDm → BorrowerOperations (if allowance insufficient)
    2. `BorrowerOperations.openTrove()` with computed hints
  - Request params: collAmount, debtAmount, interestRate, maxUpfrontFee
  - Verify: wait for tx confirmation, validate trove exists on-chain
- [ ] **P3-3: Collateral input component** (`open-trove/collateral-input.tsx`)
  - Token icon + symbol (USDm)
  - Amount input with balance display
  - Max button (reserves gas compensation amount)
  - USD equivalent display
- [ ] **P3-4: Debt input component** (`open-trove/debt-input.tsx`)
  - Token icon + symbol (GBPm)
  - Amount input with min debt indicator
  - Suggestion chips (e.g., 500, 1000, 5000 GBPm)
  - Local currency equivalent display
- [ ] **P3-5: Interest rate input** (`open-trove/interest-rate-input.tsx`)
  - Slider with min/max from SystemParams
  - Manual entry field
  - Rate delegate option (batch manager address input)
  - Shows annual cost estimate based on debt amount
- [ ] **P3-6: Loan summary component** (`open-trove/loan-summary.tsx`)
  - Collateral ratio
  - LTV
  - Liquidation price (in FX terms: "£X.XX per USDm")
  - Risk level badge
  - One-time fee estimate
  - Updates in real-time as inputs change

#### Manage Trove

- [ ] **P3-7: Manage trove view** (`manage-trove/manage-trove-view.tsx`)
  - Tab container: Adjust | Rate | Close
  - Header showing current trove summary
  - Navigated to from position card click
- [ ] **P3-8: Adjust trove form** (`manage-trove/adjust-form.tsx`)
  - Add/remove collateral (toggle direction)
  - Borrow more / repay debt (toggle direction)
  - Shows before → after comparison for LTV, liquidation price
  - "Update Position" button → triggers tx flow
- [ ] **P3-9: Adjust trove tx flow** (`tx-flows/adjust-trove.ts`)
  - Dynamic steps:
    1. Approve collateral (if adding and allowance insufficient)
    2. `BorrowerOperations.adjustTrove()` with new amounts + hints
  - Handles all combinations: add coll, remove coll, borrow more, repay
- [ ] **P3-10: Change interest rate form** (`manage-trove/rate-form.tsx`)
  - Current rate display
  - New rate input (slider + manual)
  - Shows impact on annual cost
- [ ] **P3-11: Change interest rate tx flow** (`tx-flows/change-interest-rate.ts`)
  - Single step: `BorrowerOperations.adjustTroveInterestRate()`
- [ ] **P3-12: Close trove form** (`manage-trove/close-form.tsx`)
  - Shows total debt to repay (including accrued interest)
  - Shows collateral to receive back
  - Wallet balance check (enough debt token to repay?)
  - "Close Position" button → triggers tx flow
- [ ] **P3-13: Close trove tx flow** (`tx-flows/close-trove.ts`)
  - Dynamic steps:
    1. Approve debt token (if using approve instead of permit)
    2. `BorrowerOperations.closeTrove()`
  - Verify: trove no longer exists
- [ ] **P3-14: Claim collateral surplus flow** (`tx-flows/claim-coll-surplus.ts`)
  - Shown when user has claimable collateral after redistribution
  - Single step: `BorrowerOperations.claimCollateral()`

### Acceptance criteria

- User can open a trove: deposit USDm, borrow GBPm, set interest rate
- User can adjust: add/remove collateral, borrow/repay
- User can change interest rate
- User can close trove and receive collateral back
- All operations show accurate before/after comparisons
- Min debt, max LTV, and other protocol limits are enforced in the UI
- Transaction flows handle approval + execution correctly

### BOLD reference files

| BOLD source | What to extract |
|---|---|
| `screens/BorrowScreen.tsx` | Open trove form layout + validation logic |
| `screens/LoanScreen.tsx` | Manage trove tab structure |
| `tx-flows/openBorrowPosition.tsx` | Open trove step definitions |
| `tx-flows/updateBorrowPosition.tsx` | Adjust trove step definitions |
| `tx-flows/closeLoanPosition.tsx` | Close trove step definitions |
| `tx-flows/updateLoanInterestRate.tsx` | Rate change step definitions |
| `tx-flows/claimCollateralSurplus.tsx` | Claim surplus step definitions |
| `comps/InterestRateField/` | Interest rate input with delegate support |
| `comps/Field/` | Amount input field patterns |

---

## 9. Phase 4 — Stability Pool

> **Goal:** Deposit/withdraw from stability pools, claim rewards
>
> **Separate PRD:** `tasks/prd-phase-4-stability-pool.md`

### Tasks

- [ ] **P4-1: Earn view** (`earn/earn-view.tsx`)
  - Pool stats: total deposits, current yield, pool share
  - User position: deposit amount, pending rewards
  - Deposit and withdraw forms
- [ ] **P4-2: Deposit form** (`earn/deposit-form.tsx`)
  - GBPm amount input with wallet balance
  - Expected yield display
  - "Deposit" button → triggers tx flow
- [ ] **P4-3: Deposit tx flow** (`tx-flows/stability-deposit.ts`)
  - Steps:
    1. Approve GBPm → StabilityPool (if needed)
    2. `StabilityPool.provideToSP(amount, doClaim)`
  - Option to claim pending rewards in same tx
- [ ] **P4-4: Withdraw form** (`earn/withdraw-form.tsx`)
  - Amount input with max = current deposit
  - Shows rewards that will be claimed
  - "Withdraw" button → triggers tx flow
- [ ] **P4-5: Withdraw tx flow** (`tx-flows/stability-withdraw.ts`)
  - Single step: `StabilityPool.withdrawFromSP(amount)`
  - Always claims pending rewards
- [ ] **P4-6: Claim rewards flow** (`tx-flows/claim-sp-rewards.ts`)
  - Claim without changing deposit amount
  - `StabilityPool.withdrawFromSP(0)` (triggers reward claim)
- [ ] **P4-7: SP stats display**
  - Total GBPm deposited in pool
  - APR/APY estimate (based on recent yield)
  - Pool's collateral gains (USDm from liquidations)

### Acceptance criteria

- User can deposit GBPm into the stability pool
- User can withdraw deposit partially or fully
- Pending rewards (USDm gains + GBPm yield) display correctly
- Claiming rewards works standalone and as part of deposit/withdraw
- Pool statistics are accurate

### BOLD reference files

| BOLD source | What to extract |
|---|---|
| `screens/EarnPoolScreen.tsx` | SP screen layout |
| `tx-flows/earnUpdate.tsx` | Deposit/withdraw step logic |
| `tx-flows/earnClaimRewards.tsx` | Claim rewards step logic |
| `comps/EarnPositionSummary/` | SP position display |

---

## 10. Phase 5 — Leverage / Multiply

> **Goal:** Flash-loan-powered leveraged positions
>
> **Separate PRD:** `tasks/prd-phase-5-leverage.md`

### Prerequisites (must be confirmed before starting)

- [ ] Flash loan provider available on Celo (Aave V3 or alternative)
- [ ] DEX with sufficient GBPm/USDm liquidity for the swap leg
- [ ] Zapper contracts deployed (LeverageZapper for USDm collateral)
- [ ] ExchangeHelpers contract deployed pointing to Celo DEX

### Tasks

- [ ] **P5-1: Research & confirm prerequisites**
  - Identify flash loan provider on Celo
  - Assess DEX liquidity for GBPm/USDm pair
  - Confirm zapper contract deployment plan
- [ ] **P5-2: Leverage form** (`leverage/leverage-form.tsx`)
  - Initial deposit input (USDm)
  - Leverage factor slider (1.1x to max)
  - Shows: total exposure, total debt, liquidation price
  - Interest rate input
  - Slippage display and warning
- [ ] **P5-3: Leverage slider component** (`leverage/leverage-slider.tsx`)
  - Visual slider with factor labels
  - Suggestion chips (1.5x, 2x, 3x, 5x)
  - Dynamic max based on collateral ratio limits
- [ ] **P5-4: Slippage check hook** (`hooks/use-leverage-slippage.ts`)
  - Calls `ExchangeHelpers.getCollFromBold()` equivalent
  - Returns actual slippage percentage
  - Blocks submission if > 5%
- [ ] **P5-5: Open leverage tx flow** (`tx-flows/open-leverage.ts`)
  - Steps:
    1. Approve collateral → Zapper
    2. `Zapper.openLeveragedTrove(params)` with flash loan
  - Flash loan amount computed via `getOpenLeveragedTroveParams()`
- [ ] **P5-6: Adjust leverage tx flow** (`tx-flows/adjust-leverage.ts`)
  - Lever up: `Zapper.leverUpTrove(params)`
  - Lever down: `Zapper.leverDownTrove(params)`
  - Close from collateral: `Zapper.closeTroveFromCollateral(troveId, flashLoanAmount)`
- [ ] **P5-7: Leverage position display**
  - Shows leverage factor (e.g., "3.2x")
  - Total exposure vs initial deposit
  - Liquidation price at current leverage

### Acceptance criteria

- User can open a leveraged position with a specified multiply factor
- User can increase or decrease leverage on existing position
- User can close leveraged position from collateral (no debt token needed)
- Slippage is checked and displayed before submission
- All leverage math produces correct results

### BOLD reference files

| BOLD source | What to extract |
|---|---|
| `liquity-leverage.ts` | All flash loan parameter calculations |
| `screens/LeverageScreen.tsx` | Leverage form layout |
| `tx-flows/openLeveragePosition.tsx` | Open leverage step definitions |
| `tx-flows/updateLeveragePosition.tsx` | Adjust leverage step definitions |
| `comps/LeverageField/` | Leverage factor input |

---

## 11. Phase 6 — Multi-Debt Expansion

> **Goal:** Add CHFm, JPYm and cross-deployment views
>
> **Separate PRD:** `tasks/prd-phase-6-multi-debt.md`

### Tasks

- [ ] **P6-1: Add CHFm deployment config**
  - Contract addresses for CHFm deployment on Celo
  - FXPriceFeed for USD/CHF
  - Currency formatting: `Fr.1'234.56`
- [ ] **P6-2: Add JPYm deployment config**
  - Contract addresses for JPYm deployment on Celo
  - FXPriceFeed for USD/JPY
  - Currency formatting: `¥123,456`
- [ ] **P6-3: Enable debt token selector**
  - Remove "Coming soon" badges
  - Switching debt token updates all hooks and views
- [ ] **P6-4: Cross-deployment dashboard**
  - Show positions across all debt tokens in one view
  - Grouped by debt token with totals
  - Each position links to the correct deployment's manage view
- [ ] **P6-5: Per-deployment stability pools**
  - Each debt token has its own stability pool
  - Earn view shows the SP for the selected debt token
  - Dashboard shows all SP positions across debt tokens

### Acceptance criteria

- User can switch between GBPm, CHFm, JPYm
- Each debt token's troves and SP are independent
- Dashboard aggregates positions across all debt tokens
- Currency formatting is correct for each locale

---

## 12. Cross-Cutting Concerns

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

This ensures the entire borrow module (components, hooks, ABIs) is tree-shaken
when the flag is off and lazy-loaded when it's on.

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

- **Unit tests** for pure math (loan-details, risk, leverage) — these are critical
- **Unit tests** for tx-flow step builders (request validation, step ordering)
- **Component tests** for form validation and display logic
- **Integration tests** on Celo fork (Anvil) for full tx flows
- Use existing vitest setup from `@repo/web3`

### Accessibility

- All form inputs have labels and aria attributes
- Risk badges have aria-label describing the risk level
- Flow dialog traps focus and supports escape to close
- Color is not the only indicator for risk (use icons + text)

---

## 13. What We Drop from BOLD

These BOLD features are **not included** in the Mento borrow section:

| BOLD Feature | Reason |
|---|---|
| LQTY staking + governance voting | Mento has its own governance app |
| sBOLD vault (ERC-4626) | No Mento equivalent |
| Legacy V1 migration flows | Not applicable |
| Allocation voting / bribe claiming | Liquity-specific governance |
| Account statistics screen | Not needed for MVP |
| PandaCSS UIKit | Replaced by @repo/ui (shadcn/Tailwind) |
| ConnectKit wallet connection | Replaced by RainbowKit (already in Mento) |
| ENS resolution | Celo doesn't use ENS |
| VPN/blocking list | Not needed initially |

This reduces the 20 BOLD tx flows to **11 relevant flows** (9 in Phases 3-4,
2 more in Phase 5).

---

## 14. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | FX price display bugs (wrong currency, inverted rate) | Medium | High | Build `currency-display` component first; test with known FX rates; snapshot tests |
| R2 | Leverage prerequisites not met on Celo (no flash loans/DEX liquidity) | Medium | Medium | Phase 5 is explicitly deferred; research prerequisites in P5-1 before committing |
| R3 | Mento V3 contracts not yet deployed to mainnet | High | High | Use testnet/fork for development; deployment config is environment-specific |
| R4 | SDK V3 contract address format changes | Low | Low | Local config abstraction means only `deployments.ts` needs updating |
| R5 | MultiTroveGetter gas limits on large account positions | Low | Medium | Paginate reads; fall back to individual reads if batch fails |
| R6 | StableTokenV3 permit differs from ERC-2612 | Medium | Medium | Test permit flow early in Phase 2; fallback to standard approve always available |
| R7 | Bundle size increase from borrow ABIs and logic | Low | Medium | Dynamic import behind feature flag ensures tree-shaking; monitor with bundle analyzer |
| R8 | Tab-based nav limits deep linking to specific troves | Medium | Low | Each view stores enough state in atoms for restoration; URL routing can be added later |

---

## 15. Reference: BOLD → Mento Mapping

### File-level mapping

| BOLD File | Action | Mento Destination |
|---|---|---|
| `liquity-math.ts` | Extract pure functions | `packages/web3/.../borrow/math/loan-details.ts`, `risk.ts` |
| `liquity-leverage.ts` | Extract pure functions | `packages/web3/.../borrow/math/leverage.ts` |
| `liquity-utils.ts` | Partial extract | `packages/web3/.../borrow/hooks/`, `types.ts` |
| `contracts.ts` | Redesign for 2D model | `packages/web3/.../borrow/config/deployments.ts` |
| `abi/*.ts` | Copy + add FXPriceFeed, SystemParams | `packages/web3/.../borrow/config/abis/` |
| `services/TransactionFlow.tsx` | Reimplement as Jotai | `packages/web3/.../borrow/tx-flows/engine.ts` |
| `services/Prices.tsx` | Replace with FXPriceFeed | `packages/web3/.../borrow/hooks/use-price-feed.ts` |
| `services/Ethereum.tsx` | Drop (use @repo/web3) | N/A |
| `services/ReactQuery.tsx` | Drop (use @repo/web3) | N/A |
| `services/StoredState.tsx` | Replace with Jotai atoms | `packages/web3/.../borrow/atoms/` |
| `tx-flows/*.tsx` | Adapt step logic | `packages/web3/.../borrow/tx-flows/` |
| `screens/BorrowScreen.tsx` | Rewrite UI | `app/components/borrow/open-trove/` |
| `screens/LoanScreen.tsx` | Rewrite UI | `app/components/borrow/manage-trove/` |
| `screens/EarnPoolScreen.tsx` | Rewrite UI | `app/components/borrow/earn/` |
| `screens/LeverageScreen.tsx` | Rewrite UI (Phase 5) | `app/components/borrow/leverage/` |
| `subgraph.ts` | Defer (separate workstream) | Future: `packages/web3/.../borrow/hooks/` |

### Concept mapping

| BOLD Concept | Mento Equivalent |
|---|---|
| BOLD token | StableTokenV3 (GBPm / CHFm / JPYm) |
| Branch (ETH/rETH/wstETH) | Branch (USDm, future: EURm) |
| Single CollateralRegistry | One CollateralRegistry per debt token |
| Chainlink PriceFeed | FXPriceFeed → OracleAdapter |
| Hardcoded constants (MCR, etc.) | SystemParams contract (configurable) |
| `BranchId` (0-9) | `DebtTokenId × BranchId` (2D) |
| `PrefixedTroveId` ("0:0xabc") | `TroveKey { deploymentId, branchId, troveId }` |
| ConnectKit | RainbowKit |
| PandaCSS / UIKit | Tailwind / shadcn / @repo/ui |
| React Context (TransactionFlow) | Jotai atoms |
| Subgraph (required) | Direct reads (MVP) → Subgraph (later) |
