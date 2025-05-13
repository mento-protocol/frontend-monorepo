import { atom } from "jotai";

/**
 * A write-only atom that can be used to trigger the reset of token price data.
 * Currently, as price data fetching is not actively used, this serves as a placeholder
 * for the reset action previously dispatched via Redux.
 * If price data and its fetching are reintroduced (e.g., with React Query),
 * this atom can be used to trigger cache invalidation or state reset for that data.
 */
export const resetTokenPricesAtom = atom(null, (_get, set) => {
  // In the future, if actual price data is managed via other Jotai atoms or React Query,
  // an actual reset logic would go here, e.g.:
  // set(somePriceDataAtom, initialPriceDataState);
  // queryClient.invalidateQueries(['tokenPrices']);
  // For now, its existence allows us to replace the Redux action.
});
