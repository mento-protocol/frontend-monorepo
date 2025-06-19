import type { Network } from "@/app/lib/types";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { getAnalyticsUrl } from "@/app/lib/config/endpoints";

interface AnalyticsApiResponse {
  addresses: {
    network: string;
    category: string;
    addresses: {
      address: string;
      label: string;
    }[];
  }[];
}

interface TransformedAddress {
  label: string;
  addresses: Array<{
    address: string;
    network: Network;
    category: string;
  }>;
}

interface ErrorWithStatusCode extends Error {
  statusCode?: number;
}

// Opt out of caching for this dynamic route
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const analyticsUrl = getAnalyticsUrl("reserveAddresses");
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

    const transformedAddresses: Record<string, TransformedAddress> = {};

    for (const group of result.addresses) {
      const displayName = `${group.category} on ${group.network.charAt(0).toUpperCase() + group.network.slice(1)}`;

      if (!transformedAddresses[displayName]) {
        transformedAddresses[displayName] = {
          label: displayName,
          addresses: [],
        };
      }

      for (const addr of group.addresses) {
        const network = group.network.toLowerCase() as Network;
        if (
          !transformedAddresses[displayName].addresses.some(
            (a) => a.address === addr.address,
          )
        ) {
          transformedAddresses[displayName].addresses.push({
            address: addr.address,
            network,
            category: group.category,
          });
        }
      }
    }

    const headers = new Headers();
    headers.set("Server-Timing", `ms;dur=${Date.now() - start}`);

    return NextResponse.json(transformedAddresses, { headers });
  } catch (error: unknown) {
    console.error("Error in /api/reserve-addresses:", error);
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
