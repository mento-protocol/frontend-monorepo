import { ChainId, chainIdToChain } from "@/config/chains";
import {
  Mento,
  Route,
  TokenSymbol,
  getTokenAddress,
} from "@mento-protocol/mento-sdk";
import { createPublicClient, http } from "viem";

const cache: Record<number, Promise<Mento>> = {};
const publicClientCache: Record<
  number,
  ReturnType<typeof createPublicClient> | undefined
> = {};

export function getPublicClient(chainId: ChainId) {
  const cachedClient = publicClientCache[chainId];
  if (cachedClient) return cachedClient;

  const chain = chainIdToChain[chainId];
  const rpcUrl = chain?.rpcUrls?.default?.http?.[0];

  if (!chain || !rpcUrl) {
    throw new Error(
      `Unsupported chain or missing RPC URL for chain ${chainId}`,
    );
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  publicClientCache[chainId] = publicClient;
  return publicClient;
}

export async function getMentoSdk(chainId: ChainId): Promise<Mento> {
  if (cache[chainId]) return cache[chainId];

  const publicClient = getPublicClient(chainId);

  cache[chainId] = Mento.create(
    chainId,
    publicClient as Parameters<typeof Mento.create>[1],
  ).catch((error) => {
    delete cache[chainId];
    throw error;
  });

  return cache[chainId];
}

/**
 * Gets the tradable route for two tokens from the SDK
 * Accepts any string token IDs - validates against SDK data at runtime
 */
export async function getTradablePairForTokens(
  chainId: ChainId,
  tokenInSymbol: TokenSymbol,
  tokenOutSymbol: TokenSymbol,
): Promise<Route> {
  const sdk = await getMentoSdk(chainId);

  const tokenInAddr = getTokenAddress(chainId, tokenInSymbol);
  const tokenOutAddr = getTokenAddress(chainId, tokenOutSymbol);

  if (!tokenInAddr) {
    throw new Error(
      `${tokenInSymbol} token address not found on chain ${chainId}`,
    );
  }
  if (!tokenOutAddr) {
    throw new Error(
      `${tokenOutSymbol} token address not found on chain ${chainId}`,
    );
  }

  return await sdk.routes.findRoute(tokenInAddr, tokenOutAddr);
}
