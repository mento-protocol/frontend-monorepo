import { ChainId } from "@/config/chains";

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

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

const CELO_USD_QUOTE_ADDRESSES = [
  "0x765DE816845861e75A25fCA122bb6898B8B1282a", // USDm
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", // USDC
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", // USD_
  "0xEB466342C4d449BC9f53A865D5Cb90586f405215", // axlUSDC
];

const CELO_SEPOLIA_USD_QUOTE_ADDRESSES = [
  "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b", // USDm
  "0x01C5C0122039549AD1493B8220cABEdD739BC44E", // USDC
  "0xd077A400968890Eacc75cdc901F0356c943e4fDb", // USD_
  "0x6285De9DA7C1d329C0451628638908915002d9d1", // axlUSDC
];

const USD_QUOTE_TOKEN_ADDRESSES_BY_CHAIN: Record<
  ChainId,
  ReadonlySet<string>
> = {
  [ChainId.Celo]: new Set(CELO_USD_QUOTE_ADDRESSES.map(normalizeAddress)),
  [ChainId.CeloSepolia]: new Set(
    CELO_SEPOLIA_USD_QUOTE_ADDRESSES.map(normalizeAddress),
  ),
};

function isUsdQuoteToken(tokenAddress: string, chainId: ChainId): boolean {
  return USD_QUOTE_TOKEN_ADDRESSES_BY_CHAIN[chainId].has(
    normalizeAddress(tokenAddress),
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
