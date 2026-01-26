export type PoolFilterType = "all" | "fpmm" | "legacy";

export type PriceAlignmentStatus =
  | "in-band"
  | "warning"
  | "rebalance-likely"
  | "market-closed"
  | "none";

export interface PoolDisplayToken {
  symbol: string;
  address: string;
  decimals: number;
  name: string;
}

export interface PoolDisplay {
  poolAddr: string;
  poolType: "FPMM" | "Legacy";
  token0: PoolDisplayToken;
  token1: PoolDisplayToken;
  reserves: {
    token0: string; // formatted with K/M suffix
    token1: string;
    token0Ratio: number; // 0-1, token0's share of total reserves (by count)
  };
  fees: {
    total: number;
    lp: number;
    protocol: number;
    label: "fee" | "spread"; // "fee" for FPMM, "spread" for Legacy
  };
  priceAlignment: {
    status: PriceAlignmentStatus;
    priceDifferencePercent?: number;
  };
  // FPMM-specific data (only present for FPMM pools when pricing is available)
  pricing?: {
    oraclePrice: number;
    poolPrice: number;
    deviationBps: number; // in basis points
    isPoolPriceAbove: boolean;
  };
  rebalancing?: {
    incentivePercent: number;
    thresholdAboveBps: number;
    thresholdBelowBps: number;
    canRebalance: boolean; // true if out of band and has liquidity strategy
    liquidityStrategy: string | null;
  };
}
