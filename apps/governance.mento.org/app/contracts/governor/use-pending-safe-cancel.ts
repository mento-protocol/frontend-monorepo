import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { getWatchdogMultisigAddress } from "@/config";
import { encodeFunctionData } from "viem";
import { TimelockControllerABI, useContracts } from "@repo/web3";

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

/**
 * Hook to check if there's a pending Safe transaction to cancel a specific proposal.
 * Queries the Safe Transaction Service API to find pending cancel transactions.
 */
export const usePendingSafeCancellation = (operationId: `0x${string}`) => {
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
      // Determine the Safe Transaction Service API URL based on chain
      const safeServiceUrl =
        chainId === 42220
          ? "https://safe-transaction-celo.safe.global"
          : "https://safe-transaction-celo-testnet.safe.global";

      try {
        // Fetch pending transactions from the Safe
        const response = await fetch(
          `${safeServiceUrl}/api/v1/safes/${watchdogAddress}/multisig-transactions/?executed=false&limit=100`,
        );

        if (!response.ok) {
          console.warn("Failed to fetch Safe transactions:", response.status);
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
        return null;
      }
    },
    // Refetch every 10 seconds to keep signatures count updated
    refetchInterval: 10000,
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
