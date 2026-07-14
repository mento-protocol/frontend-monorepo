import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import {
  formatBalance,
  formatWithMaxDecimals,
  fromWeiRounded,
  getTokenDecimals,
  MIN_ROUNDED_VALUE,
  parseAmount,
  parseAmountWithDefault,
  toWei,
  type AccountBalances,
  type ChainId,
} from "@repo/web3";

type TokenOption = { decimals?: number; symbol: string };

export function getTokenBalanceValue(
  balances: AccountBalances,
  tokenSymbol: TokenSymbol,
): string | undefined {
  return balances[tokenSymbol];
}

export function getFormattedTokenInBalance({
  balances,
  chainId,
  tokenSymbol,
}: {
  balances: AccountBalances;
  chainId: ChainId;
  tokenSymbol?: TokenSymbol;
}): string {
  if (!tokenSymbol) return "0";
  const balance = formatBalance(
    getTokenBalanceValue(balances, tokenSymbol) ?? "0",
    getTokenDecimals(tokenSymbol, chainId),
  );
  return formatWithMaxDecimals(balance || "0.00");
}

export function getFormattedTokenOutBalance({
  balances,
  chainId,
  tokenSymbol,
}: {
  balances: AccountBalances;
  chainId: ChainId;
  tokenSymbol?: TokenSymbol;
}): string {
  if (!tokenSymbol) return "0";
  const balance = fromWeiRounded(
    getTokenBalanceValue(balances, tokenSymbol) ?? "0",
    getTokenDecimals(tokenSymbol, chainId),
  );
  return formatWithMaxDecimals(balance || "0.00");
}

export function validateSwapBalance({
  allTokenOptions,
  balances,
  tokenInSymbol,
  value,
}: {
  allTokenOptions: TokenOption[];
  balances: AccountBalances;
  tokenInSymbol?: TokenSymbol;
  value: string;
}): true | string {
  if (!value || !tokenInSymbol) return true;
  if (value === "0." || value === "0") return true;

  const parsedAmount = parseAmount(value);
  if (!parsedAmount) return true;
  if (parsedAmount.lte(MIN_ROUNDED_VALUE) && !parsedAmount.isZero()) {
    return "Amount too small";
  }

  const tokenInfo = allTokenOptions.find(
    (token) => token.symbol === tokenInSymbol,
  );
  if (!tokenInfo) return "Invalid token";

  const balance = getTokenBalanceValue(balances, tokenInSymbol);
  if (typeof balance === "undefined") return "Balance unavailable";

  const amountInWei = toWei(parsedAmount, tokenInfo.decimals || 18);
  const balanceInWei = parseAmountWithDefault(balance, "0");
  if (
    amountInWei.gt(0) &&
    (balanceInWei.isZero() || balanceInWei.lt(amountInWei))
  ) {
    return "Insufficient balance";
  }

  return true;
}

export function hasSwapAmount(amount?: string): boolean {
  return Boolean(
    amount && amount !== "0" && amount !== "0." && Number(amount) > 0,
  );
}

export function getTradingSuspensionError({
  isTradingSuspended,
  tokenInSymbol,
  tokenOutSymbol,
}: {
  isTradingSuspended: boolean;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}): string | null {
  if (!isTradingSuspended) return null;
  return `Trading temporarily paused for ${tokenInSymbol} -> ${tokenOutSymbol}. Unable to determine accurate exchange rate now. Please try again later.`;
}
