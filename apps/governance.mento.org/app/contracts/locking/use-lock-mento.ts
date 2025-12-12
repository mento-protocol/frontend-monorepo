import { useCallback, useEffect, useRef } from "react";
import {
  useWaitForTransactionReceipt,
  useWriteContract,
  type WriteContractErrorType,
} from "@repo/web3/wagmi";
import { LockingABI, useContracts } from "@repo/web3";
import { Address } from "viem";

export const useLockMento = ({
  onLockConfirmation,
}: {
  onLockConfirmation?: () => void;
}) => {
  const contracts = useContracts();
  const onErrorRef = useRef<
    ((error?: WriteContractErrorType) => void) | undefined
  >(undefined);
  const {
    writeContract,
    isPending: isAwaitingUserSignature,
    data,
    ...restWrite
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
    error: receiptError,
  } = useWaitForTransactionReceipt({
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

  // Handle transaction receipt errors
  useEffect(() => {
    if (isReceiptError && receiptError && onErrorRef.current) {
      onErrorRef.current(receiptError as WriteContractErrorType);
    }
  }, [isReceiptError, receiptError]);

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
      // Store onError callback for use in receipt error effect
      onErrorRef.current = onError;

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
