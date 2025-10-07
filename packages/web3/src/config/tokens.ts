import {
  TOKEN_ADDRESSES_BY_CHAIN,
  Token,
  TokenSymbol,
  findTokenBySymbol,
  getTokenAddress,
} from "@mento-protocol/mento-sdk";
import { Address } from "viem";
import { areAddressesEqual } from "../utils/addresses";
import { ChainId } from "./chains";

export type TokenWithBalance = Token & {
  balance: string;
};

export async function isSwappable(
  token1: TokenSymbol,
  token2: TokenSymbol,
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
  if (!token1Address) {
    throw new Error(`${token1} token address not found on chain ${chainId}`);
  }
  if (!token2Address) {
    throw new Error(`${token2} token address not found on chain ${chainId}`);
  }

  return tradablePairs.some(
    (pair) =>
      pair.find((asset) => asset.address === token1Address) &&
      pair.find((asset) => asset.address === token2Address),
  );
}

export async function getSwappableTokenOptions(
  inputTokenSymbol: TokenSymbol,
  chainId: ChainId,
): Promise<TokenSymbol[]> {
  // Get all available tokens for the chain except the input token
  const tokenOptions = getTokenOptionsByChainId(chainId).filter(
    (tokenSymbol) => tokenSymbol !== inputTokenSymbol,
  );

  // Check swappability in parallel and maintain order
  const swappableTokens = await Promise.all(
    tokenOptions.map(async (tokenSymbol) => {
      const swappable = await isSwappable(
        tokenSymbol,
        inputTokenSymbol,
        chainId,
      );
      return swappable ? tokenSymbol : null;
    }),
  );

  // Filter out non-swappable tokens (null values)
  return swappableTokens.filter(
    (tokenSymbol): tokenSymbol is TokenSymbol => tokenSymbol !== null,
  );
}

/**
 * Gets all available token symbols for a specific chain
 * Directly uses SDK's TOKEN_ADDRESSES_BY_CHAIN
 */
export function getTokenOptionsByChainId(chainId: ChainId): TokenSymbol[] {
  return Object.keys(TOKEN_ADDRESSES_BY_CHAIN[chainId] || {}) as TokenSymbol[];
}

/**
 * Gets a token by symbol using SDK's findTokenBySymbol
 * Returns null if token doesn't exist
 * Accepts any string token ID - validates against SDK data at runtime
 */
export function getTokenBySymbol(
  symbol: TokenSymbol,
  chainId?: ChainId,
): Token | null {
  if (!chainId) return null;

  const token = findTokenBySymbol(symbol, chainId);
  if (!token) return null;

  return {
    address: token.address as Address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
  };
}

/**
 * Helper to get token decimals using SDK's findTokenBySymbol
 * Returns 18 as safe default if token not found (most ERC20 tokens use 18 decimals)
 * Accepts any string token ID - validates against SDK data at runtime
 */
export function getTokenDecimals(
  symbol: TokenSymbol,
  chainId?: ChainId,
): number {
  if (!chainId) return 18;

  const token = findTokenBySymbol(symbol, chainId);
  return token?.decimals ?? 18;
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

  for (const [symbol, tokenAddr] of Object.entries(tokenAddresses) as [
    TokenSymbol,
    Address,
  ][]) {
    if (tokenAddr && areAddressesEqual(address, tokenAddr as Address)) {
      return getTokenBySymbol(symbol, chainId);
    }
  }
  return null;
}

export const NativeTokenSymbol = "CELO" as const;
