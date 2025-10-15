const API_ENDPOINTS = {
  analytics: {
    base: (() => {
      const url = process.env.NEXT_PUBLIC_ANALYTICS_API_URL;
      if (!url) {
        // In a real app, consider returning a sensible default or handling this more gracefully
        console.error(
          "NEXT_PUBLIC_ANALYTICS_API_URL environment variable is not set",
        );
        // Returning a placeholder or throwing might be appropriate depending on context
        // For now, let's return an empty string to avoid crashing the build/app immediately
        return "";
      }
      return url;
    })(),
    paths: {
      reserveAddresses: "/api/v1/reserve/addresses",
      stablecoins: "/api/v1/stablecoins",
      reserveComposition: "/api/v1/reserve/composition",
      reserveHoldings: "/api/v1/reserve/holdings/grouped",
      reserveStats: "/api/v1/reserve/stats",
    },
  },
} as const;

export const getAnalyticsUrl = (
  path: keyof typeof API_ENDPOINTS.analytics.paths,
): string => {
  const baseUrl = API_ENDPOINTS.analytics.base;
  if (!baseUrl) {
    // Handle the case where the base URL might be missing (e.g., env var not set)
    console.error("Analytics API base URL is not configured.");
    return ""; // Or throw an error, or return a default path
  }
  return `${baseUrl}${API_ENDPOINTS.analytics.paths[path]}`;
};
