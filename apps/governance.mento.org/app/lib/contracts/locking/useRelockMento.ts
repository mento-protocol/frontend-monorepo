import { LockingABI } from "@/lib/abi/Locking";
import { useContracts } from "@/lib/contracts/useContracts";
import { LockWithExpiration } from "@/lib/interfaces/lock.interface";
import * as Sentry from "@sentry/nextjs";
import React, { useCallback } from "react";
import { Address } from "viem";
import {
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { WriteContractErrorType } from "wagmi/actions";
import useLockedAmount from "./useLockedAmount";

interface RelockMentoParams {
  newDelegate?: Address;
  additionalAmountToLock?: bigint;
  newSlope: number;
  newCliff?: number;
  lock?: LockWithExpiration;
  onConfirmation?: () => void;
}

const useRelockMento = ({
  lock,
  additionalAmountToLock,
  newCliff,
  newDelegate,
  newSlope,
  onConfirmation,
}: RelockMentoParams) => {
  const contracts = useContracts();
  const { data: lockedBalance, refetch: refetchLockedBalance } =
    useLockedAmount();

  const {
    writeContract,
    isPending: isAwaitingUserSignature,
    data,
    ...restWrite
  } = useWriteContract();

  const lockingArgs = React.useMemo(() => {
    if (!lock || !lockedBalance || typeof newSlope !== "number") return null;

    // Ensure lock has required properties
    if (!lock.lockId || !lock.owner?.id || lock.cliff === undefined) {
      console.warn("Lock object is missing required properties");
      return null;
    }

    const newTotalLockedAmount = (additionalAmountToLock ?? 0n) + lockedBalance;
    return [
      lock.lockId,
      newDelegate ?? lock.owner?.id,
      newTotalLockedAmount,
      newSlope,
      newCliff ?? lock.cliff,
    ] as const;
  }, [
    lock,
    lockedBalance,
    additionalAmountToLock,
    newCliff,
    newDelegate,
    newSlope,
  ]);

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
        onError: (error) => {
          Sentry.captureException(error, {
            data: {
              function: "useRelockMento",
              lockId: lock?.lockId,
              user: lock?.owner?.id,
              contract: contracts.Locking.address,
              contractArgs: JSON.stringify(lockingArgs),
            },
          });

          onError?.(error);
        },
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

export default useRelockMento;
