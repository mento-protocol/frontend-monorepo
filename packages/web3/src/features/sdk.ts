import { ChainId } from "@/config/chains";
import { getProvider } from "@/features/providers";
import {
  Mento,
  TokenSymbol,
  TradablePair,
  getTokenAddress,
} from "@mento-protocol/mento-sdk";

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
  tokenInSymbol: TokenSymbol,
  tokenOutSymbol: TokenSymbol,
): Promise<TradablePair> {
  const sdk = await getMentoSdk(chainId);
  const tokenInAddr = getTokenAddress(tokenInSymbol, chainId);
  const tokenOutAddr = getTokenAddress(tokenOutSymbol, chainId);
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
  return await sdk.findPairForTokens(tokenInAddr, tokenOutAddr);
}
