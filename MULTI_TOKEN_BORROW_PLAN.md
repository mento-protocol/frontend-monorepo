# Multi-Token Borrow Refactor (Detailed, Refined)

## Context

The borrow flow in `apps/app.mento.org` was built around a single CDP debt token, `GBPm`. Mento is expanding the borrow product to support additional debt tokens, and the SDK is already structured for it:

- `borrowRegistries` is keyed by `(chainId, debtTokenSymbol)`.
- `BorrowService` accepts `debtTokenSymbol` on borrow methods.
- `BorrowContextStore` caches deployment context per symbol.
- Frontend hooks already accept a `symbol` argument, even though most of the current UI still reads the global `selectedDebtTokenAtom`.

The main missing piece is frontend state, routing, and UI plumbing. Today:

- `/borrow` is a single-page client view controlled by `borrowViewAtom`.
- The dashboard shows one selected token at a time via a global token selector.
- The open-trove form inherits the global token instead of letting the user pick a borrow asset directly.
- The manage-trove view also depends on that same global selection.

The target UX is:

- **Dashboard**: aggregated at `/borrow`. No token selector. Show all troves the connected user owns across all supported debt tokens.
- **Open Trove**: `/borrow/open`, with explicit dropdowns for collateral and borrow asset at the top of the form.
- **Manage Trove**: `/borrow/manage/[id]?token=<symbol>`, where the token is explicit in the route contract and does not depend on any global atom.
- **Earn Hub**: one stability opportunity card per visible `(chain, debt token)` deployment.

Collateral remains `USDm` in this release, but the implementation should be parameterized so future per-registry collateral can be unlocked without another structural refactor.

## Decisions

1. **Routing**
   - `/borrow` is the aggregated dashboard.
   - `/borrow/open` is the open-trove page.
   - `/borrow/manage/[id]?token=<symbol>` is the canonical manage route.
   - The old `borrowViewAtom` view switching is removed from borrow UI navigation.

2. **Dashboard shape**
   - The dashboard is a flat mixed-token list.
   - Do not compute fake cross-currency totals.
   - Do not compute aggregate LTV across mixed debt tokens.
   - Top-level summary should remain mixed-token-safe only: open trove count, supported debt token count, and surplus collateral banners.

3. **Token state**
   - `selectedDebtTokenAtom` is removed.
   - Open-trove uses local component state.
   - Manage-trove reads the token from the route boundary.
   - Child components in the open/manage trees receive `debtToken` and `collateralSymbol` via props, not another global atom.

4. **Collateral**
   - Collateral is still `USDm` for now.
   - `DebtTokenConfig` gains `collateralSymbol`.
   - UI code should stop hardcoding `"USDm"` where it is a display/input concern and instead consume `collateralSymbol`, defaulting to `USDm`.

5. **Supported tokens**
   - Supported tokens come directly from SDK `borrowRegistries`.
   - The frontend must not render “coming soon” borrow tokens.
   - If the SDK exposes a new symbol, it should automatically appear in the borrow dropdown, aggregated dashboard fan-out, and Earn Hub.

6. **Earn visibility**
   - Support discovery and visibility filtering remain separate concerns.
   - `getSupportedDeployments()` returns the SDK deployment matrix.
   - Earn Hub still applies `useVisibleChains("stabilityPool")` so hidden testnets do not leak into `/earn`.

7. **Flow redirects**
   - Keep a single `borrowFlowAtom`.
   - Extend flow state with optional `successHref`.
   - Open-trove success redirects to the newly created manage page.
   - Adjust/close/claim-collateral success returns to `/borrow`.
   - Stability-pool flows remain on the current page and do not use borrow redirects.

## Approach

### 1. Single source of truth: supported borrow deployments

Extend `apps/app.mento.org/app/lib/stability-route.ts` or split a sibling helper such as `borrow-deployments.ts` with SDK-backed helpers:

- `getSupportedDebtTokens(chainId): DebtTokenConfig[]`
  - Read `Object.keys(borrowRegistries[chainId] ?? {})`.
  - Resolve each symbol with `getDebtTokenConfig(symbol)`.
  - Return a stable, deterministic ordering. Sort by symbol.

- `getSupportedDeployments(): { chainId: number; token: DebtTokenConfig }[]`
  - Start from the same SDK registry source.
  - Reuse existing supported chain constants used by stability routes where appropriate.
  - Return support only; do not bake visibility decisions into this helper.

- `resolveStabilityDebtToken(tokenSlug)` and related stability route helpers
  - Stop relying on hardcoded `STABILITY_DEBT_TOKENS`.
  - Resolve against SDK-derived supported tokens instead.

Keep `STABILITY_CHAINS`, `resolveStabilityChainId`, `getStabilityRoute`, and hidden-testnet handling intact unless a direct refactor is needed to plug in the new token source.

### 2. Expand `DebtTokenConfig` and provide a fallback factory

In `packages/web3/src/features/borrow/types.ts`:

```ts
export interface DebtTokenConfig {
  symbol: string;
  currencySymbol: string;
  currencyCode: string;
  locale: string;
  collateralSymbol: string;
}

export function getDebtTokenConfig(symbol: string): DebtTokenConfig {
  return (
    DEBT_TOKEN_CONFIGS[symbol] ?? {
      symbol,
      currencySymbol: symbol,
      currencyCode: symbol.replace(/m$/, ""),
      locale: "en-US",
      collateralSymbol: "USDm",
    }
  );
}
```

Notes:

- `DEBT_TOKEN_CONFIGS` can stay curated and sparse.
- New SDK-only tokens should still render with fallback formatting.
- `GBPm` remains the only curated config until product wants explicit per-token locale metadata.

### 3. Replace client view switching with route-driven pages

Current borrow entrypoint:

- `apps/app.mento.org/app/borrow/page.tsx` renders `BorrowView`.
- `BorrowView` uses `borrowViewAtom` to switch between dashboard/open/manage.

Target:

- `apps/app.mento.org/app/borrow/page.tsx`
  - Render the aggregated dashboard directly.
- New `apps/app.mento.org/app/borrow/open/page.tsx`
  - Render the open-trove view directly.
- New `apps/app.mento.org/app/borrow/manage/[id]/page.tsx`
  - Validate `?token=` against supported tokens for the active chain context the page uses.
  - If token is missing or invalid, render a borrow-specific error/empty state with a link back to `/borrow`.

Delete or collapse to no-op:

- `apps/app.mento.org/app/components/borrow/atoms/borrow-navigation.ts`
- The view-switching logic in `borrow-view.tsx`

Navigation contract after the refactor:

- Dashboard CTA uses `Link` or `router.push("/borrow/open")`.
- Trove card manage action links to `/borrow/manage/<id>?token=<symbol>`.
- Open/manage back buttons navigate to `/borrow`.
- `FlowDialog` no longer uses `borrowViewAtom` to return to dashboard.

### 4. Aggregated dashboard

Refactor `apps/app.mento.org/app/components/borrow/dashboard/borrow-dashboard.tsx` to aggregate across supported symbols.

Implementation rules:

- Do **not** call `useUserTroves(symbol)` in a loop inside one component body.
- Instead, render one child component per supported symbol and let each child own its own hook calls.
- The parent gathers all rendered trove slices into a single flat list.

Recommended structure:

- Parent `BorrowDashboard`
  - Gets `supportedTokens`.
  - Renders child loaders such as `<TrovesForToken token={token} ... />`.
  - Combines loaded troves into a flat list.
  - Sorts by `token.symbol`, then `troveId`.

- Child `TrovesForToken`
  - Calls `useUserTroves(token.symbol)`.
  - Returns `loading`, `error`, and `troves` for that token slice.

Dashboard behavior:

- No dashboard token selector.
- No mixed-token `Total Debt`, `Total Collateral`, or `Avg LTV`.
- Safe top metrics only:
  - open trove count
  - supported debt token count
  - optional count of tokens with active positions
- Empty state renders only when all supported-token slices have zero troves and there is no surplus collateral.

Surplus collateral:

- Fan out `useSurplusCollateral(symbol)` per supported token.
- Render one banner per token with non-zero surplus.
- Each banner claims collateral for its own symbol.

Do not attempt to merge surplus balances into one number unless they share the same collateral symbol and the UI clearly preserves which debt-token deployment the claim action is targeting.

### 5. Open Trove page

`apps/app.mento.org/app/components/borrow/open-trove/open-trove-form.tsx` becomes route-local and token-controlled.

UI at the top:

- **Collateral dropdown**
  - Single option today: `USDm`
  - Rendered as a disabled dropdown
  - Sourced from a helper such as `getSupportedCollaterals()` that returns `["USDm"]` for now

- **Borrow dropdown**
  - Sourced from `getSupportedDebtTokens(chainId)`
  - Active selection is local state

State rules:

- Introduce local `selectedDebtToken` state in the open page/form.
- Initialize from supported tokens in deterministic order, preferring `GBPm` if present, else first supported token.
- Keep form state route-local.
- On borrow-token change:
  - preserve `collAmount`
  - clear `debtAmount`
  - clear `interestRate`
  - recompute all token-specific queries and derived values

All token-dependent hooks must receive `selectedDebtToken.symbol` explicitly:

- `useSystemParams`
- `useLoanDetails`
- `useInterestRateBrackets`
- `useDebtSuggestions`
- `useOpenTrove`
- `usePredictUpfrontFee`
- `useNextAvailableOwnerIndex`
- any child hook usage currently hidden behind `selectedDebtTokenAtom`

Component propagation:

- `CollateralInput` receives `debtToken` or at minimum `collateralSymbol`
- `DebtInput` receives `debtToken`
- `InterestRateInput` receives `debtToken`
- `LoanSummary` receives `debtToken`

Do not leave any open-form child reading `selectedDebtTokenAtom`.

New presentational element:

- Add the “Deposit `USDm`, borrow `<symbol>`” summary/pairing element if the design still expects it.
- Feed it from the same selected token + collateral state.

### 6. Manage Trove page

`apps/app.mento.org/app/components/borrow/manage-trove/manage-trove-view.tsx` and its subforms must stop reading `selectedDebtTokenAtom`.

Rules:

- The page boundary resolves `token` to a `DebtTokenConfig`.
- `ManageTroveView` receives `troveId` and `debtToken`.
- `AdjustForm`, `RateForm`, and `CloseForm` receive `debtToken` via props.
- `collateralSymbol` is passed where needed.

Affected behavior:

- `useTroveData(troveId, debtToken.symbol)`
- `useLoanDetails(..., debtToken.symbol)`
- adjust/close/rate mutation hooks
- token icon/address lookup
- display strings like `USDm / GBPm`

Back navigation:

- All back actions route to `/borrow`.
- No `borrowViewAtom`.

### 7. Replace `selectedDebtTokenAtom`

Remove `selectedDebtTokenAtom` from `packages/web3/src/features/borrow/atoms/deployment-atoms.ts` and its barrel exports.

Replacement state model:

- Dashboard: no selection
- Open page: local `useState`
- Manage page: route param / search param boundary
- Earn stability detail pages: already URL-driven

Migration requirement:

- Every component that currently imports `selectedDebtTokenAtom` must be converted to explicit props or route-local state.
- Do not leave partially migrated components that silently depend on old globals.

Expected affected files include:

- `open-trove/collateral-input.tsx`
- `open-trove/debt-input.tsx`
- `open-trove/interest-rate-input.tsx`
- `open-trove/loan-summary.tsx`
- `manage-trove/manage-trove-view.tsx`
- `manage-trove/adjust-form.tsx`
- `manage-trove/rate-form.tsx`
- `manage-trove/close-form.tsx`
- `borrow/shared/unsupported-chain-state.tsx`
- any remaining Earn or dashboard consumers

### 8. Replace `<DebtTokenSelector>` with a generic controlled dropdown

Refactor `apps/app.mento.org/app/components/borrow/shared/debt-token-selector.tsx` into a generic `TokenDropdown`:

- controlled `value`
- controlled `onValueChange`
- passed-in options list
- optional `disabled`
- no coupling to Jotai atoms
- no hardcoded “coming soon” entries

Use it for:

- disabled collateral dropdown on `/borrow/open`
- active borrow-token dropdown on `/borrow/open`

Anything in SDK support renders as live. Anything not in SDK support does not render.

### 9. Parameterize collateral symbol and formatting

Replace display-time collateral hardcodes with `collateralSymbol`.

Files that need explicit review include at least:

- `apps/app.mento.org/app/components/borrow/open-trove/collateral-input.tsx`
- `apps/app.mento.org/app/components/borrow/open-trove/open-trove-form.tsx`
- `apps/app.mento.org/app/components/borrow/open-trove/loan-summary.tsx`
- `apps/app.mento.org/app/components/borrow/dashboard/trove-card.tsx`
- `apps/app.mento.org/app/components/borrow/dashboard/borrow-dashboard.tsx`
- `apps/app.mento.org/app/components/borrow/manage-trove/manage-trove-view.tsx`
- `apps/app.mento.org/app/components/borrow/manage-trove/adjust-form.tsx`
- `apps/app.mento.org/app/components/borrow/manage-trove/close-form.tsx`
- `apps/app.mento.org/app/components/earn/earn-hub.tsx`
- `apps/app.mento.org/app/components/borrow/earn/earn-view.tsx`
- `packages/web3/src/features/borrow/format.ts`

Formatting changes:

- `formatCollateralAmount(amount, collateralSymbol = "USDm")`
- `formatPrice(price, debtToken, collateralSymbol = "USDm")` if needed to avoid stale “per USDm” strings

Keep runtime behavior unchanged for today’s deployments.

### 10. Stability pool routes already support tokenized detail pages

`/earn/stability/[chain]/[token]` already exists and is already token-parameterized.

Required changes:

- Replace hardcoded token source in `stability-route.ts`
- Keep route visibility and hidden-testnet behavior unchanged
- Ensure `DEFAULT_STABILITY_TOKEN` is derived from supported tokens deterministically

Do not regress:

- `/earn/stability/[chain]` redirect behavior
- source-preserving back links
- hidden-testnet fallback chain behavior

### 11. Earn Hub fan-out

Refactor `apps/app.mento.org/app/components/earn/earn-hub.tsx` from one selected token across two chains into visible `(chain, token)` cards.

Implementation rule:

- Do **not** call stability hooks inside a variable-length loop in one component body.
- Extract a child, e.g. `<StabilityOpportunityCard chainId token />`, that owns:
  - `useStabilityPool`
  - `useStabilityPoolStats`
  - `useStabilityPoolApy`

Parent behavior:

- Compute supported deployments from SDK
- Filter to visible stability chains using `useVisibleChains("stabilityPool")`
- Render one child card per visible deployment
- Merge those cards into the existing earn opportunities list alongside LP opportunities

Preserve:

- existing chain filtering
- APY-based sorting
- existing LP pool opportunity behavior

### 12. Borrow flow behavior and redirects

Current flow dialog uses `borrowViewAtom` to return to dashboard. That must be replaced with route-driven behavior.

Plan:

- Extend `BorrowFlowState` with optional `successHref`
- Extend `executeFlow` to accept or propagate that value
- `FlowDialog` uses Next router navigation after success when `successHref` is present
- On dialog close after success, route to `successHref` if present; otherwise just clear flow state

Open trove:

- Derive the newly created trove id from `(owner, owner, ownerIndex)` using the SDK trove-id derivation helper
- Set success route to `/borrow/manage/<derivedId>?token=<symbol>`

Adjust / close / claim collateral:

- Set success route to `/borrow`

Stability pool:

- No borrow redirect integration
- Remain on current stability page

### 13. SDK side assumptions and future flip path

Verified SDK assumptions:

- `borrowRegistries` is keyed by `(chainId, symbol)`
- `BorrowService` already accepts symbol across borrow operations
- `BorrowContextStore` caches context per symbol
- deployment addresses include `collToken`

Future per-registry collateral flip:

- Replace fallback `collateralSymbol: "USDm"` with metadata derived from resolved deployment `collToken`
- Lookup token metadata using SDK token utilities such as cached token resolution
- Unlock the collateral dropdown once multiple collateral assets are actually supported

This future path should be called out in the code, but it is out of scope for the current implementation.

## Critical Files

### Edits

- `apps/app.mento.org/app/lib/stability-route.ts`
- `apps/app.mento.org/app/borrow/page.tsx`
- `apps/app.mento.org/app/components/borrow/borrow-view.tsx`
- `apps/app.mento.org/app/components/borrow/dashboard/borrow-dashboard.tsx`
- `apps/app.mento.org/app/components/borrow/dashboard/trove-list.tsx`
- `apps/app.mento.org/app/components/borrow/dashboard/trove-card.tsx`
- `apps/app.mento.org/app/components/borrow/open-trove/open-trove-form.tsx`
- `apps/app.mento.org/app/components/borrow/open-trove/collateral-input.tsx`
- `apps/app.mento.org/app/components/borrow/open-trove/debt-input.tsx`
- `apps/app.mento.org/app/components/borrow/open-trove/interest-rate-input.tsx`
- `apps/app.mento.org/app/components/borrow/open-trove/loan-summary.tsx`
- `apps/app.mento.org/app/components/borrow/manage-trove/manage-trove-view.tsx`
- `apps/app.mento.org/app/components/borrow/manage-trove/adjust-form.tsx`
- `apps/app.mento.org/app/components/borrow/manage-trove/rate-form.tsx`
- `apps/app.mento.org/app/components/borrow/manage-trove/close-form.tsx`
- `apps/app.mento.org/app/components/borrow/shared/debt-token-selector.tsx`
- `apps/app.mento.org/app/components/borrow/shared/flow-dialog.tsx`
- `apps/app.mento.org/app/components/borrow/shared/unsupported-chain-state.tsx`
- `apps/app.mento.org/app/components/earn/earn-hub.tsx`
- `apps/app.mento.org/app/components/borrow/earn/earn-view.tsx`
- `packages/web3/src/features/borrow/types.ts`
- `packages/web3/src/features/borrow/format.ts`
- `packages/web3/src/features/borrow/atoms/deployment-atoms.ts`
- `packages/web3/src/features/borrow/atoms/index.ts`
- `packages/web3/src/features/borrow/atoms/flow-atoms.ts`
- `packages/web3/src/features/borrow/hooks/use-open-trove.ts`
- any other borrow hook wrappers that need `successHref`

### New

- `apps/app.mento.org/app/borrow/open/page.tsx`
- `apps/app.mento.org/app/borrow/manage/[id]/page.tsx`
- extracted stability opportunity child component if needed, e.g. `apps/app.mento.org/app/components/earn/stability-opportunity-card.tsx`
- optional borrow deployment helper module if split from `stability-route.ts`

### Delete or collapse

- `apps/app.mento.org/app/components/borrow/atoms/borrow-navigation.ts`
- `BorrowView` as a stateful router substitute; if retained, it should become a thin layout shell only

## Reused Existing Utilities

- `borrowRegistries`, `getBorrowRegistry`, `resolveAddressesFromRegistry` from the SDK
- `BorrowService` and its existing symbol-aware methods
- `BorrowContextStore` symbol-aware deployment caching
- `useUserTroves`, `useTroveData`, `useOpenTrove`, `useAdjustTrove`, `useCloseTrove`, `useSurplusCollateral`
- `useStabilityPool`, `useStabilityPoolStats`, `useStabilityPoolApy`
- `resolveStabilityChainId`, `getStabilityRoute`, hidden-testnet route handling
- SDK trove-id derivation helper for open-trove success routing

## Verification

### Static checks

1. Run monorepo build.
2. Run lint and typecheck for `apps/app.mento.org` and `packages/web3`.
3. Confirm no imports of `selectedDebtTokenAtom` remain in borrow UI paths.
4. Confirm no borrow navigation behavior depends on `borrowViewAtom`.

### Manual smoke

1. Visit `/borrow`
   - aggregated dashboard renders
   - no dashboard token selector
   - existing troves appear across all supported debt tokens

2. Visit `/borrow/open`
   - collateral dropdown renders as disabled `USDm`
   - borrow dropdown renders supported debt tokens from SDK
   - switching token updates token-specific hints and labels

3. Change borrow token on `/borrow/open`
   - `collAmount` is preserved
   - `debtAmount` is cleared
   - `interestRate` is cleared
   - min debt, suggestions, and summary recompute for the new token

4. Open a trove
   - flow dialog completes
   - success lands on `/borrow/manage/<id>?token=<symbol>`

5. Visit `/borrow/manage/<id>?token=<symbol>`
   - trove loads correctly
   - adjust, rate change, and close flows still work
   - success from those flows returns to `/borrow`

6. Invalid manage route
   - `/borrow/manage/123?token=notatoken` renders the planned invalid-token state

7. Visit `/earn`
   - one stability card renders per visible `(chain, token)` deployment
   - hidden testnet chains remain hidden when testnet mode is off

8. Visit `/earn/stability/[chain]/[token]`
   - deposit, withdraw, and claim continue to work
   - route resolution still works for supported tokens

### Forward-compat dry run

Temporarily add a second symbol to local `borrowRegistries` and confirm:

- `/borrow/open` borrow dropdown shows the extra symbol
- `/borrow` fans out trove fetching for both symbols
- `/earn` renders the extra stability opportunity card
- no frontend code changes are required beyond the SDK support change

## Assumptions

- Supported borrow tokens come exclusively from SDK `borrowRegistries`.
- Collateral remains `USDm` for this release.
- Mixed-token dashboard totals are intentionally omitted rather than approximated.
- One active borrow flow per tab is sufficient, so `borrowFlowAtom` remains singular instead of becoming an `atomFamily`.
- The SDK trove-id derivation helper is available to the frontend package or can be re-exported safely from the web3 package.
