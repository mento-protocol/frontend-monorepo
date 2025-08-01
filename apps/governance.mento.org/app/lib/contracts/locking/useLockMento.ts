import { useCallback, useEffect } from "react";
import { useContracts } from "@/lib/contracts/useContracts";
import {
  useWaitForTransactionReceipt,
  useWriteContract,
} from "@repo/web3/wagmi";
import { LockingABI } from "@/lib/abi/Locking";
import { Address } from "viem";
import { WriteContractErrorType } from "wagmi/actions";

const useLockMento = ({
  onLockConfirmation,
}: {
  onLockConfirmation?: () => void;
}) => {
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
      confirmations: 10,
    });

  useEffect(() => {
    if (isConfirmed && onLockConfirmation) {
      onLockConfirmation();
      restWrite.reset();

      const timeout1 = setTimeout(() => {
        onLockConfirmation();
      }, 2000);

      const timeout2 = setTimeout(() => {
        onLockConfirmation();
      }, 5000);

      return () => {
        clearTimeout(timeout1);
        clearTimeout(timeout2);
      };
    }
  }, [isConfirmed, onLockConfirmation, restWrite]);

  const lockMento = useCallback(
    ({
      account,
      delegate,
      amount,
      slope,
      cliff,
      onSuccess,
      onError,
    }: {
      account: Address;
      delegate: Address;
      amount: bigint;
      slope: number;
      cliff: number;
      onSuccess?: () => void;
      onError?: (error?: WriteContractErrorType) => void;
    }) => {
      writeContract(
        {
          address: contracts.Locking.address,
          abi: LockingABI,
          functionName: "lock",
          args: [account, delegate, amount, slope, cliff],
        },
        {
          onSuccess,
          onError,
        },
      );
    },
    [contracts.Locking.address, writeContract],
  );

  return {
    hash: data,
    lockMento,
    isAwaitingUserSignature,
    isConfirming,
    isConfirmed,
    ...restWrite,
  };
};

export default useLockMento;
