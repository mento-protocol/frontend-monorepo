import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type { HoldingsApi, Tokens } from "@/app/lib/types";
import { getAnalyticsUrl } from "@/app/lib/config/endpoints";

interface AnalyticsApiResponse {
  total_holdings_usd: number;
  assets: {
    symbol: string;
    totalBalance: string;
    usdValue: number;
  }[];
}

interface ErrorWithStatusCode extends Error {
  statusCode?: number;
}

// Opt out of caching for this dynamic route
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const analyticsUrl = getAnalyticsUrl("reserveHoldings");
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

    const result: AnalyticsApiResponse = await response.json();

    // Convert the result to the HoldingsApi interface
    const analyticsHoldings: HoldingsApi = {
      celo: {
        unfrozen: {
          token: "CELO",
          units: Number(
            result.assets.find((a) => a.symbol === "CELO")?.totalBalance || 0,
          ),
          value: result.assets.find((a) => a.symbol === "CELO")?.usdValue || 0,
          updated: Date.now(),
        },
        frozen: {
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
          token: asset.symbol as Tokens,
          units: Number(asset.totalBalance),
          value: asset.usdValue,
          updated: Date.now(),
        })),
    };

    const headers = new Headers();
    headers.set("Server-Timing", `ms;dur=${Date.now() - start}`);

    return NextResponse.json(analyticsHoldings, { headers });
  } catch (error: unknown) {
    console.error("Error in /api/reserve-holdings:", error);
    Sentry.captureException(error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown server error";
    const statusCode =
      error instanceof Error && "statusCode" in error
        ? ((error as ErrorWithStatusCode).statusCode ?? 500)
        : 500;
    return NextResponse.json({ message: errorMessage }, { status: statusCode });
  }
}
