import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { getTokenByAddress } from "@/lib/config/tokens";
import type { SwapFormValues } from "@/features/swap/types";
import { logger } from "@/lib/utils/logger";

export async function checkTradingLimits(
  values: SwapFormValues,
  chainId: number,
): Promise<{ exceeds: boolean; errorMsg: string }> {
  const mento = await getMentoSdk(chainId);

  // Ensure fromTokenId and toTokenId are valid before proceeding
  if (!values.fromTokenId || !values.toTokenId) {
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
    return { exceeds: false, errorMsg: "Trading path not available." };
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

  // Get the token info from the address
  const limitTokenInfo = getTokenByAddress(tradingLimits[0].asset);
  if (!limitTokenInfo) {
    logger.warn(
      "Could not find token info for address:",
      tradingLimits[0].asset,
    );
    return {
      exceeds: false,
      errorMsg: "Could not verify trading limits due to missing token info.",
    };
  }

  // Use the token ID for comparison, not the symbol
  const tokenToCheckId = limitTokenInfo.id;

  let amountToCheck: number;
  let exceeds = false;
  let limit = 0;
  let timestamp = 0;

  // Ensure amount and quote are numbers for comparison
  const currentAmount = Number.parseFloat(String(values.amount));
  const currentQuote = Number.parseFloat(String(values.quote));

  if (tokenToCheckId === values.fromTokenId) {
    amountToCheck = isSwapIn ? currentAmount : currentQuote;
    if (amountToCheck > minMaxIn) {
      exceeds = true;
      limit = minMaxIn;
      timestamp = timestampIn;
    }
  } else if (tokenToCheckId === values.toTokenId) {
    amountToCheck = isSwapIn ? currentQuote : currentAmount;
    if (amountToCheck > minMaxOut) {
      exceeds = true;
      limit = minMaxOut;
      timestamp = timestampOut;
    }
  } else {
    logger.warn(
      "Token from trading limits doesn't match either from or to token:",
      {
        limitToken: tokenToCheckId,
        fromToken: values.fromTokenId,
        toToken: values.toTokenId,
      },
    );
    return { exceeds: false, errorMsg: "" };
  }

  if (exceeds) {
    const date = new Date(timestamp * 1000).toLocaleString();
    const tokenSymbol = limitTokenInfo.symbol;
    const errorMsg = `The ${tokenSymbol} amount exceeds the current trading limits. The current limit is ${limit} ${tokenSymbol} until ${date}`;
    return { exceeds, errorMsg };
  }

  return { exceeds: false, errorMsg: "" };
}
