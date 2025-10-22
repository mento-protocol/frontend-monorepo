import { useCallback } from "react";
import { Address, erc20Abi } from "viem";
import {
  useConfig,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  waitForTransactionReceipt,
  WriteContractErrorType,
} from "wagmi/actions";
import { useContracts } from "@repo/web3";

interface ApproveParams {
  target: Address;
  amount: bigint;
  onSuccess?: () => void;
  onError?: (error?: WriteContractErrorType) => void;
  onConfirmation?: () => void;
}

export const useApprove = () => {
  const contracts = useContracts();
  const {
    writeContract,
    isPending: isAwaitingUserSignature,
    data,
    ...restWrite
  } = useWriteContract();
  const config = useConfig();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash: data,
      pollingInterval: 1000,
    });
  const approveMento = useCallback(
    (params: ApproveParams) => {
      const { target, amount, onConfirmation, onError } = params;

      writeContract(
        {
          address: contracts.MentoToken.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [target, amount],
        },
        {
          onSuccess: async (data) => {
            try {
              await waitForTransactionReceipt(config, {
                hash: data,
                pollingInterval: 1000,
                confirmations: 2,
              });
              onConfirmation?.();
            } catch (error) {
              console.error(error);
              onError?.(error as WriteContractErrorType);
            }
          },
          onError,
        },
      );
    },
    [config, contracts.MentoToken.address, writeContract],
  );

  return {
    hash: data,
    approveMento,
    isAwaitingUserSignature,
    isConfirming,
    isConfirmed,
    ...restWrite,
  };
};
