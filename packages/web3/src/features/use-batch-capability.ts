"use client";

import { useCapabilities, useChainId } from "wagmi";

export function useBatchCapability() {
  const chainId = useChainId();
  const { data: capabilities } = useCapabilities();

  // Any wallet that responds to wallet_getCapabilities supports EIP-5792 and can handle
  // wallet_sendCalls. We don't gate on atomicBatch.supported because:
  // - MetaMask auto-enrolls smart accounts when wallet_sendCalls is called
  // - Rabby and others bundle calls even without advertising atomicBatch
  // Wallets that don't support EIP-5792 leave capabilities undefined (query fails).
  const supportsBatching =
    capabilities != null && capabilities[chainId] != null;

  return { supportsBatching };
}
