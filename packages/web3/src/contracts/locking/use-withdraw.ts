import {
  useWriteContract,
  useWaitForTransactionReceipt,
} from "@repo/web3/wagmi";
import { LockingABI } from "@/abi/Locking";
import { useContracts } from "@/contracts/use-contracts";
import { useEnsureChainId } from "@/features/governance/use-ensure-chain-id";
import React, { useCallback } from "react";
import { WriteContractErrorType } from "viem";

export const useWithdraw = ({
  onConfirmation,
  onError,
}: {
  onConfirmation?: (hash?: `0x${string}`) => void;
  onError?: (error?: WriteContractErrorType) => void;
} = {}) => {
  const { writeContract, data, reset, isPending, error } = useWriteContract();
  const { Locking } = useContracts();
  const ensuredChainId = useEnsureChainId();

  const withdraw = useCallback(() => {
    writeContract({
      address: Locking.address,
      abi: LockingABI,
      functionName: "withdraw",
      chainId: ensuredChainId,
    });
  }, [Locking.address, ensuredChainId, writeContract]);

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError,
  } = useWaitForTransactionReceipt({
    hash: data,
    pollingInterval: 1000,
  });

  React.useEffect(() => {
    if (isConfirmed && onConfirmation) {
      // Add a small delay to ensure we hit the post-transaction block
      const timer = setTimeout(() => {
        onConfirmation(data as `0x${string}`);
        reset();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [isConfirmed, onConfirmation, reset]);

  React.useEffect(() => {
    if (isError) {
      onError?.(error as WriteContractErrorType);
    }
  }, [isError, error]);

  return {
    withdraw,
    isPending,
    isConfirming,
    error,
    hash: data,
  };
};
