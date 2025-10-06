import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import type { AccountBalances } from "../accounts/use-account-balances";

export type SwapDirection = "in" | "out";

export interface SwapFormValues {
  tokenInSymbol?: TokenSymbol;
  tokenOutSymbol?: TokenSymbol;
  amount?: string;
  quote?: string;
  direction?: SwapDirection;
  slippage: string;
  buyUSDValue?: string;
  sellUSDValue?: string;
}

export type ToCeloRates = Partial<Record<TokenSymbol, ExchangeRate>>;

// Raw Mento chain data from an Exchange contract
export interface ExchangeRate {
  stableBucket: string;
  celoBucket: string;
  spread: string;
  lastUpdated: number;
}

// Result after ExchangeRate gets processed
export interface SimpleExchangeRate {
  rate: number;
  lastUpdated: number;
}

export type SizeLimits = Partial<
  Record<TokenSymbol, { min: string; max: string }>
>;

export interface IUseFormValidatorProps {
  balances: AccountBalances;
  isBalanceLoaded: boolean | undefined;
  isWalletConnected: boolean | undefined;
}

export interface ISubmitButtonProps {
  isWalletConnected: boolean | undefined;
  isBalanceLoaded: boolean | undefined;
}
