import { env } from "../../../env.mjs";

export type BlockchainExplorerSource = "blockscout" | "celoscan";

export interface ContractSourceCodeItem {
  ContractName: string;
  SourceCode: string;
  ABI: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  ConstructorArguments: string;
  EVMVersion: string;
  Library: string;
  LicenseType: string;
  Proxy: string;
  Implementation: string;
  SwarmSource: string;
}

export interface ContractSourceCodeResponse {
  result: ContractSourceCodeItem[];
}

// In-memory cache for all blockchain explorer API responses
const responseCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Rate limiting for blockchain explorer API calls
const apiCallTimes: number[] = [];
const MAX_CALLS_PER_SECOND = 4; // Leave buffer below 5/sec limit

// Pending requests to prevent duplicate concurrent requests
const pendingRequests = new Map<string, Promise<unknown>>();

/**
 * Rate limiting helper for external API calls
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const oneSecondAgo = now - 1000;

  // Remove calls older than 1 second
  while (apiCallTimes.length > 0 && apiCallTimes[0]! < oneSecondAgo) {
    apiCallTimes.shift();
  }

  // If we're at the limit, wait
  if (apiCallTimes.length >= MAX_CALLS_PER_SECOND) {
    const firstCallTime = apiCallTimes[0];
    if (firstCallTime !== undefined) {
      const waitTime = 1000 - (now - firstCallTime);
      if (waitTime > 0) {
        console.log(`Rate limiting: waiting ${waitTime}ms before API call`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  // Record this call
  apiCallTimes.push(now);
}

/**
 * Generic function to fetch data from external APIs with caching and rate limiting
 */
export async function fetchFromBlockchainExplorer<T>(
  endpoint: string,
  address: string,
  source: BlockchainExplorerSource,
  apiKey?: string,
): Promise<T | null> {
  const cacheKey = `${endpoint}:${address}:${source}`;

  // Check cache first
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`Returning cached response for ${cacheKey}`);
    return cached.data as T;
  }

  // Check if there's already a pending request for this cache key
  const pendingRequest = pendingRequests.get(cacheKey);
  if (pendingRequest) {
    console.log(`Waiting for pending request for ${cacheKey}`);
    return pendingRequest as Promise<T>;
  }

  // Create the request promise
  const requestPromise = (async () => {
    try {
      // Apply rate limiting before making external API calls
      await waitForRateLimit();

      let url: string;

      if (source === "blockscout") {
        // Blockscout doesn't require an API key
        url = `${env.NEXT_PUBLIC_BLOCKSCOUT_API_URL}?module=contract&action=${endpoint}&address=${address}`;
      } else {
        // Celoscan requires an API key - use Etherscan V2 API (Celo chain ID: 42220)
        if (!apiKey) throw new Error("API key is required for Celoscan");
        url = `${env.NEXT_PUBLIC_ETHERSCAN_API_URL}?chainid=42220&module=contract&action=${endpoint}&address=${address}&apikey=${apiKey}`;
      }

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "MentoGovernance/1.0",
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === "1" && data.result) {
          // Cache the successful response
          responseCache.set(cacheKey, { data, timestamp: Date.now() });
          return data as T;
        } else {
          console.warn(
            `/${endpoint}: ${source} API returned status ${data.status}: ${data.message || "Unknown error"}`,
          );
        }
      } else {
        console.warn(
          `/${endpoint}: ${source} API returned ${response.status}: ${response.statusText}`,
        );
      }
      return null;
    } catch (error) {
      console.warn(
        `/${endpoint}: ${source} API failed for address ${address}:`,
        error,
      );
      return null;
    } finally {
      // Clean up pending request
      pendingRequests.delete(cacheKey);
    }
  })();

  // Store the pending request
  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

/**
 * Fetch ABI from external APIs
 */
export async function fetchAbi(
  address: string,
  source: BlockchainExplorerSource,
  apiKey?: string,
): Promise<unknown[] | null> {
  const response = await fetchFromBlockchainExplorer<{ result: string }>(
    "getabi",
    address,
    source,
    apiKey,
  );

  if (response?.result) {
    try {
      return JSON.parse(response.result);
    } catch (error) {
      console.warn(`Failed to parse ABI for ${address}:`, error);
      return null;
    }
  }

  return null;
}

/**
 * Clear cache (useful for testing or manual cache invalidation)
 */
export function clearCache(): void {
  responseCache.clear();
  pendingRequests.clear();
  apiCallTimes.length = 0;
}

/**
 * Get cache statistics (useful for monitoring)
 */
export function getCacheStats(): {
  cacheSize: number;
  pendingRequests: number;
  recentApiCalls: number;
} {
  const now = Date.now();
  const oneSecondAgo = now - 1000;
  const recentCalls = apiCallTimes.filter(
    (time) => time >= oneSecondAgo,
  ).length;

  return {
    cacheSize: responseCache.size,
    pendingRequests: pendingRequests.size,
    recentApiCalls: recentCalls,
  };
}
