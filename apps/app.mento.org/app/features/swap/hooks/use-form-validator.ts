import { useCallback } from "react";
import { MIN_ROUNDED_VALUE } from "@/lib/config/consts";
// Tokens and getTokenByAddress are used as values, AppTokenId as type
import { Tokens, getTokenByAddress } from "@/lib/config/tokens";
import type { TokenId as AppTokenId } from "@/lib/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
// These are all types
import type {
  IUseFormValidatorProps,
  SwapFormValues,
  TokenId,
} from "@/features/swap/types";
import { parseAmount, toWei } from "@/lib/utils/amount";
import { logger } from "@/lib/utils/logger";
import { useChainId } from "wagmi";

// RHF-compatible error types
type RHFFieldError = {
  type: string;
  message: string;
};

// Define a generic RHFErrors type for SwapFormValues
type SwapFormRHFErrors = {
  [K in keyof SwapFormValues]?: RHFFieldError;
};

export function useFormValidator({
  balances,
  isBalanceLoaded,
  isWalletConnected,
}: IUseFormValidatorProps) {
  const chainId = useChainId();
  const isAccountReady = isWalletConnected && isBalanceLoaded;

  return useCallback(
    async (
      values: SwapFormValues,
    ): Promise<{ values: SwapFormValues; errors: SwapFormRHFErrors }> => {
      const { amount, fromTokenId, toTokenId } = values;
      const currentErrors: SwapFormRHFErrors = {};

      try {
        // Basic check for token selection, though often handled by UI disabling submit
        if (!fromTokenId) {
          // Not adding to currentErrors as this might be pre-submit UI state
        }
        if (!toTokenId) {
          // Not adding to currentErrors
        }

        // Amount validation
        if (!String(amount).trim()) {
          currentErrors.amount = {
            type: "required",
            message: "Amount Required",
          };
          return { values, errors: currentErrors };
        }

        const parsedAmount = parseAmount(String(amount));
        if (!parsedAmount) {
          currentErrors.amount = {
            type: "invalid",
            message: "Amount is Invalid",
          };
          return { values, errors: currentErrors };
        }

        // Check if amount is too small (but not zero or empty, which are handled above)
        if (
          isAccountReady &&
          parsedAmount.lt(MIN_ROUNDED_VALUE) &&
          !parsedAmount.isZero()
        ) {
          currentErrors.amount = { type: "min", message: "Amount too small" };
          return { values, errors: currentErrors };
        }

        // Balance and trading limit checks only if account is ready and basic amount validation passed
        if (isAccountReady) {
          const tokenInfo = Tokens[fromTokenId as AppTokenId]; // Cast because fromTokenId is from our specific TokenId enum/type
          if (!tokenInfo) {
            logger.error("Invalid fromTokenId in validator:", fromTokenId);
            currentErrors.amount = {
              type: "internal",
              message: "Invalid token configuration.",
            };
            return { values, errors: currentErrors };
          }

          const tokenBalance = balances[fromTokenId];
          if (typeof tokenBalance === "undefined") {
            logger.warn(
              "Token balance not found for",
              fromTokenId,
              "Balances:",
              balances,
            );
            currentErrors.amount = {
              type: "internal",
              message: "Balance data unavailable for the selected token.",
            };
            return { values, errors: currentErrors };
          }

          const amountInWei = toWei(parsedAmount, tokenInfo.decimals);
          if (amountInWei.gt(tokenBalance)) {
            currentErrors.amount = {
              type: "balance",
              message: "Amount exceeds balance",
            };
            return { values, errors: currentErrors };
          }

          // Check for toTokenId before calling checkTradingLimits which requires it
          if (!toTokenId) {
            // This state should ideally be prevented by the UI (e.g. disable form until toTokenId is selected)
            // currentErrors.toTokenId = { type: "required", message: "Destination token required" };
            // return { values, errors: currentErrors };
            // For now, proceed, but checkTradingLimits might fail or give incomplete info
          }

          const { exceeds, errorMsg } = await checkTradingLimits(
            values,
            chainId,
          );
          if (exceeds) {
            currentErrors.amount = { type: "limit", message: errorMsg };
            return { values, errors: currentErrors };
          }
        }

        return { values, errors: currentErrors }; // No errors found, or errors handled
      } catch (error) {
        logger.error("Validation error in resolver:", error);
        currentErrors.amount = {
          type: "unexpected",
          message: "An unexpected validation error occurred.",
        };
        return { values, errors: currentErrors };
      }
    },
    [balances, chainId, isAccountReady],
  );
}

// checkTradingLimits function remains largely the same internally
async function checkTradingLimits(
  values: SwapFormValues,
  chainId: number,
): Promise<{ exceeds: boolean; errorMsg: string }> {
  const mento = await getMentoSdk(chainId);
  // Ensure fromTokenId and toTokenId are valid before proceeding
  if (!values.fromTokenId || !values.toTokenId) {
    // This case should be handled before calling, or return a non-blocking error
    // For now, returning false as limits can't be checked
    logger.warn("checkTradingLimits called with missing token IDs");
    return { exceeds: false, errorMsg: "" };
  }

  const tradablePair = await getTradablePairForTokens(
    chainId,
    values.fromTokenId,
    values.toTokenId,
  );
  // TODO: handle multiple hops
  if (!tradablePair || !tradablePair.path || tradablePair.path.length === 0) {
    logger.warn(
      "No tradable pair found for",
      values.fromTokenId,
      values.toTokenId,
    );
    return { exceeds: false, errorMsg: "Trading path not available." }; // Or a specific error message
  }
  const exchangeId = tradablePair.path[0].id;
  const tradingLimits = await mento.getTradingLimits(exchangeId);

  let timestampIn = 0;
  let timestampOut = 0;
  let minMaxIn = Infinity;
  let minMaxOut = Infinity;

  for (const limit of tradingLimits) {
    if (limit.maxIn < minMaxIn) {
      minMaxIn = limit.maxIn;
      timestampIn = limit.until;
    }
    if (limit.maxOut < minMaxOut) {
      minMaxOut = limit.maxOut;
      timestampOut = limit.until;
    }
  }
  const isSwapIn = values.direction === "in";
  // Ensure tradingLimits[0].asset is valid before using getTokenByAddress
  if (
    !tradingLimits ||
    tradingLimits.length === 0 ||
    !tradingLimits[0] ||
    !tradingLimits[0].asset
  ) {
    logger.warn(
      "Trading limits data is incomplete for exchangeId:",
      exchangeId,
    );
    return {
      exceeds: false,
      errorMsg: "Could not verify trading limits due to incomplete data.",
    };
  }
  const tokenToCheck = getTokenByAddress(
    tradingLimits[0].asset as AppTokenId,
  ).symbol;

  let amountToCheck: number;
  let exceeds = false;
  let limit = 0;
  let timestamp = 0;

  // Ensure amount and quote are numbers for comparison
  const currentAmount = Number.parseFloat(String(values.amount));
  const currentQuote = Number.parseFloat(String(values.quote));

  if (tokenToCheck === values.fromTokenId) {
    amountToCheck = isSwapIn ? currentAmount : currentQuote;
    if (amountToCheck > minMaxIn) {
      exceeds = true;
      limit = minMaxIn;
      timestamp = timestampIn;
    }
  } else {
    amountToCheck = isSwapIn ? currentQuote : currentAmount;
    if (amountToCheck > minMaxOut) {
      exceeds = true;
      limit = minMaxOut;
      timestamp = timestampOut;
    }
  }

  if (exceeds) {
    const date = new Date(timestamp * 1000).toLocaleString();
    const errorMsg = `The ${tokenToCheck} amount exceeds the current trading limits. The current ${
      tokenToCheck === values.fromTokenId ? "sell" : "buy"
    }  limit is ${limit} ${tokenToCheck} until ${date}`;
    return { exceeds, errorMsg };
  }

  return { exceeds: false, errorMsg: "" };
}
