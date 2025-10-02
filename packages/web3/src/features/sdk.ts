import { ChainId } from "@/config/chains";
import { getTokenAddress } from "@/config/tokens";
import { getProvider } from "@/features/providers";
import { Mento, TradablePair } from "@mento-protocol/mento-sdk";

const cache: Record<number, Mento> = {};

export async function getMentoSdk(chainId: ChainId): Promise<Mento> {
  if (cache[chainId]) return cache[chainId];

  const provider = getProvider(chainId);
  const mento = await Mento.create(provider);
  cache[chainId] = mento;
  return mento;
}

/**
 * Gets the tradable pair for two tokens from the SDK
 * Accepts any string token IDs - validates against SDK data at runtime
 */
export async function getTradablePairForTokens(
  chainId: ChainId,
  tokenInId: string,
  tokenOutId: string,
): Promise<TradablePair> {
  const sdk = await getMentoSdk(chainId);
  const tokenInAddr = getTokenAddress(tokenInId, chainId);
  const tokenOutAddr = getTokenAddress(tokenOutId, chainId);
  return await sdk.findPairForTokens(tokenInAddr, tokenOutAddr);
}
