import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getAnalyticsUrl } from "@/app/lib/config/endpoints"; // Assuming tsconfig paths alias @/ is set up for app dir

interface ReserveTotalsResponse {
  collateralization_ratio: number;
  total_reserve_value_usd: number;
  total_outstanding_stables_usd: number;
}

// Opt out of caching for this dynamic route
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const analyticsUrl = getAnalyticsUrl("reserveStats");
    if (!analyticsUrl) {
      throw new Error("Analytics API URL could not be constructed.");
    }

    const response = await fetch(analyticsUrl, {
      // Consider caching strategy for the external API call if appropriate
      // next: { revalidate: 60 }, // Example: Revalidate every 60 seconds
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

    const result: ReserveTotalsResponse = await response.json();

    const headers = new Headers();
    headers.set("Server-Timing", `ms;dur=${Date.now() - start}`);
    // Add CORS headers if needed, though typically API routes are same-origin
    // headers.set('Access-Control-Allow-Origin', '*');

    return NextResponse.json(result, { headers });
  } catch (error: any) {
    console.error("Error in /api/reserve-stats:", error);
    Sentry.captureException(error);
    return NextResponse.json(
      { message: error.message || "Unknown server error" },
      { status: error.statusCode || 500 },
    );
  }
}
