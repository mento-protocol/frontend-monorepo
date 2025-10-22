import { useCallback } from "react";
import { TimelockControllerABI, useContracts } from "@repo/web3";
import { encodeFunctionData } from "viem";
import {
  useAccount,
  useChainId,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { getWatchdogMultisigAddress } from "@/config";
import { toast } from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ProposalQueryKey } from "@/contracts/governor/use-proposal";
import * as Sentry from "@sentry/nextjs";

/**
 * Hook to cancel a queued proposal.
 *
 * Supports two modes:
 * 1. Connected AS the watchdog Safe (via WalletConnect) → executes transaction directly
 * 2. Connected as individual watchdog signer → downloads JSON file for Safe UI import
 */
export const useCancelProposal = (): {
  hash: `0x${string}` | undefined;
  cancelProposal: (
    operationId: `0x${string}`,
    onSuccess?: () => void,
    onError?: (error?: Error) => void,
  ) => void;
  isAwaitingUserSignature: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  error: Error | undefined;
} => {
  const queryClient = useQueryClient();
  const contracts = useContracts();
  const chainId = useChainId();
  const { address } = useAccount();
  const watchdogAddress = getWatchdogMultisigAddress(chainId);

  // Check if connected AS the Safe itself (via WalletConnect from Safe UI)
  const isConnectedAsSafe =
    address?.toLowerCase() === watchdogAddress.toLowerCase();

  // Direct transaction execution (when connected as Safe)
  const { writeContract, isPending, data, ...restWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: data });

  /**
   * Mode 1: Execute cancellation directly (when connected AS the Safe via WalletConnect)
   */
  const executeCancelDirectly = useCallback(
    (
      operationId: `0x${string}`,
      onSuccess?: () => void,
      onError?: (error?: Error) => void,
    ) => {
      // Open Safe UI immediately (before async transaction) to avoid popup blockers
      const safeUrl = `https://app.safe.global/home?safe=${chainId === 42220 ? "celo" : "celo-sepolia"}:${watchdogAddress}`;
      window.open(safeUrl, "_blank");

      writeContract(
        {
          address: contracts.TimelockController.address,
          abi: TimelockControllerABI,
          functionName: "cancel",
          args: [operationId],
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [ProposalQueryKey] });
            toast.success("Cancellation transaction submitted!", {
              description:
                "The proposal cancellation has been submitted to the watchdog multisig.",
            });
            onSuccess?.();
          },
          onError: (error) => {
            console.error("Failed to cancel proposal:", error);

            // Check if user rejected the transaction
            const errorMessage = error.message || "";
            const isUserRejection =
              errorMessage.includes("User rejected") ||
              errorMessage.includes("user rejected") ||
              errorMessage.includes("User denied");

            if (isUserRejection) {
              // User deliberately rejected - show clear message
              toast.error("Failed to cancel proposal", {
                description: "You rejected the transaction",
              });
            } else {
              // Unexpected error - send to Sentry and show generic error toast
              Sentry.captureException(error, {
                tags: {
                  context: "cancel-proposal",
                  mode: "direct-execution",
                },
              });
              toast.error("Failed to cancel proposal", {
                description:
                  "An error occurred while trying to cancel the proposal. Please try again.",
              });
            }
            onError?.(error as Error);
          },
        },
      );
    },
    [
      writeContract,
      contracts.TimelockController.address,
      queryClient,
      chainId,
      watchdogAddress,
    ],
  );

  /**
   * Mode 2: Download JSON file and open Safe UI (when connected as individual watchdog signer)
   */
  const downloadCancelTransaction = useCallback(
    (operationId: `0x${string}`, onSuccess?: () => void) => {
      // Encode the cancel function call
      const data = encodeFunctionData({
        abi: TimelockControllerABI,
        functionName: "cancel",
        args: [operationId],
      });

      // Build transaction builder URL with pre-filled data
      const txBuilderUrl = new URL(
        "https://app.safe.global/apps/open?safe=" +
          `${chainId === 42220 ? "celo" : "celo-sepolia"}:${watchdogAddress}`,
      );
      txBuilderUrl.searchParams.set(
        "appUrl",
        "https://apps-portal.safe.global/tx-builder",
      );

      // Create a Safe transaction JSON that can be imported
      const safeTxData = {
        version: "1.0",
        chainId: chainId.toString(),
        createdAt: Date.now(),
        meta: {
          name: "Cancel Proposal",
          description: `Cancel queued governance proposal with operation ID: ${operationId}`,
        },
        transactions: [
          {
            to: contracts.TimelockController.address,
            value: "0",
            data: data,
            contractMethod: {
              inputs: [
                { internalType: "bytes32", name: "id", type: "bytes32" },
              ],
              name: "cancel",
              payable: false,
            },
            contractInputsValues: {
              id: operationId,
            },
          },
        ],
      };

      // Create and download the transaction JSON file
      const transactionString = JSON.stringify(safeTxData, null, 2);
      const blob = new Blob([transactionString], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cancel-proposal-${operationId.slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Show toast notification
      toast.success(
        "Transaction file downloaded. Opening Safe Transaction Builder...",
        {
          description:
            "Upload the downloaded JSON file in the Safe app to propose the cancellation to other signers.",
          duration: 6000,
        },
      );

      // Open Safe Transaction Builder after a short delay to ensure download starts
      setTimeout(() => {
        window.open(txBuilderUrl.toString(), "_blank");
      }, 500);

      // Call success callback
      onSuccess?.();
    },
    [contracts.TimelockController.address, chainId, watchdogAddress],
  );

  const cancelProposal = useCallback(
    (
      operationId: `0x${string}`,
      onSuccess?: () => void,
      onError?: (error?: Error) => void,
    ) => {
      try {
        if (isConnectedAsSafe) {
          // Mode 1: Connected AS the Safe itself
          executeCancelDirectly(operationId, onSuccess, onError);
        } else {
          // Mode 2: Connected as individual watchdog signer
          downloadCancelTransaction(operationId, onSuccess);
        }
      } catch (error) {
        console.error("Failed to create Safe transaction:", error);
        Sentry.captureException(error, {
          tags: {
            context: "cancel-proposal",
            mode: isConnectedAsSafe ? "direct-execution" : "file-download",
          },
        });
        toast.error("Failed to prepare cancellation transaction", {
          description:
            "Please try again or contact support if the problem persists.",
        });
        onError?.(error as Error);
      }
    },
    [isConnectedAsSafe, executeCancelDirectly, downloadCancelTransaction],
  );

  return {
    hash: isConnectedAsSafe ? data : undefined,
    cancelProposal,
    isAwaitingUserSignature: isConnectedAsSafe ? isPending : false,
    isConfirming: isConnectedAsSafe ? isConfirming : false,
    isConfirmed: isConnectedAsSafe ? isConfirmed : false,
    error: isConnectedAsSafe ? (restWrite.error ?? undefined) : undefined,
  };
};
