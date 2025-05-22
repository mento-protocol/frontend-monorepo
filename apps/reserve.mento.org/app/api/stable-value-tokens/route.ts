import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getAnalyticsUrl } from "@/app/lib/config/endpoints";
import type { Tokens, StableValueTokensAPI } from "@/app/lib/types";

// Opt out of caching for this dynamic route
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const analyticsUrl = getAnalyticsUrl("stablecoins");
    if (!analyticsUrl) {
      throw new Error("Analytics API URL could not be constructed.");
    }

    const response = await fetch(analyticsUrl, {
      cache: "no-store", // Fetches fresh data on every request to the external API
    });

    if (!response.ok) {
      // Log more details about the error response
      const errorBody = await response.text();
      console.error(
        `Analytics API request failed: ${response.status} ${response.statusText}`,
        errorBody,
      );
      throw new Error(
        `Analytics API request failed with status ${response.status}`,
      );
    }

    const result = await response.json();

    // Convert the result to the StableValueTokensAPI interface
    const convertedResult: StableValueTokensAPI = {
      totalStableValueInUSD: result.total_supply_usd,
      tokens: result.stablecoins.map((stablecoin) => ({
        token: stablecoin.symbol as Tokens,
        units: Number(stablecoin.supply.amount),
        value: stablecoin.supply.usd_value,
        updated: Date.now(),
        hasError: false,
        iconUrl: stablecoin.icon_url,
      })),
    };

    const headers = new Headers();
    headers.set("Server-Timing", `ms;dur=${Date.now() - start}`);

    return NextResponse.json(convertedResult, { headers });
  } catch (error: any) {
    console.error("Error in /api/stable-value-tokens:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { message: error.message || "Unknown server error" },
      { status: error.statusCode || 500 },
    );
  }
}
