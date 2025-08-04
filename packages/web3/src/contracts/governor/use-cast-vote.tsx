import { useCallback, useEffect } from "react";
import {
  useWaitForTransactionReceipt,
  useWriteContract,
  useAccount,
} from "@repo/web3/wagmi";
import { useContracts } from "@/contracts/use-contracts";
import { GovernorABI } from "@/abi/Governor";
import { WriteContractErrorType } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { ProposalQueryKey } from "@/contracts/governor/use-proposal";
import { toast } from "@repo/ui";
import { Celo, Alfajores } from "@/config/chains";

const useCastVote = () => {
  const queryClient = useQueryClient();
  const contracts = useContracts();
  const { chainId } = useAccount();
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

  const castVote = useCallback(
    (
      proposalId: bigint,
      support: number,
      onSuccess?: () => void,
      onError?: (error?: WriteContractErrorType) => void,
    ) => {
      writeContract(
        {
          address: contracts.MentoGovernor.address,
          abi: GovernorABI,
          functionName: "castVote",
          args: [proposalId, support],
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

  // Toast notifications for vote casting
  useEffect(() => {
    if (error) {
      if (error.message?.includes("User rejected request")) {
        toast.error("Vote transaction rejected by user");
      } else {
        toast.error("Failed to cast vote");
      }
    } else if (isConfirmed && data) {
      const currentChain = chainId === Celo.id ? Celo : Alfajores;
      const explorerUrl = currentChain.blockExplorers?.default?.url;
      const explorerTxUrl = explorerUrl ? `${explorerUrl}/tx/${data}` : null;

      const message = "Vote cast successfully!";
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
  }, [error, isConfirmed, data, chainId]);

  return {
    hash: data,
    castVote,
    isAwaitingUserSignature,
    isConfirming,
    isConfirmed,
    error,
    ...restWrite,
  };
};

export default useCastVote;
