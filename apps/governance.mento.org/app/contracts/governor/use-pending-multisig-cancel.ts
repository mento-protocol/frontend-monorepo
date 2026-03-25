import { useQuery } from "@tanstack/react-query";
import { useChainId } from "@repo/web3/wagmi";
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

interface PendingMultisigCancellationResult {
  hasPendingCancellation: boolean;
  signaturesCollected: number;
  signaturesRequired: number;
  nonce: number | undefined;
  isStatusUnavailable: boolean;
  isLoading: boolean;
}

const SAFE_POLLING_ERROR_NAME = "SafePollingError";
const SAFE_POLLING_ERROR_REPORT_INTERVAL_MS = 5 * 60 * 1000;
const lastSafePollingReportAt = new Map<string, number>();

function reportSafePollingError(
  error: Error,
  context: {
    chainId: number;
    watchdogAddress: string;
    operationId: `0x${string}`;
    safeServiceUrl: string;
    status?: number;
  },
) {
  const reportKey = [
    context.chainId,
    context.watchdogAddress,
    context.operationId,
    context.status ?? "network",
  ].join(":");
  const now = Date.now();
  const lastReportedAt = lastSafePollingReportAt.get(reportKey) ?? 0;

  if (now - lastReportedAt < SAFE_POLLING_ERROR_REPORT_INTERVAL_MS) {
    return;
  }

  lastSafePollingReportAt.set(reportKey, now);

  Sentry.captureException(error, {
    tags: {
      context: "pending-safe-cancellation",
      chainId: String(context.chainId),
      watchdogAddress: context.watchdogAddress,
    },
    extra: {
      operationId: context.operationId,
      safeServiceUrl: context.safeServiceUrl,
      status: context.status,
    },
  });
}

/**
 * Hook to check if there's a pending Safe transaction to cancel a specific proposal.
 * Queries the Safe Transaction Service API to find pending cancel transactions.
 */
export const usePendingMultisigCancellation = (
  operationId: `0x${string}`,
  enabled = true,
): PendingMultisigCancellationResult => {
  const chainId = useChainId();
  const contracts = useContracts();
  const watchdogAddress = getWatchdogMultisigAddress(chainId);

  // Encode the cancel function call to match against pending transactions
  const cancelCalldata = encodeFunctionData({
    abi: TimelockControllerABI,
    functionName: "cancel",
    args: [operationId],
  });

  const { data, isError, isLoading } = useQuery({
    queryKey: ["pending-safe-cancel", watchdogAddress, chainId, operationId],
    enabled,
    queryFn: async () => {
      // Get the Safe Transaction Service API URL based on chain
      const safeServiceUrl = getSafeServiceUrl(chainId);

      try {
        // Fetch pending transactions from the Safe
        const response = await fetch(
          `${safeServiceUrl}/api/v1/safes/${watchdogAddress}/multisig-transactions/?executed=false&limit=100`,
        );

        if (!response.ok) {
          const error = new Error(
            `Failed to fetch Safe transactions: ${response.status}`,
          );
          error.name = SAFE_POLLING_ERROR_NAME;

          console.warn(error.message, {
            context: "pending-safe-cancellation",
            chainId,
            watchdogAddress,
          });
          reportSafePollingError(error, {
            chainId,
            watchdogAddress,
            operationId,
            safeServiceUrl,
            status: response.status,
          });
          throw error;
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
        const normalizedError =
          error instanceof Error
            ? error
            : new Error("Error fetching Safe transactions");

        console.error("Error fetching Safe transactions:", normalizedError);
        if (normalizedError.name !== SAFE_POLLING_ERROR_NAME) {
          reportSafePollingError(normalizedError, {
            chainId,
            watchdogAddress,
            operationId,
            safeServiceUrl,
          });
        }
        throw normalizedError;
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
    isStatusUnavailable: isError && !data,
    isLoading,
  };
};
