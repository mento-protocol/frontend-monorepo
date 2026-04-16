import { getAnalyticsUrl } from "@/lib/config/endpoints";
import type {
  V2OverviewResponse,
  V2StablecoinsResponse,
  V2ReserveResponse,
  V2AddressesResponse,
  ReservePageData,
} from "@/lib/types";

async function fetchApi<T>(
  endpoint: Parameters<typeof getAnalyticsUrl>[0],
): Promise<T> {
  const url = getAnalyticsUrl(endpoint);
  if (!url) {
    throw new Error(
      `Analytics API URL for ${endpoint} could not be constructed.`,
    );
  }

  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    const body = await response.text();
    console.error(`API ${endpoint} failed: ${response.status}`, body);
    throw new Error(`API ${endpoint} failed with status ${response.status}`);
  }

  return response.json();
}

export async function getAllReserveData(): Promise<ReservePageData> {
  const [overview, stablecoins, reserve, addresses] = await Promise.all([
    fetchApi<V2OverviewResponse>("overview"),
    fetchApi<V2StablecoinsResponse>("stablecoins"),
    fetchApi<V2ReserveResponse>("reserve"),
    fetchApi<V2AddressesResponse>("addresses"),
  ]);

  return { overview, stablecoins, reserve, addresses };
}
