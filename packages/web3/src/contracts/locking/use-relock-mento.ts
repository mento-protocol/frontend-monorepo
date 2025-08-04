import { LockingABI } from "@/abi/Locking";
import { useContracts } from "@/contracts/use-contracts";
import { LockWithExpiration } from "@/types";
import React, { useCallback } from "react";
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
      newDelegate ?? lock.owner?.id,
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

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
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

      writeContract(lockingConfig, {
        onSuccess,
        onError,
      });
    },
    [
      contracts.Locking.address,
      lock?.lockId,
      lock?.owner?.id,
      lockingArgs,
      lockingConfig,
      writeContract,
    ],
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
