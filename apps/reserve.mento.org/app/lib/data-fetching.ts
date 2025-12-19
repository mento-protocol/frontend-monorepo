import { getAnalyticsUrl } from "@/lib/config/endpoints";
import type {
  ReserveStats,
  StableValueTokensAPI,
  ExternalCompositionResponse,
  ReserveCompositionAPI,
  ExternalAnalyticsApiResponse,
  HoldingsApi,
  ReserveAddressesResponse,
  ReserveAssetSymbol,
} from "@/lib/types";
import { TokenSymbol } from "@mento-protocol/mento-sdk";

// Define a more specific type for the items in result.stablecoins
interface ExternalStablecoin {
  symbol: string;
  name: string;
  supply: {
    amount: string | number; // Allow string or number, will be converted to Number
    usd_value: number;
  };
  icon_url?: string;
}

async function getReserveStats(): Promise<ReserveStats> {
  // For server-side rendering, we'll directly fetch from the external API
  // instead of going through our own API route
  const analyticsUrl = getAnalyticsUrl("reserveStats");
  if (!analyticsUrl) {
    throw new Error("Analytics API URL could not be constructed.");
  }

  const response = await fetch(analyticsUrl, {
    cache: "no-store", // Ensure fresh data on each request
  });

  if (!response.ok) {
    throw new Error(
      `Analytics API request failed with status ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

async function getStableCoinStats(): Promise<StableValueTokensAPI> {
  const analyticsUrl = getAnalyticsUrl("stablecoins");
  if (!analyticsUrl) {
    throw new Error(
      "Analytics API URL for stablecoins could not be constructed.",
    );
  }

  const response = await fetch(analyticsUrl, {
    cache: "no-store", // Fetches fresh data on every request
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `Stablecoins Analytics API request failed: ${response.status} ${response.statusText}`,
      errorBody,
    );
    throw new Error(
      `Stablecoins Analytics API request failed with status ${response.status} ${response.statusText}`,
    );
  }

  // Assuming result has a 'total_supply_usd' and 'stablecoins' array
  const result = await response.json();

  // Convert the result to the StableValueTokensAPI interface
  const convertedResult: StableValueTokensAPI = {
    totalStableValueInUSD: result.total_supply_usd,
    tokens: result.stablecoins.map((stablecoin: ExternalStablecoin) => ({
      symbol: stablecoin.symbol as TokenSymbol,
      name: stablecoin.name,
      units: Number(stablecoin.supply.amount),
      value: stablecoin.supply.usd_value,
      updated: Date.now(),
      hasError: false,
      iconUrl: stablecoin.icon_url,
    })),
  };

  return {
    ...convertedResult,
    tokens: convertedResult.tokens.sort((a, b) => b.value - a.value),
  };
}

async function getReserveComposition(): Promise<ReserveCompositionAPI> {
  const analyticsUrl = getAnalyticsUrl("reserveComposition");
  if (!analyticsUrl) {
    throw new Error(
      "Analytics API URL for reserve composition could not be constructed.",
    );
  }

  const response = await fetch(analyticsUrl, {
    cache: "no-store", // Fetches fresh data on every request
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `Reserve Composition Analytics API request failed: ${response.status} ${response.statusText}`,
      errorBody,
    );
    throw new Error(
      `Reserve Composition Analytics API request failed with status ${response.status} ${response.statusText}`,
    );
  }

  const result: ExternalCompositionResponse = await response.json();

  // Convert the result to the ReserveCompositionAPI interface
  // Filter out assets with zero percentage
  const convertedResult: ReserveCompositionAPI = result.composition
    .filter((item) => item.percentage > 0)
    .map((item) => ({
      symbol: item.symbol as ReserveAssetSymbol,
      percent: item.percentage,
    }));

  return convertedResult;
}

async function getReserveHoldings(): Promise<HoldingsApi> {
  const analyticsUrl = getAnalyticsUrl("reserveHoldings");
  if (!analyticsUrl) {
    throw new Error(
      "Analytics API URL for reserve holdings could not be constructed.",
    );
  }

  const response = await fetch(analyticsUrl, {
    cache: "no-store", // Fetches fresh data on every request
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `Reserve Holdings Analytics API request failed: ${response.status} ${response.statusText}`,
      errorBody,
    );
    throw new Error(
      `Reserve Holdings Analytics API request failed with status ${response.status} ${response.statusText}`,
    );
  }

  const result: ExternalAnalyticsApiResponse = await response.json();

  // Convert the result to the HoldingsApi interface
  const celoAsset = result.assets.find((a) => a.symbol === "CELO");
  const convertedResult: HoldingsApi = {
    celo: {
      unfrozen: {
        symbol: "CELO",
        units: Number(celoAsset?.totalBalance || 0),
        value: celoAsset?.usdValue || 0,
        updated: Date.now(),
      },
      frozen: {
        // Assuming frozen and custody are not directly in this API response, default to 0
        symbol: "CELO",
        units: 0,
        value: 0,
        updated: Date.now(),
      },
      custody: {
        symbol: "CELO",
        units: 0,
        value: 0,
        updated: Date.now(),
      },
    },
    totalReserveValue: result.total_holdings_usd,
    otherAssets: result.assets
      .filter((asset) => asset.symbol !== "CELO")
      .filter((asset) => Number(asset.totalBalance) > 0 || asset.usdValue > 0)
      .map((asset) => ({
        symbol: asset.symbol as ReserveAssetSymbol,
        units: Number(asset.totalBalance),
        value: asset.usdValue,
        updated: Date.now(),
        iconUrl: asset.iconUrl,
      })),
  };

  return convertedResult;
}

async function getReserveAddresses(): Promise<ReserveAddressesResponse> {
  const analyticsUrl = getAnalyticsUrl("reserveAddresses");
  if (!analyticsUrl) {
    throw new Error(
      "Analytics API URL for reserve addresses could not be constructed.",
    );
  }

  const response = await fetch(analyticsUrl, {
    cache: "no-store", // Fetches fresh data on every request
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(
      `Reserve Addresses Analytics API request failed: ${response.status} ${response.statusText}`,
      errorBody,
    );
    throw new Error(
      `Reserve Addresses Analytics API request failed with status ${response.status} ${response.statusText}`,
    );
  }

  const result: ReserveAddressesResponse = await response.json();
  return result;
}

// Utility function to fetch all data needed for both routes
export async function getAllReserveData() {
  const [
    reserveStats,
    stableCoinStats,
    reserveComposition,
    reserveHoldings,
    reserveAddresses,
  ] = await Promise.all([
    getReserveStats(),
    getStableCoinStats(),
    getReserveComposition(),
    getReserveHoldings(),
    getReserveAddresses(),
  ]);

  return {
    reserveStats,
    stableCoinStats,
    reserveComposition,
    reserveHoldings,
    reserveAddresses,
  };
}
