"use client";

import * as Sentry from "@sentry/nextjs";
import { useWalletInfo } from "@repo/web3";
import { useEffect } from "react";

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
      // Set user context with wallet address
      Sentry.setUser({
        id: walletInfo.address,
        username: walletInfo.address,
      });

      // Set wallet-specific context
      Sentry.setContext("wallet", {
        address: walletInfo.address,
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
