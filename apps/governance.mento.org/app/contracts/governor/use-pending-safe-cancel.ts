import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { getWatchdogMultisigAddress, getSafeServiceUrl } from "@/config";
import { encodeFunctionData } from "viem";
import { TimelockControllerABI, useContracts } from "@repo/web3";
import * as Sentry from "@sentry/nextjs";

interface SafeTransaction {
  safe: string;
  to: string;
  value: string;
  data: string;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: number;
  executionDate: string | null;
  submissionDate: string;
  confirmations: Array<{
    owner: string;
    submissionDate: string;
    signature: string;
  }>;
  confirmationsRequired: number;
}

interface SafeTransactionsResponse {
  count: number;
  results: SafeTransaction[];
}

interface PendingSafeCancellationResult {
  hasPendingCancellation: boolean;
  signaturesCollected: number;
  signaturesRequired: number;
  nonce: number | undefined;
  isLoading: boolean;
}

/**
 * Hook to check if there's a pending Safe transaction to cancel a specific proposal.
 * Queries the Safe Transaction Service API to find pending cancel transactions.
 */
export const usePendingSafeCancellation = (
  operationId: `0x${string}`,
): PendingSafeCancellationResult => {
  const chainId = useChainId();
  const contracts = useContracts();
  const watchdogAddress = getWatchdogMultisigAddress(chainId);

  // Encode the cancel function call to match against pending transactions
  const cancelCalldata = encodeFunctionData({
    abi: TimelockControllerABI,
    functionName: "cancel",
    args: [operationId],
  });

  const { data, isLoading } = useQuery({
    queryKey: ["pending-safe-cancel", watchdogAddress, chainId, operationId],
    queryFn: async () => {
      try {
        // Get the Safe Transaction Service API URL based on chain
        const safeServiceUrl = getSafeServiceUrl(chainId);

        // Fetch pending transactions from the Safe
        const response = await fetch(
          `${safeServiceUrl}/api/v1/safes/${watchdogAddress}/multisig-transactions/?executed=false&limit=100`,
        );

        if (!response.ok) {
          const errorMessage = `Failed to fetch Safe transactions: ${response.status}`;
          console.error(errorMessage);
          Sentry.captureMessage(errorMessage, {
            level: "warning",
            tags: {
              context: "pending-safe-cancellation",
              chainId,
              watchdogAddress,
            },
          });
          return null;
        }

        const data: SafeTransactionsResponse = await response.json();

        // Find a pending transaction that matches our cancel operation
        const pendingCancelTx = data.results.find(
          (tx) =>
            tx.to.toLowerCase() ===
              contracts.TimelockController.address.toLowerCase() &&
            tx.data === cancelCalldata &&
            !tx.executionDate,
        );

        if (!pendingCancelTx) {
          return null;
        }

        return {
          safeTxHash: pendingCancelTx.nonce.toString(),
          signaturesCollected: pendingCancelTx.confirmations.length,
          signaturesRequired: pendingCancelTx.confirmationsRequired,
          nonce: pendingCancelTx.nonce,
        };
      } catch (error) {
        console.error("Error fetching Safe transactions:", error);
        Sentry.captureException(error, {
          tags: {
            context: "pending-safe-cancellation",
            chainId,
            watchdogAddress,
          },
        });
        return null;
      }
    },
    // Refetch every 3 seconds to keep signatures count updated
    refetchInterval: 3000,
    // Keep previous data while refetching
    placeholderData: (previousData) => previousData,
  });

  return {
    hasPendingCancellation: !!data,
    signaturesCollected: data?.signaturesCollected ?? 0,
    signaturesRequired: data?.signaturesRequired ?? 0,
    nonce: data?.nonce,
    isLoading,
  };
};
