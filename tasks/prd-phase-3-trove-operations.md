# PRD: Phase 3 — Core Trove Operations

## Introduction

Phase 3 builds the form UI for opening, adjusting, and closing troves. All write hooks (`useOpenTrove`, `useAdjustTrove`, `useCloseTrove`, `useAdjustInterestRate`, `useClaimCollateral`) and the transaction flow engine already exist from Phase 2. All read hooks (`useSystemParams`, `useCollateralPrice`, `useLoanDetails`, `useDebtSuggestions`, `useInterestRateChartData`, `useRedemptionRisk`, `usePredictUpfrontFee`, `useNextOwnerIndex`, `useBorrowAllowance`) already exist from Phase 1.

This phase is purely UI — building the form components, wiring them to hooks, and ensuring real-time feedback as users configure their positions.

**Base branch:** `feat/borrow`
**Depends on:** Phase 0 (complete), Phase 1 (complete), Phase 2 (complete)
**Source plan:** `tasks/v3-borrow-project-plan.md` — Section 9

## Goals

- Build the open-trove form with collateral input, debt input, interest rate selection, and real-time loan summary
- Build the manage-trove view with adjust, rate change, and close sub-forms
- Wire all forms to existing write hooks from Phase 2
- Show real-time loan metrics (LTV, liquidation price, risk level) that update as inputs change
- Display interest rate distribution chart using Recharts
- Enforce protocol limits in the UI (min debt, max LTV, min interest rate)
- Show fee estimates before submission

## User Stories

### US-001: Create form state atoms for open-trove

**Description:** As a developer, I need Jotai atoms to hold the open-trove form state so inputs are preserved during the flow dialog and across component renders.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/atoms/trove-form-atoms.ts`
- [ ] Define `openTroveFormAtom` with shape: `{ collAmount: string, debtAmount: string, interestRate: string }` (strings for input fields, converted to bigint on submit)
- [ ] Default values: `{ collAmount: "", debtAmount: "", interestRate: "" }`
- [ ] Use plain `atom()` from Jotai (no persistence needed — form resets on page reload)
- [ ] Export from `atoms/index.ts` barrel
- [ ] Typecheck passes (pnpm check-types)

### US-002: Create collateral input component

**Description:** As a user, I want to enter the amount of USDm collateral to deposit, see my wallet balance, and use a "Max" button.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/open-trove/collateral-input.tsx`
- [ ] Shows "USDm" token label/icon and "Collateral" heading
- [ ] Numeric input field for collateral amount (string state, parsed to bigint on blur/submit)
- [ ] Displays user's USDm wallet balance (use wagmi `useBalance` or equivalent)
- [ ] "Max" button sets amount to wallet balance minus a small gas reserve (use `ETH_GAS_COMPENSATION` from `useSystemParams()` or a sensible fixed buffer)
- [ ] Input validation: positive number, not exceeding balance
- [ ] Accepts `value: string` and `onChange: (value: string) => void` props (controlled component)
- [ ] Uses Tailwind styling consistent with existing pool forms
- [ ] Typecheck passes (pnpm check-types)

### US-003: Create debt input component with suggestions

**Description:** As a user, I want to enter the amount of GBPm to borrow and see suggested amounts based on my collateral.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/open-trove/debt-input.tsx`
- [ ] Shows debt token symbol (from `selectedDebtTokenAtom`) and "Borrow" heading
- [ ] Numeric input field for debt amount
- [ ] Shows minimum debt from `useSystemParams()` — display as helper text below input (e.g., "Min: £2,000")
- [ ] Suggestion chips from `useDebtSuggestions(collAmount, price)` — clickable to fill the input
- [ ] FX-formatted display using debt token's locale (e.g., "£1,234.56")
- [ ] Input validation: at least min debt, collateral ratio within bounds
- [ ] Accepts `value: string`, `onChange: (value: string) => void`, and `collAmount: bigint` props
- [ ] Typecheck passes (pnpm check-types)

### US-004: Create interest rate input component

**Description:** As a user, I want to set my annual interest rate with a slider and manual entry, seeing the minimum rate and annual cost estimate.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/open-trove/interest-rate-input.tsx`
- [ ] Shows "Annual Interest Rate" heading
- [ ] Slider component (from `@repo/ui`) with range: min from `useSystemParams().minInterestRate` to a reasonable max (e.g., 15% or from SDK constants)
- [ ] Manual numeric input field synced with slider (editing one updates the other)
- [ ] Display current rate as percentage (e.g., "5.5%")
- [ ] Show annual cost estimate: `debtAmount * rate` formatted in debt token currency
- [ ] Show redemption risk indicator using `useRedemptionRisk(rate)` — text label like "Low redemption risk" or warning if high
- [ ] Accepts `value: string`, `onChange: (value: string) => void`, and `debtAmount: bigint` props
- [ ] Typecheck passes (pnpm check-types)

### US-005: Create interest rate chart component

**Description:** As a user, I want to see a mini bar chart showing how debt is distributed across interest rate brackets so I can understand where my rate falls.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/open-trove/interest-rate-chart.tsx`
- [ ] Uses Recharts via `@repo/ui` Chart components (`ChartContainer`, etc.)
- [ ] Data from `useInterestRateChartData(selectedRate)` hook — returns `{ rate: number, debt: number, isCurrentRate: boolean }[]`
- [ ] Bar chart: x-axis = interest rate, y-axis = total debt at that rate
- [ ] Highlights the bar matching the user's selected rate (different color or border)
- [ ] Compact size suitable for embedding in the open-trove form (roughly 200-300px height)
- [ ] Shows a vertical line or marker at the user's selected rate position
- [ ] Accepts `selectedRate: string` prop
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-006: Create loan summary component

**Description:** As a user, I want to see a real-time summary of my loan metrics (LTV, liquidation price, risk level, fees) as I fill out the form.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/open-trove/loan-summary.tsx`
- [ ] Uses `useLoanDetails(collAmount, debtAmount, price)` for real-time metrics
- [ ] Displays: LTV (formatted as %), liquidation price (formatted in debt token currency), risk level via `RiskBadge`, collateral ratio
- [ ] Shows one-time fee from `usePredictUpfrontFee(debtAmount, interestRate)` — formatted in debt token currency
- [ ] Shows annual interest cost: `debtAmount * rate` formatted in debt token currency
- [ ] Updates in real-time as form inputs change (no submit needed)
- [ ] Grayed out / placeholder state when inputs are empty or insufficient
- [ ] Uses existing `TroveMetrics` component where appropriate, or a simpler summary layout
- [ ] Accepts `collAmount: bigint`, `debtAmount: bigint`, `interestRate: bigint` props
- [ ] Typecheck passes (pnpm check-types)

### US-007: Create open-trove form container

**Description:** As a user, I want a complete form to open a new trove with all inputs, summary, and submit button.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/open-trove/open-trove-form.tsx`
- [ ] Composes: `CollateralInput`, `DebtInput`, `InterestRateInput`, `InterestRateChart`, `LoanSummary`
- [ ] Form state managed via `openTroveFormAtom` or local state (developer's choice)
- [ ] "Open Trove" submit button at the bottom
- [ ] Button disabled states: wallet not connected, inputs empty, below min debt, LTV too high, insufficient balance
- [ ] Button shows descriptive text for disabled reason (e.g., "Insufficient balance", "Below minimum debt")
- [ ] On submit: converts string amounts to bigint, gets `ownerIndex` from `useNextOwnerIndex()`, computes `maxUpfrontFee` (fee estimate + 5% buffer), calls `openTrove.mutate({ symbol, params, wagmiConfig, account })`
- [ ] After successful mutation: form resets, flow dialog shows progress (handled automatically by flow atom)
- [ ] Card-based layout with sections for each input group
- [ ] "Back" button/link to return to dashboard (sets `borrowViewAtom` to "dashboard")
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-008: Wire open-trove form into borrow-view

**Description:** As a user, I want to navigate to the open-trove form from the dashboard and see the full form.

**Acceptance Criteria:**

- [ ] Update `apps/app.mento.org/app/components/borrow/borrow-view.tsx`
- [ ] Replace the open-trove placeholder with `<OpenTroveForm />`
- [ ] Import from `./open-trove/open-trove-form`
- [ ] Verify: clicking "Open Trove" on dashboard navigates to the form
- [ ] Verify: "Back" on the form returns to dashboard
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-009: Create manage-trove view container

**Description:** As a user, I want a tabbed view to manage my existing trove with options to adjust, change rate, or close.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/manage-trove/manage-trove-view.tsx`
- [ ] Accepts `troveId: string` from the `borrowViewAtom` state (`{ view: "manage-trove", troveId }`)
- [ ] Uses `useTroveData(symbol, troveId)` to load current trove state
- [ ] Header showing: current collateral, debt, interest rate, risk level
- [ ] Tab navigation using `@repo/ui` Tabs: "Adjust" | "Interest Rate" | "Close"
- [ ] Renders the appropriate sub-form based on selected tab
- [ ] Loading state while trove data loads
- [ ] "Back to Dashboard" link/button
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-010: Create adjust trove form

**Description:** As a user, I want to add/remove collateral and borrow/repay debt on my existing trove.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/manage-trove/adjust-form.tsx`
- [ ] Two sections: Collateral adjustment and Debt adjustment
- [ ] Each section has a direction toggle: "Add" / "Remove" for collateral, "Borrow more" / "Repay" for debt
- [ ] Collateral input: amount field, shows wallet balance (for add) or current collateral (for remove)
- [ ] Debt input: amount field, shows current debt, min debt constraint
- [ ] Before → After comparison: shows current LTV → new LTV, current liquidation price → new liquidation price using `useLoanDetails` for both states
- [ ] Risk indicator updates in real-time as adjustment inputs change
- [ ] Fee estimate via `usePredictUpfrontFee` if borrowing more (debt increase triggers upfront fee)
- [ ] "Adjust Trove" submit button with appropriate disabled states
- [ ] On submit: builds `AdjustTroveParams` (`{ troveId, collChange, isCollIncrease, debtChange, isDebtIncrease, maxUpfrontFee }`), calls `adjustTrove.mutate()`
- [ ] Accepts `troveId: string` and `troveData: BorrowPosition` props
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-011: Create interest rate change form

**Description:** As a user, I want to change my trove's interest rate, seeing the fee impact and new annual cost.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/manage-trove/rate-form.tsx`
- [ ] Shows current interest rate prominently
- [ ] New rate input: slider + manual entry (reuse pattern from `InterestRateInput` or extract shared logic)
- [ ] Shows fee estimate for rate change via `usePredictUpfrontFee` (rate changes may trigger upfront fee if rate decreases)
- [ ] Before → After comparison: current annual cost → new annual cost
- [ ] Redemption risk indicator for the new rate
- [ ] "Change Rate" submit button with disabled states (rate unchanged, below minimum)
- [ ] On submit: calls `adjustInterestRate.mutate({ symbol, troveId, newRate, maxUpfrontFee, wagmiConfig, account })`
- [ ] Accepts `troveId: string` and `troveData: BorrowPosition` props
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-012: Create close trove form

**Description:** As a user, I want to close my trove, seeing exactly how much debt I need to repay and collateral I'll receive.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/manage-trove/close-form.tsx`
- [ ] Shows summary: total debt to repay (debt + accrued interest from `troveData`), collateral to receive back
- [ ] Wallet balance check: shows warning if debt token balance insufficient to repay
- [ ] Clear confirmation messaging: "You will repay £X and receive Y USDm"
- [ ] "Close Trove" submit button — destructive variant (red/warning styling)
- [ ] Button disabled if wallet balance insufficient to cover debt
- [ ] On submit: calls `closeTrove.mutate({ symbol, troveId, wagmiConfig, account })`
- [ ] On success: flow dialog handles navigation back to dashboard
- [ ] Accepts `troveId: string` and `troveData: BorrowPosition` props
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-013: Wire manage-trove view into borrow-view

**Description:** As a user, I want to click a position card on the dashboard and see the manage-trove view for that trove.

**Acceptance Criteria:**

- [ ] Update `apps/app.mento.org/app/components/borrow/borrow-view.tsx`
- [ ] Replace the manage-trove placeholder with `<ManageTroveView troveId={view.troveId} />`
- [ ] Import from `./manage-trove/manage-trove-view`
- [ ] Verify: clicking a position card on dashboard navigates to manage view with correct troveId
- [ ] Verify: "Back to Dashboard" returns to dashboard
- [ ] Verify: all three tabs (Adjust, Rate, Close) render their forms
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-014: Add claim collateral button to dashboard

**Description:** As a user, I want to claim surplus collateral directly from the dashboard when available.

**Acceptance Criteria:**

- [ ] Update `apps/app.mento.org/app/components/borrow/dashboard/borrow-dashboard.tsx`
- [ ] Check if user has claimable collateral (from `useUserTroves` data — look for troves with `status === "closedByLiquidation"` or surplus collateral indicator)
- [ ] If claimable: show a "Claim Collateral" button or banner on the dashboard
- [ ] On click: calls `claimCollateral.mutate({ symbol, wagmiConfig, account })`
- [ ] Flow dialog shows claim progress
- [ ] If no claimable collateral: button/banner not shown (default state)
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- **FR-1:** All form inputs must convert between string display values and bigint on-chain values correctly. Use `parseUnits` / `formatUnits` from viem for 18-decimal token amounts.
- **FR-2:** Real-time loan metrics (LTV, liquidation price, risk) must update as the user types, not only on submit.
- **FR-3:** Protocol limits must be enforced client-side: minimum debt from `useSystemParams()`, interest rate minimum, collateral ratio bounds.
- **FR-4:** Submit buttons must show descriptive disabled reasons, not just be grayed out.
- **FR-5:** The before → after comparison in adjust/rate forms must show both current and projected metrics.
- **FR-6:** All currency amounts must use the correct locale formatting from `DebtTokenConfig` (e.g., "£1,234.56" for GBPm).
- **FR-7:** Forms must remain usable while the flow dialog is showing (flow dialog is a portal overlay, form stays mounted underneath).
- **FR-8:** The interest rate chart must visually indicate where the user's selected rate falls in the distribution.

## Non-Goals

- **No batch manager / delegate selection** — deferred to a later phase. Interest rate is manual entry only.
- **No redeem form** — redemption is a separate Phase 4+ concern.
- **No leverage form** — Phase 5.
- **No form persistence across page reload** — form state resets on reload (only flow state persists).
- **No advanced gas estimation display** — gas is handled internally by `sendSdkTransaction`.

## Technical Considerations

### Existing hooks available (from Phase 1 + Phase 2)

**Read hooks** (all in `packages/web3/src/features/borrow/hooks/`):

- `useSystemParams(symbol)` → `{ mcr, ccr, minDebt, minInterestRate, ... }`
- `useCollateralPrice(symbol)` → `bigint` (FX price)
- `useLoanDetails(collAmount, debtAmount, price)` → `{ ltv, maxLtv, liquidationPrice, liquidationRisk, status }`
- `useDebtSuggestions(collAmount, price)` → `bigint[]` (suggested debt amounts)
- `useInterestRateChartData(selectedRate?)` → `{ rate, debt, isCurrentRate }[]`
- `useRedemptionRisk(rate)` → `RiskLevel`
- `usePredictUpfrontFee(debtAmount, interestRate)` → `bigint`
- `useNextOwnerIndex(symbol, owner)` → `number`
- `useTroveData(symbol, troveId)` → `BorrowPosition`
- `useUserTroves(symbol, owner)` → `BorrowPosition[]`
- `useBorrowAllowance(symbol, owner)` → `{ collateral: bigint, debt: bigint }`

**Write hooks** (all in `packages/web3/src/features/borrow/hooks/`):

- `useOpenTrove()` → `useMutation` — accepts `{ symbol, params: OpenTroveParams, wagmiConfig, account }`
- `useAdjustTrove()` → `useMutation` — accepts `{ symbol, params: AdjustTroveParams, wagmiConfig, account }`
- `useCloseTrove()` → `useMutation` — accepts `{ symbol, troveId, wagmiConfig, account }`
- `useAdjustInterestRate()` → `useMutation` — accepts `{ symbol, troveId, newRate, maxUpfrontFee, wagmiConfig, account }`
- `useClaimCollateral()` → `useMutation` — accepts `{ symbol, wagmiConfig, account }`

### SDK type references

```typescript
// OpenTroveParams (from SDK)
interface OpenTroveParams {
  owner: string;
  ownerIndex: number;
  collAmount: bigint;
  boldAmount: bigint; // debt amount
  annualInterestRate: bigint; // 18-decimal (e.g., 5% = 5n * 10n**16n)
  maxUpfrontFee: bigint;
}

// AdjustTroveParams (from SDK)
interface AdjustTroveParams {
  troveId: string;
  collChange: bigint;
  isCollIncrease: boolean;
  debtChange: bigint;
  isDebtIncrease: boolean;
  maxUpfrontFee: bigint;
}
```

### UI component patterns (from existing monorepo)

- **Form layout:** Use `Card` > `CardHeader` > `CardTitle` + `CardContent` for each form section
- **Token inputs:** Reference `CoinInput` from `@repo/ui` or the pool form's token input pattern
- **Sliders:** `@repo/ui` Slider (Radix-based) — `min`, `max`, `step`, `value`, `onValueChange`
- **Tabs:** `@repo/ui` Tabs > TabsList > TabsTrigger + TabsContent
- **Buttons:** `@repo/ui` Button with `variant` prop (default, outline, destructive)
- **Charts:** `@repo/ui` Chart (Recharts wrapper) — `ChartContainer` with theme-aware colors
- **Number formatting:** Use `formatDebtAmount`, `formatCollateralAmount`, `formatInterestRate` from `features/borrow/format.ts`
- **Bigint conversion:** `parseUnits(inputString, 18)` for user input → bigint, `formatUnits(bigintValue, 18)` for display

### Key patterns from Phase 2 progress

- `borrowViewAtom` is in app layer — forms navigate by setting this atom directly
- Flow dialog appears automatically when a write hook triggers (via `borrowFlowAtom`)
- After success, flow dialog shows "Back to Dashboard" — no navigation needed in the form itself
- `wagmiConfig` obtained via `useConfig()` from `wagmi`
- `account` obtained via `useAccount()` from `@repo/web3/wagmi` — use `address` field
- `selectedDebtTokenAtom` provides the current symbol (e.g., "GBPm")

### BOLD reference files

| BOLD source                                     | What to reference              |
| ----------------------------------------------- | ------------------------------ |
| `screens/BorrowScreen.tsx`                      | Open trove form layout         |
| `screens/LoanScreen.tsx`                        | Manage trove tab layout        |
| `comps/InterestRateChart/InterestRateChart.tsx` | Bar chart of rate distribution |
| `comps/InputField/InputField.tsx`               | Number input with validation   |

## Success Metrics

- User can open a trove end-to-end: enter collateral, debt, rate → see summary → submit → flow dialog → dashboard updated
- User can adjust an existing trove: add/remove collateral, borrow/repay
- User can change interest rate on a trove
- User can close a trove and receive collateral back
- All loan metrics update in real-time as inputs change
- Protocol limits (min debt, min rate) are enforced with clear messaging
- Fee estimates display before submission
- Interest rate chart renders and highlights user's selected rate

## Open Questions

- **Recharts bar vs area chart:** Should the interest rate distribution be a bar chart or area chart? BOLD uses bars — follow that pattern.
- **Max button gas reserve:** How much to reserve for gas when using "Max" on collateral? Use `ETH_GAS_COMPENSATION` from SystemParams if available, otherwise a fixed buffer.
- **Upfront fee buffer:** What percentage buffer to add on top of the predicted upfront fee for `maxUpfrontFee`? BOLD uses ~5% — follow that.
