import type { PoolDisplay, PoolDisplayToken } from "./types";

/**
 * Symbols that should appear as the quote (second) token in display ordering.
 * Lower index = higher priority as quote.
 */
const QUOTE_TOKEN_PRIORITY: string[] = ["USDm", "EURm"];

export interface DisplayOrderedTokens {
  displayToken0: PoolDisplayToken;
  displayToken1: PoolDisplayToken;
  displayReserve0: string;
  displayReserve1: string;
  displayRatio0: number;
  isSwapped: boolean;
}

/**
 * Returns display-ordered tokens for a pool. When a pool contains USDm or EURm,
 * that token is placed second (as the "quote" token). Between USDm and EURm,
 * USDm takes priority as quote, resulting in "EURm / USDm".
 *
 * This is cosmetic only — the returned values should only be used for rendering,
 * never for transaction logic.
 */
export function getPoolDisplayOrder(pool: PoolDisplay): DisplayOrderedTokens {
  const idx0 = QUOTE_TOKEN_PRIORITY.indexOf(pool.token0.symbol);
  const idx1 = QUOTE_TOKEN_PRIORITY.indexOf(pool.token1.symbol);

  // Swap if token0 should be the quote (second) token:
  //   - token0 is in the priority list AND token1 is NOT, OR
  //   - both are in the list but token0 has higher priority (lower index)
  const shouldSwap = idx0 !== -1 && (idx1 === -1 || idx0 < idx1);

  if (shouldSwap) {
    return {
      displayToken0: pool.token1,
      displayToken1: pool.token0,
      displayReserve0: pool.reserves.token1,
      displayReserve1: pool.reserves.token0,
      displayRatio0: 1 - pool.reserves.token0Ratio,
      isSwapped: true,
    };
  }

  return {
    displayToken0: pool.token0,
    displayToken1: pool.token1,
    displayReserve0: pool.reserves.token0,
    displayReserve1: pool.reserves.token1,
    displayRatio0: pool.reserves.token0Ratio,
    isSwapped: false,
  };
}
