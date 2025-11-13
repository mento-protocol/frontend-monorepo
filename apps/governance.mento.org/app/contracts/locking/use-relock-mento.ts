import { LockingABI, useContracts } from "@repo/web3";
import { LockWithExpiration } from "@/contracts/types";
import React, { useCallback, useRef } from "react";
import { Address } from "viem";
import {
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { WriteContractErrorType } from "wagmi/actions";
import { useLockedAmount } from "./use-locked-amount";

interface RelockMentoParams {
  newDelegate?: Address;
  additionalAmountToLock?: bigint;
  newSlope: number;
  newCliff?: number;
  lock?: LockWithExpiration;
  onConfirmation?: () => void;
}

export const useRelockMento = ({
  lock,
  additionalAmountToLock,
  newCliff,
  newDelegate,
  newSlope,
  onConfirmation,
}: RelockMentoParams) => {
  const contracts = useContracts();
  const { refetch: refetchLockedBalance } = useLockedAmount();
  const onErrorRef = useRef<
    ((error?: WriteContractErrorType) => void) | undefined
  >(undefined);

  const {
    writeContract,
    isPending: isAwaitingUserSignature,
    data,
    ...restWrite
  } = useWriteContract();

  const lockingArgs = React.useMemo(() => {
    if (!lock || typeof newSlope !== "number") return null;

    // Ensure lock has required properties
    if (
      !lock.lockId ||
      !lock.owner?.id ||
      lock.cliff === undefined ||
      !lock.amount
    ) {
      console.warn("Lock object is missing required properties");
      return null;
    }

    // Calculate new total for this specific lock (not all locks)
    const currentLockAmount = BigInt(lock.amount);
    const newTotalLockedAmount =
      (additionalAmountToLock ?? 0n) + currentLockAmount;

    return [
      lock.lockId,
      // Default to existing delegate to preserve current delegation unless explicitly changed
      (newDelegate ?? lock?.delegate?.id ?? lock.owner?.id) as Address,
      newTotalLockedAmount,
      newSlope,
      newCliff ?? lock.cliff,
    ] as const;
  }, [lock, additionalAmountToLock, newCliff, newDelegate, newSlope]);

  const lockingConfig = React.useMemo(() => {
    if (!lockingArgs) return null;

    return {
      address: contracts.Locking.address,
      abi: LockingABI,
      functionName: "relock",
      args: lockingArgs,
    } as const;
  }, [contracts.Locking.address, lockingArgs]);

  const simulation = useSimulateContract(lockingConfig ?? {});

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: data,
  });

  React.useEffect(() => {
    if (isConfirmed && onConfirmation) {
      refetchLockedBalance();
      restWrite.reset();

      onConfirmation();

      const timeout1 = setTimeout(() => {
        refetchLockedBalance();
        onConfirmation();
      }, 2000);

      const timeout2 = setTimeout(() => {
        refetchLockedBalance();
        onConfirmation();
      }, 5000);

      return () => {
        clearTimeout(timeout1);
        clearTimeout(timeout2);
      };
    }
  }, [isConfirmed, onConfirmation, restWrite, refetchLockedBalance]);

  // Handle transaction receipt errors
  React.useEffect(() => {
    if (isReceiptError && receiptError && onErrorRef.current) {
      onErrorRef.current(receiptError as WriteContractErrorType);
    }
  }, [isReceiptError, receiptError]);

  const relockMento = useCallback(
    ({
      onSuccess,
      onError,
    }: {
      onSuccess?: () => void;
      onError?: (error?: WriteContractErrorType) => void;
    } = {}) => {
      if (!lockingConfig) {
        const error = new Error(
          "Cannot relock: missing or invalid lock configuration",
        );
        onError?.(error as WriteContractErrorType);
        return;
      }

      // Store onError callback for use in receipt error effect
      onErrorRef.current = onError;

      writeContract(lockingConfig, {
        onSuccess,
        onError,
      });
    },
    [lockingConfig, writeContract],
  );

  return {
    canRelock: !!lock && simulation.isSuccess,
    hash: data,
    relockMento,
    isAwaitingUserSignature,
    isConfirming,
    isConfirmed,
    ...restWrite,
  };
};
