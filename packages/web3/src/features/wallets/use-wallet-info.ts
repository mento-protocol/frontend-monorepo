"use client";

import { useAccount } from "wagmi";

export interface WalletInfo {
  address: string | undefined;
  connectorName: string | undefined;
  connectorId: string | undefined;
  connectorType: string | undefined;
  chainId: number | undefined;
  connectionStatus: string;
  isConnected: boolean;
}

/**
 * Hook to get wallet connection information.
 * This can be used to enrich error reports or analytics with wallet details.
 *
 * @returns WalletInfo object containing wallet connection details
 *
 * @example
 * ```tsx
 * const walletInfo = useWalletInfo();
 * // Use walletInfo.connectorName to get the wallet type (e.g., "MetaMask", "Rabby", "WalletConnect")
 * ```
 */
export function useWalletInfo(): WalletInfo {
  const { address, connector, isConnected, chainId, status } = useAccount();

  return {
    address,
    connectorName: connector?.name,
    connectorId: connector?.id,
    connectorType: connector?.type,
    chainId,
    connectionStatus: status,
    isConnected,
  };
}
