# PRD: Phase 1 — Read Path (Dashboard + Positions)

## Introduction

Phase 1 builds the read-only data layer and dashboard UI for the Mento V3 Borrow section. Users with connected wallets will see their open trove positions and Stability Pool deposits on a dashboard. All data comes from SDK read methods (for troves) and direct contract reads (for stability pools). No write operations in this phase — that's Phase 2.

**Base branch:** `feat/borrow`
**Depends on:** Phase 0 (complete) — feature flag, SDK integration, scaffolding, types, formatting, SP ABI
**Source plan:** `tasks/v3-borrow-project-plan.md` — Section 7

## Goals

- Create thin React Query hooks wrapping every SDK read method needed by the borrow UI
- Create derived hooks that combine SDK reads with SDK math (loan details, debt suggestions, risk)
- Create Stability Pool read hooks using direct contract calls (not in SDK)
- Build a borrow dashboard showing open trove positions and SP deposits
- Build reusable shared components: risk badge, debt token selector, trove metrics display
- Ensure all monetary values display in the correct local currency format (£ for GBPm)

## User Stories

### US-001: Create use-system-params hook

**Description:** As a developer, I need a hook that fetches system parameters (MCR, CCR, minDebt, etc.) so the UI can display limits and validate inputs.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-system-params.ts`
- [ ] Uses `useQuery` from `@tanstack/react-query` with query key `["borrow", "systemParams", symbol]`
- [ ] Calls `sdk.getSystemParams(symbol)` via `useBorrowService()` hook
- [ ] Long stale time (these are immutable contract parameters) — e.g., `staleTime: Infinity` or `1000 * 60 * 60` (1 hour)
- [ ] Returns `{ data: SystemParams | undefined, isLoading, error }` — standard React Query return
- [ ] Accepts `symbol` parameter (defaults to `"GBPm"` or reads from a selected debt token atom)
- [ ] Enabled only when `sdk` is not null
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-002: Create use-collateral-price hook

**Description:** As a developer, I need a hook that fetches the current collateral price so the UI can compute LTV, liquidation price, and format prices.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-collateral-price.ts`
- [ ] Uses `useQuery` with query key `["borrow", "collateralPrice", symbol]`
- [ ] Calls `sdk.getCollateralPrice(symbol)` — returns price as bigint (18 decimals)
- [ ] Polls at 60-second intervals (`refetchInterval: 60_000`)
- [ ] Returns `{ data: bigint | undefined, isLoading, error }`
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-003: Create use-user-troves hook

**Description:** As a developer, I need a hook that fetches all trove positions for the connected wallet so the dashboard can list them.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-user-troves.ts`
- [ ] Uses `useQuery` with query key `["borrow", "userTroves", symbol, account]`
- [ ] Calls `sdk.getUserTroves(symbol, account)` — returns array of `BorrowPosition`
- [ ] Refetches on a 15-second interval (`refetchInterval: 15_000`)
- [ ] Enabled only when `sdk` is not null AND `account` is defined (wallet connected)
- [ ] Uses `useAccount()` from wagmi to get the connected address
- [ ] Returns `{ data: BorrowPosition[] | undefined, isLoading, error }`
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-004: Create use-trove-data hook

**Description:** As a developer, I need a hook that fetches detailed data for a single trove, used by the manage-trove view.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-trove-data.ts`
- [ ] Uses `useQuery` with query key `["borrow", "troveData", symbol, troveId]`
- [ ] Calls `sdk.getTroveData(symbol, troveId)` — returns `BorrowPosition`
- [ ] Refetches on 15-second interval
- [ ] Enabled only when `sdk` is not null AND `troveId` is provided
- [ ] Returns `{ data: BorrowPosition | undefined, isLoading, error }`
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-005: Create use-branch-stats and use-interest-rate-brackets hooks

**Description:** As a developer, I need hooks for branch-level aggregate statistics and interest rate distribution so the dashboard and open-trove form can display market data.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-branch-stats.ts`
- [ ] `useBranchStats(symbol)` calls `sdk.getBranchStats(symbol)` — returns aggregate data (total collateral, total debt, etc.)
- [ ] Also exposes `sdk.getAverageInterestRate(symbol)` as part of the returned data or as a separate derived value
- [ ] Refetches on 60-second interval
- [ ] Create `packages/web3/src/features/borrow/hooks/use-interest-rate-brackets.ts`
- [ ] `useInterestRateBrackets(symbol)` calls `sdk.getInterestRateBrackets(symbol)` — returns `InterestRateBracket[]`
- [ ] Refetches on 60-second interval
- [ ] Both hooks follow same `useQuery` pattern as above (enabled when sdk not null)
- [ ] Export both from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-006: Create use-borrow-allowance and use-next-owner-index hooks

**Description:** As a developer, I need hooks for checking token allowances and next trove index, used by write flows in Phase 2.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-borrow-allowance.ts`
- [ ] `useBorrowAllowance(symbol, account)` calls `sdk.getCollateralAllowance(symbol, account, ...)` and `sdk.getDebtAllowance(...)` — returns `{ collateralAllowance: bigint, debtAllowance: bigint }`
- [ ] Refetches after transactions (use query invalidation key pattern)
- [ ] Create `packages/web3/src/features/borrow/hooks/use-next-owner-index.ts`
- [ ] `useNextOwnerIndex(symbol, owner)` calls `sdk.getNextOwnerIndex(symbol, owner)` — returns the next available trove index for this owner
- [ ] Both enabled only when sdk not null and account defined
- [ ] Export both from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-007: Create use-predict-upfront-fee hook

**Description:** As a developer, I need a hook that predicts the upfront fee for opening a trove, shown in the open-trove form summary.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-predict-upfront-fee.ts`
- [ ] `usePredictUpfrontFee(symbol, borrowAmount, interestRateIndex)` calls the appropriate SDK method (e.g., `sdk.predictOpenTroveUpfrontFee()`)
- [ ] Uses debounced inputs (user types debt amount → debounce 350ms → fetch fee) — follow the `useDebounce` pattern from swap hooks
- [ ] Returns `{ data: bigint | undefined, isLoading }` — the predicted fee amount
- [ ] Enabled only when sdk not null and borrowAmount > 0
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-008: Create derived hooks (loan details, debt suggestions, redemption risk)

**Description:** As a developer, I need derived hooks that combine SDK reads with SDK math to compute loan details, suggest debt amounts, and assess redemption risk.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-loan-details.ts`
- [ ] `useLoanDetails(collAmount, debtAmount, interestRate, symbol)` combines `useCollateralPrice` + SDK `getLoanDetails()` math
- [ ] Returns `LoanDetails` (LTV, liquidation price, risk level, max debt, status) — all computed client-side using SDK math functions
- [ ] Recomputes when any input changes (collAmount, debtAmount, interestRate, price)
- [ ] Create `packages/web3/src/features/borrow/hooks/use-debt-suggestions.ts`
- [ ] `useDebtSuggestions(collAmount, symbol)` combines `useLoanDetails` + SDK `calculateDebtSuggestions()` — returns suggested debt amounts at different risk levels
- [ ] Create `packages/web3/src/features/borrow/hooks/use-redemption-risk.ts`
- [ ] `useRedemptionRisk(interestRate, symbol)` combines `useInterestRateBrackets` + SDK `getRedemptionRisk()` — returns risk level for a given interest rate
- [ ] All derived hooks use `useMemo` for computation (not `useQuery` — these are pure client-side calculations from existing query data)
- [ ] Export all from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-009: Create use-interest-rate-chart-data hook

**Description:** As a developer, I need a hook that transforms interest rate bracket data into a format suitable for chart rendering, used by the open-trove form.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-interest-rate-chart-data.ts`
- [ ] `useInterestRateChartData(symbol)` consumes `useInterestRateBrackets` and transforms data into chart-friendly format
- [ ] Output shape: array of `{ rate: number, debt: number }` (JS numbers suitable for chart libraries) or similar
- [ ] Optionally accepts current user's rate to highlight their position in the distribution
- [ ] Uses `useMemo` for the transformation
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-010: Create use-stability-pool hook

**Description:** As a developer, I need a hook that reads Stability Pool data via direct contract calls (not in SDK), so the dashboard can show SP positions.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-stability-pool.ts`
- [ ] Uses `useReadContract` or `useReadContracts` from wagmi with the `stabilityPoolAbi` from Phase 0
- [ ] Reads for connected user: `getCompoundedBoldDeposit(account)`, `getDepositorCollGain(account)`, `getDepositorYieldGain(account)`
- [ ] Returns `StabilityPoolPosition` type: `{ deposit, collateralGain, debtTokenGain }`
- [ ] Create `packages/web3/src/features/borrow/hooks/use-stability-pool-stats.ts`
- [ ] `useStabilityPoolStats(symbol)` reads `getTotalBoldDeposits()` — returns total pool size
- [ ] Both hooks need the StabilityPool contract address — resolve via SDK's address resolution or hardcode for GBPm initially (document the approach)
- [ ] Refetches on 30-second interval
- [ ] Enabled only when account is connected (for user position) / always for pool stats
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-011: Create deployment atom and debt token selector component

**Description:** As a user, I want to select which debt token deployment to view (GBPm now, CHFm/JPYm later) so the dashboard shows the right data.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/atoms/deployment-atoms.ts`
- [ ] `selectedDebtTokenAtom` — Jotai atom holding the selected `DebtTokenConfig`, defaults to GBPm from `DEBT_TOKEN_CONFIGS`
- [ ] Export from `atoms/index.ts`
- [ ] Create `apps/app.mento.org/app/components/borrow/shared/debt-token-selector.tsx`
- [ ] Renders a dropdown or segmented control showing available debt tokens
- [ ] GBPm is active/selectable; CHFm and JPYm show "Coming soon" badge and are disabled
- [ ] Selecting a token updates `selectedDebtTokenAtom`
- [ ] Uses `@repo/ui` components (e.g., Select, Button) where appropriate
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill: selector shows GBPm selected, other options disabled

### US-012: Create risk badge component

**Description:** As a user, I want to see a color-coded risk badge on my positions so I can quickly assess their health.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/shared/risk-badge.tsx`
- [ ] Accepts `risk: RiskLevel | null` prop (from SDK: `"low"` | `"medium"` | `"high"`)
- [ ] Renders colored badge: Low = green, Medium = amber/yellow, High = red
- [ ] When `null`, renders nothing or a muted "N/A" state
- [ ] Uses existing Tailwind color utilities and `@repo/ui` Badge component if available
- [ ] Compact size suitable for use inside cards and table rows
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill: badge renders correctly with all three states

### US-013: Create trove metrics display component

**Description:** As a user, I want to see key trove metrics (LTV, liquidation price, collateral ratio) in a consistent format across the dashboard and manage views.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/shared/trove-metrics.tsx`
- [ ] Accepts `loanDetails: LoanDetails | null` and `debtToken: DebtTokenConfig` props
- [ ] Displays: LTV (formatted via `formatLtv`), liquidation price (via `formatPrice`), interest rate (via `formatInterestRate`), status
- [ ] Each metric shows a label + value pair in a grid or flex layout
- [ ] Uses risk badge component for the risk level
- [ ] Handles loading/null state gracefully (shows skeleton or placeholder)
- [ ] Uses formatting utilities from Phase 0 (`formatLtv`, `formatPrice`, `formatInterestRate`)
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-014: Create position card component

**Description:** As a user, I want to see each of my trove positions as a card on the dashboard with key metrics at a glance.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/dashboard/position-card.tsx`
- [ ] Accepts `position: BorrowPosition` and `debtToken: DebtTokenConfig` props
- [ ] Displays: collateral amount (formatted as USDm), debt amount (formatted in local currency), LTV with risk badge, liquidation price, interest rate
- [ ] Uses `useLoanDetails` derived hook to compute LTV and risk from the position data
- [ ] Uses `useCollateralPrice` hook for price data
- [ ] Clicking the card navigates to manage-trove view (updates `borrowViewAtom` to `{ view: "manage-trove", troveId }`)
- [ ] Uses `@repo/ui` Card component for consistent styling
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-015: Create stability card component

**Description:** As a user, I want to see my Stability Pool deposit as a card on the dashboard with pending rewards.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/dashboard/stability-card.tsx`
- [ ] Accepts `position: StabilityPoolPosition` and `debtToken: DebtTokenConfig` props
- [ ] Displays: deposit amount (formatted in local currency), collateral gain (USDm from liquidations), debt token yield gain
- [ ] Shows pool share percentage if total pool size is available (from `useStabilityPoolStats`)
- [ ] Clicking the card navigates to earn view (updates `borrowViewAtom` to `"earn"`)
- [ ] Uses `@repo/ui` Card component for consistent styling
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-016: Create borrow dashboard view

**Description:** As a user, I want to see all my borrow positions and stability pool deposits on a single dashboard when I click the Borrow tab.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/dashboard/borrow-dashboard.tsx`
- [ ] Uses `useUserTroves` hook to fetch open troves for connected wallet
- [ ] Uses `useStabilityPool` hook to fetch SP position for connected wallet
- [ ] Renders a position card for each active trove
- [ ] Renders a stability card if user has an SP deposit
- [ ] Shows debt token selector at the top
- [ ] Shows "Open Trove" and "Earn" action buttons (CTAs)
- [ ] Empty state when no positions: friendly message + prominent CTA to open first trove or deposit into SP
- [ ] Loading state: skeleton cards while data fetches
- [ ] Not-connected state: message prompting wallet connection
- [ ] Update `borrow-view.tsx` to render `<BorrowDashboard />` when `borrowViewAtom` is `"dashboard"` (replacing the placeholder from Phase 0)
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill: dashboard renders correctly with empty state when no positions exist

## Functional Requirements

- **FR-1:** All read hooks must use `@tanstack/react-query` with `useQuery` and follow the query key pattern `["borrow", hookName, ...params]` for consistent cache management.
- **FR-2:** Hooks must be disabled (`enabled: false`) when their dependencies are not ready (sdk null, account undefined, etc.) to prevent unnecessary error states.
- **FR-3:** Derived hooks (`useLoanDetails`, `useDebtSuggestions`, `useRedemptionRisk`) must use `useMemo` for client-side computation, not `useQuery` — they don't make network calls.
- **FR-4:** Stability Pool hooks must use wagmi's `useReadContract`/`useReadContracts` with the `stabilityPoolAbi` from Phase 0, since the SDK does not cover stability pools.
- **FR-5:** All monetary display must use the formatting utilities from Phase 0 (`formatDebtAmount`, `formatCollateralAmount`, `formatPrice`, `formatInterestRate`, `formatLtv`).
- **FR-6:** The dashboard must handle three states: not connected (prompt to connect), connected but no positions (empty state with CTAs), connected with positions (cards).
- **FR-7:** Position cards must be clickable, navigating to the manage-trove sub-view via `borrowViewAtom`.
- **FR-8:** The debt token selector must update `selectedDebtTokenAtom`, which all hooks consume to determine which deployment to query.

## Non-Goals

- **No write operations** — opening, adjusting, closing troves, and SP deposits/withdrawals are Phase 2+3.
- **No open-trove form** — the form UI comes in Phase 3. The "Open Trove" CTA button on the dashboard will be a placeholder that navigates to the `"open-trove"` view but the form itself is not built yet.
- **No manage-trove view** — navigation to it works, but the view itself is Phase 3.
- **No earn view** — the stability card navigates to `"earn"` but the view is Phase 3/4.
- **No interest rate chart component** — the hook that prepares chart data is built, but the actual chart visualization is Phase 3 (open-trove form).
- **No transaction flow dialog** — that's Phase 2.
- **No subgraph integration** — all reads are direct contract calls via SDK or wagmi.

## Design Considerations

- Follow the existing pools dashboard layout pattern (`pools-view.tsx`) for the borrow dashboard
- Use `@repo/ui` Card, Badge, Button, Select components for consistency
- Position cards should show the most critical info at a glance: collateral, debt, LTV, risk
- Use the same max-width container (`max-w-5xl`) as the pools view
- Loading states should use skeleton/shimmer placeholders, not spinners

## Technical Considerations

### Hook dependency chain

```
useSystemParams (immutable)
useCollateralPrice (60s poll)
useUserTroves (15s poll) ──→ position cards
useTroveData (15s poll)  ──→ manage view (Phase 3)
useBranchStats (60s poll) ──→ dashboard stats
useInterestRateBrackets (60s poll) ──→ chart data
useBorrowAllowance ──→ write flows (Phase 2)
useNextOwnerIndex ──→ open trove (Phase 3)
usePredictUpfrontFee ──→ open trove form (Phase 3)

Derived (no network):
useLoanDetails = useCollateralPrice + SDK math
useDebtSuggestions = useLoanDetails + SDK math
useRedemptionRisk = useInterestRateBrackets + SDK math
useInterestRateChartData = useInterestRateBrackets + transform
```

### Stability Pool address resolution

The SDK's `BorrowService` handles address resolution for trove contracts via `AddressesRegistry`. For Stability Pool reads (not in SDK), we need the SP contract address. Options:

1. Use SDK's address resolution if it exposes the SP address
2. Hardcode for GBPm initially and make it configurable later
3. Read from the `AddressesRegistry` contract directly

Check what the SDK exposes and use the simplest working approach.

### Patterns from Phase 0 progress

- Hook pattern: `useChainId()` + `usePublicClient({ chainId })` + `useMemo` for service hooks
- `BorrowService` constructor: `new BorrowService(publicClient, chainId)`
- Swap hooks use `useDebounce(amount, 350)` for input-dependent queries
- Features barrel at `packages/web3/src/features/index.ts` — already exports borrow

## Success Metrics

- All typechecks pass (`pnpm check-types` + `tsc --noEmit` in app)
- `tsup` build succeeds for `packages/web3`
- Dashboard renders with empty state for wallets with no positions
- Dashboard renders position cards for wallets with open troves (testable on Celo mainnet/fork)
- All monetary values formatted correctly (£ for GBPm)
- Risk badges show correct colors based on LTV thresholds
- Debt token selector shows GBPm active, CHFm/JPYm disabled

## Open Questions

- **StabilityPool contract address:** How to resolve it? Does the SDK expose it, or do we need to read from `AddressesRegistry` directly?
- **Batch manager display:** `BorrowPosition` includes `interestBatchManager`. Should the position card show whether a trove uses a batch manager? (Defer to Phase 3 manage view?)
- **Multiple troves per wallet:** The SDK supports multiple troves per owner. Should the dashboard show them all in a flat list, or group by deployment?
