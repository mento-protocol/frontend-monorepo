"use client";

import * as Sentry from "@sentry/nextjs";
import { useWalletInfo } from "@repo/web3";
import { useEffect } from "react";
import { keccak256, stringToHex } from "viem";

/**
 * Derives a stable pseudonymous Sentry user id from a wallet address, so events
 * from one wallet can be grouped without sending the address itself.
 */
export const sentryUserId = (address: string) =>
  keccak256(stringToHex(`mento-sentry:${address.toLowerCase()}`)).slice(2, 18);

/**
 * Hook to automatically track wallet connection information in Sentry.
 * This enriches error reports with details about the user's wallet and connection state.
 *
 * Usage: Call this hook once at the root of your app (e.g., in providers.tsx)
 */
export function useSentryWalletContext() {
  const walletInfo = useWalletInfo();

  useEffect(() => {
    if (
      walletInfo.isConnected &&
      walletInfo.address &&
      walletInfo.connectorName
    ) {
      // Set a pseudonymous user id; the wallet address itself is not sent
      Sentry.setUser({ id: sentryUserId(walletInfo.address) });

      // Set wallet-specific context
      Sentry.setContext("wallet", {
        connector_name: walletInfo.connectorName,
        connector_id: walletInfo.connectorId,
        connector_type: walletInfo.connectorType,
        chain_id: walletInfo.chainId,
        connection_status: walletInfo.connectionStatus,
      });

      // Set tags for easier filtering in Sentry
      Sentry.setTag("wallet.type", walletInfo.connectorName);
      Sentry.setTag(
        "wallet.chain_id",
        walletInfo.chainId?.toString() || "unknown",
      );
    } else {
      // Clear user context when disconnected
      Sentry.setUser(null);
      Sentry.setContext("wallet", null);
      Sentry.setTag("wallet.type", "disconnected");
    }
  }, [walletInfo]);
}
