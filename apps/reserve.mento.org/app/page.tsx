import { getAnalyticsUrl } from "@/app/lib/config/endpoints";
import { Content } from "./components/content";
import type {
  ReserveStats,
  StableValueTokensAPI,
  Tokens,
  ExternalCompositionResponse,
  ReserveCompositionAPI,
  ExternalAnalyticsApiResponse,
  HoldingsApi,
} from "@/app/lib/types";
import Image from "next/image";
import { env } from "@/env.mjs";

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
      `Analytics API request failed with status ${response.status}`,
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
      `Stablecoins Analytics API request failed with status ${response.status}`,
    );
  }

  // Assuming result has a 'total_supply_usd' and 'stablecoins' array
  const result = await response.json();

  // Convert the result to the StableValueTokensAPI interface
  const convertedResult: StableValueTokensAPI = {
    totalStableValueInUSD: result.total_supply_usd,
    tokens: result.stablecoins.map((stablecoin: ExternalStablecoin) => ({
      token: stablecoin.symbol as Tokens,
      name: stablecoin.name,
      units: Number(stablecoin.supply.amount),
      value: stablecoin.supply.usd_value,
      updated: Date.now(),
      hasError: false,
      iconUrl: stablecoin.icon_url,
    })),
  };

  return convertedResult;
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
      `Reserve Composition Analytics API request failed with status ${response.status}`,
    );
  }

  const result: ExternalCompositionResponse = await response.json();

  // Convert the result to the ReserveCompositionAPI interface
  const convertedResult: ReserveCompositionAPI = result.composition.map(
    (item) => ({
      token: item.symbol,
      percent: item.percentage,
    }),
  );

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
      `Reserve Holdings Analytics API request failed with status ${response.status}`,
    );
  }

  const result: ExternalAnalyticsApiResponse = await response.json();

  // Convert the result to the HoldingsApi interface
  const celoAsset = result.assets.find((a) => a.symbol === "CELO");
  const convertedResult: HoldingsApi = {
    celo: {
      unfrozen: {
        token: "CELO",
        units: Number(celoAsset?.totalBalance || 0),
        value: celoAsset?.usdValue || 0,
        updated: Date.now(),
      },
      frozen: {
        // Assuming frozen and custody are not directly in this API response, default to 0
        token: "CELO",
        units: 0,
        value: 0,
        updated: Date.now(),
      },
      custody: {
        token: "CELO",
        units: 0,
        value: 0,
        updated: Date.now(),
      },
    },
    totalReserveValue: result.total_holdings_usd,
    otherAssets: result.assets
      .filter((asset) => asset.symbol !== "CELO")
      .map((asset) => ({
        token: asset.symbol as Tokens, // Type assertion, ensure all symbols are covered by Tokens or extend Tokens
        units: Number(asset.totalBalance),
        value: asset.usdValue,
        updated: Date.now(),
        // iconUrl would need to be sourced if required, not present in ExternalAnalyticsApiResponse
      })),
  };

  return convertedResult;
}

export default async function Home() {
  const reserveStats = await getReserveStats();
  const stableCoinStats = await getStableCoinStats();
  const reserveComposition = await getReserveComposition();
  const reserveHoldings = await getReserveHoldings();

  const collateralizationRatio = reserveStats.collateralization_ratio;
  const totalSupply = reserveStats.total_outstanding_stables_usd;
  const reserveHoldingsValue = reserveStats.total_reserve_value_usd;

  return (
    <main className="relative w-full pb-4">
      <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/hero-mobile-Miv9NJifq4Bv1yI7nLERCxpEAc52Du.png`}
        alt="Mento Reserve"
        width={320}
        height={168}
        className="w-full md:hidden"
      />
      {/* <Image
        src={`${env.NEXT_PUBLIC_STORAGE_URL}/hero-c7xKGtRaVn3xkLRWh1ErDf3brBXZWG.png`}
        alt="Mento Reserve"
        width={1280}
        height={640}
        className="absolute left-0 top-0 -z-10 hidden max-h-[660px] w-full object-cover md:block"
      /> */}
      <section className="mb-20 max-w-xl px-4 md:p-20">
        <h1 className="text-3xl font-medium md:text-5xl">Mento Reserve</h1>
        <p className="text-muted-foreground mt-2">
          A diversified portfolio of crypto assets supporting the ability of the
          Mento Platform to expand and contract the supply of Mento stablecoins.
        </p>
        <div className="mt-16">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              Collateralization ratio
            </span>
            <span>{collateralizationRatio.toFixed(2)}</span>
          </div>
          <hr className="bg-border my-2.5 h-px" />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total Supply</span>
            <span>${totalSupply.toLocaleString()}</span>
          </div>
          <hr className="bg-border my-2.5 h-px" />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Reserve Holdings</span>
            <span>${reserveHoldingsValue.toLocaleString()}</span>
          </div>
        </div>
      </section>
      <section className="bg-background px-4 md:px-20">
        <Content
          stableCoinStats={stableCoinStats}
          reserveComposition={reserveComposition}
          reserveHoldings={reserveHoldings}
        />
      </section>
    </main>
  );
}
