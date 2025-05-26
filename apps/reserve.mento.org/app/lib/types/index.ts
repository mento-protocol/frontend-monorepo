export interface HoldingsApi {
  celo: {
    unfrozen: TokenModel;
    frozen: TokenModel;
    custody: TokenModel;
  };
  otherAssets: TokenModel[];
  totalReserveValue?: number;
}

import type { StableToken, Token } from "@celo/contractkit";

export type Tokens =
  | "CELO"
  | "BTC"
  | "DAI"
  | "ETH"
  | "cMCO2"
  | "USDC"
  | "nativeUSDC"
  | "EURC"
  | "WBTC"
  | "WETH"
  | "stEUR"
  | "sDAI"
  | "stETH"
  | "USDT"
  | "cEUR"
  | "cUSD"
  | "cREAL"
  | "cKES"
  | "eXOF"
  | "PUSO"
  | "cCOP"
  | "USDGLO"
  | "cGHS"
  | Token
  | StableToken;

export interface Address {
  address: string;
  label: string;
  token: Tokens;
  status?: "active" | "inactive";
}

export interface TokenModel {
  token: Tokens;
  units: number;
  value: number;
  updated: number;
  hasError?: boolean;
  iconUrl?: string;
}

export enum Network {
  ETH = "ethereum",
  CELO = "celo",
  BTC = "btc",
}

export interface StableValueTokensAPI {
  totalStableValueInUSD: number;
  tokens: TokenModel[];
}
