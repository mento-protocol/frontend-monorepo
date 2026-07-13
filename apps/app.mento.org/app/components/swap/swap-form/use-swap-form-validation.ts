import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import {
  parseAmount,
  parseAmountWithDefault,
  useTradingLimits,
  useTradingSuspensionCheck,
  type AccountBalances,
  type ChainId,
} from "@repo/web3";
import { useCallback, useMemo } from "react";

import {
  getFormattedTokenInBalance,
  getFormattedTokenOutBalance,
  getTradingSuspensionError,
  hasSwapAmount,
  validateSwapBalance,
} from "./swap-form-validation";
import { checkTradingLimitViolation } from "./trading-limits";

type TokenOptions = Parameters<
  typeof validateSwapBalance
>[0]["allTokenOptions"];

export function useSwapFormValidation({
  allTokenOptions,
  amount,
  balances,
  chainId,
  formQuote,
  hasAmountError,
  selectedTokenInSymbol,
  selectedTokenOutSymbol,
  tokenInSymbol,
  tokenOutSymbol,
}: {
  allTokenOptions: TokenOptions;
  amount: string;
  balances: AccountBalances;
  chainId: ChainId;
  formQuote: string;
  hasAmountError: boolean;
  selectedTokenInSymbol?: TokenSymbol;
  selectedTokenOutSymbol?: TokenSymbol;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}) {
  const fromTokenBalance = useMemo(
    () =>
      getFormattedTokenInBalance({
        balances,
        chainId,
        tokenSymbol: selectedTokenInSymbol,
      }),
    [balances, selectedTokenInSymbol, chainId],
  );
  const toTokenBalance = useMemo(
    () =>
      getFormattedTokenOutBalance({
        balances,
        chainId,
        tokenSymbol: selectedTokenOutSymbol,
      }),
    [balances, selectedTokenOutSymbol, chainId],
  );
  const { data: limits, isLoading: limitsLoading } = useTradingLimits(
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    chainId,
  );
  const {
    isSuspended: isTradingSuspended,
    isLoading: isSuspensionCheckLoading,
  } = useTradingSuspensionCheck(
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    chainId,
  );
  const validateBalance = useCallback(
    (value: string) =>
      validateSwapBalance({
        allTokenOptions,
        balances,
        tokenInSymbol: selectedTokenInSymbol,
        value,
      }),
    [balances, selectedTokenInSymbol, allTokenOptions],
  );
  const validateLimits = useCallback(
    async (value: string) => {
      if (!value || limitsLoading || !limits || !limits.tokenToCheck)
        return true;
      if (value === "0." || value === "0") return true;

      const parsedAmount = parseAmount(value);
      if (!parsedAmount) return true;

      const violation = checkTradingLimitViolation({
        amountIn: parsedAmount,
        amountOut: parseAmountWithDefault(formQuote, 0),
        limits,
        tokenInSymbol,
        tokenOutSymbol,
      });
      return violation || true;
    },
    [limitsLoading, limits, tokenInSymbol, tokenOutSymbol, formQuote],
  );
  const validateAmount = useCallback(
    async (value: string) => {
      const balanceCheck = validateBalance(value);
      if (balanceCheck !== true) return balanceCheck;

      const limitsCheck = await validateLimits(value);
      if (limitsCheck !== true) return limitsCheck;
      return true;
    },
    [validateBalance, validateLimits],
  );
  const hasAmount = hasSwapAmount(amount);
  const balanceError = useMemo(() => {
    if (!hasAmount || !selectedTokenInSymbol) return null;
    const balanceCheck = validateBalance(amount);
    return balanceCheck !== true ? balanceCheck : null;
  }, [amount, hasAmount, selectedTokenInSymbol, validateBalance]);
  const tradingSuspensionError = useMemo(
    () =>
      getTradingSuspensionError({
        isTradingSuspended,
        tokenInSymbol,
        tokenOutSymbol,
      }),
    [isTradingSuspended, tokenInSymbol, tokenOutSymbol],
  );
  const canQuote =
    hasAmount &&
    !hasAmountError &&
    !limitsLoading &&
    !isTradingSuspended &&
    !!selectedTokenInSymbol &&
    !!selectedTokenOutSymbol;

  return {
    balanceError,
    canQuote,
    fromTokenBalance,
    hasAmount,
    isSuspensionCheckLoading,
    isTradingSuspended,
    limits,
    limitsLoading,
    toTokenBalance,
    tradingSuspensionError,
    validateAmount,
  };
}
