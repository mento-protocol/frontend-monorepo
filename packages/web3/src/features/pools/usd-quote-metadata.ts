import { ChainId } from "@/config/chains";
import { isUsdQuoteTokenAddress } from "@/config/usd-quote-tokens";

type UsdQuoteSide = "token0" | "token1" | "both" | "none";

type GetUsdTokenPricesParams = {
  token0Address: string;
  token1Address: string;
  oraclePrice: number;
  chainId: ChainId;
};

type UsdTokenPrices = {
  token0PriceUsd: number;
  token1PriceUsd: number;
};

function isUsdQuoteToken(tokenAddress: string, chainId: ChainId): boolean {
  return isUsdQuoteTokenAddress(tokenAddress, chainId);
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

export function getUsdTokenPrices({
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
