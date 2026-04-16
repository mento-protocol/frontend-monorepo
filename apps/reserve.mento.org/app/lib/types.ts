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

type CollateralSourceType =
  | "wallet"
  | "aave"
  | "univ3"
  | "fpmm"
  | "stability_pool";

export interface CollateralSource {
  type: CollateralSourceType;
  label: string;
  identifier: string;
  balance: string;
  usd_value: number;
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
      sources: CollateralSource[];
    }>;
  };
  reserve_held_supply: {
    total_usd: number;
    by_token: Array<{
      symbol: string;
      amount: number;
      usd_value: number;
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
      trove_id: string;
      owner: string;
      owner_label: string;
      stablecoin: string;
      collateral_token: string;
      collateral_amount: string;
      collateral_usd: number;
      debt_amount: string;
      debt_usd: number;
      ratio: number;
      annual_interest_rate: number;
      liquidation_price: number;
      status: TroveStatus;
      chain: Chain;
      contract_address: string;
      overhead?: {
        usd: number;
        wiggleroom_pct: number;
      };
    }>;
  };
  positions: {
    wallet_balances: Array<{
      address: string;
      label: string;
      chain: Chain;
      token: string;
      token_address: string;
      balance: string;
      usd_value: number;
      is_mento_stable: boolean;
    }>;
    aave_deposits: Array<{
      address: string;
      label: string;
      chain: Chain;
      token: string;
      a_token_address: string;
      balance: string;
      usd_value: number;
      is_mento_stable: boolean;
    }>;
    univ3_positions: Array<{
      position_id: number;
      owner: string;
      owner_label: string;
      chain: Chain;
      pool_address: string;
      fee_tier: number;
      token0: { symbol: string; address: string; amount: string };
      token1: { symbol: string; address: string; amount: string };
      liquidity: string;
      in_range: boolean;
    }>;
    fpmm_positions: Array<{
      pool_address: string;
      chain: Chain;
      pool_name: string;
      strategy_registered: boolean;
      lp_holder: string;
      lp_holder_label: string;
      lp_share_pct: number;
      debt_token: { symbol: string; amount: number; address: string };
      collateral_token: { symbol: string; amount: number; address: string };
    }>;
    cdp_troves: Array<{
      trove_id: string;
      owner: string;
      owner_label: string;
      chain: Chain;
      status: TroveStatus;
      collateral_token: string;
      collateral_amount: string;
      collateral_usd: number;
      debt_token: string;
      debt_amount: string;
      debt_usd: number;
      ratio: number;
      annual_interest_rate: number;
      contract_address: string;
    }>;
    stability_pool_deposits: Array<{
      pool_address: string;
      pool_label: string;
      chain: Chain;
      depositor: string;
      depositor_label: string;
      deposit_token: string;
      deposit_amount: string;
      deposit_usd: number;
      collateral_gained_token: string;
      collateral_gained: string;
      collateral_gained_usd: number;
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
interface SupplyBreakdownNode {
  id: string;
  label: string;
  value_usd: number;
  color?: string;
  children?: SupplyBreakdownNode[];
}

interface V2SupplyBreakdownResponse {
  breakdown: SupplyBreakdownNode;
}

// Aggregated data passed to the page
export interface ReservePageData {
  overview: V2OverviewResponse;
  stablecoins: V2StablecoinsResponse;
  reserve: V2ReserveResponse;
  addresses: V2AddressesResponse;
}
