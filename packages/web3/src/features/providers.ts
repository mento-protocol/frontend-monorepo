import { providers } from "ethers";
import { ChainId, chainIdToChain } from "@/config/chains";

const cache: Record<number, providers.JsonRpcProvider> = {};

export function getProvider(chainId: ChainId): providers.JsonRpcProvider {
  if (cache[chainId]) return cache[chainId];
  const chain = chainIdToChain[chainId];
  if (!chain) {
    throw new Error(`Unknown chainId: ${chainId}`);
  }
  const provider = new providers.JsonRpcProvider(chain.rpcUrl, chainId);
  cache[chainId] = provider;
  return provider;
}
