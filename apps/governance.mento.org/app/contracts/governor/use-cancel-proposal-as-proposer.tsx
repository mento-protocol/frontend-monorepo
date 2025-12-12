import { GovernorABI } from "@repo/web3";
import { ProposalQueryKey } from "@/contracts/governor/use-proposal";
import { useContracts } from "@repo/web3";
import { useCurrentChain } from "@/hooks/use-current-chain";
import { toast } from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
  type WriteContractErrorType,
} from "@repo/web3/wagmi";
import * as Sentry from "@sentry/nextjs";

/**
 * Hook to cancel a proposal as the proposer.
 * Calls MentoGovernor.cancel(proposalId)
 * Only works for proposals in Pending, Active, or Succeeded states.
 */
export const useCancelProposalAsProposer = () => {
  const queryClient = useQueryClient();
  const contracts = useContracts();
  const { chainId } = useAccount();
  const currentChain = useCurrentChain();
  const {
    writeContract,
    isPending: isAwaitingUserSignature,
    data,
    error,
    ...restWrite
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash: data,
    });

  const cancelProposalAsProposer = useCallback(
    (
      proposalId: bigint,
      onSuccess?: () => void,
      onError?: (error?: WriteContractErrorType) => void,
    ) => {
      writeContract(
        {
          address: contracts.MentoGovernor.address,
          abi: GovernorABI,
          functionName: "cancel",
          args: [proposalId],
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: [ProposalQueryKey],
            });
            onSuccess?.();
          },
          onError,
        },
      );
    },
    [contracts.MentoGovernor.address, queryClient, writeContract],
  );

  // Toast notifications for proposal cancellation
  useEffect(() => {
    if (error) {
      const errorMessage = error.message || "";
      const isUserRejection =
        errorMessage.includes("User rejected") ||
        errorMessage.includes("user rejected") ||
        errorMessage.includes("User denied");

      if (isUserRejection) {
        toast.error("Cancellation rejected by user");
      } else {
        // Send non-rejection errors to Sentry
        Sentry.captureException(error, {
          tags: {
            context: "cancel-proposal-as-proposer",
          },
        });
        toast.error("Failed to cancel proposal");
      }
    } else if (isConfirmed && data) {
      const explorerUrl = currentChain?.blockExplorers?.default?.url;
      const explorerTxUrl = explorerUrl ? `${explorerUrl}/tx/${data}` : null;

      const message = "Proposal cancelled successfully!";
      const detailsElement = explorerTxUrl ? (
        <a
          href={explorerTxUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline", color: "inherit" }}
        >
          See Details
        </a>
      ) : (
        <span>See Details</span>
      );

      toast.success(
        <>
          {message} <br /> {detailsElement}
        </>,
      );
    }
  }, [
    currentChain?.blockExplorers?.default?.url,
    error,
    isConfirmed,
    data,
    chainId,
  ]);

  return {
    hash: data,
    cancelProposalAsProposer,
    isAwaitingUserSignature,
    isConfirming,
    isConfirmed,
    error,
    ...restWrite,
  };
};
