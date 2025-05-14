import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getAnalyticsUrl } from "@/app/lib/config/endpoints";

interface CompositionResponse {
  composition: {
    symbol: string;
    percentage: number;
    usd_value: number;
  }[];
}

interface SliceData {
  token: string;
  percent: number;
}

// Opt out of caching for this dynamic route
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const analyticsUrl = getAnalyticsUrl("reserveComposition");
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

    const result: CompositionResponse = await response.json();

    const slices: SliceData[] = result.composition.map((item) => ({
      token: item.symbol,
      percent: item.percentage,
    }));

    const headers = new Headers();
    headers.set("Server-Timing", `ms;dur=${Date.now() - start}`);

    return NextResponse.json(slices, { headers });
  } catch (error: any) {
    console.error("Error in /api/reserve-composition:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { message: error.message || "Unknown server error" },
      { status: error.statusCode || 500 },
    );
  }
}
