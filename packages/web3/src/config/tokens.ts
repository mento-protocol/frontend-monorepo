import {
  TokenSymbol,
  getTokenAddress as sdkGetTokenAddress,
  TOKEN_ADDRESSES_BY_CHAIN,
  findTokenBySymbol,
} from "@mento-protocol/mento-sdk";
import { Address } from "viem";
import { areAddressesEqual } from "../utils/addresses";
import { ChainId } from "./chains";

export interface Token {
  id: string;
  symbol: string; // The same as id for now
  name: string;
  decimals: number;
}

export interface TokenWithAddress {
  address: Address;
}

/**
 * Re-export TokenSymbol from SDK as TokenId for backwards compatibility
 * All token IDs are now managed by the SDK
 */
export { TokenSymbol };
export type TokenId = TokenSymbol;
export const TokenId = TokenSymbol;

/**
 * Known USDC variant token IDs
 */
export const USDCVariantIds = ["axlUSDC"] as const;

/**
 * Gets all available token IDs from the SDK for a given chain
 * Uses SDK's TOKEN_ADDRESSES_BY_CHAIN as the source of truth
 *
 * @example
 * ```ts
 * const tokenIds = getAvailableTokenIds(chainId);
 * ```
 */
export function getAvailableTokenIds(chainId: ChainId): string[] {
  return Object.keys(TOKEN_ADDRESSES_BY_CHAIN[chainId] || {});
}

/**
 * Legacy Tokens object - kept for backward compatibility
 * @deprecated Use findTokenBySymbol from SDK or getTokenById instead
 */
export const Tokens: Partial<Record<TokenSymbol, Token>> = {};

export async function isSwappable(
  token1: string,
  token2: string,
  chainId: number,
) {
  // Exit early if the same token was passed in two times
  if (token1 === token2) return false;

  const { getMentoSdk } = await import("@/features/sdk");
  const sdk = await getMentoSdk(chainId);
  const tradablePairs = await sdk.getTradablePairs();
  if (!tradablePairs) return false;

  const token1Address = getTokenAddress(token1, chainId);
  const token2Address = getTokenAddress(token2, chainId);

  return tradablePairs.some(
    (pair) =>
      pair.find((asset) => asset.address === token1Address) &&
      pair.find((asset) => asset.address === token2Address),
  );
}

export async function getSwappableTokenOptions(
  inputTokenId: string,
  chainId: ChainId,
): Promise<string[]> {
  // Get all available tokens for the chain except the input token
  const tokenOptions = getTokenOptionsByChainId(chainId).filter(
    (tokenId) => tokenId !== inputTokenId,
  );

  // Check swappability in parallel and maintain order
  const swappableTokens = await Promise.all(
    tokenOptions.map(async (tokenId) => {
      const swappable = await isSwappable(tokenId, inputTokenId, chainId);
      return swappable ? tokenId : null;
    }),
  );

  // Filter out non-swappable tokens (null values)
  return swappableTokens.filter(
    (tokenId): tokenId is string => tokenId !== null,
  );
}

/**
 * Gets all available token IDs for a specific chain
 * Directly uses SDK's TOKEN_ADDRESSES_BY_CHAIN
 */
export function getTokenOptionsByChainId(chainId: ChainId): string[] {
  return Object.keys(TOKEN_ADDRESSES_BY_CHAIN[chainId] || {});
}

/**
 * Gets a token by ID using SDK's findTokenBySymbol
 * Returns null if token doesn't exist
 * Accepts any string token ID - validates against SDK data at runtime
 */
export function getTokenById(id: string, chainId?: ChainId): Token | null {
  if (!chainId) return null;

  const sdkToken = findTokenBySymbol(id, chainId);
  if (!sdkToken) return null;

  return {
    id,
    symbol: sdkToken.symbol,
    name: sdkToken.name,
    decimals: sdkToken.decimals,
  };
}

/**
 * Helper to get token decimals using SDK's findTokenBySymbol
 * Returns 18 as safe default if token not found (most ERC20 tokens use 18 decimals)
 * Accepts any string token ID - validates against SDK data at runtime
 */
export function getTokenDecimals(id: string, chainId?: ChainId): number {
  if (!chainId) return 18;

  const sdkToken = findTokenBySymbol(id, chainId);
  return sdkToken?.decimals ?? 18;
}

/**
 * Gets the address for a token ID from the SDK
 * Wraps the SDK's getTokenAddress function with consistent error handling
 * Accepts any string token ID - validates against SDK data at runtime
 * Throws if token not found in SDK cache for the given chain
 */
export function getTokenAddress(id: string, chainId: ChainId): Address {
  const addr = sdkGetTokenAddress(id as TokenSymbol, chainId);
  if (!addr) {
    const availableTokens = TOKEN_ADDRESSES_BY_CHAIN[chainId];
    throw new Error(
      `No address found for token ${id} on chain ${chainId}. Available tokens: ${Object.keys(availableTokens || {}).join(", ")}`,
    );
  }
  return addr as Address;
}

/**
 * Gets a token by its address (reverse lookup)
 * Uses SDK's TOKEN_ADDRESSES_BY_CHAIN for the lookup
 */
export function getTokenByAddress(
  address: Address,
  chainId: ChainId,
): Token | null {
  const tokenAddresses = TOKEN_ADDRESSES_BY_CHAIN[chainId];
  if (!tokenAddresses) return null;

  for (const [symbol, tokenAddr] of Object.entries(tokenAddresses)) {
    if (tokenAddr && areAddressesEqual(address, tokenAddr as Address)) {
      return getTokenById(symbol, chainId);
    }
  }
  return null;
}

export const NativeTokenId = "CELO" as const;
