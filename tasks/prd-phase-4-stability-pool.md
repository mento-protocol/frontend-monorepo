# PRD: Phase 4 — Stability Pool UI

## Introduction

Phase 4 builds the Stability Pool (Earn) UI for depositing, withdrawing, and claiming rewards. All the backend plumbing is already complete:

- **Read hooks** (Phase 1): `useStabilityPool` (deposit + gains), `useStabilityPoolStats` (total deposits), `useStabilityPoolAddress`
- **Write hooks** (Phase 2): `useSpDeposit` (approve + deposit), `useSpWithdraw` (withdraw, no approval needed)
- **TX builders** (Phase 2): `buildSpDeposit`, `buildSpWithdraw` using viem `encodeFunctionData` with `stabilityPoolAbi`
- **Dashboard card** (Phase 1): `stability-card.tsx` already shows SP position summary and links to earn view

This phase is purely UI — building the earn view container, deposit form, withdraw form, and claim functionality. The `doClaim` parameter on SP operations allows users to claim accumulated rewards (collateral gains + yield) as part of any deposit or withdraw action.

**Base branch:** `feat/borrow`
**Depends on:** Phase 0 (complete), Phase 1 (complete), Phase 2 (complete), Phase 3 (complete)
**Source plan:** `tasks/v3-borrow-project-plan.md` — Section 10

## Goals

- Build the earn view showing pool stats and user's SP position
- Build deposit form with debt token input, wallet balance, and optional claim toggle
- Build withdraw form with amount input (max = current deposit) and claim toggle
- Add standalone claim rewards functionality
- Wire all forms to existing `useSpDeposit` and `useSpWithdraw` hooks
- Show pool share percentage and accumulated rewards (collateral + yield gains)

## User Stories

### US-001: Create earn view container

**Description:** As a user, I want to see the Stability Pool overview with my position and pool statistics.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/earn/earn-view.tsx`
- [ ] Header: "Stability Pool" title + description text
- [ ] Pool stats section: total deposits from `useStabilityPoolStats()`, formatted in debt token currency
- [ ] User position section (when connected + has deposit): current deposit, collateral gain (USDm from liquidations), yield gain (debt token rewards)
- [ ] Data from `useStabilityPool(symbol, address)` — returns `{ deposit, collateralGain, debtTokenGain }`
- [ ] Pool share calculation: `userDeposit / totalDeposits * 100` — display as percentage
- [ ] Shows deposit and withdraw action areas (placeholder content for now, wired in subsequent stories)
- [ ] "Back to Dashboard" button that sets `borrowViewAtom` to `"dashboard"`
- [ ] Not-connected state: prompt to connect wallet
- [ ] Empty state (no deposit): show CTA to deposit
- [ ] Uses Card layout consistent with other borrow views
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-002: Create deposit form

**Description:** As a user, I want to deposit debt tokens (GBPm) into the Stability Pool to earn rewards from liquidations.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/earn/deposit-form.tsx`
- [ ] Debt token amount input with wallet balance display (use `useReadContract` + `erc20Abi` pattern from collateral-input)
- [ ] Max button to fill with wallet balance
- [ ] "Claim rewards" toggle/checkbox — controls `doClaim` parameter (default: true if user has pending rewards, false if no rewards)
- [ ] Shows pending rewards summary when `doClaim` is checked: collateral gain (USDm) and yield gain (debt token)
- [ ] "Deposit" submit button with disabled states: wallet not connected, amount empty, amount exceeds balance, pending mutation
- [ ] On submit: calls `spDeposit.mutate({ symbol, amount: parsedAmount, doClaim, wagmiConfig, account })`
- [ ] Flow dialog shows deposit progress automatically
- [ ] Accepts current SP position data as props (to show rewards info)
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-003: Create withdraw form

**Description:** As a user, I want to withdraw my deposit from the Stability Pool, optionally claiming accumulated rewards.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/earn/withdraw-form.tsx`
- [ ] Amount input with max = current deposit balance (from `useStabilityPool`)
- [ ] Max button to fill with current deposit
- [ ] "Claim rewards" toggle/checkbox — controls `doClaim` parameter (default: true)
- [ ] Shows pending rewards summary when `doClaim` is checked
- [ ] "Withdraw" submit button with disabled states: wallet not connected, amount empty, amount exceeds deposit, pending mutation
- [ ] On submit: calls `spWithdraw.mutate({ symbol, amount: parsedAmount, doClaim, wagmiConfig, account })`
- [ ] Flow dialog shows withdraw progress automatically
- [ ] Accepts current SP position data as props
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-004: Create claim rewards action

**Description:** As a user, I want to claim my accumulated rewards (collateral gains + yield) without depositing or withdrawing.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/earn/claim-rewards.tsx`
- [ ] Shows pending rewards: collateral gain (USDm) formatted with `formatCollateralAmount`, yield gain (debt token) formatted with `formatDebtAmount`
- [ ] "Claim Rewards" button — only visible when user has non-zero rewards (collateralGain > 0 or debtTokenGain > 0)
- [ ] On click: calls `spWithdraw.mutate({ symbol, amount: 0n, doClaim: true, wagmiConfig, account })` — withdraw 0 triggers claim-only
- [ ] Button disabled when: wallet not connected, no rewards, pending mutation
- [ ] Hidden entirely when no rewards to claim
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-005: Wire earn view into borrow-view with deposit and withdraw forms

**Description:** As a user, I want to navigate to the Stability Pool from the dashboard and use all earn features.

**Acceptance Criteria:**

- [ ] Update `apps/app.mento.org/app/components/borrow/borrow-view.tsx` — replace earn placeholder with `<EarnView />`
- [ ] Import EarnView from `./earn/earn-view`
- [ ] Update `earn-view.tsx` to compose: pool stats, user position, `DepositForm`, `WithdrawForm`, `ClaimRewards` — either as tabs (Deposit | Withdraw) or as side-by-side sections
- [ ] Pass SP position data (`deposit`, `collateralGain`, `debtTokenGain`) to child forms
- [ ] Verify: clicking "Earn" on dashboard navigates to earn view
- [ ] Verify: Back to Dashboard returns to dashboard
- [ ] Verify: deposit, withdraw, and claim actions trigger flow dialog
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- **FR-1:** Depositing into the SP requires debt token approval — `useSpDeposit` handles this internally (checks allowance, approves SP address with `maxUint256` if insufficient).
- **FR-2:** Withdrawing from the SP does NOT require approval — `useSpWithdraw` is a single-step flow.
- **FR-3:** Claiming rewards uses `withdrawFromSP(0, true)` — withdraw 0 with `doClaim=true` triggers reward claim only.
- **FR-4:** The `doClaim` parameter on both deposit and withdraw controls whether accumulated gains are claimed in the same transaction.
- **FR-5:** Pool share = `userDeposit / totalDeposits * 100` — display as percentage with 2 decimal places.
- **FR-6:** All amounts must use correct currency formatting: USDm for collateral gains, debt token currency (e.g., £) for deposits and yield gains.
- **FR-7:** SP position data refreshes automatically — `useStabilityPool` has built-in refetch interval.

## Non-Goals

- **No APR/APY calculation** — APR depends on historical yield data which requires a subgraph or indexer. Deferred.
- **No SP position history** — no historical deposit/withdrawal tracking for MVP.
- **No multi-pool aggregation** — one SP per debt token; future Phase 6 adds multi-deployment support.

## Technical Considerations

### Existing hooks (from Phase 1 + Phase 2)

**Read hooks:**

- `useStabilityPool(symbol, address)` → `{ deposit: bigint, collateralGain: bigint, debtTokenGain: bigint } | null`
- `useStabilityPoolStats(symbol)` → `{ totalDeposits: bigint } | null`
- `useStabilityPoolAddress(symbol)` → `string` (internal, used by hooks)

**Write hooks:**

- `useSpDeposit()` → `useMutation` — accepts `{ symbol, amount, doClaim, wagmiConfig, account }`
  - Two-step flow: check debt token allowance for SP address → approve with `maxUint256` if insufficient → `buildSpDeposit` → send
- `useSpWithdraw()` → `useMutation` — accepts `{ symbol, amount, doClaim, wagmiConfig, account }`
  - Single-step flow: `buildSpWithdraw` → send (no approval needed)

### UI patterns from Phase 3

- Token balance: `useReadContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [userAddress] })`
- Token address: `getTokenAddress(chainId, debtToken.symbol as TokenSymbol)` from SDK
- Controlled inputs: `value: string` + `onChange` props, convert to bigint via `parseUnits` on submit
- Button disabled states: descriptive text for each invalid condition
- `selectedDebtTokenAtom` holds `DebtTokenConfig` object — use `debtToken.symbol` for hook calls
- `wagmiConfig` from `useConfig()`, `account`/`address` from `useAccount()`
- Flow dialog auto-triggers via `borrowFlowAtom` when write hook fires

### Dashboard integration

`stability-card.tsx` already exists in `dashboard/` and navigates to `"earn"` view on click. The earn view just needs to render when `borrowViewAtom === "earn"`.

### BOLD reference files

| BOLD source                  | What to reference                  |
| ---------------------------- | ---------------------------------- |
| `screens/EarnPoolScreen.tsx` | SP screen layout and stats display |
| `tx-flows/earnUpdate.tsx`    | SP deposit/withdraw flow structure |

## Success Metrics

- User can deposit GBPm into the Stability Pool end-to-end
- User can withdraw deposit partially or fully
- User can claim rewards standalone (via withdraw 0)
- Pool stats (total deposits, pool share) display correctly
- Pending rewards (collateral gain + yield) update in real-time
- `doClaim` toggle controls whether rewards are claimed with deposit/withdraw

## Open Questions

- **Layout:** Should deposit/withdraw be tabs or side-by-side sections? Tabs keep it cleaner if screen space is limited. BOLD uses a single form with a mode toggle — either approach works.
- **Pool share tooltip:** Should we show additional context about what pool share means? Consider a simple tooltip.
