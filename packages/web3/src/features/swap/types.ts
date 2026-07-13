import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import type { AccountBalances } from "../accounts/use-account-balances";

export interface SwapFormValues {
  tokenInSymbol?: TokenSymbol;
  tokenOutSymbol?: TokenSymbol;
  amount?: string;
  quote?: string;
  slippage: string;
  isAutoSlippage?: boolean;
  deadlineMinutes?: string;
  isAutoDeadline?: boolean;
  buyUSDValue?: string;
  sellUSDValue?: string;
}

// Result after an exchange rate gets processed for display.
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
