import { env } from "@/env.mjs";
import { getAddress, isAddress } from "viem";

export type BlockchainExplorerSource = "blockscout" | "celoscan";

interface ContractSourceCodeItem {
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

// Blockscout API response for smart contracts
export interface BlockscoutSmartContractResponse {
  name: string;
  source_code: string;
  abi: string | unknown[];
  compiler_version: string;
  optimization_enabled: boolean;
  optimizations_runs: number;
  evm_version: string;
  license_type: string;
  proxy_type: string | null;
  implementations: Array<{ name: string; address_hash: string }> | null;
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

      // Normalize address - Blockscout prefers lowercase, Celoscan prefers checksummed
      let normalizedAddress: string;
      if (source === "blockscout") {
        // Blockscout API works better with lowercase addresses
        normalizedAddress = address.toLowerCase();
      } else {
        // Celoscan/Etherscan prefers checksummed addresses
        normalizedAddress = isAddress(address) ? getAddress(address) : address;
      }

      if (source === "blockscout") {
        // Blockscout doesn't require an API key
        const baseUrl = env.NEXT_PUBLIC_BLOCKSCOUT_API_URL;
        url = `${baseUrl}/smart-contracts/${normalizedAddress}`;
      } else {
        // Celoscan requires an API key - use Etherscan API (Celo chain ID: 42220)
        if (!apiKey) throw new Error("API key is required for Celoscan");
        url = `${env.NEXT_PUBLIC_ETHERSCAN_API_URL}?chainid=42220&module=contract&action=${endpoint}&address=${normalizedAddress}&apikey=${apiKey}`;
      }

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "MentoGovernance/1.0",
        },
        redirect: "follow", // Explicitly follow redirects
      });

      // Debug logging for Blockscout errors
      if (source === "blockscout" && !response.ok) {
        console.log(`Blockscout API call failed: ${url}`);
        console.log(
          `Response status: ${response.status} ${response.statusText}`,
        );
      }

      if (response.ok) {
        const data = await response.json();

        // Handle Blockscout API response
        if (source === "blockscout") {
          // For getabi, return the response directly (it has abi field)
          if (endpoint === "getabi") {
            if (data.abi && Array.isArray(data.abi)) {
              // Cache the successful response
              responseCache.set(cacheKey, { data, timestamp: Date.now() });
              return data as T;
            } else {
              // Contract not found/verified
              console.log(
                `Contract not found/verified on Blockscout: ${normalizedAddress} (${data.message || "no message"})`,
              );
            }
          }
          // For getsourcecode, return response directly
          else if (endpoint === "getsourcecode") {
            const blockscoutResponse = data as BlockscoutSmartContractResponse;
            if (
              blockscoutResponse.name &&
              blockscoutResponse.source_code !== undefined
            ) {
              // Cache and return response directly
              responseCache.set(cacheKey, {
                data: blockscoutResponse,
                timestamp: Date.now(),
              });
              return blockscoutResponse as T;
            } else {
              // Contract not found/verified
              console.log(
                `Contract not found/verified on Blockscout: ${normalizedAddress} (${data.message || "no message"})`,
              );
            }
          }
        }
        // Handle Celoscan API responses (Etherscan-compatible format)
        else if (data.status === "1" && data.result) {
          // Cache the successful response
          responseCache.set(cacheKey, { data, timestamp: Date.now() });
          return data as T;
        } else {
          // Log when contracts are not found/verified (expected behavior)
          // Blockscout returns status "0" with various messages like "Contract source code not verified"
          // Celoscan returns status "0" with message "NOTOK"
          if (data.status === "0" || data.status === 0) {
            console.log(
              `Contract not found/verified on ${source}: ${normalizedAddress} (${data.message || "no message"})`,
            );
          } else {
            // Log actual errors
            console.warn(`API returned error status`, {
              endpoint,
              source,
              address: normalizedAddress,
              status: data.status,
              message: data.message || "Unknown error",
            });
          }
        }
      } else {
        // For Blockscout, check if it's a 400 that might actually be a "not found"
        if (source === "blockscout") {
          // Try to parse the response body even for 400 errors
          const errorText = await response.text().catch(() => "");
          try {
            const errorData = JSON.parse(errorText);
            // If it's a valid JSON response with status "0", treat it as "not found"
            if (errorData.status === "0" || errorData.status === 0) {
              console.log(
                `Contract not found/verified on Blockscout: ${normalizedAddress} (${errorData.message || "no message"})`,
              );
            } else {
              // Log unexpected Blockscout errors
              console.warn(`Blockscout API error`, {
                endpoint,
                address: normalizedAddress,
                status: response.status,
                errorData,
              });
            }
          } catch {
            // If response isn't JSON, log it as an error
            console.warn(`Blockscout API returned non-JSON error`, {
              endpoint,
              address: normalizedAddress,
              status: response.status,
              errorText: errorText.substring(0, 200),
            });
          }
        } else {
          // Log other HTTP errors
          const errorText = await response.text().catch(() => "");
          console.warn(`API returned HTTP error`, {
            endpoint,
            source,
            address: normalizedAddress,
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText.substring(0, 200), // Limit error body length
          });
        }
      }
      return null;
    } catch (error) {
      // Safely log error without using user input in format string
      console.warn(`API request failed`, {
        endpoint,
        source,
        address,
        error,
      });
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
  // Blockscout API returns ABI directly in the response
  if (source === "blockscout") {
    const response = await fetchFromBlockchainExplorer<{ abi: unknown[] }>(
      "getabi",
      address,
      source,
      apiKey,
    );

    if (response?.abi && Array.isArray(response.abi)) {
      return response.abi;
    }

    return null;
  }

  // Celoscan/Etherscan API returns ABI as a JSON string in result field
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
      // Safely log error without using user input in format string
      console.warn("Failed to parse ABI", { address, error });
      return null;
    }
  }

  return null;
}
