import { ChainId, chainIdToChain } from "@/config/chains";
import {
  Mento,
  Route,
  TokenSymbol,
  getTokenAddress,
} from "@mento-protocol/mento-sdk";

const cache: Record<number, Mento> = {};

export async function getMentoSdk(chainId: ChainId): Promise<Mento> {
  if (cache[chainId]) return cache[chainId];

  const chain = chainIdToChain[chainId];
  const rpcUrl = chain?.rpcUrls?.default?.http?.[0];

  const mento = await Mento.create(chainId, rpcUrl);
  cache[chainId] = mento;
  return mento;
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
