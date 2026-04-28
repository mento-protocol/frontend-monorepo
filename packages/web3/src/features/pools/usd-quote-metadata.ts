import type { ChainId } from "@/config/chains";
import { isUsdQuoteTokenAddress } from "@/config/usd-quote-tokens";
import {
  TOKEN_ADDRESSES_BY_CHAIN,
  TokenSymbol,
} from "@mento-protocol/mento-sdk";

type UsdQuoteSide = "token0" | "token1" | "both" | "none";

type GetUsdTokenPricesParams = {
  token0Address: string;
  token1Address: string;
  oraclePrice: number;
  chainId: ChainId;
  context?: PoolUsdPricingContext;
};

type UsdTokenPrices = {
  token0PriceUsd: number;
  token1PriceUsd: number;
};

type ReferencePoolRoute = {
  path: Array<{
    poolAddr: string;
    token0: string;
    token1: string;
  }>;
};

type ReferencePoolDetails = {
  poolType: string;
  token0: string;
  token1: string;
  pricing?: {
    oraclePrice: number;
  } | null;
};

type PoolUsdPricingSdk = {
  routes: {
    findRoute(
      tokenIn: string,
      tokenOut: string,
      options?: { cached?: boolean },
    ): Promise<ReferencePoolRoute>;
  };
  pools: {
    getPoolDetails(poolAddr: string): Promise<ReferencePoolDetails>;
  };
};

export type PoolUsdPricingContext = {
  sdk: PoolUsdPricingSdk;
  chainId: ChainId;
  eurToUsdPricePromise?: Promise<number | null>;
};

function isUsdQuoteToken(tokenAddress: string, chainId: ChainId): boolean {
  return isUsdQuoteTokenAddress(tokenAddress, chainId);
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function areSameAddress(addressA: string, addressB: string): boolean {
  return normalizeAddress(addressA) === normalizeAddress(addressB);
}

function isPairMatch(
  token0Address: string,
  token1Address: string,
  expectedTokenA: string,
  expectedTokenB: string,
): boolean {
  return (
    (areSameAddress(token0Address, expectedTokenA) &&
      areSameAddress(token1Address, expectedTokenB)) ||
    (areSameAddress(token0Address, expectedTokenB) &&
      areSameAddress(token1Address, expectedTokenA))
  );
}

function isValidOraclePrice(oraclePrice: number): boolean {
  return Number.isFinite(oraclePrice) && oraclePrice > 0;
}

function getUsdQuoteSide(
  token0Address: string,
  token1Address: string,
  chainId: ChainId,
): UsdQuoteSide {
  const token0IsUsd = isUsdQuoteToken(token0Address, chainId);
  const token1IsUsd = isUsdQuoteToken(token1Address, chainId);

  if (token0IsUsd && token1IsUsd) return "both";
  if (token0IsUsd) return "token0";
  if (token1IsUsd) return "token1";
  return "none";
}

function getDirectUsdTokenPrices({
  token0Address,
  token1Address,
  oraclePrice,
  chainId,
}: GetUsdTokenPricesParams): UsdTokenPrices | null {
  const usdQuoteSide = getUsdQuoteSide(token0Address, token1Address, chainId);
  if (usdQuoteSide === "none") return null;
  if (usdQuoteSide === "both") {
    return {
      token0PriceUsd: 1,
      token1PriceUsd: 1,
    };
  }
  if (!isValidOraclePrice(oraclePrice)) return null;

  // oraclePrice orientation is token1 per token0
  if (usdQuoteSide === "token0") {
    return {
      token0PriceUsd: 1,
      token1PriceUsd: 1 / oraclePrice,
    };
  }

  return {
    token0PriceUsd: oraclePrice,
    token1PriceUsd: 1,
  };
}

function isSupportedEurPool(
  token0Address: string,
  token1Address: string,
  chainId: ChainId,
): boolean {
  const tokenAddresses = TOKEN_ADDRESSES_BY_CHAIN[chainId];
  const eurAddress = tokenAddresses?.[TokenSymbol.EURm];
  const eurocAddress = tokenAddresses?.[TokenSymbol.axlEUROC];

  if (!eurAddress || !eurocAddress) return false;

  return isPairMatch(token0Address, token1Address, eurAddress, eurocAddress);
}

async function resolveEurToUsdPrice(
  context: PoolUsdPricingContext,
): Promise<number | null> {
  const tokenAddresses = TOKEN_ADDRESSES_BY_CHAIN[context.chainId];
  const eurAddress = tokenAddresses?.[TokenSymbol.EURm];
  const usdAddress = tokenAddresses?.[TokenSymbol.USDm];

  if (!eurAddress || !usdAddress) return null;

  try {
    const route = await context.sdk.routes.findRoute(eurAddress, usdAddress, {
      cached: true,
    });
    const referencePool = route.path.find((pool) =>
      isPairMatch(pool.token0, pool.token1, eurAddress, usdAddress),
    );

    if (!referencePool) return null;

    const details = await context.sdk.pools.getPoolDetails(
      referencePool.poolAddr,
    );
    if (details.poolType !== "FPMM" || !details.pricing) return null;

    const directUsdPrices = getDirectUsdTokenPrices({
      token0Address: details.token0,
      token1Address: details.token1,
      oraclePrice: details.pricing.oraclePrice,
      chainId: context.chainId,
    });

    if (!directUsdPrices) return null;

    if (areSameAddress(details.token0, eurAddress)) {
      return directUsdPrices.token0PriceUsd;
    }
    if (areSameAddress(details.token1, eurAddress)) {
      return directUsdPrices.token1PriceUsd;
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("route") && message.includes("not found")) {
      return null;
    }
    throw error;
  }
}

async function getEurToUsdPrice(
  context: PoolUsdPricingContext,
): Promise<number | null> {
  if (!context.eurToUsdPricePromise) {
    context.eurToUsdPricePromise = resolveEurToUsdPrice(context);
  }

  return context.eurToUsdPricePromise;
}

export function createPoolUsdPricingContext(
  sdk: PoolUsdPricingSdk,
  chainId: ChainId,
): PoolUsdPricingContext {
  return { sdk, chainId };
}

export async function getUsdTokenPrices({
  token0Address,
  token1Address,
  oraclePrice,
  chainId,
  context,
}: GetUsdTokenPricesParams): Promise<UsdTokenPrices | null> {
  const directUsdPrices = getDirectUsdTokenPrices({
    token0Address,
    token1Address,
    oraclePrice,
    chainId,
  });
  if (directUsdPrices) return directUsdPrices;

  if (!isSupportedEurPool(token0Address, token1Address, chainId)) {
    return null;
  }
  if (!context) return null;

  const eurToUsdPrice = await getEurToUsdPrice(context);
  if (eurToUsdPrice === null || !isValidOraclePrice(eurToUsdPrice)) {
    return null;
  }

  return {
    token0PriceUsd: eurToUsdPrice,
    token1PriceUsd: eurToUsdPrice,
  };
}
