# PRD: Phase 2 — Write Hooks + Transaction Flow Engine

## Introduction

Phase 2 adds the write (mutation) layer to the borrow feature: hooks that build and send transactions via the SDK, a flow state atom for tracking multi-step operations, and a flow dialog UI for user feedback. This phase makes it possible for Phase 3's forms to trigger trove operations (open, adjust, close, etc.) and stability pool operations.

The `sendSdkTransaction()` and `waitForTx()` bridge functions already exist from Phase 0 (P0-7). This phase builds on top of them with `useMutation`-based hooks and a Jotai-powered flow state machine.

**Base branch:** `feat/borrow`
**Depends on:** Phase 0 (complete), Phase 1 (complete)
**Source plan:** `tasks/v3-borrow-project-plan.md` — Section 8

## Goals

- Create write hooks for all borrow operations using `useMutation` from React Query
- Create a Jotai-based flow state atom for tracking multi-step transaction progress
- Build a flow dialog component that shows step-by-step progress (approve → execute → confirm)
- Create stability pool transaction builders (not in SDK — direct contract calls)
- Ensure all write hooks invalidate relevant queries on success and show toast notifications

## User Stories

### US-001: Create flow state atom and types

**Description:** As a developer, I need a Jotai atom that tracks the current transaction flow state so the UI can show progress feedback across multi-step operations.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/atoms/flow-atoms.ts`
- [ ] Define `BorrowFlowState` type: `{ flowId: string, operation: string, steps: FlowStep[], currentStepIndex: number, account: string }`
- [ ] Define `FlowStep` type: `{ id: string, label: string, status: "idle" | "pending" | "confirming" | "confirmed" | "error", txHash?: string, error?: { name: string | null, message: string } }`
- [ ] `borrowFlowAtom` — Jotai atom, nullable (`BorrowFlowState | null`), default `null`
- [ ] Use `atomWithStorage` from `jotai/utils` with key `"mento:borrow:flow"` for localStorage persistence (page-reload recovery)
- [ ] Export `borrowFlowAtom`, `BorrowFlowState`, `FlowStep` from `atoms/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-002: Create flow execution engine

**Description:** As a developer, I need a function that executes a sequence of transaction steps, updating the flow atom at each stage, so write hooks can orchestrate multi-step operations.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/tx-flows/engine.ts`
- [ ] `executeFlow(config, flowAtom, steps)` function that:
  - Sets the flow atom with initial state (all steps "idle")
  - Iterates through steps sequentially
  - For each step: updates status to "pending", calls `sendSdkTransaction`, updates to "confirming" with txHash, calls `waitForTx`, updates to "confirmed"
  - On error: updates current step to "error" with error message, stops execution
  - Uses the `sendSdkTransaction` and `waitForTx` from Phase 0's send-tx bridge
- [ ] Define `FlowStepDefinition` type: `{ id: string, label: string, buildTx: () => Promise<CallParams | null> }` — `null` means skip (e.g., approval not needed)
- [ ] Engine skips steps where `buildTx` returns `null` (marks them as "confirmed" immediately)
- [ ] Returns `{ success: boolean, txHashes: string[] }` after completion
- [ ] Export from `tx-flows/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-003: Create borrow approval hook

**Description:** As a developer, I need a standalone approval hook that checks and requests token approval before borrow operations.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-borrow-approval.ts`
- [ ] `useBorrowApproval()` returns a `useMutation` that:
  - Accepts `{ symbol, tokenType: "collateral" | "debt", amount, wagmiConfig }`
  - For collateral: calls `sdk.buildCollateralApprovalParams(symbol, amount)` → `sendSdkTransaction`
  - For debt: calls `sdk.buildDebtApprovalParams(symbol, spender, amount)` → `sendSdkTransaction`
  - Waits for receipt via `waitForTx`
  - On success: invalidates `["borrow", "allowance"]` queries
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-004: Create use-open-trove write hook

**Description:** As a developer, I need a hook that handles the full open-trove flow: check allowance → approve collateral → open trove.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-open-trove.ts`
- [ ] Uses `useMutation` from `@tanstack/react-query`
- [ ] `mutationFn` accepts `{ symbol, params: OpenTroveParams, wagmiConfig }` (OpenTroveParams from SDK: owner, ownerIndex, collAmount, boldAmount, annualInterestRate, maxUpfrontFee)
- [ ] Internally uses `executeFlow` to orchestrate steps:
  1. Check collateral allowance → approve if insufficient (skip if sufficient)
  2. Build open trove tx via `sdk.buildOpenTroveTransaction(symbol, params)` → send
- [ ] On success: invalidates `["borrow", "userTroves"]`, `["borrow", "allowance"]`, `["borrow", "branchStats"]` queries
- [ ] On success: shows toast notification
- [ ] On error: error is available via `mutation.error`
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-005: Create use-adjust-trove write hook

**Description:** As a developer, I need a hook that handles adjusting an existing trove (add/remove collateral, borrow/repay debt).

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-adjust-trove.ts`
- [ ] Uses `useMutation` from `@tanstack/react-query`
- [ ] `mutationFn` accepts `{ symbol, params: AdjustTroveParams, wagmiConfig }` (AdjustTroveParams from SDK: troveId, collChange, isCollIncrease, debtChange, isDebtIncrease, maxUpfrontFee)
- [ ] Orchestrates steps:
  1. If adding collateral: check allowance → approve if needed (skip otherwise)
  2. Build adjust tx via `sdk.buildAdjustTroveTransaction(symbol, params)` → send
- [ ] On success: invalidates `["borrow", "userTroves"]`, `["borrow", "troveData"]`, `["borrow", "allowance"]`, `["borrow", "branchStats"]`
- [ ] On success: shows toast
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-006: Create use-close-trove write hook

**Description:** As a developer, I need a hook that handles closing a trove (repay all debt, receive collateral back).

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-close-trove.ts`
- [ ] Uses `useMutation`
- [ ] `mutationFn` accepts `{ symbol, troveId, wagmiConfig }`
- [ ] Orchestrates steps:
  1. Check debt token allowance → approve if needed
  2. Build close tx via `sdk.buildCloseTroveTransaction(symbol, troveId)` → send
- [ ] On success: invalidates `["borrow", "userTroves"]`, `["borrow", "troveData"]`, `["borrow", "branchStats"]`
- [ ] On success: shows toast, navigates back to dashboard (set borrowViewAtom to "dashboard")
- [ ] Export from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-007: Create use-adjust-interest-rate and use-claim-collateral write hooks

**Description:** As a developer, I need hooks for changing interest rate and claiming surplus collateral — both single-transaction operations.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-adjust-interest-rate.ts`
- [ ] `useAdjustInterestRate()` mutation accepts `{ symbol, troveId, newRate, maxUpfrontFee, wagmiConfig }`
- [ ] Single-step: `sdk.buildAdjustInterestRateTransaction(symbol, troveId, newRate, maxUpfrontFee)` → send → wait
- [ ] On success: invalidates `["borrow", "troveData"]`, `["borrow", "userTroves"]`, `["borrow", "interestRateBrackets"]`
- [ ] Create `packages/web3/src/features/borrow/hooks/use-claim-collateral.ts`
- [ ] `useClaimCollateral()` mutation accepts `{ symbol, wagmiConfig }`
- [ ] Single-step: `sdk.buildClaimCollateralTransaction(symbol)` → send → wait
- [ ] On success: invalidates `["borrow", "userTroves"]`
- [ ] Both show toast on success
- [ ] Export both from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-008: Create Stability Pool transaction builders

**Description:** As a developer, I need functions that build deposit/withdraw transactions for the Stability Pool (not in SDK — direct contract interaction).

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/stability-pool/tx-builders.ts`
- [ ] `buildSpDeposit(spAddress, amount, doClaim)` — encodes `provideToSP(uint256, bool)` using viem's `encodeFunctionData` with `stabilityPoolAbi`
- [ ] `buildSpWithdraw(spAddress, amount, doClaim)` — encodes `withdrawFromSP(uint256, bool)` using `stabilityPoolAbi`
- [ ] Both return `CallParams` format: `{ to: spAddress, data: encodedCalldata, value: "0x0" }` — compatible with `sendSdkTransaction`
- [ ] Export from `stability-pool/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-009: Create use-sp-deposit and use-sp-withdraw write hooks

**Description:** As a developer, I need write hooks for depositing into and withdrawing from the Stability Pool.

**Acceptance Criteria:**

- [ ] Create `packages/web3/src/features/borrow/hooks/use-sp-deposit.ts`
- [ ] `useSpDeposit()` mutation accepts `{ symbol, amount, doClaim, wagmiConfig }`
- [ ] Resolves SP address (reuse `useStabilityPoolAddress` internal hook or resolve inline)
- [ ] Orchestrates: check debt token allowance → approve if needed → `buildSpDeposit` → send → wait
- [ ] On success: invalidates stability pool queries
- [ ] Create `packages/web3/src/features/borrow/hooks/use-sp-withdraw.ts`
- [ ] `useSpWithdraw()` mutation accepts `{ symbol, amount, doClaim, wagmiConfig }`
- [ ] Single-step: `buildSpWithdraw` → send → wait (no approval needed for withdrawal)
- [ ] On success: invalidates stability pool queries
- [ ] Both show toast on success
- [ ] Export both from `hooks/index.ts`
- [ ] Typecheck passes (pnpm check-types)

### US-010: Create flow dialog component

**Description:** As a user, I want to see a dialog showing the progress of my transaction (approve → execute → confirm) so I know what's happening.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/shared/flow-dialog.tsx`
- [ ] Reads `borrowFlowAtom` to display current flow state
- [ ] Shows as a modal/dialog overlay (use @repo/ui Dialog component if available, otherwise a card overlay)
- [ ] Displays a list of steps, each showing: step label, status icon (spinner for pending, check for confirmed, X for error)
- [ ] For steps with a txHash: shows a link to Celo block explorer (celoscan.io)
- [ ] Error state: shows error message + "Try Again" button (resets flow atom to null)
- [ ] Success state: shows success message + "Back to Dashboard" button (navigates to dashboard, clears flow atom)
- [ ] Dialog is visible whenever `borrowFlowAtom` is not null
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-011: Create flow step component

**Description:** As a user, I want each step in the flow dialog to show its status clearly with appropriate icons and links.

**Acceptance Criteria:**

- [ ] Create `apps/app.mento.org/app/components/borrow/shared/flow-step.tsx`
- [ ] Accepts `step: FlowStep` and `isActive: boolean` props
- [ ] Status rendering: idle = circle outline, pending = spinner, confirming = spinner + txHash link, confirmed = green check, error = red X
- [ ] When txHash is present: renders as a link to `https://celoscan.io/tx/{txHash}`
- [ ] Error state shows error message below the step label
- [ ] Compact layout suitable for stacking in the flow dialog
- [ ] Uses Tailwind for styling (no external icon library required — use unicode or SVG)
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

### US-012: Integrate flow dialog into borrow-view

**Description:** As a user, I want the flow dialog to appear automatically when I trigger a transaction and dismiss when complete.

**Acceptance Criteria:**

- [ ] Update `apps/app.mento.org/app/components/borrow/borrow-view.tsx`
- [ ] Import and render `<FlowDialog />` — it self-manages visibility based on `borrowFlowAtom`
- [ ] Flow dialog renders on top of any borrow sub-view (dashboard, open-trove, manage, earn)
- [ ] Clicking "Back to Dashboard" in success state: clears `borrowFlowAtom` and sets `borrowViewAtom` to `"dashboard"`
- [ ] Clicking "Try Again" in error state: clears `borrowFlowAtom` (user can re-submit the form)
- [ ] Typecheck passes (pnpm check-types)
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- **FR-1:** All write hooks must use `useMutation` from `@tanstack/react-query` — consistent with the swap/pools pattern.
- **FR-2:** Multi-step operations (approve → execute) must use the flow engine to update `borrowFlowAtom` at each stage.
- **FR-3:** Single-step operations (e.g., adjust interest rate) should still update the flow atom for consistent UI feedback.
- **FR-4:** All write hooks must invalidate relevant read query keys on success so the dashboard updates immediately.
- **FR-5:** All write hooks must show toast notifications on success via the existing toast utility.
- **FR-6:** The flow dialog must be visible whenever `borrowFlowAtom` is not null — dismissal clears the atom.
- **FR-7:** Stability Pool transaction builders must return `CallParams` format compatible with `sendSdkTransaction`.
- **FR-8:** Flow state must persist in localStorage so page reload during "confirming" step can resume verification.

## Non-Goals

- **No form UI** — the actual open-trove, adjust, close, earn forms are Phase 3. This phase provides the hooks and flow engine they'll use.
- **No batch manager support** — batch manager selection and delegation is deferred.
- **No retry logic** — if a step fails, the user retries from the form. No automatic retry.
- **No gas price display** — gas estimation is internal to `sendSdkTransaction`.

## Technical Considerations

### Write hook pattern (from existing monorepo)

Follow `packages/web3/src/features/swap/hooks/use-swap-transaction.tsx` and `use-approve-transaction.tsx` for the `useMutation` pattern. Key aspects:

- `useMutation` with `mutationFn`
- `useQueryClient()` for invalidation in `onSuccess`
- Toast notifications via the app's toast utility
- Error handling in `onError` callback

### SDK transaction builder methods

From the progress notes, the SDK provides:

- `sdk.buildOpenTroveTransaction(symbol, params)` → `CallParams`
- `sdk.buildAdjustTroveTransaction(symbol, params)` → `CallParams`
- `sdk.buildCloseTroveTransaction(symbol, troveId)` → `CallParams`
- `sdk.buildAdjustInterestRateTransaction(symbol, troveId, newRate, maxUpfrontFee)` → `CallParams`
- `sdk.buildClaimCollateralTransaction(symbol)` → `CallParams`
- `sdk.buildCollateralApprovalParams(symbol, amount)` → `CallParams`
- `sdk.buildDebtApprovalParams(symbol, spender, amount)` → `CallParams`

### Stability Pool (not in SDK)

SP operations need direct contract interaction:

- Use `encodeFunctionData` from viem with `stabilityPoolAbi`
- SP address resolved via `useStabilityPoolAddress` (from Phase 1)
- Return `CallParams` format so `sendSdkTransaction` works uniformly

### BOLD reference

- `services/TransactionFlow.tsx` — state machine pattern
- `screens/TransactionsScreen/TransactionStatus.tsx` — step status display

### Key patterns from Phase 1 progress

- `Config` type from `"wagmi"` (not `@wagmi/core`)
- `sendSdkTransaction` and `waitForTx` at `features/borrow/tx-flows/send-tx.ts`
- `useAccount()` from `@repo/web3/wagmi` for connected address
- `useStabilityPoolAddress` resolves SP address via SDK registry helpers

## Success Metrics

- All typechecks pass
- `tsup` build succeeds
- Write hooks compile and export correctly
- Flow dialog renders with idle/pending/confirming/confirmed/error states
- Flow state persists in localStorage
- All query invalidation keys are correct (dashboard updates after mutations)

## Open Questions

- **Toast utility:** Which toast library does the app use? Check existing swap/pools hooks for the import pattern.
- **Dialog component:** Does `@repo/ui` export a Dialog component? If not, use a card overlay with backdrop.
- **Celo explorer URL:** Is it `celoscan.io` or `explorer.celo.org`? Check existing code for the block explorer URL pattern.
