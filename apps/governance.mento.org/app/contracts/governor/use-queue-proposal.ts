import { useCallback } from "react";
import {
  useWaitForTransactionReceipt,
  useWriteContract,
  type WriteContractErrorType,
} from "@repo/web3/wagmi";
import { GovernorABI, useContracts } from "@repo/web3";
import { useQueryClient } from "@tanstack/react-query";
import { ProposalQueryKey } from "@/contracts/governor/use-proposal";

export const useQueueProposal = () => {
  const queryClient = useQueryClient();
  const contracts = useContracts();
  const {
    writeContract,
    isPending: isAwaitingUserSignature,
    data,
    ...restWrite
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash: data,
    });

  const queueProposal = useCallback(
    (
      proposalId: bigint,
      onSuccess?: () => void,
      onError?: (error?: WriteContractErrorType) => void,
    ) => {
      writeContract(
        {
          address: contracts.MentoGovernor.address,
          abi: GovernorABI,
          functionName: "queue",
          args: [BigInt(proposalId).valueOf()],
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

  return {
    hash: data,
    queueProposal,
    isAwaitingUserSignature,
    isConfirming,
    isConfirmed,
    ...restWrite,
  };
};
