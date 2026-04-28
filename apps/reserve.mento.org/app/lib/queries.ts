import { getAnalyticsUrl } from "@/lib/config/endpoints";
import type {
  V2OverviewResponse,
  V2StablecoinsResponse,
  V2ReserveResponse,
  V2AddressesResponse,
} from "@/lib/types";

export type V2Endpoint = "overview" | "stablecoins" | "reserve" | "addresses";

export interface V2ResponseByEndpoint {
  overview: V2OverviewResponse;
  stablecoins: V2StablecoinsResponse;
  reserve: V2ReserveResponse;
  addresses: V2AddressesResponse;
}

export const V2_ENDPOINTS: V2Endpoint[] = [
  "overview",
  "stablecoins",
  "reserve",
  "addresses",
];

// Query keys are plain tuples so both server prefetch and client useQuery
// share cache entries without a factory object.
export const v2QueryKey = (endpoint: V2Endpoint) => ["v2", endpoint] as const;

export async function fetchV2<E extends V2Endpoint>(
  endpoint: E,
): Promise<V2ResponseByEndpoint[E]> {
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

export enum TabType {
  overview = "overview",
  stablecoins = "stablecoins",
  collateral = "collateral",
  positions = "positions",
  addresses = "addresses",
}

// Which endpoints each tab needs to render. Drives server-side eager
// prefetch and the subsequent client-side background prefetch.
export const TAB_ENDPOINTS: Record<TabType, V2Endpoint[]> = {
  [TabType.overview]: ["overview"],
  [TabType.stablecoins]: ["stablecoins"],
  [TabType.collateral]: ["reserve"],
  [TabType.positions]: ["reserve", "stablecoins"],
  [TabType.addresses]: ["addresses"],
};

// Legacy ?tab= values from the old separate pages.
const LEGACY_TAB_ALIASES: Record<string, TabType> = {
  "stablecoin-supply": TabType.stablecoins,
  "reserve-holdings": TabType.collateral,
  "reserve-addresses": TabType.addresses,
};

export function resolveTab(raw: string | string[] | null | undefined): TabType {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return TabType.overview;
  const normalized = LEGACY_TAB_ALIASES[value] ?? value;
  return Object.values(TabType).includes(normalized as TabType)
    ? (normalized as TabType)
    : TabType.overview;
}
