// Chain / network enum matching the API
export enum Chain {
  CELO = "celo",
  ETHEREUM = "ethereum",
  BITCOIN = "bitcoin",
  MONAD = "monad",
}

export type BackingType = "reserve" | "cdp";
export type TroveStatus = "active" | "pending";

// GET /api/v2/overview
export interface V2OverviewResponse {
  supply: {
    total_usd: number;
    debt_usd: number;
    reserve_debt_usd: number;
    cdp_debt_usd: number;
    reserve_held_usd: number;
    lost_usd: number;
    stablecoin_count: number;
  };
  reserve_backing: {
    collateral_usd: number;
    debt_usd: number;
    ratio: number;
    stablecoin_count: number;
  };
  cdp_backings: Array<{
    stablecoin: string;
    collateral_token: string;
    collateral_usd: number;
    collateral_amount: string;
    debt_usd: number;
    debt_amount: string;
    ratio: number;
    status: TroveStatus;
    chain: Chain;
  }>;
  timestamp: string;
}

// Supply breakdown (shared between aggregate and per-network)
export interface StablecoinSupply {
  total: string;
  total_usd: number;
  debt: string;
  debt_usd: number;
  reserve_held: string;
  reserve_held_usd: number;
  lost: string;
  lost_usd: number;
}

export interface NetworkSupply {
  chain: Chain;
  address: string;
  supply: StablecoinSupply;
}

// GET /api/v2/stablecoins
export interface V2StablecoinsResponse {
  total_supply_usd: number;
  total_debt_usd: number;
  stablecoins: Array<{
    symbol: string;
    name: string;
    backing_type: BackingType;
    fiat_symbol: string;
    icon_url?: string;
    networks: Chain[];
    supply: StablecoinSupply;
    network_supplies: NetworkSupply[];
    market_cap_percentage: number;
  }>;
}

// GET /api/v2/reserve
export interface V2ReserveResponse {
  collateral: {
    total_usd: number;
    assets: Array<{
      symbol: string;
      chain: Chain;
      balance: string;
      usd_value: number;
      percentage: number;
    }>;
  };
  lp_positions: {
    total_usd: number;
    positions: Array<{
      pool_name: string;
      pool_type: string;
      chain: Chain;
      reserve_liquidity_usd: number;
      token_a: { symbol: string; amount: string };
      token_b: { symbol: string; amount: string };
      pool_share_pct: number;
    }>;
  };
  operational_holdings: {
    total_usd: number;
    holdings: Array<{
      token: string;
      chain: Chain;
      wallet_label: string;
      balance: string;
      usd_value: number;
    }>;
  };
  cdp_troves: {
    total_collateral_usd: number;
    total_debt_usd: number;
    troves: Array<{
      stablecoin: string;
      collateral_token: string;
      collateral_amount: string;
      collateral_usd: number;
      debt_amount: string;
      debt_usd: number;
      ratio: number;
      liquidation_price: number;
      status: TroveStatus;
      chain: Chain;
      contract_address: string;
    }>;
  };
}

// GET /api/v2/addresses
export interface V2AddressesResponse {
  networks: Array<{
    chain: Chain;
    categories: Array<{
      category: string;
      addresses: Array<{
        address: string;
        label: string;
        description?: string;
      }>;
    }>;
  }>;
}

// GET /api/v2/supply/breakdown (not used for now, but typed for completeness)
export interface SupplyBreakdownNode {
  id: string;
  label: string;
  value_usd: number;
  color?: string;
  children?: SupplyBreakdownNode[];
}

export interface V2SupplyBreakdownResponse {
  breakdown: SupplyBreakdownNode;
}

// Aggregated data passed to the page
export interface ReservePageData {
  overview: V2OverviewResponse;
  stablecoins: V2StablecoinsResponse;
  reserve: V2ReserveResponse;
  addresses: V2AddressesResponse;
}
