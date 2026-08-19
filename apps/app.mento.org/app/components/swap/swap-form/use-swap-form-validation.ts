import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import {
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

type TokenOptions = Parameters<
  typeof validateSwapBalance
>[0]["allTokenOptions"];

export function useSwapFormValidation({
  allTokenOptions,
  amount,
  balances,
  chainId,
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
  const validateAmount = useCallback(
    async (value: string) => {
      const balanceCheck = validateBalance(value);
      if (balanceCheck !== true) return balanceCheck;
      return true;
    },
    [validateBalance],
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
