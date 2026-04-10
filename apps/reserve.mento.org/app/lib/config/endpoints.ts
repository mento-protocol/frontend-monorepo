const API_ENDPOINTS = {
  analytics: {
    base: (() => {
      const url = process.env.NEXT_PUBLIC_ANALYTICS_API_URL;
      if (!url) {
        console.error(
          "NEXT_PUBLIC_ANALYTICS_API_URL environment variable is not set",
        );
        return "";
      }
      return url;
    })(),
    paths: {
      overview: "/api/v2/overview",
      stablecoins: "/api/v2/stablecoins",
      reserve: "/api/v2/reserve",
      addresses: "/api/v2/addresses",
    },
  },
} as const;

export const getAnalyticsUrl = (
  path: keyof typeof API_ENDPOINTS.analytics.paths,
): string => {
  const baseUrl = API_ENDPOINTS.analytics.base;
  if (!baseUrl) {
    console.error("Analytics API base URL is not configured.");
    return "";
  }
  return `${baseUrl}${API_ENDPOINTS.analytics.paths[path]}`;
};
