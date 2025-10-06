import type { Network } from "./types/index";
import type { TokenSymbol } from "@mento-protocol/mento-sdk";

export type ReserveAssetSymbol =
  | "CELO"
  | "ETH"
  | "BTC"
  | "USDC"
  | "USDT"
  | "DAI"
  | "EURC"
  | "WBTC"
  | "WETH"
  | "stEUR"
  | "sDAI"
  | "stETH"
  | "USDGLO";

export interface TokenModel {
  symbol: TokenSymbol;
  name: string;
  units: number;
  value: number; // Presumed to be USD value
  updated: number; // Timestamp of the last update
  hasError: boolean;
  iconUrl?: string; // Optional icon URL
}

export interface StableValueTokensAPI {
  totalStableValueInUSD: number;
  tokens: TokenModel[];
}

export interface ReserveStats {
  collateralization_ratio: number;
  total_reserve_value_usd: number;
  total_outstanding_stables_usd: number;
}

// Types for Reserve Composition
export interface ReserveCompositionEntry {
  symbol: ReserveAssetSymbol;
  percent: number;
}

export type ReserveCompositionAPI = ReserveCompositionEntry[];

// Raw type from external API for reserve composition
export interface ExternalReserveCompositionItem {
  symbol: string;
  percentage: number;
  usd_value: number;
}

export interface ExternalCompositionResponse {
  composition: ExternalReserveCompositionItem[];
}

// Types for Reserve Holdings
export interface CeloAssetDetails {
  symbol: "CELO";
  units: number;
  value: number;
  updated: number; // Timestamp of the last update
}

export interface OtherReserveAsset {
  symbol: ReserveAssetSymbol;
  units: number;
  value: number;
  updated: number; // Timestamp of the last update
  iconUrl?: string; // Optional icon URL, though not present in current API route transformation
}

export interface HoldingsApi {
  celo: {
    unfrozen: CeloAssetDetails;
    frozen: CeloAssetDetails;
    custody: CeloAssetDetails;
  };
  totalReserveValue: number;
  otherAssets: OtherReserveAsset[];
}

// Raw type from external API for reserve holdings
export interface ExternalReserveAsset {
  symbol: string;
  totalBalance: string; // Will be converted to number
  usdValue: number;
  iconUrl?: string;
}

export interface ExternalAnalyticsApiResponse {
  total_holdings_usd: number;
  assets: ExternalReserveAsset[];
}

// Reserve Addresses Types
export interface ReserveAddress {
  address: string;
  label: string;
}

export interface ReserveAddressGroup {
  network: Network; // Use proper Network enum
  category: string; // "Mento Reserve" | "Uniswap V3 Pool" | "Aave"
  addresses: ReserveAddress[];
}

export interface ReserveAddressesResponse {
  addresses: ReserveAddressGroup[];
}
